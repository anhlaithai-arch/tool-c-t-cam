# HANDOFF
Khóa: trống
Cập nhật: 2026-11-10 10:10 bởi Claude

## Đang làm
- Việc: chưa nhận việc mới; vừa chuyển project sang quy trình `AGENTS.md` mới (khóa + sổ bàn giao + phiếu việc).
- File đang sửa: không
- Đã xong: máy mới `C:\Users\anh.laithai\projects\TOOL-CAT-CAM` đã clone, `npm install`, build, test JS 39/39, Python `.venv` (3.13) pytest 12/12.
- Còn lại (việc tồn, theo `docs/TONG_HOP.md`):
  1. Trừ 1 kiện khi người bắn lấy kiện ra khỏi bao.
  2. Dùng thêm cam A.
  3. Vùng đếm bám theo bao di động.
  4. Thu mẫu huấn luyện từ mục duyệt ✓/✗ rồi huấn luyện mô hình (`app/tools/build_dataset.py`).
  5. Khóa webapp cho tên miền công ty (hiện "Anyone") — cần người dùng deploy.

## Quyết định đã chốt
- Video xử lý trong trình duyệt, không upload; GAS chỉ xác thực, lưu Sheet/Drive.
- Giờ quay lấy từ đồng hồ in trên hình (OCR), không dùng tên/ngày file.
- FMS chặn API từ máy chủ GAS (403) → lấy TO bằng bookmarklet "📋 Lấy TO" hoặc file .xlsx.
- `gas/LogicBundle.html` chỉ sinh bằng `npm run build`.

## Chờ người dùng
- Chọn việc tiếp theo trong "Còn lại".
- Video + file TO thật chưa có trên máy này (`data/` trống) → chưa thử được trên dữ liệu thật.
