<!-- TIET_KIEM_TOKEN_START -->
## Tiết kiệm token (áp dụng mọi project)

Người dùng nói tiếng Việt, có cả Claude Code và Codex CLI. Mục tiêu: chất lượng ở phần khó, rẻ ở phần dễ.

**File quy trình**
- Project có `AGENTS.md` mà chưa có `CLAUDE.md`: đọc `AGENTS.md` và làm theo; tạo `CLAUDE.md` chỉ một dòng `@AGENTS.md`. Nếu `AGENTS.md` có mục "Riêng project này" còn trống thì điền sau khi xem project.
- Mẫu chung: `setup/AGENTS.md` trong repo tool-c-t-cam (chép vào project mới).

**Chia việc**
- Claude tự làm: lập kế hoạch, tìm chỗ cần sửa, thiết kế cách làm, viết phiếu việc, dò lỗi, review, commit, deploy. **Claude không tự viết code.**
- Giao Codex (nếu lệnh `codex` có trên máy) **mọi việc viết code, kể cả việc nhỏ nhất** (người dùng chốt 2026-11-10).
  Lệnh: `codex exec -C "<thư mục project>" --sandbox workspace-write -o .agents/codex-last.txt - < .agents/task.md`
  (`task.md` ghi: file nào sửa gì, hàm/API liên quan, "không commit, không push, không deploy"). Chờ xong rồi review bằng `git diff`, Claude commit.
  Ngoại lệ Claude tự sửa: Codex hết token / không chạy được; hoặc chỉ đổi chữ hay số.
  Nếu project có `AGENTS.md` quy định khác thì theo `AGENTS.md`.
- Dò/đọc rộng (tìm chỗ gọi hàm, quét nhiều file, đọc log dài): dùng agent phụ với `model: "haiku"` hoặc `"sonnet"`, chỉ lấy kết luận về.

**Đọc ít**
- Review bằng `git diff` / `git show`, không mở lại cả file.
- Đọc đúng đoạn cần (offset/limit, grep), không đọc nguyên file lớn.
- Không đọc file sinh tự động, bản build, dữ liệu, file khóa (`dist/`, `build/`, `*.min.js`, bundle, `package-lock.json`, `data/`).

**Phiên làm việc**
- Khi người dùng chuyển sang việc không liên quan, hoặc phiên đã rất dài, nhắc một câu: mở phiên mới sẽ rẻ hơn.
- Việc lặt vặt (commit, push, sửa chữ, đổi màu) thì nhắc người dùng có thể chuyển `/model` sang Sonnet/Haiku.
- Ghi điều đã chốt vào tài liệu trong repo (`README`, `docs/`) để phiên sau đọc lại, không phải kể lại từ đầu.
- Trả lời ngắn, đi thẳng vào việc.
<!-- TIET_KIEM_TOKEN_END -->
