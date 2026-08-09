# -*- coding: utf-8 -*-
import os

from assets import supergrok_proxy


def test_supergrok_proxy_accepts_only_exact_loopback_hosts():
    assert supergrok_proxy.validate_listen_host("127.0.0.1") == "127.0.0.1"
    assert supergrok_proxy.validate_listen_host("LOCALHOST.") == "localhost"

    for host in ("0.0.0.0", "::", "192.0.2.2", "localhost.example.com", ""):
        try:
            supergrok_proxy.validate_listen_host(host)
            raise AssertionError(f"unsafe listen host accepted: {host}")
        except ValueError:
            pass


def test_supergrok_proxy_never_logs_token_suffix(tmp_path, capsys):
    token = "secret-access-token-abcdef"
    store = tmp_path / "xai.json"
    store.write_text(
        '{"access_token":"%s","refresh_token":"refresh","expires_at":4102444800}' % token,
        encoding="utf-8",
    )
    supergrok_proxy.TokenManager(str(store), proxy="")
    output = capsys.readouterr().out
    assert token not in output
    assert "abcdef" not in output
    assert "[redacted]" in output
    if os.name != "nt":
        assert store.stat().st_mode & 0o777 == 0o600


def test_supergrok_proxy_rejects_symlinked_token_store(tmp_path):
    victim = tmp_path / "victim.json"
    victim.write_text("owner-data", encoding="utf-8")
    link = tmp_path / "xai.json"
    link.symlink_to(victim)
    try:
        supergrok_proxy.TokenManager(str(link), proxy="")
        raise AssertionError("symlinked OAuth token store was accepted")
    except RuntimeError as exc:
        assert "symlink" in str(exc) or "regular file" in str(exc)
    assert victim.read_text("utf-8") == "owner-data"
