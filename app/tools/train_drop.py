"""Huấn luyện bộ phân loại "kiện đi vào bao" từ bộ dữ liệu của build_dataset.py, xuất ONNX cho trình duyệt.

    .venv-ml\\Scripts\\python -m app.tools.train_drop data\\dataset --out data\\models\\drop

Mô hình: MobileNetV3-small (ImageNet, đóng băng) rút đặc trưng từng khung trong 3 khung (-0,4 / 0 / +0,4 s),
ghép [f0, f1, f2, f1-f0, f2-f1] -> lớp tuyến tính -> xác suất "bo_vao". Chỉ học lớp cuối: chạy nhanh trên CPU,
hợp với vài trăm mẫu. Nhãn: bo_vao = 1; sai, khong_kien = 0. Tập train/val lấy theo cột split (chia theo phiếu TO).

Kết quả trong --out:
  drop.onnx     đầu vào "frames" float32 [N, 3 khung, 3 màu, S, S], RGB 0..1; đầu ra "prob" [N]
  metrics.json  độ chính xác / độ phủ trên val ở ngưỡng 0,5 và ngưỡng tốt nhất, theo từng phiếu TO
"""
from __future__ import annotations

import argparse
import sys
import csv
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch import nn

POS = "bo_vao"
NEG = {"sai", "khong_kien"}
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]


class DropNet(nn.Module):
    def __init__(self, backbone: nn.Module, dim: int):
        super().__init__()
        self.backbone = backbone
        self.head = nn.Linear(dim * 5, 1)
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

    def features(self, x: torch.Tensor) -> torch.Tensor:
        n = x.shape[0]
        f = self.backbone((x.flatten(0, 1) - self.mean) / self.std).view(n, 3, -1)
        return torch.cat([f[:, 0], f[:, 1], f[:, 2], f[:, 1] - f[:, 0], f[:, 2] - f[:, 1]], 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.head(self.features(x))).squeeze(1)


def make_model(pretrained: bool = True) -> DropNet:
    from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small
    m = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT if pretrained else None)
    backbone = nn.Sequential(m.features, m.avgpool, nn.Flatten())
    for p in backbone.parameters():
        p.requires_grad = False
    return DropNet(backbone.eval(), 576)


def load_rows(data: Path) -> list[dict]:
    with open(data / "manifest.csv", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r["label"] == POS or r["label"] in NEG]
    for r in rows:
        r["y"] = 1.0 if r["label"] == POS else 0.0
    return rows


def load_frames(data: Path, r: dict, size: int) -> np.ndarray:
    fr = []
    for i in range(3):
        im = Image.open(data / r["label"] / f"{r['id']}_f{i}.jpg").convert("RGB").resize((size, size), Image.BILINEAR)
        fr.append(np.asarray(im, dtype=np.float32).transpose(2, 0, 1) / 255.0)
    return np.stack(fr)


@torch.no_grad()
def extract(model: DropNet, data: Path, rows: list[dict], size: int, batch: int = 32) -> torch.Tensor:
    out = []
    for k in range(0, len(rows), batch):
        x = torch.from_numpy(np.stack([load_frames(data, r, size) for r in rows[k:k + batch]]))
        out.append(model.features(x))
    return torch.cat(out) if out else torch.zeros(0, model.head.in_features)


def train_head(model: DropNet, X: torch.Tensor, y: torch.Tensor, epochs: int, lr: float, wd: float) -> None:
    pos = float(y.sum())
    pw = torch.tensor((len(y) - pos) / max(pos, 1.0))  # cân lớp: ít mẫu dương thì phạt sai dương nặng hơn
    mu, sd = X.mean(0), X.std(0) + 1e-6
    head = nn.Linear(X.shape[1], 1)
    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=wd)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pw)
    Xn = (X - mu) / sd
    for _ in range(epochs):
        opt.zero_grad()
        loss_fn(head(Xn).squeeze(1), y).backward()
        opt.step()
    # gộp chuẩn hóa vào lớp cuối để ONNX nhận đặc trưng thô
    with torch.no_grad():
        model.head.weight.copy_(head.weight / sd)
        model.head.bias.copy_(head.bias - (head.weight / sd * mu).sum(1))


