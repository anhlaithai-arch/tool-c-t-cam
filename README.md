# App AI đếm kiện hàng theo camera

Bắn mã đơn → lấy thời gian packing từ webapp GAS → tua đúng đoạn video camera → khoanh vùng miệng bao → đếm và đánh dấu kiện, xuất bằng chứng.

Quy trình làm việc giữa Claude Code và Codex: xem [AGENTS.md](AGENTS.md).

## Cấu trúc

```
app/            Python chạy local (xử lý video, AI)
  core/clock.py   đọc đồng hồ in trên hình camera (OCR)
  core/sync.py    ánh xạ thời gian video <-> giờ thật
  web/          giao diện app local (Codex phụ trách)
gas/            webapp Google Apps Script tra thời gian packing
tests/          kiểm thử logic (không cần video)
data/           dữ liệu chạy local, KHÔNG commit
```

## Cài đặt (Windows)

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

## Trạng thái tính năng

| Tính năng | Trạng thái |
|---|---|
| Đọc đồng hồ camera, ánh xạ giờ thật ↔ thời gian video | Đã chạy trên 1 video thật (Camera 01, 720p) |
| Lấy thời gian packing từ GAS theo mã đơn | Chưa làm, chờ thông tin webapp GAS |
| Khoanh vùng + đếm kiện | Chưa làm |
| Xuất ảnh/clip bằng chứng | Chưa làm |

## Dùng thử: đồng bộ thời gian

```bash
.venv\Scripts\python -m app sync "đường\dẫn\video.mp4"
.venv\Scripts\python -m app locate data\sync\video.json "2026-11-04 16:55:00"
```

`sync` đọc đồng hồ trên hình mỗi 15 giây, phát hiện chỗ đồng hồ nhảy, căn chính xác tới ±1 khung hình và lưu `data/sync/<tên video>.json`.
`locate` đổi giờ thật sang vị trí trong video.

Vùng đồng hồ mặc định là góc trên trái (tỷ lệ theo độ phân giải). Camera khác vị trí thì truyền `--roi x,y,w,h` (pixel).

## Thư viện và giấy phép

OpenCV (Apache-2.0), NumPy (BSD), RapidOCR (Apache-2.0), ONNX Runtime (MIT). Mô hình OCR chạy local, không gửi hình ra ngoài.
