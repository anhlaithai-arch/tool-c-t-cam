# Mục tiêu dài hạn: mô hình AI đếm kiện "xịn" (người dùng chốt 2026-11-10)

**Mọi việc sau này phải đi theo hướng này.**

## Mục tiêu
- Một mô hình AI tự huấn luyện, đếm đúng kiện bỏ vào bao ở **mọi góc camera, mọi kho, ngày/đêm**.
- Kết quả cuối **chính xác 100%**. Cách đạt: AI tự quyết khi đủ chắc (mục tiêu ≥ 99% lượt tự quyết đúng), lượt không chắc **bắt buộc** chuyển người duyệt. Không bao giờ âm thầm đoán.
- Chỉ người đóng TO được bỏ hàng vào bao; người khác bỏ/ném/rơi → cảnh báo (docs/QUY_TAC_DEM.md).
- Đầu vào: video bất kỳ + mã đơn → tự ra ảnh bằng chứng "kiện N/T" của đơn.

## Lợi thế dữ liệu
Giờ quét FMS của từng đơn = nhãn gần đúng miễn phí (mỗi lần quét ≈ 1 lần bỏ kiện vài giây sau). Dùng để tự tạo nhãn, người chỉ duyệt lại chỗ lệch.

## Lộ trình
| Giai đoạn | Việc | Máy |
|---|---|---|
| 0 – Thu dữ liệu | Deploy webapp; duyệt ✓/✗ trên webapp; gom video + file TO nhiều camera vào `data/videos/<camera>/`, `data/to/` | Máy nào cũng được |
| 1 – Bộ dữ liệu | Tự cắt đoạn quanh miệng bao theo giờ quét FMS; công cụ gán nhãn nhanh (lượt bỏ kiện, người bỏ, hộp kiện/tay); tách tập kiểm theo **camera** (camera chưa từng học) | Máy 4060 |
| 2 – Mô hình | (a) nhận kiện + tay (RF-DETR, Apache-2.0) tinh chỉnh; (b) mô hình thời gian phân loại đoạn ~1,5 s: "người đóng bỏ vào / người khác / rơi / không có"; (c) RTMO nhận người. Xuất ONNX | Máy 4060 (CUDA) |
| 3 – Đo | Chỉ số: đúng tổng số kiện từng TO, đúng thứ tự đơn, tỉ lệ lượt phải duyệt; đo trên camera chưa học | Máy 4060 |
| 4 – Chạy thật | Trình duyệt (WebGPU) hoặc app chạy trên máy có card; vòng lặp: lượt người sửa → thêm vào dữ liệu → học lại | — |

## Hiện có (2026-11-10)
- Webapp: nhận người RTMO, gán lượt cho người đóng, cảnh báo người khác, học logistic 19 đặc trưng (bước đệm, không phải mô hình cuối).
- Dữ liệu thật: 1 video Camera 01 + TO2026102219TA2 (55 đơn), người đóng = chị áo vàng SKT VINA.

## Cần đủ để bắt đầu giai đoạn 1
- Ít nhất **5 camera/góc khác nhau**, mỗi camera **≥ 5 TO trọn vẹn** (video + file TO gốc: mã đơn, scan time), có cả ca đêm nếu kho làm đêm.
