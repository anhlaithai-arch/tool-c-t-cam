"""Tự tìm CHỖ bỏ kiện của một phiếu TO bằng lưới ô: ô nào có chuyển động khớp nhịp quét nhất.

    python -m app.tools.find_bag_grid VIDEO TO.xlsx SYNC_JSON OUTDIR [--max-off 3]

Không cần tách bao trước. Khung thu nhỏ 4 lần; ô 12x12 (=48x48 px gốc), bước 6.
Mỗi ô: tín hiệu chuyển động (tỷ lệ điểm đổi) -> đỉnh -> điểm z khớp nhịp quét
(lần quét có đỉnh trong [t+off, t+off+lag], so với kỳ vọng ngẫu nhiên theo mật độ đỉnh của ô).
Xuất heatmap.jpg và ô tốt nhất; bao = vùng xanh chứa/kề ô tốt nhất.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np

from app.tools.find_bag import load_to, green_mask


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("to"); ap.add_argument("sync"); ap.add_argument("outdir")
    ap.add_argument("--max-off", type=float, default=3.0)
    ap.add_argument("--lag", type=float, default=1.5)
    a = ap.parse_args(argv)
    out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)
    to_no, scans = load_to(a.to)
    seg = json.load(open(a.sync))["segments"][0]
    from app.core.sync import EPOCH
    scan_v = np.array([(dt - EPOCH).total_seconds() - seg["offset_s"] for dt, _ in scans])
    t_lo, t_hi = scan_v[0] - 15, scan_v[-1] + 15
    cap = cv2.VideoCapture(a.video)
    cap.set(cv2.CAP_PROP_POS_MSEC, t_lo * 1000)
    S, C, ST = 4, 12, 6
    ts, sig = [], []
    prev = None; i = 0; ref = None
    while True:
        ok, f = cap.read()
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if not ok or t > t_hi:
            break
        if i % 2 == 0:
            g = cv2.cvtColor(cv2.resize(f, (f.shape[1] // S, f.shape[0] // S), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
            g = cv2.blur(g, (3, 3)).astype(np.int16)
            if prev is not None:
                ch = (np.abs(g - prev) > 18).astype(np.float32)
                ii = cv2.integral(ch)
                H, W = ch.shape
                ys, xs = np.arange(0, H - C + 1, ST), np.arange(0, W - C + 1, ST)
                tile = (ii[np.ix_(ys + C, xs + C)] - ii[np.ix_(ys, xs + C)] - ii[np.ix_(ys + C, xs)] + ii[np.ix_(ys, xs)]) / (C * C)
                ts.append(t); sig.append(tile)
            else:
                ref = f.copy()
            prev = g
        i += 1
    ts = np.array(ts); sig = np.stack(sig)  # [T, ny, nx]
    T, ny, nx = sig.shape
    span = ts[-1] - ts[0]
    # nền trượt ~5s và đỉnh cho tất cả ô cùng lúc
    k = 31
    pad = np.pad(sig, ((k, k), (0, 0), (0, 0)), mode="edge")
    base = np.stack([np.median(pad[j:j + 2 * k + 1], axis=0) for j in range(T)])
    ex = sig - base
    mad = np.median(np.abs(ex - np.median(ex, axis=0)), axis=0) + 1e-6
    thr = np.maximum(0.03, 3 * mad)
    is_pk = (ex > thr) & (ex >= np.roll(ex, 1, 0)) & (ex >= np.roll(ex, -1, 0))
    is_pk[0] = is_pk[-1] = False
    offs = np.arange(-a.max_off, a.max_off + 0.01, 0.25)
    zmap = np.full((ny, nx), -9.0); offmap = np.zeros((ny, nx)); hitmap = np.zeros((ny, nx), int)
    n = len(scan_v)
    for y in range(ny):
        for x in range(nx):
            pk = ts[is_pk[:, y, x]]
            # gộp đỉnh sát nhau (<0.7s)
            if len(pk):
                keep = [pk[0]]
                for p in pk[1:]:
                    if p - keep[-1] >= 0.7:
                        keep.append(p)
                pk = np.array(keep)
            if len(pk) < 3:
                continue
            p = 1 - math.exp(-len(pk) / span * a.lag)
            best = (-9, 0, 0)
            for off in offs:
                lo = scan_v + off
                idx = np.searchsorted(pk, lo)
                hits = int(np.sum((idx < len(pk)) & (pk[np.minimum(idx, len(pk) - 1)] <= lo + a.lag)))
                z = (hits - n * p) / math.sqrt(max(1e-9, n * p * (1 - p)))
                if z > best[0]:
                    best = (z, off, hits)
            zmap[y, x], offmap[y, x], hitmap[y, x] = best
    by, bx = np.unravel_index(np.argmax(zmap), zmap.shape)
    cell = [int(bx * ST * S), int(by * ST * S), C * S, C * S]
    order = np.argsort(zmap.ravel())[::-1][:6]
    print(f"TO {to_no}: {n} đơn; lưới {ny}x{nx} ô")
    for o in order:
        yy, xx = divmod(o, nx)
        print(f"  ô x={xx*ST*S} y={yy*ST*S} (48x48)  z={zmap[yy,xx]:.2f}  trúng {hitmap[yy,xx]}/{n}  lệch {offmap[yy,xx]:+.2f}s")
    # heatmap
    zz = np.clip((zmap - 0) / max(1e-6, zmap.max()), 0, 1)
    hm = cv2.applyColorMap((zz * 255).astype(np.uint8), cv2.COLORMAP_JET)
    hm = cv2.resize(hm, (nx * ST * S, ny * ST * S), interpolation=cv2.INTER_NEAREST)
    canvas = ref.copy()
    canvas[:hm.shape[0], :hm.shape[1]] = cv2.addWeighted(ref[:hm.shape[0], :hm.shape[1]], 0.5, hm, 0.5, 0)
    x, y, w, h = cell
    cv2.rectangle(canvas, (x, y), (x + w, y + h), (255, 255, 255), 2)
    cv2.imwrite(str(out / "heatmap.jpg"), canvas)
    json.dump(dict(to=to_no, best_cell=cell, z=float(zmap[by, bx]), offset=float(offmap[by, bx]), hits=int(hitmap[by, bx]), n=n),
              open(out / "grid_result.json", "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
