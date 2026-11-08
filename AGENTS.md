# Quy trình làm việc 2 AI

Project: app AI đếm kiện hàng bỏ vào bao qua video camera kho, đối chiếu với thời gian packing của mã đơn.

## Kiến trúc (đã chốt 2026-11-08)

| Phần | Thư mục | Chạy ở đâu |
|---|---|---|
| Logic xử lý video/OCR/AI chạy trong trình duyệt | `browser/` (build thành `gas/LogicBundle.html`) | Trình duyệt người dùng |
| Webapp: server + giao diện | `gas/` | Google Apps Script (đẩy bằng `clasp`, scriptId trong `gas/.clasp.json`) |
| Thử nghiệm, dữ liệu đối chiếu, huấn luyện (Python) | `app/` | Máy dev (RTX 4060) |

- Cả nhóm dùng qua một link webapp GAS. Video chọn từ máy người dùng, **không upload**; trình duyệt xử lý.
- GAS chỉ xác thực, tra giờ packing, lưu kết quả (Sheet) và ảnh bằng chứng (Drive).
- Chi tiết: `docs/PHUONG_AN_TRINH_DUYET.md`.
- Thời gian: dùng đồng hồ in trên hình camera (OCR), **không** dùng tên file hay ngày tạo file làm giờ quay.

## Vai trò

| Ai | Phụ trách | Được sửa |
|---|---|---|
| **Claude Code** — trưởng nhóm | `browser/**`, `scripts/**`, `tests/**`, `app/`, `gas/Code.js`; lập kế hoạch, chia việc, review, quyết định cuối cùng | Mọi file trừ phần của Codex |
| **Codex** | Giao diện: `gas/Index.html`, `gas/UiStyles.html`, `gas/UiViews.html`, `gas/UiBindings.html` | **Chỉ** các file đó |

`gas/LogicBundle.html` là file sinh tự động từ `browser/` (`node scripts/build-browser.mjs`), không ai sửa tay.

Khi có bất đồng, Claude Code quyết định; nếu ảnh hưởng lớn thì hỏi người dùng.

> **Từ 2026-11-08 (người dùng yêu cầu): Claude tự làm toàn bộ, kể cả giao diện; không gọi Codex.**
> Phần Codex bên dưới giữ lại để dùng khi người dùng muốn bật lại.

## Luật bắt buộc (cả hai AI)

1. **Không đọc `Images.html`** (không mở, không grep, không đưa vào ngữ cảnh).
2. **Không ai tự chạy `clasp push`** (hay `clasp deploy`) khi người dùng chưa đồng ý rõ ràng. Không `git push` khi chưa được đồng ý.
3. **Mỗi bước sửa = 1 commit git riêng**, ghi rõ ai sửa:
   - Claude: `git -c user.name="Claude Code" -c user.email="claude@agents.local" commit -m "[Claude] ..."`
   - Codex:  `git -c user.name="Codex" -c user.email="codex@agents.local" commit -m "[Codex] ..."`
4. Không để 2 bên sửa file cùng lúc. Codex chỉ chạy khi Claude đã commit xong và đang chờ.
5. Codex không sửa file ngoài phần của mình. Nếu cần đổi API/hàm server, ghi đề xuất vào câu trả lời.
6. Không commit video, ảnh trích từ video, dữ liệu đơn hàng (`data/`, `*.mp4` đã nằm trong `.gitignore`).

## Quy trình khi người dùng giao việc

1. **Claude phân tích** yêu cầu, chia phần xử lý / phần giao diện.
2. **Claude sửa phần xử lý** (Python, `gas/Code.js`) trước → commit `[Claude] ...`.
3. **Claude giao phần giao diện cho Codex** bằng lệnh không tương tác:
   ```bash
   codex exec -C "D:\New folder" --sandbox workspace-write -o codex-last.txt "<mô tả việc>"
   ```
   (Đã kiểm tra với codex-cli 0.167.0; xem lại `codex exec --help` khi nâng cấp.
   `-o` ghi câu trả lời cuối của Codex ra file để Claude đọc; `codex-last.txt` không commit.)
   Mô tả giao cho Codex phải có:
   - file/hàm nào cần sửa, sửa gì;
   - API/hàm server liên quan (tên endpoint Python, tên hàm `google.script.run`) để gọi cho khớp;
   - nhắc: chỉ sửa file giao diện, không đọc `Images.html`, không `clasp push`, **không commit**.
   Sandbox `workspace-write` của Codex không ghi được vào `.git`, nên sau khi review Claude commit thay
   với tác giả `Codex` (`git -c user.name="Codex" ...`, message `[Codex] ...`, dòng `Reviewed-by: Claude Code`).
   Đưa mô tả dài qua stdin: `codex exec ... -o codex-last.txt - < task.md`.
4. **Chờ Codex chạy xong** mới làm tiếp.
5. **Claude review** bằng `git diff` / `git show` commit của Codex; nếu sai thì sửa (commit `[Claude] fix: ...`) hoặc giao lại Codex.
6. **Claude báo người dùng**: đã đổi gì, commit nào, cần người dùng làm gì.

## Việc chỉ đọc

Khi Claude nhờ Codex chỉ đọc/phân tích, dùng `--sandbox read-only` và Codex không sửa, không commit.
