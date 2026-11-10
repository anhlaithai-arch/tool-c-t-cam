# Quy trình làm chung Claude Code + Codex

## 1. Vai trò

| | Claude Code — trưởng nhóm | Codex — thợ chính |
|---|---|---|
| Làm | Phân tích yêu cầu, chia việc, logic khó, dò lỗi khó, review, quyết định cuối | Việc dài đã mô tả rõ: giao diện, test, sửa hàng loạt, việc lặp |
| Không làm | Việc lặp dài mà Codex làm được (để tiết kiệm token Claude) | Tự đổi thiết kế, API, cấu trúc dữ liệu; sửa file ngoài phần được giao |
| Khi bất đồng | Claude quyết; ảnh hưởng lớn thì hỏi người dùng | Ghi đề xuất vào câu trả lời, không tự làm |

## 2. Luật bắt buộc (cả hai)

1. **Không** `git push`, deploy, publish, `clasp push`, chạy migration lên máy thật… khi người dùng chưa đồng ý rõ ràng **cho lần đó**.
2. **Không** commit bí mật (mật khẩu, cookie, token, file `.env`) và dữ liệu thật (video, ảnh, file khách hàng). Kiểm `.gitignore` trước khi commit.
3. **Mỗi bước sửa = 1 commit riêng**, ghi rõ ai làm:
   - Claude: `git -c user.name="Claude Code" -c user.email="claude@agents.local" commit -m "[Claude] <việc>"`
   - Codex:  `git -c user.name="Codex" -c user.email="codex@agents.local" commit -m "[Codex] <việc>"`
4. **Chỉ một bên sửa tại một thời điểm.** Trước khi sửa, đọc `.agents/HANDOFF.md`; nếu đang có bên khác giữ khóa (mục 4) thì không sửa.
5. Mỗi bên **chỉ sửa file được giao** trong phiếu việc. Cần sửa thêm file khác → dừng, ghi lý do vào câu trả lời.
6. Không sửa file sinh tự động (bản build, bundle); sửa nguồn rồi chạy lệnh build.
7. Trước khi commit: chạy test/build của project (lệnh ở mục "Riêng project này"). Test đỏ thì không commit, báo lại.

## 3. Quy trình một việc

1. **Claude phân tích** yêu cầu → chia thành các phiếu việc, mỗi phiếu một nhóm file không chồng nhau.
2. **Claude làm phần khó** (logic, server, API) trước → commit `[Claude] ...`.
3. **Claude giao phiếu cho Codex** (chỉ khi phiếu dài; việc vài dòng thì Claude tự làm):
   - Viết phiếu ra `.agents/task.md` theo mẫu ở mục 5.
   - Chạy: `codex exec -C "<thư mục project>" --sandbox workspace-write -o .agents/codex-last.txt - < .agents/task.md`
   - Sandbox `workspace-write` không ghi được `.git` → Codex **không commit**; Claude commit thay (bước 5).
4. **Chờ Codex xong** (lệnh kết thúc) rồi mới làm tiếp. Trong lúc chờ, Claude không sửa file nào trong phiếu.
5. **Claude review** bằng `git diff` (không đọc lại cả file), chạy test:
   - Đạt → commit với tác giả Codex, message `[Codex] ...` + dòng `Reviewed-by: Claude Code`.
   - Sai nhỏ → Claude sửa, commit riêng `[Claude] fix: ...`.
   - Sai lớn → `git checkout -- <file>` bỏ phần sửa, viết lại phiếu rõ hơn, giao lại.
6. **Cập nhật `.agents/HANDOFF.md`** (mục 4) sau **mỗi** commit.
7. **Báo người dùng**: đã đổi gì, commit nào, cần người dùng làm gì (push, deploy, thử).

## 4. Khóa và sổ bàn giao — `.agents/HANDOFF.md`

File này là "trí nhớ chung", để bên nào vào sau cũng làm tiếp được, kể cả khi bên kia hết token giữa chừng.
Tạo nếu chưa có. Commit cùng các commit việc. Thêm `.agents/task.md` và `.agents/codex-last.txt` vào `.gitignore` (không commit). Giữ ngắn (chỉ trạng thái hiện tại, không ghi lịch sử dài — lịch sử đã có trong git).

```markdown
# HANDOFF
Khóa: <Claude | Codex | trống>   (ai đang sửa; xong việc thì để trống)
Cập nhật: <YYYY-MM-DD HH:MM> bởi <Claude | Codex>

## Đang làm
- Việc: <một câu>
- File đang sửa: <danh sách>
- Đã xong: <các bước, commit hash>
- Còn lại: <các bước cụ thể, đủ để người khác làm tiếp>

## Quyết định đã chốt
- <điều không được làm lại / không đổi>

## Chờ người dùng
- <push? deploy? câu hỏi?>
```

Luật khóa:
- Bắt đầu sửa → ghi `Khóa: <tên mình>`. Xong (hoặc dừng) → ghi `Khóa: trống` và điền "Còn lại".
- Thấy khóa của bên kia nhưng bên kia đã dừng hẳn (người dùng báo hết token / đóng phiên) → được lấy khóa, ghi rõ "lấy khóa từ <tên> vì <lý do>".
- `git status` có file đang sửa dở mà không rõ của ai → **không xóa**; hỏi người dùng hoặc commit riêng `[<tên>] WIP còn dở của <bên kia>` rồi mới làm tiếp.

## 5. Mẫu phiếu việc giao Codex — `.agents/task.md`

