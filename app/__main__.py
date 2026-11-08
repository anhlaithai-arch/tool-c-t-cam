"""CLI: python -m app sync VIDEO | python -m app locate SYNC_JSON "YYYY-MM-DD HH:MM:SS" """
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from .core.sync import SyncResult, sync_video


def _fmt_v(s: float) -> str:
    m, sec = divmod(s, 60)
    return f"{int(m):02d}:{sec:06.3f}"


def cmd_sync(a) -> int:
    roi = tuple(int(v) for v in a.roi.split(",")) if a.roi else None
    out = Path(a.out) if a.out else Path("data/sync") / (Path(a.video).stem + ".json")
    prog = lambda i, n: print(f"\r  OCR {i}/{n}", end="", file=sys.stderr, flush=True)
    r = sync_video(a.video, roi=roi, step_s=a.step, progress=prog)
    print(file=sys.stderr)
    r.save(out)
    print(f"Video: {r.width}x{r.height}, {r.fps_nominal:.2f} fps, {_fmt_v(r.duration_s)}")
    ok = sum(1 for s in r.samples if s.wall)
    print(f"Mẫu đọc được đồng hồ: {ok}/{len(r.samples)}")
    for i, seg in enumerate(r.segments, 1):
        print(
            f"Đoạn {i}: video {_fmt_v(seg.video_start)}–{_fmt_v(seg.video_end)} = "
            f"{seg.wall_at(seg.video_start):%Y-%m-%d %H:%M:%S.%f}"[:-3]
            + f" → {seg.wall_at(seg.video_end):%H:%M:%S.%f}"[:-3]
            + f"  (±{seg.uncertainty_s:.3f}s, {seg.method}, {seg.n_samples} mẫu)"
        )
    for w in r.warnings:
        print("CẢNH BÁO:", w)
    print(f"Đã lưu: {out}")
    return 0 if r.segments else 1


def cmd_locate(a) -> int:
    r = SyncResult.load(a.sync_json)
    wall = datetime.fromisoformat(a.wall)
    v, note = r.to_video(wall)
    if v is None:
        print(f"{wall} không nằm trong video: {note}")
        return 1
    print(f"{wall} → video {_fmt_v(v)} ({v:.3f}s) {note}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m app")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="Đọc đồng hồ camera, tạo ánh xạ thời gian")
    s.add_argument("video")
    s.add_argument("--roi", help="vùng đồng hồ x,y,w,h (pixel)")
    s.add_argument("--step", type=float, default=15.0, help="giây giữa hai lần OCR")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_sync)
    l = sub.add_parser("locate", help="Đổi giờ thật sang vị trí trong video")
    l.add_argument("sync_json")
    l.add_argument("wall", help='"YYYY-MM-DD HH:MM:SS"')
    l.set_defaults(fn=cmd_locate)
    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
