# Đo độ chính xác đếm lượt bỏ kiện (2026-11-08)

## Dữ liệu

- Video `record_2026-11-08_13-43-07.mp4`, Camera 01, 1280×720, 25 khung/giây.
- Đoạn **11:00–14:10** (190 giây), bao ở giữa khung hình đặt trên giá. Vùng khoanh miệng bao `x=862 y=350 w=110 h=62`.
- Một nhân viên **ném** kiện vào bao từ bên trái; thỉnh thoảng có người đi ngang trước bao. Khoảng phút 13:20 bao được đóng/thay.
- **Nhãn do Claude gán** bằng cách xem dải 6 khung của từng lượt (`app/tools/eval_drops.py`), lưu ở `tests/fixtures/eval_labels_center_660_850.json`.
  Đây **chưa phải** đếm tay của người; 4 lượt không chắc được tính riêng (khoảng sai số 46–50).

## Kết quả

Số kiện thật vào bao trong đoạn: **46–50**.

| Phiên bản | Tool tự tính | Đúng | Sai (không có kiện) | Không chắc | Độ chính xác | Độ phủ | Phải xem lại |
|---|---|---|---|---|---|---|---|
| v1: chỉ ngưỡng chuyển động | 58 | 42 | 12 | 4 | **78%** | ~91% | 7 |
| v2: thêm lọc vị trí (đang dùng) | 45 | 38 | 4 | 3 | **90,5%** | ~83% | 19 |

- v2 không làm mất kiện nào: mọi kiện thật đều nằm trong một lượt; 8 kiện thật bị đưa sang nhóm "cần xem lại" (bị người che hoặc chuyển động yếu).
  Người dùng duyệt 19 lượt đó (✓/✗) thì tổng và thứ tự khớp đếm thật.
- Không duyệt gì: v1 đếm **dư ~20%**; v2 đếm **thiếu ~2–10%**.

## Lỗi còn lại và nguyên nhân

| Loại | Ví dụ | Hướng xử lý |
|---|---|---|
| Kiện ném đúng lúc người đi ngang che bao | 4 lượt | Hiện bắt người duyệt; sau này cần mô hình nhận diện kiện |
| Tay cầm kiện lơ lửng trên miệng bao rồi mới ném → tách thành 2 lượt | 1 lượt | Gộp lượt theo vật thể (cần theo dõi đối tượng) |
| Chuyển động ở mép vùng (người phía sau, chân người) | 4–7 lượt | Đã lọc phần lớn bằng "chuyển động yếu ở mép" |
| Bao bị bê đi sau khi chốt | 1 lượt | Người dùng giới hạn khoảng đếm |

## Quy tắc v2 (`browser/core/motion.mjs`, `refineEvents`)

So khung đỉnh của lượt với khung ngay trước lượt, trong vùng khoanh:
- Đổi > 30% ở **đáy** vùng (20% dưới cùng) → "nghi người che" (kiện ném vào đi từ trên xuống, không làm đổi đáy).
- Chuyển động yếu (< 6,5% diện tích) và gần như không đổi ở **lõi** vùng → "cần kiểm tra".

## Giới hạn của phép đo

- **Chỉnh ngưỡng và đo trên cùng một đoạn video**, nên con số v2 có thể lạc quan. Cần đo lại trên đoạn khác (bao khác, giờ khác, camera khác).
- Nhãn do AI xem ảnh, không phải người đếm tay.
- Chỉ một kiểu thao tác (ném từ bên trái, bao đứng yên).

## Cách đo lại trên video khác

```bash
.venv\Scripts\python -m app.tools.eval_drops VIDEO data\eval\<tên> --roi x,y,w,h --from <giây> --to <giây>
```
Xem `data/eval/<tên>/strips_*.jpg`, ghi nhãn vào `tests/fixtures/eval_labels_<tên>.json` (cùng định dạng),
chạy trang Đếm cùng vùng/khoảng, xuất `JSON.stringify(window.__dem.st.scan.events)` ra file rồi:

```bash
node scripts/eval-drops.mjs events.json data\eval\<tên>\candidates.json tests\fixtures\eval_labels_<tên>.json
```
