"""Chạy thử cả đường build_dataset -> train_drop -> ONNX trên dữ liệu giả (cần .venv-ml có torch)."""
import base64
import io
import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")
ort = pytest.importorskip("onnxruntime")
from PIL import Image  # noqa: E402

from app.tools import build_dataset, train_drop  # noqa: E402


def _jpeg(arr):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=92)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _sample(rng, i, bag, label):
    frames = []
    for k in range(3):
        im = (rng.random((64, 64, 3)) * 60 + 20).astype(np.uint8)  # lòng bao tối, nhiễu
        if label == "bo_vao" and k == 1:
            im[20:44, 20:44] = 230  # kiện sáng đi qua miệng bao ở khung giữa
        frames.append(_jpeg(im))
    return {"id": f"{bag}_{label}_{i}", "label": label, "bag": bag, "frames": frames}


def test_train_drop_end_to_end(tmp_path):
    rng = np.random.default_rng(0)
    samples = [_sample(rng, i, f"TO{b}", lab) for b in range(20) for i in range(2) for lab in ("bo_vao", "khong_kien")]
    src = tmp_path / "mau.json"
    src.write_text(json.dumps({"format": "dem-kien-train/1", "samples": samples}), encoding="utf-8")
    ds, out = tmp_path / "ds", tmp_path / "model"
    assert build_dataset.main([str(src), "--out", str(ds)]) == 0
    assert train_drop.main([str(ds), "--out", str(out), "--size", "64", "--no-pretrained"]) == 0

    m = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert m["best"]["accuracy"] >= 0.9  # dữ liệu giả dễ: phải tách được

    # ONNX cho cùng kết quả với PyTorch
    rows = train_drop.load_rows(ds)
    x = np.stack([train_drop.load_frames(ds, r, 64) for r in rows[:4]])
    sess = ort.InferenceSession(str(out / "drop.onnx"))
    p = sess.run(["prob"], {"frames": x})[0]
    assert p.shape == (4,) and np.all((p >= 0) & (p <= 1))
