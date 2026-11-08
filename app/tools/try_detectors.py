"""Thử mô hình nhận diện theo từ khóa (zero-shot) trên khung hình kho: có nhận ra kiện hàng không?

Chạy trong .venv-ml (PyTorch + transformers):
    .venv-ml\\Scripts\\python -m app.tools.try_detectors VIDEO OUTDIR --times 672.64,690.16 --crop 700,250,460,320

Vẽ khung kết quả lên ảnh để người xem đánh giá. Không gửi ảnh ra ngoài: mô hình tải về và chạy trên máy.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

PROMPTS = ["parcel", "package", "cardboard box", "plastic mailer bag", "hand", "person", "green sack"]
COLORS = {"parcel": (0, 255, 255), "package": (0, 255, 255), "cardboard box": (0, 200, 255),
          "plastic mailer bag": (255, 0, 255), "hand": (0, 0, 255), "person": (255, 128, 0), "green sack": (0, 255, 0)}


def load(name, dev):
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection, Owlv2Processor, Owlv2ForObjectDetection
    if name == "gdino":
        ck = "IDEA-Research/grounding-dino-tiny"
        return AutoProcessor.from_pretrained(ck), AutoModelForZeroShotObjectDetection.from_pretrained(ck).to(dev).eval()
    ck = "google/owlv2-base-patch16-ensemble"
    return Owlv2Processor.from_pretrained(ck), Owlv2ForObjectDetection.from_pretrained(ck).to(dev).eval()


@torch.no_grad()
def detect(name, proc, model, img, dev, thr):
    if name == "gdino":
        text = ". ".join(PROMPTS) + "."
        inp = proc(images=img, text=text, return_tensors="pt").to(dev)
        out = model(**inp)
        r = proc.post_process_grounded_object_detection(out, inp.input_ids, threshold=thr, text_threshold=0.25,
                                                        target_sizes=[img.size[::-1]])[0]
        labels = r.get("text_labels", r.get("labels"))
        return [(b.tolist(), float(s), str(l)) for b, s, l in zip(r["boxes"], r["scores"], labels)]
    inp = proc(text=[PROMPTS], images=img, return_tensors="pt").to(dev)
    out = model(**inp)
    # OWLv2 đệm ảnh thành hình vuông: target_sizes là cạnh lớn
    side = max(img.size)
    r = proc.post_process_object_detection(outputs=out, target_sizes=torch.tensor([[side, side]]).to(dev), threshold=thr)[0]
    return [(b.tolist(), float(s), PROMPTS[int(l)]) for b, s, l in zip(r["boxes"], r["scores"], r["labels"])]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("outdir")
    ap.add_argument("--times", required=True)
    ap.add_argument("--crop", default=None, help="x,y,w,h vùng cắt (phóng to vật nhỏ)")
    ap.add_argument("--scale", type=float, default=2.0)
    ap.add_argument("--models", default="gdino,owlv2")
    ap.add_argument("--thr", type=float, default=0.2)
    a = ap.parse_args(argv)
    out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    cap = cv2.VideoCapture(a.video)
    frames = []
    for t in [float(x) for x in a.times.split(",")]:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, f = cap.read()
        if a.crop:
            x, y, w, h = (int(v) for v in a.crop.split(","))
            f = f[y:y + h, x:x + w]
        f = cv2.resize(f, None, fx=a.scale, fy=a.scale, interpolation=cv2.INTER_CUBIC)
        frames.append((t, f))
    for name in a.models.split(","):
        proc, model = load(name, dev)
        tiles = []
        for t, f in frames:
            img = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
            t0 = time.time(); dets = detect(name, proc, model, img, dev, a.thr); ms = (time.time() - t0) * 1000
            vis = f.copy()
            for (x0, y0, x1, y1), s, lab in dets:
                c = COLORS.get(lab, (255, 255, 255))
                cv2.rectangle(vis, (int(x0), int(y0)), (int(x1), int(y1)), c, 2)
                cv2.putText(vis, f"{lab} {s:.2f}", (int(x0), max(12, int(y0) - 3)), 0, 0.45, c, 1)
            cv2.putText(vis, f"{name} t={t:.2f} {ms:.0f}ms", (5, 20), 0, 0.6, (255, 255, 255), 2)
            tiles.append(vis)
            print(name, t, f"{ms:.0f}ms", [(lab, round(s, 2)) for _, s, lab in dets])
        rows = [np.hstack(tiles[i:i + 2]) if i + 1 < len(tiles) else np.hstack([tiles[i], np.zeros_like(tiles[i])]) for i in range(0, len(tiles), 2)]
        cv2.imwrite(str(out / f"{name}.jpg"), np.vstack(rows))
        del model; torch.cuda.empty_cache()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