```markdown
# Phiếu việc
Mục tiêu: <làm gì, cho ai dùng, một-hai câu>
Được sửa: <đúng danh sách file>        Không được sửa: mọi file khác
Chi tiết:
- <file A>: <sửa gì, ở hàm/đoạn nào>
- ...
Hàm / API phải gọi đúng tên: <tên hàm, endpoint, tham số, dữ liệu trả về>
Xong khi: <tiêu chí kiểm được: test nào đạt, màn hình hiện gì>
Kiểm tra: <lệnh test/build>
Nhắc: không commit, không push/deploy, không đọc file cấm (mục "Riêng project này").
Cuối câu trả lời: liệt kê file đã sửa + điều chưa chắc.
```

## 6. Khi một bên hết token / hết lượt

Vì HANDOFF được cập nhật sau mỗi commit, việc dừng giữa chừng chỉ mất tối đa phần đang làm dở.

### Codex hết token (Claude còn)
1. Claude xem `git status` / `git diff`: Codex sửa dở gì.
   - Dùng được → review như bước 3.5, commit `[Codex] ... (dở, Claude hoàn thiện)`.
   - Không dùng được → bỏ (`git checkout -- <file>`), ghi lý do vào HANDOFF.
2. Claude **tự làm nốt phiếu** (được sửa cả file giao diện trong lúc Codex nghỉ), commit `[Claude] ...`.
   Ưu tiên làm gọn, tránh đọc file lớn không cần.
3. Ghi HANDOFF: "Codex nghỉ từ <giờ>, Claude làm thay phiếu <...>". Codex quay lại thì đọc HANDOFF trước khi làm.

### Claude hết token (Codex còn)
Người dùng mở Codex (tương tác: `codex` trong thư mục project) và nói: **"Claude hết token, làm tiếp theo AGENTS.md"**. Khi đó Codex:
1. Đọc `AGENTS.md` và `.agents/HANDOFF.md`; `git log --oneline -15`; `git status`.
2. Lấy khóa, ghi HANDOFF: "Codex làm trưởng nhóm tạm từ <giờ>".
3. **Tạm được sửa mọi file** để làm nốt "Còn lại" — nhưng **không** đổi thiết kế/quyết định trong "Quyết định đã chốt",
   không làm việc mới ngoài HANDOFF trừ khi người dùng giao trực tiếp.
4. Tự commit được (chạy tương tác, có quyền ghi `.git`): message `[Codex] ...`, mỗi bước một commit, cập nhật HANDOFF.
5. Luật 2.1 vẫn giữ: không push/deploy khi người dùng chưa đồng ý.
6. Việc khó (thiết kế, lỗi không rõ nguyên nhân, đổi cấu trúc dữ liệu) → **không đoán**; ghi vào HANDOFF mục "Chờ Claude" và dừng phần đó.

### Claude quay lại sau khi Codex làm trưởng nhóm tạm
1. Đọc HANDOFF, `git log` từ mốc Codex lấy khóa, review bằng `git diff <mốc>..HEAD`.
2. Sửa nếu cần (commit `[Claude] fix: ...`), xử lý mục "Chờ Claude", trả vai về như mục 1.

### Cả hai hết token
Không ai sửa. Mọi trạng thái đã nằm trong HANDOFF + git; lần sau bên nào có lượt trước thì làm theo trường hợp tương ứng ở trên.

## 7. Tiết kiệm token

- Claude: review bằng diff; đọc đúng đoạn cần; dò tìm rộng thì dùng agent phụ model rẻ (haiku/sonnet); việc lặp dài thì giao Codex.
- Cả hai: không đọc file build/bundle/dữ liệu/`package-lock.json`; không dán lại nội dung file dài vào câu trả lời.
- Đổi sang việc không liên quan → mở phiên mới; điều đã chốt ghi vào HANDOFF hoặc `docs/`, không dựa vào lịch sử chat.

## 8. Riêng project này

| Mục | Giá trị |
|---|---|
| Project làm gì | Đếm kiện bỏ vào bao qua video camera kho, đối chiếu với giờ quét của từng đơn trong TO (FMS), xuất ảnh bằng chứng từng đơn |
| Phần của Claude | `browser/**`, `scripts/**`, `tests/**`, `app/**`, `gas/Code.js`, `docs/**`, file cấu hình |
| Phần của Codex | Giao diện: `gas/Index.html` (tra cứu), `gas/Dem.html` (trang Đếm) |
| File cấm đọc | `Images.html` (không mở, không grep); `data/**` (video, file TO thật); `package-lock.json`; `dist/**` |
| File sinh tự động (không sửa tay) + lệnh build | `gas/LogicBundle.html`, `dist/*.html` ← `npm run build` (nguồn ở `browser/`) |
| Lệnh test | `npm test` (JS) và `.venv\Scripts\python -m pytest` (Python) |
| Lệnh deploy (chỉ khi người dùng đồng ý) | `npm run build` rồi `cd gas && clasp push --force`; scriptId trong `gas/.clasp.json` |
| Ghi chú khác | Video chọn từ máy người dùng, **không upload**; trình duyệt xử lý, GAS chỉ xác thực/lưu Sheet/Drive. Giờ quay lấy từ đồng hồ in trên hình (OCR), **không** dùng tên file hay ngày tạo file. Chi tiết: `docs/TONG_HOP.md`, `docs/PHUONG_AN_TRINH_DUYET.md` |
