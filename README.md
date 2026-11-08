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

Đường chạy chính: webapp GAS, xử lý video trong trình duyệt (xem `docs/PHUONG_AN_TRINH_DUYET.md`).

| Tính năng | Trạng thái |
|---|---|
| Mở video local trong trình duyệt, tua đúng khung | Đạt trên Chrome local (78/78 khung chuẩn). Chưa thử trong iframe GAS |
| Đọc đồng hồ camera (mẫu chữ số, JS) + đồng bộ giờ | Đạt trên video mẫu: 50/50 khung, ±0,02s, khớp Python |
| Khoanh miệng bao, quét chuyển động, đề xuất lượt bỏ kiện | Chạy được: 3 phút video quét trong ~46s. Đo sơ bộ trên 1 đoạn: chính xác 90,5%, phủ ~83%, kiện còn lại nằm trong nhóm "cần xem lại" (`docs/DO_CHINH_XAC.md`) |
| Duyệt lượt (tính/bỏ/số kiện), đánh thứ tự, đánh dấu đơn theo mm:ss / giờ camera / #thứ tự | Chạy được trên trình duyệt local |
| Ảnh bằng chứng (nguyên khung, đánh dấu, cắt) + lưu lên Sheet/Drive | Code xong, **chưa chạy trên GAS thật** |
| Lấy giờ packing từ FMS | Chưa làm (để sau) |
| Vùng đếm bám theo bao di động, nhiều camera | Chưa làm |

## Chạy thử local

```bash
npm install
npm run build
.venv\Scripts\python -m http.server 8765
```

Mở `http://localhost:8765/dist/dem.html` (trang Đếm kiện) – chọn file video trên máy.
Kiểm thử: `npm test` (JS) và `.venv\Scripts\python -m pytest` (Python).

## Đẩy lên Apps Script

```bash
npm run build
cd gas
clasp push --force
```

Lần đầu: mở project Apps Script, chạy `setup()` (tạo sheet, thư mục Drive, `API_TOKEN` cho app Python), rồi Deploy > Web app.
Trang tra cứu: link webapp. Trang đếm: link webapp + `?page=dem`.

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
