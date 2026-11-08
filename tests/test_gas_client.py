import json

import pytest

from app.core.gas_client import GasClient, GasError, load_env


def test_payload_shape():
    c = GasClient(url="https://example.invalid/exec", token="t0k")
    body = json.loads(c.build_payload("packingTime", {"orderCode": "SPXVN123"}))
    assert body == {"token": "t0k", "action": "packingTime", "data": {"orderCode": "SPXVN123"}}


def test_missing_config_raises(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("GAS_URL", raising=False)
    monkeypatch.delenv("GAS_TOKEN", raising=False)
    with pytest.raises(GasError):
        GasClient()


def test_load_env(tmp_path):
    p = tmp_path / ".env"
    p.write_text('# comment\nGAS_URL="https://x/exec"\nGAS_TOKEN=abc\n', encoding="utf-8")
    assert load_env(p) == {"GAS_URL": "https://x/exec", "GAS_TOKEN": "abc"}
