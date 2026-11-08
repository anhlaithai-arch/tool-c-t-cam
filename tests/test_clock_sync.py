from datetime import datetime

from app.core.clock import normalize_text, parse_clock
from app.core.sync import Sample, coarse_offset, split_segments, SyncResult, Segment, EPOCH, _sec


def test_normalize_rapidocr_fragments():
    # đúng dạng RapidOCR trả về trên Camera 01
    assert normalize_text(("11-", "-04-2026", "Wed", "16", ":48:42")) == "11-04-2026 Wed 16:48:42"


def test_parse_weekday_disambiguates_mdy():
    dt, amb = parse_clock("11-04-2026 Wed 16:48:42")
    assert dt == datetime(2026, 11, 4, 16, 48, 42) and not amb  # 4/11/2026 là thứ Tư


def test_parse_weekday_picks_dmy_when_matching():
    dt, amb = parse_clock("04-11-2026 Wed 16:48:42")
    assert dt == datetime(2026, 11, 4, 16, 48, 42) and not amb


def test_parse_ambiguous_without_weekday():
    dt, amb = parse_clock("11-04-2026 16:48:42")
    assert amb and dt == datetime(2026, 11, 4, 16, 48, 42)


def test_parse_garbage():
    assert parse_clock("Camera 01") == (None, False)


def _s(v, wall):
    return Sample(v, wall.isoformat() if wall else None, "")


def _wall(T, v):
    from datetime import timedelta
    import math
    return EPOCH + timedelta(seconds=math.floor(T + v))


def test_continuous_video_single_segment_and_tight_offset():
    T = _sec(datetime(2026, 11, 4, 16, 48, 24)) + 0.37
    samples = [_s(v, _wall(T, v)) for v in [0, 15.2, 30.04, 45.6, 60.8, 75.9]]
    groups, warns = split_segments(samples)
    assert len(groups) == 1 and not warns
    est, unc, _ = coarse_offset(groups[0])
    assert abs(est - T) <= unc + 1e-9 and unc < 0.5


def test_clock_jump_creates_two_segments():
    T1 = 1000.0
    T2 = T1 + 300  # mất 5 phút hình
    samples = [_s(v, _wall(T1, v)) for v in [0, 15, 30]] + [_s(v, _wall(T2, v)) for v in [45, 60, 75]]
    groups, warns = split_segments(samples)
    assert [len(g) for g in groups] == [3, 3]
    assert any("nhảy" in w for w in warns)


def test_single_ocr_error_is_dropped():
    T = 1000.0
    samples = [_s(v, _wall(T, v)) for v in [0, 15, 30, 45]]
    samples[2] = _s(30, _wall(T + 3600, 30))  # OCR đọc sai giờ
    groups, warns = split_segments(samples)
    assert len(groups) == 1 and len(groups[0]) == 3
    assert any("đọc sai" in w for w in warns)


def test_to_video_roundtrip_and_gap():
    r = SyncResult("x", 1280, 720, 25.0, 100.0, (0, 0, 1, 1))
    base = _sec(datetime(2026, 11, 4, 16, 0, 0))
    r.segments = [Segment(0, 40, base, 0.02, "ocr+tick", 3), Segment(45, 100, base + 300, 0.02, "ocr+tick", 4)]
    v, _ = r.to_video(datetime(2026, 11, 4, 16, 0, 10))
    assert abs(v - 10) < 1e-6
    v, _ = r.to_video(datetime(2026, 11, 4, 16, 5, 50))
    assert abs(v - 50) < 1e-6
    v, note = r.to_video(datetime(2026, 11, 4, 16, 2, 0))  # rơi vào khoảng mất hình
    assert v is None and "nhảy" in note
