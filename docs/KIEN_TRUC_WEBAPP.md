# Webapp GAS: bắn mã, tra giờ packing, xem kết quả đếm

Đã chốt 2026-11-08: webapp hiển thị **cả kết quả đếm và ảnh bằng chứng**.

```
[Máy local có GPU]                         [Google Apps Script webapp]
 app Python: đọc video, đếm kiện  --POST-->  doPost API (cần API_TOKEN)
   - hỏi giờ packing theo mã đơn             - Sheet "KetQua": 1 dòng / kết quả
   - gửi kết quả + ảnh bằng chứng            - Drive: thư mục ảnh bằng chứng
                                             doGet -> Index.html (không cần khóa)
                                              - bắn mã / tìm mã đơn
                                              - xem số kiện, thứ tự, ảnh
```

- Video **không** lên Google. Chỉ ảnh bằng chứng (khung hình / ảnh cắt) và số liệu được gửi lên Sheet/Drive của công ty.
- Gửi lại cùng `id` thì **ghi đè đúng dòng đó**, không tạo dòng trùng.
- Thứ tự (`order_index`) có thể đổi khi sửa kết quả, nên định danh luôn là `id` (ID sự kiện), không dùng số thứ tự.

## Truy cập và bảo mật

- Deploy webapp: *Execute as: Me*, *Who has access: Anyone* (để app Python gọi được mà không cần đăng nhập Google).
- `API_TOKEN` (Script Properties): app Python dùng để ghi/đọc qua `doPost`.
- **Không có khóa nhóm** (bỏ 2026-11-09 theo yêu cầu người dùng): ai có link webapp đều xem, lưu kết quả và gọi FMS được (bằng cookie FMS của người deploy). Giữ link trong nội bộ; muốn chặn thì deploy *Who has access: Anyone within* tên miền công ty.
- Nếu Google Workspace công ty chặn deploy "Anyone" thì phải đổi phương án xác thực (báo Claude).

## Script Properties

| Khóa | Ý nghĩa |
|---|---|
| `API_TOKEN` | Tạo tự động khi chạy `setup()` |
| `RESULT_SHEET_ID` | Spreadsheet lưu kết quả (tạo tự động) |
| `EVIDENCE_FOLDER_ID` | Thư mục Drive chứa ảnh (tạo tự động) |
| `PACKING_SHEET_ID`, `PACKING_SHEET_NAME`, `PACKING_CODE_COL`, `PACKING_TIME_COL` | Nguồn tra giờ packing. **Tạm** là một Google Sheet; thay bằng hệ thống thật khi có thông tin |

## API `doPost` (JSON)

Gửi: `{"token": API_TOKEN, "action": "...", "data": {...}}`
Trả: `{"ok": true, ...}` hoặc `{"ok": false, "error": "..."}`

| action | data | trả về |
|---|---|---|
| `ping` | `{}` | `{ok, time}` |
| `packingTime` | `{orderCode}` | `{ok, orderCode, packingTime: "YYYY-MM-DDTHH:MM:SS" \| null}` |
| `submitResult` | một bản ghi kết quả (bảng dưới) | `{ok, id, row, created: bool}` |
| `uploadEvidence` | `{resultId, kind, fileName, mimeType, base64}` | `{ok, fileId}` |

`kind`: `full` (ảnh nguyên khung) · `marked` (ảnh đánh dấu) · `crop` (ảnh cắt kiện).

## Bản ghi kết quả (cột Sheet "KetQua")

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | chuỗi | ID sự kiện cố định, khóa chính |
| `orderCode` | chuỗi | mã đơn đã bắn |
| `packingTime` | ISO | giờ packing từ hệ thống |
| `sessionId`, `bagId` | chuỗi | phiên đóng bao, bao tải |
| `camera` | chuỗi | |
| `videoFile` | chuỗi | tên file video (chỉ tên, không upload) |
| `videoTimeS` | số | vị trí trong video (giây) |
| `wallTime` | ISO | giờ thật của sự kiện (từ đồng hồ camera) |
| `orderIndex` | chuỗi | thứ tự trong phiên, ví dụ `20` hoặc `20–21` khi chưa phân giải |
| `total` | số | tổng đã chốt hoặc số đang ghi nhận |
| `sessionClosed` | bool | `false` → hiển thị "phiên chưa chốt" |
| `status` | chuỗi | `xac_nhan` · `can_kiem_tra` · `da_sua` |
| `note` | chuỗi | |
| `evidence` | JSON | `[{kind, fileId}]`, server tự điền khi upload |
| `updatedAt` | ISO | server tự điền |

## Hàm cho giao diện (`google.script.run`)

| Hàm | Trả về |
|---|---|
| `uiSearch(query)` | `{items: [bản ghi...]}`; `query` = mã đơn (khớp chính xác hoặc một phần), rỗng = 50 kết quả mới nhất |
| `uiGetResult(id)` | bản ghi + `images: [{kind, dataUrl}]` |
| `uiPackingTime(orderCode)` | `{orderCode, packingTime}` |
| `uiFmsStations(orderCode)` | `{order, stations: [{station, to, scanTime}], allStations}`: các station đơn đi qua có TO, theo thứ tự hành trình |
| `uiFmsFetch(orderCode, station)` | TO của đơn tại `station` + mọi đơn trong TO kèm giờ quét |
