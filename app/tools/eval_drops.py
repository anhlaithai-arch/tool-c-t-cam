"""Chuẩn bị dữ liệu đánh giá độ chính xác đếm lượt bỏ kiện.

Tái tạo đúng tín hiệu của trình duyệt (browser/counter.mjs + core/motion.mjs): vùng khoanh, làm mờ 3x3,
tỷ lệ điểm đổi > 18 mức xám giữa hai mẫu liên tiếp, 12,5 mẫu/giây. Xuất:
  - candidates.json: lượt tool đề xuất (drop/occlusion) + các "chuyển động yếu" bị bỏ qua (để soi lượt sót)
  - strips_*.jpg: mỗi dòng = 1 ứng viên, 6 khung từ trước tới sau, để người/AI gán nhãn

    python -m app.tools.eval_drops VIDEO OUTDIR --roi 862,350,110,62 --from 660 --to 850
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

DEF = dict(hiMin=0.04, loMin=0.02, quietS=0.4, mergeGapS=0.6, occlusionAct=0.5, occlusionDurS=2.0)


def detect(times, act, o=DEF, hi_override=None, lo_override=None):
    """Bản Python của detectEvents (browser/core/motion.mjs)."""
    act = np.asarray(act)
    med = float(np.median(act)); mad = float(np.median(np.abs(act - med))) + 1e-6
    hi = hi_override if hi_override is not None else max(o["hiMin"], med + 6 * mad)
    lo = lo_override if lo_override is not None else max(o["loMin"], med + 3 * mad)
    raw, on, s = [], False, 0
    for k in range(len(act)):
        if not on and act[k] > hi:
            on, s = True, k
            continue
        if on and act[k] < lo:
            quiet = True
            j = k
            while j < len(act) and times[j] - times[k] < o["quietS"]:
                if act[j] >= lo:
                    quiet = False
                    break
                j += 1
            if quiet:
                raw.append([s, k]); on = False
    if on:
        raw.append([s, len(act) - 1])
    merged = []
    for e in raw:
        if merged and times[e[0]] - times[merged[-1][1]] < o["mergeGapS"]:
            merged[-1][1] = e[1]
        else:
            merged.append(list(e))
    out = []
    for a, b in merged:
        p = a + int(np.argmax(act[a:b + 1]))
        dur = times[b] - times[a]
        kind = "occlusion" if act[p] > o["occlusionAct"] or dur > o["occlusionDurS"] else "drop"
        out.append(dict(startS=times[a], endS=times[b], peakS=times[p], maxAct=float(act[p]), kind=kind))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("outdir")
    ap.add_argument("--roi", required=True); ap.add_argument("--from", dest="t0", type=float, default=0)
    ap.add_argument("--to", dest="t1", type=float, default=1e9)
    a = ap.parse_args(argv)
    X, Y, W, H = (int(v) for v in a.roi.split(","))
    out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(a.video)
    cap.set(cv2.CAP_PROP_POS_MSEC, a.t0 * 1000)
    times, act, frames_t, ctx = [], [], [], {}
    prev = None
    scale = min(1.0, 160 / W)
    cw, ch = max(8, round(W * scale)), max(8, round(H * scale))
    # vùng ngữ cảnh (giống contextBox trong counter.mjs)
    fw, fh = int(cap.get(3)), int(cap.get(4))
    bw, bh = min(fw, W * 1.6 + 40), min(fh, H * 1.6 + 40)
    bx = int(max(0, min(fw - bw, X + W / 2 - bw / 2))); by = int(max(0, min(fh - bh, Y + H / 2 - bh / 2)))
    bw, bh = int(bw), int(bh)
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t > a.t1:
            break
        ctx[round(t, 2)] = cv2.resize(f[by:by + bh, bx:bx + bw], (bw * 160 // bw, bh * 160 // bw))
        frames_t.append(round(t, 2))
        if i % 2 == 0:  # 12,5 mẫu/giây
            g = cv2.cvtColor(f[Y:Y + H, X:X + W], cv2.COLOR_BGR2GRAY)
            g = cv2.resize(g, (cw, ch), interpolation=cv2.INTER_AREA)
            g = cv2.blur(g, (3, 3)).astype(np.int16)
            act.append(0.0 if prev is None else float((np.abs(g - prev) > 18).mean()))
            times.append(t); prev = g
        i += 1
    ev = detect(times, act)
    for e in ev:
        e["source"] = "tool"
    # chuyển động yếu không thành lượt: ngưỡng thấp 0.012
    weak = [w for w in detect(times, act, hi_override=0.012, lo_override=0.006)
            if not any(e["startS"] - 0.3 <= w["peakS"] <= e["endS"] + 0.3 for e in ev)]
    for w in weak:
        w["source"] = "weak"
    cands = sorted(ev + weak, key=lambda e: e["peakS"])
    for k, c in enumerate(cands):
        c["n"] = k
    json.dump(dict(roi=[X, Y, W, H], range=[a.t0, a.t1], candidates=cands), open(out / "candidates.json", "w"), indent=1)

    ft = np.array(frames_t)

    def near(t):
        return ctx[float(ft[np.abs(ft - t).argmin()])]

    rows = []
    for c in cands:
        ts = np.linspace(c["startS"] - 0.24, c["endS"] + 0.24, 6)
        row = np.hstack([near(t) for t in ts])
        tag = f"#{c['n']} {c['source'][0].upper()}{c['kind'][0]} {c['peakS']:.1f}s a={c['maxAct']:.2f}"
        cv2.rectangle(row, (0, 0), (len(tag) * 7 + 4, 14), (0, 0, 0), -1)
        cv2.putText(row, tag, (2, 11), 0, 0.4, (0, 255, 255), 1)
        rows.append(row)
    per = 10
    for s in range(0, len(rows), per):
        cv2.imwrite(str(out / f"strips_{s // per:02d}.jpg"), np.vstack(rows[s:s + per]))
    n_tool = sum(1 for c in cands if c["source"] == "tool")
    print(f"samples={len(times)} tool={n_tool} (drop={sum(1 for c in ev if c['kind']=='drop')}) weak={len(weak)} sheets={(len(rows)+per-1)//per}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
