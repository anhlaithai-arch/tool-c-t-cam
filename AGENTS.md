# Quy trình làm việc 2 AI

Project: tool Google Apps Script (server `Code.js`, giao diện `Index.html`).

## Vai trò

| Ai | Phụ trách | Được sửa |
|---|---|---|
| **Claude Code** — trưởng nhóm | `Code.js` (server Apps Script), lập kế hoạch, chia việc, review, quyết định cuối cùng | `Code.js`, file cấu hình/tài liệu (`AGENTS.md`, `CLAUDE.md`, `appsscript.json`...) |
| **Codex** | `Index.html` (giao diện, CSS, JS phía client) | **Chỉ** `Index.html` |

Khi có bất đồng, Claude Code quyết định; nếu ảnh hưởng lớn thì hỏi người dùng.

## Luật bắt buộc (cả hai AI)

1. **Không đọc `Images.html`** (không mở, không grep, không đưa vào ngữ cảnh).
2. **Không ai tự chạy `clasp push`** (hay `clasp deploy`) khi người dùng chưa đồng ý rõ ràng.
3. **Mỗi bước sửa = 1 commit git riêng**, ghi rõ ai sửa:
   - Claude: `git -c user.name="Claude Code" -c user.email="claude@agents.local" commit -m "[Claude] ..."`
   - Codex:  `git -c user.name="Codex" -c user.email="codex@agents.local" commit -m "[Codex] ..."`
4. Không để 2 bên sửa file cùng lúc. Codex chỉ chạy khi Claude đã commit xong và đang chờ.
5. Codex không được sửa file ngoài `Index.html`. Nếu thấy cần đổi `Code.js`, ghi đề xuất vào phần trả lời, không tự sửa.

## Quy trình khi người dùng giao việc

1. **Claude phân tích** yêu cầu, chia phần server / phần giao diện.
2. **Claude sửa `Code.js`** trước → commit `[Claude] ...`.
3. **Claude giao phần `Index.html` cho Codex** bằng lệnh không tương tác, ví dụ:
   ```bash
   codex exec --sandbox workspace-write "<mô tả việc>"
   ```
   (Cú pháp chính xác kiểm tra bằng `codex exec --help` trước mỗi phiên.)
   Mô tả giao cho Codex phải có:
   - hàm/đoạn nào trong `Index.html` cần sửa, sửa gì;
   - tên hàm server mới/đã đổi trong `Code.js` để gọi `google.script.run` cho khớp;
   - nhắc: chỉ sửa `Index.html`, không đọc `Images.html`, không `clasp push`, commit `[Codex] ...` khi xong.
4. **Chờ Codex chạy xong** mới làm tiếp.
5. **Claude review** bằng `git diff` / `git show` commit của Codex; nếu sai thì sửa (commit `[Claude] fix: ...`) hoặc giao lại Codex.
6. **Claude báo người dùng**: đã đổi gì, commit nào, cần người dùng làm gì (vd. đồng ý `clasp push`).

## Việc chỉ đọc

Khi Claude nhờ Codex chỉ đọc/phân tích, dùng `--sandbox read-only` và Codex không sửa, không commit.
