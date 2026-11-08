"""Tự xác định BAO nào ứng với một phiếu TO: bao có lượt "vật vào miệng bao" khớp nhịp các lần quét nhất.

    python -m app.tools.find_bag VIDEO TO.xlsx SYNC_JSON OUTDIR

1. Tìm các bao xanh trong khung hình lúc quét đơn đầu tiên (mặt nạ màu xanh, vùng liên thông lớn).
   Miệng bao ước lượng = phần trên của vùng xanh.
2. Mỗi bao: đo theo thời gian (12,5 mẫu/giây) quanh khoảng quét:
     motion  = tỷ lệ điểm đổi so với mẫu trước (vật/tay đi qua miệng bao)
     cover   = tỷ lệ điểm KHÔNG xanh trong miệng bao (kiện dù trắng hay đen đều che lòng bao xanh)
   -> đỉnh của từng tín hiệu (vượt nền trượt).
3. Chấm khớp nhịp: với độ lệch giờ off trong ±15s, đếm số lần quét có đỉnh trong [t+off, t+off+3s];
   so với số trúng ngẫu nhiên kỳ vọng theo mật độ đỉnh của bao đó -> điểm z. Bao có z cao nhất là bao của TO.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import openpyxl


def load_to(path):
    rows = list(openpyxl.load_workbook(path, data_only=True).worksheets[0].iter_rows(values_only=True))
    meta = {str(r[0]).strip(): r[1] for r in rows if r and r[0] and len(r) > 1}
    h = next(i for i, r in enumerate(rows) if r and any(str(x or "").lower().startswith("lm tracking") for x in r))
    hdr = [str(x or "").lower() for x in rows[h]]
    ci, ti = next(i for i, x in enumerate(hdr) if "tracking" in x), next(i for i, x in enumerate(hdr) if "scan time" in x)
    scans = sorted((datetime.fromisoformat(str(r[ti])), str(r[ci])) for r in rows[h + 1:] if r and r[ci])
    return meta.get("TO Number"), scans


def green_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return ((hsv[..., 0] >= 35) & (hsv[..., 0] <= 90) & (hsv[..., 1] > 60)).astype(np.uint8)


def find_bags(frame, min_area=1800):
    m = green_mask(frame)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    bags = []
    H = frame.shape[0]
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if a < min_area or y < 0.12 * H:  # bỏ vùng quá nhỏ và vùng sát mép trên (đồng hồ, tường)
            continue
        fill = a / (w * h)
        # miệng bao: dải trên cùng của vùng xanh, cao ~35% bbox
        mh = max(12, int(0.35 * h))
        bags.append(dict(id=len(bags), box=[int(x), int(y), int(w), int(h)], mouth=[int(x), int(y), int(w), mh], fill=round(fill, 2), area=int(a)))
    return bags


def peaks(t, s, k=3.0, min_thr=0.02, win=31, sep=0.7):
    s = np.asarray(s); t = np.asarray(t)
    base = np.array([np.median(s[max(0, i - win):i + win + 1]) for i in range(len(s))])
    ex = s - base
    mad = np.median(np.abs(ex - np.median(ex))) + 1e-6
    thr = max(min_thr, k * mad)
    P = []
    for i in range(1, len(s) - 1):
        if ex[i] > thr and ex[i] >= ex[i - 1] and ex[i] >= ex[i + 1]:
            if P and t[i] - t[P[-1]] < sep:
                if ex[i] > ex[P[-1]]:
                    P[-1] = i
            else:
                P.append(i)
    return t[P] if P else np.array([])


def rhythm_score(scan_v, pk, span, lag=3.0, offs=np.arange(-15, 15.01, 0.25)):
    """Điểm z cao nhất theo độ lệch; trả (z, off, hits, kỳ vọng)."""
    if len(pk) == 0:
        return (-9, 0, 0, 0)
    rate = len(pk) / span
    p = 1 - math.exp(-rate * lag)
    n = len(scan_v)
    best = None
    for off in offs:
        hits = sum(1 for v in scan_v if np.any((pk >= v + off) & (pk <= v + off + lag)))
        z = (hits - n * p) / math.sqrt(max(1e-9, n * p * (1 - p)))
        if best is None or z > best[0]:
            best = (z, off, hits, n * p)
    return best


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("to"); ap.add_argument("sync"); ap.add_argument("outdir")
    a = ap.parse_args(argv)
    out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)
    to_no, scans = load_to(a.to)
    seg = json.load(open(a.sync))["segments"][0]
    from app.core.sync import EPOCH
    v0 = lambda dt: (dt - EPOCH).total_seconds() - seg["offset_s"]
    scan_v = [v0(dt) for dt, _ in scans]
    t_lo, t_hi = scan_v[0] - 20, scan_v[-1] + 20
    cap = cv2.VideoCapture(a.video)
    cap.set(cv2.CAP_PROP_POS_MSEC, (scan_v[0] + 1) * 1000); ok, f0 = cap.read()
    bags = find_bags(f0)
    vis = f0.copy()
    for b in bags:
        x, y, w, h = b["box"]; cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 255, 255), 1)
        x, y, w, h = b["mouth"]; cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 0, 255), 2)
        cv2.putText(vis, str(b["id"]), (x + 2, y + 14), 0, 0.5, (0, 0, 255), 2)
    cv2.imwrite(str(out / "bags.jpg"), vis)

    cap.set(cv2.CAP_PROP_POS_MSEC, t_lo * 1000)
    ts, mot, cov = [], {b["id"]: [] for b in bags}, {b["id"]: [] for b in bags}
    prev = {}
    i = 0
    while True:
        ok, f = cap.read()
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if not ok or t > t_hi:
            break
        if i % 2 == 0:
            ts.append(t)
            for b in bags:
                x, y, w, h = b["mouth"]
                r = f[y:y + h, x:x + w]
                g = cv2.blur(cv2.cvtColor(r, cv2.COLOR_BGR2GRAY), (3, 3)).astype(np.int16)
                mot[b["id"]].append(0.0 if b["id"] not in prev else float((np.abs(g - prev[b["id"]]) > 18).mean()))
                prev[b["id"]] = g
                cov[b["id"]].append(1.0 - float(green_mask(r).mean()))
        i += 1
    span = ts[-1] - ts[0]
    res = []
    for b in bags:
        for name, sig in (("motion", mot[b["id"]]), ("cover", cov[b["id"]])):
            pk = peaks(ts, sig)
            z, off, hits, exp = rhythm_score(scan_v, pk, span)
            res.append(dict(bag=b["id"], signal=name, z=round(z, 2), offset=off, hits=hits, n=len(scan_v), expected=round(exp, 1), peaks=len(pk)))
    res.sort(key=lambda r: -r["z"])
    print(f"TO {to_no}: {len(scans)} đơn, quét video {scan_v[0]:.1f}–{scan_v[-1]:.1f}s; {len(bags)} bao tìm thấy")
    for b in bags:
        print("  bao", b["id"], "khung", b["box"], "miệng", b["mouth"], "độ đặc", b["fill"])
    for r in res[:8]:
        print(f"  bao {r['bag']} [{r['signal']}] z={r['z']}  trúng {r['hits']}/{r['n']} (ngẫu nhiên ~{r['expected']})  lệch {r['offset']}s  đỉnh {r['peaks']}")
    json.dump(dict(to=to_no, bags=bags, ranking=res), open(out / "result.json", "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
