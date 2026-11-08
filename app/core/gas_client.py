"""Gọi webapp GAS (doPost). Hợp đồng API: docs/KIEN_TRUC_WEBAPP.md

Cấu hình trong file .env (không commit):
    GAS_URL=https://script.google.com/macros/s/.../exec
    GAS_TOKEN=<API_TOKEN in ra khi chạy setup()>
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request
from pathlib import Path


def load_env(path: str | Path = ".env") -> dict[str, str]:
    env: dict[str, str] = {}
    p = Path(path)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class GasError(RuntimeError):
    pass


class GasClient:
    def __init__(self, url: str | None = None, token: str | None = None, timeout: float = 60.0):
        env = load_env()
        self.url = url or os.environ.get("GAS_URL") or env.get("GAS_URL")
        self.token = token or os.environ.get("GAS_TOKEN") or env.get("GAS_TOKEN")
        if not self.url or not self.token:
            raise GasError("Thiếu GAS_URL hoặc GAS_TOKEN (đặt trong .env)")
        self.timeout = timeout

    def build_payload(self, action: str, data: dict) -> bytes:
        return json.dumps({"token": self.token, "action": action, "data": data}, ensure_ascii=False).encode("utf-8")

    def call(self, action: str, data: dict | None = None) -> dict:
        req = urllib.request.Request(
            self.url, data=self.build_payload(action, data or {}),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        # Apps Script trả 302 sang googleusercontent; urllib tự theo bằng GET, đúng cách GAS cần.
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            raw = resp.read().decode("utf-8")
        try:
            out = json.loads(raw)
        except json.JSONDecodeError as e:
            raise GasError(f"Webapp không trả JSON (kiểm tra quyền deploy): {raw[:200]}") from e
        if not out.get("ok"):
            raise GasError(out.get("error") or "Lỗi không rõ từ webapp")
        return out

    # ---- tiện ích ----
    def ping(self) -> dict:
        return self.call("ping")

    def packing_time(self, order_code: str) -> str | None:
        return self.call("packingTime", {"orderCode": order_code}).get("packingTime")

    def submit_result(self, record: dict) -> dict:
        return self.call("submitResult", record)

    def upload_evidence(self, result_id: str, kind: str, image_bytes: bytes,
                        file_name: str = "image.jpg", mime_type: str = "image/jpeg") -> str:
        out = self.call("uploadEvidence", {
            "resultId": result_id, "kind": kind, "fileName": file_name, "mimeType": mime_type,
            "base64": base64.b64encode(image_bytes).decode("ascii"),
        })
        return out["fileId"]
