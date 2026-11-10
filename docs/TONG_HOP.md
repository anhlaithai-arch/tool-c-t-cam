# Tổng hợp dự án (cập nhật 2026-11-10)

Đọc file này đầu tiên khi tiếp tục trên máy khác. Chi tiết từng phần ở các file `docs/` khác.

## Tool làm gì

Nhân viên bắn mã đơn trên webapp → tool lấy TO (bao) và giờ quét của mọi đơn trong TO từ FMS →
mở video camera kho trên máy (không upload) → đọc đồng hồ in trên hình để đồng bộ giờ →
tìm lúc từng kiện được bỏ vào miệng bao → đánh dấu đơn là "kiện thứ N/T" kèm ảnh bằng chứng →
cắt ảnh từng đơn (khung hình + cột thông tin) hoặc ZIP cả bao.

## Đường chạy

| Bước | Ở đâu | File chính |
|---|---|---|
| Lấy TO + danh sách đơn | Nút "📋 Lấy TO" (bookmarklet) chạy trên trang FMS đang đăng nhập, copy bảng → dán vào trang Đếm | `browser/fms-bookmarklet.js` |
| Hoặc nạp file TO xuất từ FMS (.xlsx) | Trình duyệt | `browser/core/xlsx.mjs`, `browser/core/fms.mjs` |
| Mở video, tua khung | Trình duyệt | `browser/video.mjs` |
| Đọc đồng hồ camera (OCR mẫu chữ số) | Trình duyệt | `browser/core/osd.mjs`, `browser/clocksync.mjs` |
| AI tự tìm bao (nhịp chuyển động khớp nhịp quét FMS) | Trình duyệt | `browser/bagfinder.mjs`, `browser/core/rhythm.mjs` |
| Phát hiện lượt bỏ kiện (màu kiện / chuyển động) + ghép với lần quét | Trình duyệt | `browser/counter.mjs`, `browser/core/motion.mjs`, `alignScans` trong `fms.mjs` |
| Cắt ảnh đơn / ZIP | Trình duyệt | `browser/ordercard.mjs` |
| Lưu kết quả, ảnh bằng chứng, mẫu huấn luyện | GAS → Sheet/Drive | `gas/Code.js` |
| Giao diện | GAS HtmlService | `gas/Dem.html` (trang Đếm, `?page=dem`), `gas/Index.html` (tra cứu) |

`gas/LogicBundle.html` sinh từ `browser/` bằng `npm run build`, không sửa tay.

## Kết quả đo trên dữ liệu thật

- TO20261107JIZEQ (28 đơn, cam B, người bắn áo đỏ sẫm): ghép đúng 28/28 bằng tín hiệu màu kiện.
- TO20261106IH08H (49 đơn, kiện đen): AI tự tìm đúng bao, ghép 48/49, khoảng 37/49 ảnh bằng chứng đúng chính xác.
- Đọc đồng hồ: 50/50 khung mẫu, sai lệch khoảng ±0,06 s.

## Còn dở / việc tiếp theo

1. FMS chặn gọi API từ máy chủ GAS (403 chống bot), nên dùng nút "Lấy TO". Phần gọi qua máy chủ chỉ để thử.
2. Webapp chưa có khóa, đang mở "Anyone": trước khi cả nhóm dùng, deploy chỉ cho tên miền công ty.
3. Chưa làm: trừ 1 khi người bắn lấy kiện ra; dùng cam A; vùng đếm bám bao di động.
4. Thu mẫu huấn luyện từ mục duyệt (✓/✗) rồi huấn luyện mô hình (`app/tools/build_dataset.py`).

## Thiết lập máy mới

Xem `docs/LAM_VIEC_NHIEU_MAY.md`. Tóm tắt:

```bash
git clone <URL repo> "D:\New folder"
cd "D:\New folder"
npm install
npm run build
npm test
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pytest
```

Đẩy lên GAS: `npm i -g @google/clasp`, `clasp login`, rồi `cd gas && clasp push` (chỉ khi người dùng đồng ý).
Video và file TO (`data/`) không có trên GitHub, phải chép riêng.
