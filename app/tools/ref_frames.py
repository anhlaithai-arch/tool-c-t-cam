"""Tạo dữ liệu đối chiếu cho Spike A (tua đúng khung trong trình duyệt).

Giải mã video TUẦN TỰ (không seek) để có khung hình chuẩn, chọn N khung có chuyển động rõ
(khác nhiều so với khung trước và sau, để phân biệt được lệch ±1 khung), rồi lưu ảnh thu nhỏ
xám của khung i-1, i, i+1 vào JSON.

    python -m app.tools.ref_frames VIDEO OUT.json [--n 100]
"""
from __future__ import annotations

import argparse
import base64
import json

import cv2
import numpy as np

TW, TH = 160, 90  # kích thước ảnh thu nhỏ; trình duyệt dùng cùng kích thước


def thumb(frame: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.resize(g, (TW, TH), interpolation=cv2.INTER_AREA)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--n", type=int, default=100)
    a = ap.parse_args(argv)

    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Lượt 1: độ khác biệt với khung trước (tuần tự)
    prev, diffs, i = None, [], 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        t = thumb(f).astype(np.int16)
        diffs.append(0.0 if prev is None else float(np.abs(t - prev).mean()))
        prev, i = t, i + 1
    total = i
    d = np.array(diffs + [0.0])
    # khung i "rõ" khi khác cả khung trước (d[i]) và khung sau (d[i+1])
    score = np.minimum(d[:-1], d[1:])
    score[:2] = 0
    score[-2:] = 0

    # chọn N khung trải đều: chia video thành N đoạn, lấy khung điểm cao nhất mỗi đoạn
    edges = np.linspace(2, total - 2, a.n + 1).astype(int)
    picks = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        if hi > lo:
            j = lo + int(score[lo:hi].argmax())
            picks.append(int(j))
    need = set()
    for j in picks:
        need.update((j - 1, j, j + 1))

    # Lượt 2: lấy ảnh thu nhỏ cho các khung cần
    cap.release()
    cap = cv2.VideoCapture(a.video)
    thumbs, pts, i = {}, {}, 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i in need:
            thumbs[i] = base64.b64encode(thumb(f).tobytes()).decode("ascii")
            pts[i] = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0  # PTS của khung vừa đọc
        i += 1

    out = {
        "fps": fps, "frameCount": total, "frameCountHeader": n, "w": TW, "h": TH,
        "targets": [
            {"index": j, "score": round(float(score[j]), 2),
             "ptsPrev": round(pts[j - 1], 4), "pts": round(pts[j], 4), "ptsNext": round(pts[j + 1], 4),
             "prev": thumbs[j - 1], "cur": thumbs[j], "next": thumbs[j + 1]}
            for j in picks
        ],
    }
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    s = np.array([t["score"] for t in out["targets"]])
    print(f"frames={total} fps={fps} targets={len(picks)} score min/median={s.min():.2f}/{np.median(s):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
