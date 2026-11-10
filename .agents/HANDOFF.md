# HANDOFF
Khóa: trống
Cập nhật: 2026-11-10 11:45 bởi Claude

## Đang làm
- Việc (ưu tiên, người dùng giao 11:10): lấy TO qua Cloudflare Worker — mã đơn → Load station (API 1) → Export TO (API 2) → bảng FMS; đơn quét đầu = bắt đầu đếm, đơn quét cuối = dừng. Sau đó: huấn luyện đếm bỏ vào (đang chờ dữ liệu).
- File đang sửa: không
- Đã xong: giao diện Load station/Export TO + nút tải toàn bộ mẫu (Codex, đã review); server Worker `uiFmsStations`/`uiFmsFetch` + test (2375c07); `app/tools/train_drop.py` + `uiExportTrainingSamples` trong `gas/Code.js` (9bf7ce2); webapp deploy @2; máy mới `C:\Users\anh.laithai\projects\TOOL-CAT-CAM` đã clone, `npm install`, build, test JS 39/39, Python `.venv` (3.13) pytest 12/12.
- Còn lại (việc tồn, theo `docs/TONG_HOP.md`):
  1. Thu mẫu đã duyệt (✓/✗) từ nhiều TO → `app/tools/build_dataset.py` → huấn luyện bộ phân loại nhỏ (3 khung ±0,4s) → ONNX chạy trong trình duyệt để chấm lại lượt → đo trên TO chưa dùng để huấn luyện.
  2. Dùng thêm cam A.
  3. Vùng đếm bám theo bao di động.
  4. Trừ 1 kiện khi người bắn lấy kiện ra — để SAU khi đếm bỏ vào đã chính xác (người dùng chốt). Chưa rõ FMS ghi nhận việc lấy ra thế nào.

## Quyết định đã chốt
- Video xử lý trong trình duyệt, không upload; GAS chỉ xác thực, lưu Sheet/Drive.
- Giờ quay lấy từ đồng hồ in trên hình (OCR), không dùng tên/ngày file.
- FMS chặn API gọi thẳng từ GAS (403) → gọi qua Worker `https://catcam.laithaianhcn59vnua.workers.dev/` (Script Property WORKER_URL ghi đè), bản `tracking-station-outbound-v1`. Bookmarklet / file .xlsx là cách dự phòng.
- `gas/LogicBundle.html` chỉ sinh bằng `npm run build`.

## Quyết định đã chốt (thêm)
- Webapp chỉ cho tài khoản tên miền công ty (`appsscript.json` access DOMAIN) — Workspace không cho ANYONE.
- Deploy mới: `clasp push --force` rồi `clasp update-deployment AKfycbzRq-C0E2nQcYOCkseXwnjojbspMLYaFAA3XHgJT5faw8KVWXT5VdyZzVfWh87CQ6nfPA` để giữ nguyên link.
- Ưu tiên đếm bỏ vào chính xác trước; lấy ra (−1) huấn luyện sau.
- Máy hiện tại: không có GPU NVIDIA (Intel Graphics, 16 GB RAM) → chỉ huấn luyện mô hình nhỏ trên CPU; mô hình lớn cần máy RTX 4060 cũ.

## Chờ người dùng
- Đồng ý `clasp push` + `clasp update-deployment` để chạy thử luồng Worker trên webapp thật.
- Xác nhận chỗ để cookie: đang đọc spreadsheet "Phân quyền" G1/G2 (script thử của người dùng đọc tab 🔐Cookies🔑 A1/A2/C1).
- Đã chọn: thu mẫu bằng duyệt trên webapp. `clasp push` xong 2026-11-10 10:33 (code trên GAS vốn đã trùng repo; giữ `gas/aa.js` của người dùng).
- Webapp đã deploy @2 (2026-11-10), quyền DOMAIN (quản trị Workspace chặn ANYONE). Link: https://script.google.com/macros/s/AKfycbzRq-C0E2nQcYOCkseXwnjojbspMLYaFAA3XHgJT5faw8KVWXT5VdyZzVfWh87CQ6nfPA/exec (trang Đếm: thêm `?page=dem`). Chờ người dùng mở thử, chạy `setup()` nếu chưa, bắt đầu duyệt mẫu.
- Chọn việc tiếp theo trong "Còn lại".
- Video + file TO thật chưa có trên máy này (`data/` trống) → chưa thử được trên dữ liệu thật.
