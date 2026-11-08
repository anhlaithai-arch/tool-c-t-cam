"""Thử nhận diện tư thế nhiều người (RTMO, Apache-2.0 qua rtmlib) trên khung kho: có thấy cổ tay người bắn hàng không?

    .venv-ml\\Scripts\\python -m app.tools.try_pose VIDEO OUT.jpg --times 672.2,672.4,672.6,672.8 --crop 700,250,460,320
"""
from __future__ import annotations

import argparse
import time

import cv2
import numpy as np

# COCO-17: 9 = cổ tay trái, 10 = cổ tay phải
SKELETON = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (0, 5), (0, 6)]
PALETTE = [(255, 128, 0), (0, 200, 0), (255, 0, 255), (0, 128, 255), (255, 255, 0), (128, 0, 255)]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("out")
    ap.add_argument("--times", required=True)
    ap.add_argument("--crop", default=None)
    ap.add_argument("--device", default="cuda")
    a = ap.parse_args(argv)
    from rtmlib import RTMO
    model = RTMO("https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211.zip",
                 model_input_size=(640, 640), backend="onnxruntime", device=a.device)
    cap = cv2.VideoCapture(a.video)
    tiles = []
    for t in [float(x) for x in a.times.split(",")]:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, f = cap.read()
        t0 = time.time(); kps, scores = model(f); ms = (time.time() - t0) * 1000
        vis = f.copy()
        for p, (k, s) in enumerate(zip(kps, scores)):
            c = PALETTE[p % len(PALETTE)]
            for i, j in SKELETON:
                if s[i] > 0.3 and s[j] > 0.3:
                    cv2.line(vis, tuple(int(v) for v in k[i]), tuple(int(v) for v in k[j]), c, 2)
            for w in (9, 10):
                if s[w] > 0.3:
                    cv2.circle(vis, tuple(int(v) for v in k[w]), 7, (0, 0, 255), 2)
                    cv2.putText(vis, f"{s[w]:.2f}", (int(k[w][0]) + 8, int(k[w][1])), 0, 0.4, (0, 0, 255), 1)
        if a.crop:
            x, y, w, h = (int(v) for v in a.crop.split(","))
            vis = cv2.resize(vis[y:y + h, x:x + w], None, fx=1.5, fy=1.5)
        cv2.putText(vis, f"t={t:.2f} {ms:.0f}ms n={len(kps)}", (5, 20), 0, 0.6, (255, 255, 255), 2)
        tiles.append(vis)
        print(t, f"{ms:.0f}ms", "người:", len(kps), "cổ tay>0.3:", int(sum((s[9] > 0.3) + (s[10] > 0.3) for s in scores)))
    rows = [np.hstack(tiles[i:i + 2]) if i + 1 < len(tiles) else np.hstack([tiles[i], np.zeros_like(tiles[i])]) for i in range(0, len(tiles), 2)]
    cv2.imwrite(a.out, np.vstack(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
