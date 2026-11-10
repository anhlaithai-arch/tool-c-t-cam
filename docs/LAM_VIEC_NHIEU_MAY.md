# Làm việc trên nhiều máy (sáng máy này, chiều máy khác)

Code đồng bộ qua GitHub (repo **private**). Video và dữ liệu (`data/`, `*.mp4`) **không** lên GitHub, phải chép riêng.

## Cài một lần trên mỗi máy

1. Git for Windows, Python 3.12+ (máy hiện tại dùng 3.14), Node.js.
2. Claude Code (app desktop hoặc `npm i -g @anthropic-ai/claude-code`), Codex (`npm i -g @openai/codex`, rồi `codex login`), clasp (`npm i -g @google/clasp`, rồi `clasp login`).
3. Lấy code:
   ```bash
   git clone <URL repo GitHub> "D:\New folder"
   cd "D:\New folder"
   python -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
4. Máy dùng để chạy AI đếm kiện nên có GPU NVIDIA. Máy không có GPU vẫn sửa code và chạy kiểm thử được (`.venv\Scripts\python -m pytest`).

## Mỗi lần bắt đầu làm

```bash
git pull
```

Nếu `requirements.txt` có đổi thì chạy lại `pip install -r requirements.txt`.

## Mỗi lần nghỉ / chuyển máy

Bảo Claude: "commit và push". Claude commit theo luật trong `AGENTS.md`, rồi `git push`.
Không sửa cùng lúc trên hai máy. Nếu quên push ở máy sáng thì máy chiều sẽ thiếu code.

## Dữ liệu không lên GitHub

| Thứ | Cách mang sang máy khác |
|---|---|
| Video `*.mp4` | Google Drive / USB / ổ mạng |
| `data/sync/*.json` (kết quả đọc đồng hồ) | Không cần mang, chạy lại `python -m app sync <video>` |
| Mật khẩu, khóa, link webapp riêng tư | File `.env` (không commit), tự chép |

## Lịch sử trò chuyện với Claude

Mỗi máy là một phiên Claude riêng, không chung lịch sử chat. Những gì đã chốt đều được ghi vào `AGENTS.md`, `README.md` và thư mục `docs/`, nên Claude ở máy khác đọc repo là nắm được.

## Luật tiết kiệm token cho Claude (chung mọi project)

File `setup/claude-global.md` là luật chung (chia việc Claude/Codex, đọc ít, mở phiên mới). Mỗi máy mới chạy một lần
(PowerShell) để thêm vào `CLAUDE.md` chung của máy:

```powershell
Get-Content setup\claude-global.md | Add-Content -Encoding utf8 "$HOME\.claude\CLAUDE.md"
```

Sửa luật thì sửa `setup/claude-global.md` rồi chép lại (xóa đoạn cũ giữa hai dòng `TIET_KIEM_TOKEN` trước).

## Dùng Claude + Codex cho project khác

Chép `setup/AGENTS.md` vào thư mục gốc project đó (giữ tên `AGENTS.md`). Lần đầu mở Claude trong project,
Claude tự tạo `CLAUDE.md` (`@AGENTS.md`) và điền mục "Riêng project này". File có sẵn cách xử lý khi Claude hoặc Codex hết token
(sổ bàn giao `.agents/HANDOFF.md`).
