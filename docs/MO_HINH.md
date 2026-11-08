# Thử mô hình có sẵn (2026-11-08)

Mục tiêu: đáp ứng `docs/QUY_TAC_DEM.md` – chỉ tính kiện **người bắn hàng** bỏ vào miệng bao, lấy ra thì −1.

## Đã thử trên video mẫu (Camera 01, 720p)

| Mô hình | Giấy phép | Kết quả trên khung thật | Tốc độ | Chạy trong trình duyệt |
|---|---|---|---|---|
| Grounding DINO tiny (nhận diện theo từ khóa) | Apache-2.0 | Người: rất tốt (0,75–0,87). Kiện: lúc được lúc không; kiện đang bay bị nhòe **không nhận ra**. Tay: đôi khi | ~300 ms/khung (GPU) | Không thực tế (quá nặng) |
| RTMO-m (tư thế nhiều người, 17 điểm khớp gồm cổ tay) | Apache-2.0 | Thấy đủ người ngồi quanh bao, phần lớn cổ tay; tay đang vung nhanh đôi khi mất | ~170 ms/khung (CPU) | Có: bản ONNX (Transformers.js / ONNX Runtime Web) |

Ảnh kết quả: `data/eval/detectors/gdino.jpg`, `pose.jpg` (không commit). Script: `app/tools/try_detectors.py`, `app/tools/try_pose.py` (chạy trong `.venv-ml`).

**Phát hiện:** cùng một bao có **hai người ném kiện** (người ngồi bên trái và người ngồi bên phải). Cách đếm theo chuyển động cũ cộng cả hai, nên sai so với quy tắc mới.

## Phương án đếm mới

1. **Miệng bao = đa giác** người dùng khoanh theo viền trong của bao. Chuyển động ngoài đa giác bị bỏ qua.
2. **Người bắn hàng**: người dùng bấm vào người đó trên một khung. App chạy RTMO quanh các lượt để bám người đó (người ngồi gần như cố định nên bám dễ).
3. **Lượt có vật qua miệng bao** (tín hiệu chuyển động trong đa giác như hiện tại).
4. **Gán lượt cho người**: xét 0,8 s trước lượt, cổ tay của ai đi về phía miệng bao và ở gần mép miệng bao nhất.
   - Cổ tay người bắn hàng → **+1**
   - Người khác hoặc không thấy cổ tay ai gần → **0**, liệt kê "không phải người bắn hàng"
5. **Lấy ra (−1)**: cổ tay người bắn hàng đi **vào trong** đa giác miệng bao rồi rút ra, kèm chuyển động đi ra ngoài miệng bao → đề xuất **−1**, mặc định cần người duyệt xác nhận.
6. Chỉ chạy mô hình tư thế quanh các lượt (khoảng 10 khung mỗi lượt), không chạy toàn video, để giữ tốc độ trong trình duyệt.

## Thử gán kiện cho người bắn hàng (đoạn 11:00–14:10, người bắn hàng = áo đỏ sẫm)

Nhãn người ném: 43–46 kiện của người bắn hàng, 3 kiện người áo xám, 1 lượt người đi ngang (`tests/fixtures/eval_labels_center_660_850.json`, trường `who`).
Theo dõi tư thế **liên tục** 12,5 khung/giây cả đoạn (`app/tools/pose_track.py`): người bắn hàng được bám ở **96%** số khung, kể cả khi đứng dậy.

| Cách gán | Độ chính xác | Độ phủ | Loại kiện người khác |
|---|---|---|---|
| Chỉ chuyển động trong vùng khoanh (v2) | ~86% | ~84% | Không |
| Cổ tay gần miệng bao nhất (`attribute_pose.py`) | 71% | 67% | Không |
| Tốc độ cổ tay lao về miệng bao (`attribute_track.py`) | 70% | 44% | Không |
| **Điểm kiện đi vào viền miệng bao + cổ tay gần điểm đó** (`entry_direction.py`) | **81–85%** | **79–84%** | Được 2–3/3 |

Nhận xét:
- Cả hai người ngồi sát bao, cổ tay ai cũng gần miệng bao → khoảng cách đơn thuần không phân biệt được.
- Điểm cổ tay rung nhiễu giữa các khung; động tác thả kiện của người bắn hàng ngắn → tốc độ không dùng được.
- Hướng đi vào: kiện người bắn hàng vào từ trên/trái (220–340°), người áo xám ném vòng qua phía trên-phải (288–345°) → chỉ dùng góc vẫn lẫn.
- Lỗi còn lại chủ yếu do ID người khác bị đổi qua lại khi bị che, và lượt có người đi ngang.

**Kết luận:** mô hình có sẵn + luật tay đạt khoảng 80–85%. Không đủ để tự đánh dấu đơn mà không cần người duyệt.
Muốn vượt mức này cần: (a) dữ liệu thời gian quét mã từng đơn từ FMS, hoặc (b) huấn luyện mô hình nhận kiện/động tác riêng trên video của kho (vài trăm lượt gán nhãn).

## Mô hình khác đã tìm (chưa thử)

- **RF-DETR** (Apache-2.0 cho bản Nano–Large, xuất ONNX được): nếu sau này huấn luyện mô hình nhận kiện riêng.
- **SAM 2** (Apache-2.0): bám theo mặt nạ vật thể trong video; có thể dùng để **tạo dữ liệu huấn luyện** (chạy trên máy dev), không chạy trong trình duyệt.
- **ByteTrack / OC-SORT** (MIT): theo dõi nhiều đối tượng, dùng khi có mô hình nhận kiện.
- **MediaPipe Hand/Pose Landmarker**: chạy trong trình duyệt; chủ yếu cho ít người, ảnh gần; giấy phép cần xác nhận trên repo chính thức.
- **100DOH / Hands23** (nhận tay đang cầm vật): giấy phép chưa rõ, chưa dùng.

## Nguồn

- [Grounding DINO tiny – Hugging Face](https://huggingface.co/IDEA-Research/grounding-dino-tiny)
- [OWLv2 – Hugging Face](https://huggingface.co/google/owlv2-base-patch16-ensemble)
- [rtmlib (RTMPose/RTMO)](https://github.com/Tau-J/rtmlib)
- [RTMO-s ONNX cho trình duyệt (Xenova)](https://huggingface.co/Xenova/RTMO-s/blame/main/README.md)
- [RF-DETR](https://inference-models.roboflow.com/models/rfdetr-object-detection/)
- [SAM 2](https://github.com/facebookresearch/sam2)
- [OC-SORT (MIT, kèm ByteTrack)](https://github.com/noahcao/OC_SORT)
- [MediaPipe Hand Landmarker cho Web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [100DOH – Understanding Human Hands in Contact](https://arxiv.org/abs/2006.06669v1)
