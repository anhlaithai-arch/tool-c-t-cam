"""Theo dõi tư thế LIÊN TỤC mọi người trong một đoạn video (RTMO), gán ID người qua các khung, lưu ra JSON.

    .venv-ml\\Scripts\\python -m app.tools.pose_track VIDEO OUT.json --from 660 --to 850 --fps 12.5 --anchor 813,383

- ID người: ghép theo tâm thân (vai + hông) gần nhất giữa hai khung (người đứng dậy đi lại vẫn bám được nếu không bị che lâu).
- --anchor: điểm trên thân người bắn hàng ở khung đầu -> người đó mang ID 0 ("S").
Lưu mỗi khung: t, danh sách người {id, kp: 17x[x,y], sc: 17 điểm tin cậy}.
"""
from __future__ import annotations

import argparse
import json

import cv2
import numpy as np

LS, RS, LH, RH = 5, 6, 11, 12


def center(k, s):
    idx = [i for i in (LS, RS, LH, RH) if s[i] > 0.3]
    if idx:
        return np.mean([k[i] for i in idx], axis=0)
    ok = s > 0.3
    return np.mean(k[ok], axis=0) if ok.any() else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("out")
    ap.add_argument("--from", dest="t0", type=float, required=True)
    ap.add_argument("--to", dest="t1", type=float, required=True)
    ap.add_argument("--fps", type=float, default=12.5)
    ap.add_argument("--anchor", required=True)
    ap.add_argument("--max-jump", type=float, default=90, help="px tối đa tâm thân dịch giữa hai khung để coi là cùng người")
    a = ap.parse_args(argv)
    from rtmlib import RTMO
    model = RTMO("https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211.zip",
                 model_input_size=(640, 640), backend="onnxruntime", device="cpu")
    cap = cv2.VideoCapture(a.video)
    cap.set(cv2.CAP_PROP_POS_MSEC, a.t0 * 1000)
    nat = cap.get(cv2.CAP_PROP_FPS)
    step = max(1, round(nat / a.fps))
    anchor = np.array([float(v) for v in a.anchor.split(",")])
    tracks = {}  # id -> last center
    last_seen = {}
    next_id = 1
    frames = []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t > a.t1:
            break
        if i % step:
            i += 1
            continue
        i += 1
        kps, scores = model(f)
        cs = [center(k, s) for k, s in zip(kps, scores)]
        if not tracks:  # khung đầu: người gần anchor nhất = ID 0
            d = [np.linalg.norm(c - anchor) if c is not None else 1e9 for c in cs]
            if d and min(d) < 150:
                j = int(np.argmin(d)); tracks[0] = cs[j]; last_seen[0] = t
        # ghép tham lam theo khoảng cách
        pairs = sorted(((np.linalg.norm(c - tc), pi, tid) for pi, c in enumerate(cs) if c is not None
                        for tid, tc in tracks.items() if t - last_seen[tid] < 3.0), key=lambda x: x[0])
        assigned, used = {}, set()
        for d, pi, tid in pairs:
            lim = a.max_jump * (1 + 2 * (t - last_seen[tid]))  # mất dấu lâu hơn -> cho phép xa hơn
            if d > lim or pi in assigned or tid in used:
                continue
            assigned[pi] = tid; used.add(tid)
        people = []
        for pi, (k, s) in enumerate(zip(kps, scores)):
            if cs[pi] is None:
                continue
            tid = assigned.get(pi)
            if tid is None:
                tid = next_id; next_id += 1
            tracks[tid] = cs[pi]; last_seen[tid] = t
            people.append(dict(id=tid, kp=np.round(k, 1).tolist(), sc=np.round(s, 2).tolist()))
        frames.append(dict(t=round(t, 3), people=people))
        if len(frames) % 100 == 0:
            print(f"{t:.1f}s  {len(frames)} khung  người={len(people)}  S thấy={'có' if any(p['id']==0 for p in people) else 'KHÔNG'}", flush=True)
    json.dump(dict(fps=a.fps, anchor=anchor.tolist(), frames=frames), open(a.out, "w"))
    seen0 = sum(any(p["id"] == 0 for p in fr["people"]) for fr in frames)
    print(f"xong: {len(frames)} khung, người bắn hàng (ID 0) thấy ở {seen0} khung ({seen0/len(frames):.0%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
