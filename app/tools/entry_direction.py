"""Hướng vật đi vào miệng bao: chuyển động ở dải bao quanh miệng bao ngay trước lượt -> góc (độ) so với tâm miệng bao.

    python -m app.tools.entry_direction VIDEO data\\eval\\center_660_850 tests\\fixtures\\eval_labels_center_660_850.json

Góc: 0° = bên phải, 90° = phía dưới, 180° = bên trái, 270° = phía trên (trục y ảnh hướng xuống).
"""
from __future__ import annotations

import argparse
import json
import math

import cv2
import numpy as np


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("evaldir"); ap.add_argument("labels")
    ap.add_argument("--ring", type=int, default=70)
    ap.add_argument("--before", type=float, default=0.4)
    a = ap.parse_args(argv)
    C = json.load(open(f"{a.evaldir}/candidates.json"))
    X, Y, W, H = C["roi"]
    L = json.load(open(a.labels, encoding="utf-8"))
    lab = {n: k for k in ["tp", "fp", "unsure", "occ_toss", "occ_none", "weak_none"] for n in L[k]}
    who = {int(k): v for k, v in L["who"].items()}
    cap = cv2.VideoCapture(a.video)
    R = a.ring
    x0, y0, x1, y1 = X - R, Y - R, X + W + R, Y + H + R
    cx, cy = X + W / 2 - x0, Y + H / 2 - y0
    yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0]
    ring = np.ones_like(xx, bool); ring[R:R + H, R:R + W] = False
    rows = []
    for c in C["candidates"]:
        if c["source"] != "tool":
            continue
        cap.set(cv2.CAP_PROP_POS_MSEC, (c["startS"] - a.before - 0.08) * 1000)
        prev, acc = None, np.zeros(ring.shape, np.float32)
        while True:
            ok, f = cap.read()
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if not ok or t > c["peakS"] + 0.01:
                break
            g = cv2.blur(cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY), (3, 3)).astype(np.int16)
            if prev is not None:
                acc += (np.abs(g - prev) > 18) * ring
            prev = g
        wsum = acc.sum()
        if wsum < 30:
            ang, mag, ex, ey = None, 0, None, None
        else:
            mx, my = (acc * xx).sum() / wsum - cx, (acc * yy).sum() / wsum - cy
            ang, mag = math.degrees(math.atan2(my, mx)) % 360, float(wsum)
            ex, ey = round(mx + cx + x0), round(my + cy + y0)  # điểm vào (tọa độ khung gốc)
        rows.append((c["n"], lab.get(c["n"]), who.get(c["n"]), c["kind"], None if ang is None else round(ang), round(mag), ex, ey))
    for grp in ("M", "G", "O", None):
        sel = [r for r in rows if r[2] == grp]
        print(f"--- who={grp} ({len(sel)})")
        for r in sel:
            print("  ", r)
    json.dump(rows, open(f"{a.evaldir}/entry_direction.json", "w"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
