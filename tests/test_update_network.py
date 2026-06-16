# -*- coding: utf-8 -*-
import os
import subprocess
from importlib.machinery import SourceFileLoader


def _load_cli():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return SourceFileLoader("penglai_cli_for_update_test", os.path.join(root, "penglai")).load_module()


def test_fetch_timeout_returns_failed_process(monkeypatch):
    cli = _load_cli()

    def fake_sh(cmd, **kw):
        assert cmd[:5] == ["git", "-c", "http.lowSpeedLimit=1024", "-c", "http.lowSpeedTime=8"]
        assert kw["timeout"] == 35
        raise subprocess.TimeoutExpired(cmd, 35, output="", stderr="")

    monkeypatch.setattr(cli, "sh", fake_sh)
    result = cli._git("fetch", "origin")
    assert result.returncode == 124
    assert "timeout" in result.stderr


def test_non_fetch_git_command_uses_plain_git(monkeypatch):
    cli = _load_cli()
    seen = {}

    def fake_sh(cmd, **kw):
        seen["cmd"] = cmd
        seen["kw"] = kw
        return subprocess.CompletedProcess(cmd, 0, "ok", "")

    monkeypatch.setattr(cli, "sh", fake_sh)
    result = cli._git("rev-parse", "HEAD")
    assert result.returncode == 0
    assert seen["cmd"] == ["git", "rev-parse", "HEAD"]
    assert "timeout" not in seen["kw"]
