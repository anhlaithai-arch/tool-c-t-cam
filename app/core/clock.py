"""Đọc đồng hồ in trên hình camera (OSD) bằng OCR.

Ví dụ OSD: "11-04-2026 Wed 16:48:42" (tháng-ngày-năm, có thứ trong tuần).
Thứ trong tuần dùng để phân biệt tháng-ngày với ngày-tháng khi cả hai đều hợp lệ.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

import numpy as np

# Vùng đồng hồ mặc định theo tỷ lệ khung hình (x, y, w, h), đo trên Camera 01 1280x720.
DEFAULT_ROI_FRAC = (0.0, 20 / 720, 380 / 1280, 70 / 720)

_WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}

_CLOCK_RE = re.compile(
    r"(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})\s*([A-Za-z]{3})?[A-Za-z]*\s*(\d{1,2}):(\d{2}):(\d{2})"
)


@dataclass
class ClockReading:
    wall: datetime | None
    text: str
    ambiguous_date: bool = False  # True nếu không phân biệt được ngày/tháng
    seconds_box: tuple[int, int, int, int] | None = None  # vùng 2 chữ số giây (x, y, w, h) trong khung hình


def default_roi(width: int, height: int) -> tuple[int, int, int, int]:
    fx, fy, fw, fh = DEFAULT_ROI_FRAC
    return int(fx * width), int(fy * height), int(fw * width), int(fh * height)


def normalize_text(parts: list[str] | tuple[str, ...]) -> str:
    s = " ".join(p.strip() for p in parts)
    s = re.sub(r"\s*-\s*-?\s*", "-", s)
    s = re.sub(r"\s*:\s*", ":", s)
    s = re.sub(r"[Oo](?=\d)|(?<=\d)[Oo]", "0", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_clock(text: str, prefer: str = "MDY") -> tuple[datetime | None, bool]:
    """Trả về (datetime, ambiguous). prefer: 'MDY' hoặc 'DMY' khi không có thứ để phân biệt."""
    m = _CLOCK_RE.search(text)
    if not m:
        return None, False
    a, b, c, wd, hh, mm, ss = m.groups()
    a, b, c, hh, mm, ss = int(a), int(b), int(c), int(hh), int(mm), int(ss)
    weekday = _WEEKDAYS.get(wd.lower()) if wd else None

    candidates: dict[str, datetime] = {}
    orders = {"YMD": (a, b, c), "MDY": (c, a, b), "DMY": (c, b, a)}
    for name, (y, mo, d) in orders.items():
        if y < 2000:
            continue
        try:
            candidates[name] = datetime(y, mo, d, hh, mm, ss)
        except ValueError:
            pass
    if weekday is not None:
        matched = {k: v for k, v in candidates.items() if v.weekday() == weekday}
        if matched:
            candidates = matched
    if not candidates:
        return None, False
    distinct = set(candidates.values())
    if len(distinct) == 1:
        return distinct.pop(), False
    key = prefer if prefer in candidates else sorted(candidates)[0]
    return candidates[key], True


class ClockReader:
    """Bọc RapidOCR; khởi tạo một lần vì nạp mô hình mất vài giây."""

    def __init__(self, prefer: str = "MDY"):
        from rapidocr import RapidOCR  # import chậm, chỉ nạp khi cần

        self._ocr = RapidOCR()
        self.prefer = prefer

    def read(self, frame: np.ndarray, roi: tuple[int, int, int, int]) -> ClockReading:
        x, y, w, h = roi
        crop = frame[y : y + h, x : x + w]
        res = self._ocr(crop)
        txts = tuple(res.txts or ())
        text = normalize_text(txts)
        wall, amb = parse_clock(text, self.prefer)
        return ClockReading(wall, text, amb, self._seconds_box(res, roi) if wall else None)

    @staticmethod
    def _seconds_box(res, roi) -> tuple[int, int, int, int] | None:
        """Vùng 2 chữ số giây: phần bên phải của ô chữ chứa giờ (ô cuối có dấu ':')."""
        if res.boxes is None or not res.txts:
            return None
        for box, txt in zip(reversed(list(res.boxes)), reversed(list(res.txts))):
            if ":" in txt:
                xs, ys = box[:, 0], box[:, 1]
                x1, x2, y1, y2 = float(xs.min()), float(xs.max()), float(ys.min()), float(ys.max())
                n = max(len(txt.strip()), 2)
                cw = (x2 - x1) / n  # bề rộng một ký tự (font OSD gần như đều)
                sx = x2 - 2.2 * cw
                return (int(roi[0] + sx), int(roi[1] + y1), int(x2 - sx) + 1, int(y2 - y1) + 1)
        return None
