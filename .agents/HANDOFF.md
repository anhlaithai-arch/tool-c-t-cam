# HANDOFF
Khóa: trống
Cập nhật: 2026-11-10 bởi Claude

## Đang làm
- Việc: Đếm AI 2 hướng + Xem AI (thiết kế: docs/HUONG_DEM_AI.md). Người dùng chọn RTMO-m (Xenova/RTMO-m int8, onnxruntime-web CDN).
- File đang sửa: không
- Đã xong: phiếu 1 lõi pose/attrib/posemodel + test (4076999); phiếu 2 giao diện Hướng 2 + Xem AI + dải thời gian trên gas/Dem.html (7b51895). npm test 55 đạt.
- Còn lại:
  1. Chạy thử thật trên trình duyệt với video kho: model tải được không, thứ tự kênh RGB/BGR (hằng CHANNELS trong browser/posemodel.mjs), tốc độ mỗi lượt.
  2. attrib.mjs: người đóng chỉ tìm ở khung ĐẦU của cửa sổ 0,8s; nếu khung đầu không thấy thì ra "cần duyệt" – nên tìm ở khung đầu tiên có người trùng packerBox.
  3. Phiếu 3: Hướng 1 (neo giờ đơn đầu → tìm bao + người đóng tự động).
  4. Phiếu 4: huấn luyện lớp cuối trên webapp.
  5. Việc tồn cũ: cam A, vùng đếm bám bao, trừ 1 khi lấy ra.

## Quyết định đã chốt
- Video xử lý trong trình duyệt, không upload; GAS chỉ xác thực, lưu Sheet/Drive.
- Giờ quay lấy từ đồng hồ in trên hình (OCR), không dùng tên/ngày file.
- FMS chặn API gọi thẳng từ GAS (403) → gọi qua Worker `https://catcam.laithaianhcn59vnua.workers.dev/` (Script Property WORKER_URL ghi đè), bản `tracking-station-outbound-v1`. Bookmarklet / file .xlsx là cách dự phòng.
- `gas/LogicBundle.html` chỉ sinh bằng `npm run build`.

## Quyết định đã chốt (thêm)
- Từ 2026-11-10: **Codex viết mọi code, kể cả nhỏ nhất**; Claude chỉ thiết kế, viết phiếu, review, commit, deploy (ngoại lệ: Codex không chạy được, hoặc chỉ đổi chữ/số). Xem `AGENTS.md` mục 1, 3.
- Webapp chỉ cho tài khoản tên miền công ty (`appsscript.json` access DOMAIN) — Workspace không cho ANYONE.
- Deploy mới: `clasp push --force` rồi `clasp update-deployment AKfycbzRq-C0E2nQcYOCkseXwnjojbspMLYaFAA3XHgJT5faw8KVWXT5VdyZzVfWh87CQ6nfPA` để giữ nguyên link.
- Ưu tiên đếm bỏ vào chính xác trước; lấy ra (−1) huấn luyện sau.
- Máy hiện tại: không có GPU NVIDIA (Intel Graphics, 16 GB RAM) → chỉ huấn luyện mô hình nhỏ trên CPU; mô hình lớn cần máy RTX 4060 cũ.

## Chờ người dùng
- Đã push + deploy @3 (2026-11-10 11:11). Chờ người dùng chạy thử Load station / Export TO với đơn thật.
- Xác nhận chỗ để cookie: đang đọc spreadsheet "Phân quyền" G1/G2 (script thử của người dùng đọc tab 🔐Cookies🔑 A1/A2/C1).
- Đã chọn: thu mẫu bằng duyệt trên webapp. `clasp push` xong 2026-11-10 10:33 (code trên GAS vốn đã trùng repo; giữ `gas/aa.js` của người dùng).
- Webapp đã deploy @2 (2026-11-10), quyền DOMAIN (quản trị Workspace chặn ANYONE). Link: https://script.google.com/macros/s/AKfycbzRq-C0E2nQcYOCkseXwnjojbspMLYaFAA3XHgJT5faw8KVWXT5VdyZzVfWh87CQ6nfPA/exec (trang Đếm: thêm `?page=dem`). Chờ người dùng mở thử, chạy `setup()` nếu chưa, bắt đầu duyệt mẫu.
- Chọn việc tiếp theo trong "Còn lại".
- Video + file TO thật chưa có trên máy này (`data/` trống) → chưa thử được trên dữ liệu thật.
