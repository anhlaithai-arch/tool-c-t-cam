# Đếm bằng AI: 2 hướng + xem AI hoạt động (chốt 2026-11-10)

## Hướng 1 – tự tìm theo giờ đơn đầu (làm SAU, cần TO thật để thử)
1. Giờ quét đơn đầu tiên (FMS) → tua video tới giờ đó qua đồng hồ OCR, xét ±60 s.
2. Tìm bao: `bagfinder.mjs` (nhịp chuyển động khớp nhịp quét) nhưng neo ở giờ đơn đầu.
3. Tìm người đóng TO: RTMO quanh bao, chọn người có cổ tay đi về miệng bao đúng lúc các đơn đầu được quét.
4. Đếm từ đơn đầu → đơn cuối, chỉ cộng lượt gán được cho người đó.
5. Khớp nhịp kém / không thấy người / không đọc được đồng hồ → chuyển sang Hướng 2.

## Hướng 2 – khoanh tay (làm TRƯỚC)
1. Người dùng kéo **ô xét** (gồm người đóng TO + bao) và khoanh **miệng bao** bằng đa giác (bấm 4+ điểm).
2. Bấm vào người đóng TO trên một khung → chọn người (RTMO).
3. Lượt bỏ kiện = chuyển động trong miệng bao (`counter.scanRange`, như cũ).
4. Với mỗi lượt: chạy RTMO ~10 khung trong 0,8 s trước lượt, chỉ trong ô xét.
   - Cổ tay **người đóng** đi về miệng bao **và** có vật qua viền miệng bao → **+1**.
   - Cổ tay người khác → **0** ("không phải người đóng").
   - Thiếu một điều kiện / không thấy cổ tay → **cần duyệt**.

## Mô hình nhận người: RTMO-m (người dùng chọn)
- File: Hugging Face `Xenova/RTMO-m`, Apache-2.0, `onnx/model_int8.onnx` (~23 MB, có CORS). Chạy bằng onnxruntime-web (CDN), lưu Cache Storage để lần sau khỏi tải.
- Vào: `input` [1,3,640,640] float32 0..255 (không chuẩn hóa). Ra: `dets` [1,N,5] (x1,y1,x2,y2,score), `keypoints` [1,N,17,3] (x,y,score) theo tọa độ 640.
- Chỉ chạy quanh các lượt (không chạy cả video) để giữ tốc độ.

## Xem AI (nút trên trang Đếm)
Vẽ lên video khi tua: ô xét, đa giác miệng bao, khung xương người đóng, vệt cổ tay 0,8 s, nhãn lượt (+1/0/?) kèm điểm và lý do.
Dải thời gian: chuyển động miệng bao, vạch giờ quét FMS, lượt AI chấm. Bấm lượt → 3 khung + lý do + duyệt ✓/✗ (thành mẫu huấn luyện).

## Huấn luyện trên webapp (sau)
Giữ MobileNetV3-small cố định, học lớp cuối (logistic) bằng JS trong trình duyệt, trọng số lưu Drive/Sheet qua GAS.

## Phiếu việc
1. Lõi: `browser/core/pose.mjs` (thuần, có test), `browser/core/attrib.mjs` (luật gán lượt, có test), `browser/posemodel.mjs` (tải ORT + model, chạy trên video).
2. Giao diện Hướng 2 + Xem AI trong `gas/Dem.html`.
3. Hướng 1.
4. Huấn luyện trên webapp.
