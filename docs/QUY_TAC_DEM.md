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

## Chế độ FMS (đã làm, 2026-11-08)

FMS lưu **giờ quét từng đơn** và **mã bao** → thứ tự đơn trong bao lấy từ giờ quét, không phụ thuộc AI:

1. Nạp dữ liệu quét: dán bảng Excel/CSV vào trang Đếm, hoặc dán vào sheet **"FMS"** của spreadsheet kết quả rồi bấm "Lấy từ webapp" (`uiFmsBag`).
   Cần 3 cột (tên cột tự nhận): mã đơn, giờ quét, mã bao. Giờ dạng `dd/mm/yyyy HH:MM:SS` hoặc `yyyy-mm-dd HH:MM:SS`.
2. Bắn mã đơn → hiện **"kiện thứ N/T trong bao B"** theo giờ quét (đơn quét nhiều lần: lấy lần đầu, có cảnh báo).
3. Đồng bộ giờ camera (gõ chữ đồng hồ 1 lần) → đổi giờ quét sang vị trí trong video.
4. App quét chuyển động trong miệng bao quanh các lần quét của bao, **tự tính độ lệch giờ camera ↔ FMS** (±60s), rồi
   **ghép tối ưu cả chuỗi** lần quét ↔ lượt bỏ kiện (`alignScans`, quy hoạch động giữ thứ tự; mọi lượt kể cả "người che" đều là ứng viên).
5. Ảnh bằng chứng tại lượt bỏ kiện khớp với đơn; không khớp được thì lấy khung 2s sau giờ quét và ghi "cần kiểm tra".

Thử với dữ liệu FMS **giả lập** (43 lần quét của người bắn hàng, đặt 2s trước lúc ném, đồng hồ FMS lệch 23s):
tự tính lệch −21,8s, **ghép đúng 43/43** lượt. Chưa thử với dữ liệu FMS thật (độ trễ quét→bỏ vào bao thực tế có thể dao động hơn).

Chưa xử lý: lấy kiện ra (−1) trong chế độ FMS – phụ thuộc FMS có ghi lần gỡ/hủy quét không.

## Thử với dữ liệu THẬT (2026-11-08)

- FMS: phiếu TO `TO20261107JIZEQ`, 28 đơn, quét 15:47:54 → 15:48:59 ngày 07/11/2026 (khoảng 2,3 giây/đơn).
- Video: 2 góc camera. **Góc B** nhìn rõ bao và người bắn hàng (áo đỏ đậm); góc A bao bị cắt ở mép khung, người quay lưng → chưa dùng.
- Người bắn hàng ngồi sát bao, tay luôn nằm trong miệng bao → **đếm theo chuyển động thất bại** (11 lượt, gần hết bị gắn cờ người che, ghép 7/28).
- Đổi sang **tín hiệu màu kiện**: lòng bao xanh, tay áo tối, kiện trắng/nâu/đỏ → mỗi kiện đi vào miệng bao là một đỉnh nhọn
  (`parcelFraction`, `detectColorPeaks`, k = 2,5).
- Kết quả trên trình duyệt: tự tính lệch giờ camera ↔ FMS **+0,8 s**, **ghép 28/28 đơn, kiểm bằng mắt cả 28 đều đúng kiện**
  (độ trễ quét → bỏ vào bao 0,1–1,3 s). Lượt có độ trễ lệch > 1,2 s so với trung vị tự đánh dấu "cần kiểm tra".
- Lưu ý: "11-07-2026 Sat" đọc được cả 7/11 lẫn 11/7 (cả hai đều thứ Bảy) → tool hiểu tháng-ngày, khớp ngày FMS.
  Nên dùng ngày trong file FMS để chốt cách đọc ngày (chưa làm).
- Giới hạn: một bao, một camera, bao xanh. Bao màu khác / kiện màu tối (túi đen) có thể không tạo đỉnh màu → khi đó app quay về đếm theo chuyển động.