def scores(p: np.ndarray, y: np.ndarray, thr: float) -> dict:
    pred = p >= thr
    tp = int((pred & (y == 1)).sum()); fp = int((pred & (y == 0)).sum()); fn = int((~pred & (y == 1)).sum())
    return dict(threshold=round(thr, 3), accuracy=round(float((pred == (y == 1)).mean()), 4) if len(y) else None,
                precision=round(tp / (tp + fp), 4) if tp + fp else None, recall=round(tp / (tp + fn), 4) if tp + fn else None,
                tp=tp, fp=fp, fn=fn, n=int(len(y)))


def best_threshold(p: np.ndarray, y: np.ndarray) -> float:
    best, bt = -1.0, 0.5
    for t in np.arange(0.05, 0.96, 0.05):
        s = scores(p, y, float(t))
        f1 = 2 * s["tp"] / (2 * s["tp"] + s["fp"] + s["fn"]) if s["tp"] else 0.0
        if f1 > best + 1e-9 or (abs(f1 - best) <= 1e-9 and abs(t - 0.5) < abs(bt - 0.5)):  # hòa: gần 0,5
            best, bt = f1, float(t)
    return bt


def export_onnx(model: DropNet, path: Path, size: int) -> None:
    x = torch.rand(1, 3, 3, size, size)
    torch.onnx.export(model, (x,), str(path), input_names=["frames"], output_names=["prob"],
                      dynamic_axes={"frames": {0: "n"}, "prob": {0: "n"}}, opset_version=17, dynamo=False)


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # console Windows mặc định cp1252, không in được tiếng Việt
    ap = argparse.ArgumentParser()
    ap.add_argument("data", help="thư mục build_dataset.py tạo (có manifest.csv)")
    ap.add_argument("--out", default="data/models/drop")
    ap.add_argument("--size", type=int, default=128, help="cạnh ảnh đưa vào mô hình")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--lr", type=float, default=0.01)
    ap.add_argument("--wd", type=float, default=0.05)
    ap.add_argument("--no-pretrained", action="store_true", help="không tải trọng số ImageNet (chỉ để kiểm thử)")
    a = ap.parse_args(argv)
    data, out = Path(a.data), Path(a.out)
    torch.manual_seed(0)

    rows = load_rows(data)
    tr = [r for r in rows if r["split"] == "train"]
    va = [r for r in rows if r["split"] == "val"]
    if not tr or not any(r["y"] for r in tr) or all(r["y"] for r in tr):
        print("Thiếu mẫu: tập train cần cả mẫu bo_vao và mẫu âm (sai / khong_kien).")
        return 1
    if not va:
        print("Cảnh báo: không có tập val (cần mẫu từ >= 2 phiếu TO) – số đo dưới đây là trên chính tập train.")
        va = tr
    print(f"train {len(tr)} mẫu ({int(sum(r['y'] for r in tr))} bo_vao), val {len(va)} mẫu")

    model = make_model(pretrained=not a.no_pretrained)
    Xtr, Xva = extract(model, data, tr, a.size), extract(model, data, va, a.size)
    ytr = torch.tensor([r["y"] for r in tr]); yva = np.array([r["y"] for r in va])
    train_head(model, Xtr, ytr, a.epochs, a.lr, a.wd)
    model.eval()
    with torch.no_grad():
        pva = torch.sigmoid(model.head(Xva)).squeeze(1).numpy()

    thr = best_threshold(pva, yva)
    by_bag = {}
    for bag in sorted({r["bag"] for r in va}):
        m = np.array([r["bag"] == bag for r in va])
        by_bag[bag] = scores(pva[m], yva[m], thr)
    metrics = dict(train=len(tr), val=len(va), size=a.size, at_0_5=scores(pva, yva, 0.5), best=scores(pva, yva, thr), by_bag=by_bag)

    out.mkdir(parents=True, exist_ok=True)
    export_onnx(model, out / "drop.onnx", a.size)
    (out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print("val ngưỡng 0,5:", metrics["at_0_5"])
    print("val ngưỡng tốt nhất:", metrics["best"])
    print("->", out / "drop.onnx")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
