"""Gán lượt bỏ kiện cho người ném dựa trên QUỸ ĐẠO cổ tay (dữ liệu tư thế liên tục từ pose_track.py).

    python -m app.tools.attribute_track data\\eval\\center_660_850 tests\\fixtures\\eval_labels_center_660_850.json

Đặc trưng mỗi người trong cửa sổ [bắt đầu lượt - win, đỉnh + 0.1s]:
  approach = tốc độ lớn nhất cổ tay tiến về tâm miệng bao (px/s)
  near     = khoảng cách nhỏ nhất từ cổ tay tới miệng bao (px)
Người ném = người có approach lớn nhất trong số người có near <= nearMax; cần approach >= minApproach.
"""
from __future__ import annotations

import argparse
import itertools
import json

import numpy as np

LW, RW = 9, 10


def dist_rect(p, r):
    x, y, w, h = r
    return float(np.hypot(max(x - p[0], 0, p[0] - (x + w)), max(y - p[1], 0, p[1] - (y + h))))


def features(frames, roi, t0, t1):
    cx, cy = roi[0] + roi[2] / 2, roi[1] + roi[3] / 2
    per = {}  # id -> {wrist -> [(t, x, y)]}
    for fr in frames:
        if fr["t"] < t0 or fr["t"] > t1:
            continue
        for p in fr["people"]:
            for w in (LW, RW):
                if p["sc"][w] > 0.3:
                    per.setdefault(p["id"], {}).setdefault(w, []).append((fr["t"], *p["kp"][w]))
    out = {}
    for pid, ws in per.items():
        appr, near = 0.0, 1e9
        for pts in ws.values():
            for (ta, xa, ya), (tb, xb, yb) in zip(pts, pts[1:]):
                dt = tb - ta
                if dt <= 0 or dt > 0.3:
                    continue
                da, db = np.hypot(xa - cx, ya - cy), np.hypot(xb - cx, yb - cy)
                appr = max(appr, (da - db) / dt)
            near = min(near, min(dist_rect((x, y), roi) for _, x, y in pts))
        out[pid] = dict(approach=appr, near=near)
    return out


def attribute(feats, near_max, min_appr):
    cand = {pid: f for pid, f in feats.items() if f["near"] <= near_max}
    if not cand:
        return "unknown", None
    pid = max(cand, key=lambda k: cand[k]["approach"])
    if cand[pid]["approach"] < min_appr:
        return "unknown", pid
    return ("S" if pid == 0 else "other"), pid


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("evaldir"); ap.add_argument("labels")
    ap.add_argument("--win", type=float, default=1.0)
    a = ap.parse_args(argv)
    C = json.load(open(f"{a.evaldir}/candidates.json"))
    cands, roi = C["candidates"], C["roi"]
    frames = json.load(open(f"{a.evaldir}/poses.json"))["frames"]
    L = json.load(open(a.labels, encoding="utf-8"))
    lab = {n: k for k in ["tp", "fp", "unsure", "occ_toss", "occ_none", "weak_none"] for n in L[k]}
    who = {int(k): v for k, v in L["who"].items()}
    truth = [n for n, w in who.items() if w == "M" and lab.get(n) in ("tp", "occ_toss")]
    unsure_m = {n for n, w in who.items() if w == "M" and lab.get(n) == "unsure"}
    tool = [c for c in cands if c["source"] == "tool"]
    feats = {c["n"]: features(frames, roi, c["startS"] - a.win, c["peakS"] + 0.1) for c in tool}

    def score(near_max, min_appr, drop_only):
        counted, rows = [], []
        for c in tool:
            attr, pid = attribute(feats[c["n"]], near_max, min_appr)
            rows.append((c["n"], attr, pid))
            if attr == "S" and (not drop_only or c["kind"] == "drop"):
                counted.append(c["n"])
        good = [n for n in counted if n in truth]
        uns = [n for n in counted if n in unsure_m]
        bad = [n for n in counted if n not in good and n not in uns]
        return dict(counted=len(counted), good=len(good), bad=bad, unsure=len(uns),
                    precision=len(good) / max(1, len(good) + len(bad)), recall=len(good) / len(truth), rows=rows)

    best = None
    for near_max, min_appr, drop_only in itertools.product([20, 40, 60, 90], [0, 100, 200, 300, 400], [False, True]):
        s = score(near_max, min_appr, drop_only)
        f1 = 2 * s["precision"] * s["recall"] / max(1e-9, s["precision"] + s["recall"])
        if not best or f1 > best[0]:
            best = (f1, near_max, min_appr, drop_only, s)
    f1, nm, ma, do, s = best
    print(f"thật (người bắn hàng): {len(truth)}..{len(truth)+len(unsure_m)}")
    print(f"tốt nhất: nearMax={nm} minApproach={ma} chỉ lượt drop={do} -> tính {s['counted']}, đúng {s['good']}, "
          f"sai {len(s['bad'])} {[(n, lab.get(n), who.get(n)) for n in s['bad']]}, không chắc {s['unsure']}, "
          f"precision {s['precision']:.3f}, recall {s['recall']:.3f}, F1 {f1:.3f}")
    missed = [n for n in truth if not any(r[0] == n and r[1] == "S" for r in s["rows"])]
    print("bỏ sót:", [(n, next(r[1:] for r in s["rows"] if r[0] == n), {k: {kk: round(vv) for kk, vv in v.items()} for k, v in feats[n].items()}) for n in missed])
    for n in s["bad"]:
        print("sai:", n, lab.get(n), who.get(n), {k: {kk: round(vv) for kk, vv in v.items()} for k, v in feats[n].items()})
    json.dump(dict(params=dict(nearMax=nm, minApproach=ma, dropOnly=do), rows=s["rows"]), open(f"{a.evaldir}/attribution_track.json", "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
