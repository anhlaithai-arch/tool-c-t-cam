# HANDOFF
Khóa: trống
Cập nhật: 2026-11-10 10:35 bởi Claude

## Đang làm
- Việc: huấn luyện để đếm đủ, chính xác số kiện BỎ VÀO bao (người dùng giao 2026-11-10). Đang chờ dữ liệu.
- File đang sửa: không
- Đã xong: máy mới `C:\Users\anh.laithai\projects\TOOL-CAT-CAM` đã clone, `npm install`, build, test JS 39/39, Python `.venv` (3.13) pytest 12/12.
- Còn lại (việc tồn, theo `docs/TONG_HOP.md`):
  1. Thu mẫu đã duyệt (✓/✗) từ nhiều TO → `app/tools/build_dataset.py` → huấn luyện bộ phân loại nhỏ (3 khung ±0,4s) → ONNX chạy trong trình duyệt để chấm lại lượt → đo trên TO chưa dùng để huấn luyện.
  2. Dùng thêm cam A.
  3. Vùng đếm bám theo bao di động.
  4. Trừ 1 kiện khi người bắn lấy kiện ra — để SAU khi đếm bỏ vào đã chính xác (người dùng chốt). Chưa rõ FMS ghi nhận việc lấy ra thế nào.
  5. Khóa webapp cho tên miền công ty (hiện "Anyone") — cần người dùng deploy.

## Quyết định đã chốt
- Video xử lý trong trình duyệt, không upload; GAS chỉ xác thực, lưu Sheet/Drive.
- Giờ quay lấy từ đồng hồ in trên hình (OCR), không dùng tên/ngày file.
- FMS chặn API từ máy chủ GAS (403) → lấy TO bằng bookmarklet "📋 Lấy TO" hoặc file .xlsx.
- `gas/LogicBundle.html` chỉ sinh bằng `npm run build`.

## Quyết định đã chốt (thêm)
- Ưu tiên đếm bỏ vào chính xác trước; lấy ra (−1) huấn luyện sau.
- Máy hiện tại: không có GPU NVIDIA (Intel Graphics, 16 GB RAM) → chỉ huấn luyện mô hình nhỏ trên CPU; mô hình lớn cần máy RTX 4060 cũ.

## Chờ người dùng
- Đã chọn: thu mẫu bằng duyệt trên webapp. `clasp push` xong 2026-11-10 10:33 (code trên GAS vốn đã trùng repo; giữ `gas/aa.js` của người dùng).
- Chưa có deploy Web app thật (chỉ @HEAD). Chờ người dùng đồng ý deploy + chọn quyền truy cập (manifest đang ANYONE_ANONYMOUS; đề xuất DOMAIN).
- Chọn việc tiếp theo trong "Còn lại".
- Video + file TO thật chưa có trên máy này (`data/` trống) → chưa thử được trên dữ liệu thật.
