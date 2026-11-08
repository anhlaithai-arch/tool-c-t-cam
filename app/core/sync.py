"""Ánh xạ thời gian trong video <-> giờ thật, dựa trên đồng hồ in trên hình.

Cách làm:
1. Lấy mẫu mỗi `step_s` giây, OCR đồng hồ.
2. offset = giờ đọc được - thời gian video. Đồng hồ chỉ hiện tới giây (làm tròn xuống),
   nên offset thật T thỏa: max(o_i) <= T < min(o_i) + 1.
3. Các mẫu có offset lệch nhau > `tol_s` -> đồng hồ nhảy (mất hình, nối video): tách đoạn.
   Mẫu lệch đơn lẻ rồi quay lại -> coi là OCR đọc sai, bỏ qua và ghi cảnh báo.
4. Căn chính xác mỗi đoạn: tìm khung hình chữ số giây đổi -> T chính xác tới ±1 khung hình.

Không dùng tên file hay ngày tạo file làm giờ quay.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

from .clock import ClockReader, default_roi

EPOCH = datetime(2000, 1, 1)


def _sec(dt: datetime) -> float:
    return (dt - EPOCH).total_seconds()


@dataclass
class Sample:
    video_s: float
    wall: str | None  # ISO, None nếu không đọc được
    text: str
    ambiguous_date: bool = False

    @property
    def offset(self) -> float | None:
        return None if self.wall is None else _sec(datetime.fromisoformat(self.wall)) - self.video_s


@dataclass
class Segment:
    video_start: float
    video_end: float
    offset_s: float  # giờ thật = EPOCH + offset_s + video_s
    uncertainty_s: float  # sai số ± (giây)
    method: str  # "ocr-coarse" | "ocr+tick"
    n_samples: int

    def wall_at(self, video_s: float) -> datetime:
        return EPOCH + timedelta(seconds=self.offset_s + video_s)


@dataclass
class SyncResult:
    video: str
    width: int
    height: int
    fps_nominal: float
    duration_s: float
    roi: tuple[int, int, int, int]
    samples: list[Sample] = field(default_factory=list)
    segments: list[Segment] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    # ---- tra cứu ----
    def to_wall(self, video_s: float) -> datetime | None:
        for seg in self.segments:
            if seg.video_start <= video_s <= seg.video_end:
                return seg.wall_at(video_s)
        return None

    def to_video(self, wall: datetime) -> tuple[float | None, str]:
        """Trả về (thời gian video, ghi chú). None nếu giờ đó không nằm trong video."""
        for seg in self.segments:
            v = _sec(wall) - seg.offset_s
            if seg.video_start - 1e-6 <= v <= seg.video_end + 1e-6:
                return v, f"±{seg.uncertainty_s:.2f}s ({seg.method})"
        if self.segments:
            first, last = self.segments[0], self.segments[-1]
            if wall < first.wall_at(first.video_start):
                return None, "trước khi video bắt đầu"
            if wall > last.wall_at(last.video_end):
                return None, "sau khi video kết thúc"
        return None, "rơi vào khoảng đồng hồ nhảy/chưa xác định giữa hai đoạn"

    # ---- lưu/đọc ----
    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "SyncResult":
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        d["samples"] = [Sample(**s) for s in d["samples"]]
        d["segments"] = [Segment(**s) for s in d["segments"]]
        d["roi"] = tuple(d["roi"])
        return cls(**d)


# ---------------------------------------------------------------------------
# Tách đoạn theo offset (logic thuần, kiểm thử được không cần video)
# ---------------------------------------------------------------------------
def split_segments(samples: list[Sample], tol_s: float = 1.5) -> tuple[list[list[Sample]], list[str]]:
    valid = [s for s in samples if s.offset is not None]
    warnings: list[str] = []
    if not valid:
        return [], ["Không đọc được đồng hồ ở mẫu nào"]
    groups: list[list[Sample]] = [[valid[0]]]
    i = 1
    while i < len(valid):
        s = valid[i]
        cur = groups[-1]
        ref = statistics.median(x.offset for x in cur)
        if abs(s.offset - ref) <= tol_s:
            cur.append(s)
        else:
            nxt = valid[i + 1] if i + 1 < len(valid) else None
            if nxt is not None and abs(nxt.offset - ref) <= tol_s:
                warnings.append(f"Bỏ mẫu {s.video_s:.1f}s: OCR đọc '{s.text}' lệch, có thể đọc sai")
            else:
                warnings.append(
                    f"Đồng hồ nhảy {s.offset - ref:+.1f}s trong khoảng video "
                    f"{cur[-1].video_s:.1f}s–{s.video_s:.1f}s (mất hình hoặc nối video)"
                )
                groups.append([s])
        i += 1
    return groups, warnings


def coarse_offset(group: list[Sample]) -> tuple[float, float, list[str]]:
    """Từ các mẫu làm tròn xuống tới giây: T thuộc [max o, min o + 1). Trả (T, ±sai số, cảnh báo)."""
    offs = [s.offset for s in group]
    lo, hi = max(offs), min(offs) + 1.0
    warns = []
    if lo >= hi:  # mâu thuẫn: đồng hồ trôi hoặc thời gian khung hình sai
        warns.append(f"Offset trong đoạn không nhất quán (dao động {lo - hi + 1:.2f}s) – có thể đồng hồ trôi")
        mid = statistics.median(offs) + 0.5
        return mid, (max(offs) - min(offs)) / 2 + 0.5, warns
    return (lo + hi) / 2, (hi - lo) / 2, warns


# ---------------------------------------------------------------------------
# Đọc video
# ---------------------------------------------------------------------------
def _read_at(cap: cv2.VideoCapture, t_s: float) -> tuple[float, np.ndarray | None]:
    cap.set(cv2.CAP_PROP_POS_MSEC, t_s * 1000.0)
    ok, frame = cap.read()
    if not ok:
        return t_s, None
    return cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0, frame


def _refine_tick(cap, reader: ClockReader, sample: Sample, sec_box, fps: float):
    """Tìm khung hình chữ số giây đổi ngay sau mẫu. Trả (T, ±sai số) hoặc None."""
    x, y, w, h = sec_box
    cap.set(cv2.CAP_PROP_POS_MSEC, sample.video_s * 1000.0)
    times, crops, frames = [], [], []
    n = int(round(fps * 1.3)) + 2
    for _ in range(n):
        ok, f = cap.read()
        if not ok:
            break
        times.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
        crops.append(cv2.cvtColor(f[y : y + h, x : x + w], cv2.COLOR_BGR2GRAY).astype(np.float32))
        frames.append(f)
    if len(crops) < 3:
        return None
    diffs = np.array([np.abs(crops[i] - crops[i - 1]).mean() for i in range(1, len(crops))])
    k = int(diffs.argmax()) + 1
    base = float(np.median(diffs))
    if diffs[k - 1] < max(6.0, 4 * base):
        return None  # không thấy chữ số đổi rõ
    rd = reader.read(frames[k], _roi_around(sec_box, frames[k].shape))
    if rd.wall is None:
        return None
    s_new = _sec(rd.wall)
    t_prev, t_k = times[k - 1], times[k]
    # giờ thật vượt qua mốc s_new trong khoảng (t_prev, t_k]
    lo, hi = s_new - t_k, s_new - t_prev
    return (lo + hi) / 2, (hi - lo) / 2


def _roi_around(sec_box, shape):
    """Lấy lại toàn bộ dòng đồng hồ (cần cả ngày giờ để parse) quanh vùng giây."""
    x, y, w, h = sec_box
    H, W = shape[:2]
    x0 = 0
    y0 = max(0, y - h)
    return x0, y0, min(W, x + w + w), min(H - y0, 3 * h)


def sync_video(
    path: str | Path,
    roi: tuple[int, int, int, int] | None = None,
    step_s: float = 15.0,
    tol_s: float = 1.5,
    reader: ClockReader | None = None,
    progress=None,
) -> SyncResult:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise FileNotFoundError(f"Không mở được video: {path}")
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    nframes = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = nframes / fps if fps else 0.0
    roi = roi or default_roi(W, H)
    reader = reader or ClockReader()
    res = SyncResult(str(path), W, H, fps, duration, roi)

    sec_boxes: dict[float, tuple] = {}
    times = list(np.arange(0.0, max(duration - 0.5, 0.0), step_s)) + [max(duration - 0.5, 0.0)]
    for i, t in enumerate(times):
        vt, frame = _read_at(cap, float(t))
        if frame is None:
            res.warnings.append(f"Không đọc được khung hình tại {t:.1f}s")
            continue
        rd = reader.read(frame, roi)
        s = Sample(round(vt, 3), rd.wall.isoformat() if rd.wall else None, rd.text, rd.ambiguous_date)
        res.samples.append(s)
        if rd.seconds_box:
            sec_boxes[s.video_s] = rd.seconds_box
        if progress:
            progress(i + 1, len(times))

    if any(s.ambiguous_date for s in res.samples):
        res.warnings.append("Không phân biệt chắc ngày/tháng trên đồng hồ – đang hiểu là tháng-ngày-năm")
    groups, w = split_segments(res.samples, tol_s)
    res.warnings += w

    for gi, g in enumerate(groups):
        T, unc, w = coarse_offset(g)
        res.warnings += w
        method = "ocr-coarse"
        mid = g[len(g) // 2]
        if mid.video_s in sec_boxes:
            fine = _refine_tick(cap, reader, mid, sec_boxes[mid.video_s], fps)
            if fine and abs(fine[0] - T) <= unc + 0.1:
                T, unc, method = fine[0], fine[1], "ocr+tick"
            elif fine:
                res.warnings.append(f"Căn khung hình đoạn {gi + 1} lệch so với OCR ({fine[0] - T:+.2f}s), giữ kết quả OCR")
        start = 0.0 if gi == 0 else g[0].video_s
        end = duration if gi == len(groups) - 1 else g[-1].video_s
        res.segments.append(Segment(round(start, 3), round(end, 3), T, round(unc, 3), method, len(g)))
    cap.release()
    return res
