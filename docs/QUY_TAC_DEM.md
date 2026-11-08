# Quy tắc đếm kiện (người dùng chốt 2026-11-08)

## Miệng bao

- Miệng bao = **phần lòng tối bên trong viền bao** (người dùng gửi ảnh mẫu), không phải cả vùng chữ nhật quanh bao.
- Người dùng khoanh miệng bao bằng **đa giác** bám viền trong của bao. Mọi thứ ngoài đa giác (đống hàng, sàn, bao bên cạnh) không được ảnh hưởng tới số đếm.

## Người bắn hàng

- Mỗi phiên đếm gắn với **một người bắn hàng** (người quét mã rồi bỏ kiện vào bao). Người dùng chọn người đó trên khung hình (bấm vào người).
- App theo dõi người bắn hàng (cơ thể, cổ tay/bàn tay) suốt đoạn đếm.

## Tính +1 / −1

| Tình huống | Số đếm |
|---|---|
| Kiện đi từ **tay người bắn hàng** qua miệng bao vào trong, không quay ra | **+1** |
| Kiện bay vào bao **từ hướng khác / người khác** | **0** – vẫn liệt kê để xem lại, ghi "không phải người bắn hàng" |
| **Người bắn hàng lấy kiện trong bao ra** (kiện đi từ trong miệng bao ra ngoài, trong tay người đó) | **−1** |
| Người khác lấy kiện ra | 0 – liệt kê để xem lại |
| Kiện chỉ di chuyển ngoài miệng bao (đống hàng, sàn, bao bên cạnh) | 0 – không liệt kê |
| Không chắc (bị che, không thấy tay, nhiều kiện một lúc) | không tự tính – "cần kiểm tra" |

Thứ tự kiện ("kiện thứ N") tính theo **số dư** sau các lượt +1/−1 đã xác nhận, theo thời gian.

## Cần từ mô hình

1. **Phát hiện kiện** trong khung (kiện nhỏ, nhiều loại: hộp carton, túi nilon, phong bì).
2. **Theo dõi kiện** qua các khung (ID theo thời gian) để biết kiện đi vào hay ra khỏi miệng bao.
3. **Người / bàn tay**: vị trí cổ tay người bắn hàng để biết kiện có đang trong tay người đó lúc qua miệng bao không.

Trạng thái thử mô hình: xem `docs/MO_HINH.md`.
