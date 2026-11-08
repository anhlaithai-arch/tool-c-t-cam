"""Tạo dữ liệu kiểm thử OCR đồng hồ cho JS (tests/browser/osd.test.mjs). Ghi vào data/ (không commit).

Đáp án lấy từ kết quả đồng bộ đã kiểm chứng (data/sync/*.json, sai số ±0,02s), KHÔNG lấy từ OCR,
và bỏ các khung nằm sát lúc đổi giây.

    python -m app.tools.osd_fixture VIDEO SYNC_JSON OUT.json
"""
from __future__ import annotations

import argparse
import base64
import json
import math
from datetime import timedelta

import cv2

from app.core.clock import default_roi
from app.core.sync import EPOCH, SyncResult


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("sync_json")
    ap.add_argument("out")
    a = ap.parse_args(argv)
    sync = SyncResult.load(a.sync_json)
    seg = sync.segments[0]
    cap = cv2.VideoCapture(a.video)
    W, H = int(cap.get(3)), int(cap.get(4))
    x, y, w, h = default_roi(W, H)

    def grab(t):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, f = cap.read()
        vt = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        wall = seg.offset_s + vt
        if not ok or abs(wall - round(wall)) < 0.08:
            return None
        dt = EPOCH + timedelta(seconds=math.floor(wall))
        g = cv2.cvtColor(f[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY)
        return {"t": round(vt, 3), "text": dt.strftime("%m-%d-%Y %a %H:%M:%S"),
                "b64": base64.b64encode(g.tobytes()).decode("ascii")}

    boot = [s for s in (grab(18.0 + k) for k in range(13)) if s]
    ev = [s for s in (grab(7.3 + k * 14.9) for k in range(60)) if s]
    json.dump({"roi": [x, y, w, h], "bootstrap": boot, "eval": ev}, open(a.out, "w", encoding="utf-8"))
    print(f"roi={x, y, w, h} bootstrap={len(boot)} eval={len(ev)} first={boot[0]['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
