"""Thử gán từng lượt bỏ kiện cho người ném bằng cổ tay (RTMO), đo theo quy tắc mới (chỉ tính người bắn hàng).

    .venv-ml\\Scripts\\python -m app.tools.attribute_pose VIDEO data\\eval\\center_660_850 tests\\fixtures\\eval_labels_center_660_850.json

Logic (sẽ port sang trình duyệt nếu đạt):
- Bám người bắn hàng từ một điểm chọn trên thân (anchor) bằng tâm thân (vai + hông) gần nhất qua các khung.
- Mỗi lượt: chạy tư thế ở các khung từ (bắt đầu - 0,8s) tới đỉnh. Với mỗi người, khoảng cách nhỏ nhất từ cổ tay tới miệng bao.
- Người có cổ tay gần miệng bao nhất (<= maxDist px) là người ném; nếu không ai đủ gần -> không rõ.
"""
from __future__ import annotations

import argparse
import json

import cv2
import numpy as np

LW, RW, LS, RS, LH, RH = 9, 10, 5, 6, 11, 12


def torso_center(k, s):
    pts = [k[i] for i in (LS, RS, LH, RH) if s[i] > 0.3]
    return np.mean(pts, axis=0) if pts else None


def dist_to_rect(p, r):
    x, y, w, h = r
    dx = max(x - p[0], 0, p[0] - (x + w)); dy = max(y - p[1], 0, p[1] - (y + h))
    return float(np.hypot(dx, dy))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("evaldir"); ap.add_argument("labels")
    ap.add_argument("--max-dist", type=float, default=60)
    a = ap.parse_args(argv)
    from rtmlib import RTMO
    model = RTMO("https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211.zip",
                 model_input_size=(640, 640), backend="onnxruntime", device="cpu")
    cands = json.load(open(f"{a.evaldir}/candidates.json"))["candidates"]
    roi = json.load(open(f"{a.evaldir}/candidates.json"))["roi"]
    L = json.load(open(a.labels, encoding="utf-8"))
    lab = {n: k for k in ["tp", "fp", "unsure", "occ_toss", "occ_none", "weak_none"] for n in L[k]}
    who = {int(k): v for k, v in L["who"].items()}
    cap = cv2.VideoCapture(a.video)
    scanner_c = np.array(L["scanner"]["anchor_xy"], float)
    out = []
    for c in cands:
        if c["source"] != "tool":
            continue
        ts = np.arange(c["startS"] - 0.8, c["peakS"] + 0.01, 0.16)
        best = {}  # person key -> min wrist dist
        scanner_min = 1e9
        for t in ts:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, f = cap.read()
            if not ok:
                continue
            kps, scores = model(f)
            centers = [torso_center(k, s) for k, s in zip(kps, scores)]
            # người bắn hàng = tâm thân gần tâm lần trước nhất (<120px)
            si = None
            dd = [np.linalg.norm(cc - scanner_c) if cc is not None else 1e9 for cc in centers]
            if dd and min(dd) < 120:
                si = int(np.argmin(dd)); scanner_c = 0.7 * scanner_c + 0.3 * centers[si]
            for pi, (k, s) in enumerate(zip(kps, scores)):
                wd = min([dist_to_rect(k[w], roi) for w in (LW, RW) if s[w] > 0.3] or [1e9])
                key = "S" if pi == si else f"o{pi}"
                best[key] = min(best.get(key, 1e9), wd)
                if pi == si:
                    scanner_min = min(scanner_min, wd)
        others = min([v for k, v in best.items() if k != "S"] or [1e9])
        if scanner_min <= a.max_dist and scanner_min <= others:
            attr = "S"
        elif others <= a.max_dist:
            attr = "other"
        else:
            attr = "unknown"
        out.append(dict(n=c["n"], peakS=c["peakS"], kind=c["kind"], label=lab.get(c["n"]), who=who.get(c["n"]),
                        attr=attr, scannerDist=round(scanner_min, 1), otherDist=round(others, 1)))
        print(c["n"], round(c["peakS"], 1), c["kind"], lab.get(c["n"]), who.get(c["n"]), "->", attr, round(scanner_min), round(others), flush=True)
    json.dump(out, open(f"{a.evaldir}/attribution.json", "w"), indent=1)

    # chấm điểm theo quy tắc mới: đúng = kiện do người bắn hàng (M)
    truth = [n for n, w in who.items() if w == "M" and lab.get(n) in ("tp", "occ_toss")]
    unsure_m = [n for n, w in who.items() if w == "M" and lab.get(n) == "unsure"]
    for name, rule in [("chỉ cổ tay", lambda r: r["attr"] == "S"),
                       ("cổ tay + không phải che khuất", lambda r: r["attr"] == "S" and r["kind"] == "drop")]:
        counted = [r for r in out if rule(r)]
        good = [r for r in counted if r["who"] == "M" and r["label"] in ("tp", "occ_toss")]
        uns = [r for r in counted if r["n"] in unsure_m]
        bad = [r for r in counted if r not in good and r not in uns]
        print(f"[{name}] tính {len(counted)} | đúng {len(good)} | sai {len(bad)} {[ (r['n'], r['label'], r['who']) for r in bad]} | không chắc {len(uns)} | "
              f"thật {len(truth)}..{len(truth)+len(unsure_m)} | precision {len(good)/max(1,len(good)+len(bad)):.3f} | recall {len(good)/max(1,len(truth)):.3f}")
    missed = [n for n in truth if not any(r["n"] == n and r["attr"] == "S" for r in out)]
    print("kiện của người bắn hàng bị gán sai/không rõ:", [(n, next((r['attr'], r['scannerDist']) for r in out if r['n'] == n)) for n in missed])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
