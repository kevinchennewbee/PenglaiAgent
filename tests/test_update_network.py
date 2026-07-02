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
    assert "timeout" in result.stderr or "超时" in result.stderr


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


def test_release_remote_prefers_penglaiagent_remote(monkeypatch):
    cli = _load_cli()

    def fake_git(*args):
        if args == ("remote", "get-url", "origin"):
            return subprocess.CompletedProcess(["git"], 0, "https://github.com/kevinchennewbee/Penglai.git\n", "")
        if args == ("remote", "get-url", "release"):
            return subprocess.CompletedProcess(["git"], 0, "https://github.com/kevinchennewbee/PenglaiAgent.git\n", "")
        return subprocess.CompletedProcess(["git"], 1, "", "")

    monkeypatch.setattr(cli, "_git", fake_git)
    monkeypatch.delenv("PENGLAI_RELEASE_REMOTE", raising=False)
    monkeypatch.setenv("PENGLAI_RELEASE_BRANCH", "main")
    assert cli._release_remote() == "release"
    assert cli._release_ref() == "release/main"


def test_update_integrity_rejects_unsigned_target(monkeypatch):
    cli = _load_cli()
    calls = []

    def fake_git(*args):
        calls.append(args)
        if args == ("fetch", "--tags", "release"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        if args == ("tag", "--points-at", "abc123"):
            return subprocess.CompletedProcess(["git"], 0, "v0.3.5\n", "")
        if args == ("tag", "-v", "v0.3.5"):
            return subprocess.CompletedProcess(["git"], 1, "", "no signature")
        if args == ("verify-commit", "abc123"):
            return subprocess.CompletedProcess(["git"], 1, "", "no signature")
        return subprocess.CompletedProcess(["git"], 1, "", "")

    monkeypatch.setattr(cli, "_git", fake_git)
    monkeypatch.delenv("PENGLAI_ALLOW_UNSIGNED_UPDATE", raising=False)
    monkeypatch.delenv("PENGLAI_UPDATE_REQUIRE_SIGNATURE", raising=False)
    ok, detail = cli._verify_release_integrity("abc123", remote="release")
    assert ok is False
    assert "缺少可信签名" in detail
    assert ("tag", "-v", "v0.3.5") in calls


def test_update_integrity_accepts_signed_tag(monkeypatch):
    cli = _load_cli()

    def fake_git(*args):
        if args == ("fetch", "--tags", "release"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        if args == ("tag", "--points-at", "abc123"):
            return subprocess.CompletedProcess(["git"], 0, "v0.3.5\n", "")
        if args == ("tag", "-v", "v0.3.5"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        return subprocess.CompletedProcess(["git"], 1, "", "")

    monkeypatch.setattr(cli, "_git", fake_git)
    ok, detail = cli._verify_release_integrity("abc123", remote="release")
    assert ok is True
    assert detail == "signed tag v0.3.5"


def test_update_integrity_accepts_signed_commit_without_signed_tag(monkeypatch):
    """目标 commit 没有 signed tag，但 commit 本身已签名，应通过。"""
    cli = _load_cli()

    def fake_git(*args):
        if args == ("fetch", "--tags", "release"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        if args == ("tag", "--points-at", "abc123"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        if args == ("verify-commit", "abc123"):
            return subprocess.CompletedProcess(["git"], 0, "Good signature", "")
        return subprocess.CompletedProcess(["git"], 1, "", "")

    monkeypatch.setattr(cli, "_git", fake_git)
    monkeypatch.delenv("PENGLAI_ALLOW_UNSIGNED_UPDATE", raising=False)
    monkeypatch.delenv("PENGLAI_UPDATE_REQUIRE_SIGNATURE", raising=False)
    ok, detail = cli._verify_release_integrity("abc123", remote="release")
    assert ok is True
    assert detail == "signed commit"


def test_update_integrity_rejects_target_with_no_tags(monkeypatch):
    """目标 commit 没有任何 tag 且 commit 未签名，应 fail closed。"""
    cli = _load_cli()

    def fake_git(*args):
        if args == ("fetch", "--tags", "release"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        if args == ("tag", "--points-at", "abc123"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        if args == ("verify-commit", "abc123"):
            return subprocess.CompletedProcess(["git"], 1, "", "no signature")
        return subprocess.CompletedProcess(["git"], 1, "", "")

    monkeypatch.setattr(cli, "_git", fake_git)
    monkeypatch.delenv("PENGLAI_ALLOW_UNSIGNED_UPDATE", raising=False)
    monkeypatch.delenv("PENGLAI_UPDATE_REQUIRE_SIGNATURE", raising=False)
    ok, detail = cli._verify_release_integrity("abc123", remote="release")
    assert ok is False
    assert "缺少可信签名" in detail


def test_update_integrity_bypass_envs_are_not_default_path(monkeypatch):
    """默认环境（未设置 bypass 变量）必须 fail closed；bypass 变量不是默认安全路径。"""
    cli = _load_cli()

    def fake_git(*args):
        if args == ("fetch", "--tags", "release"):
            return subprocess.CompletedProcess(["git"], 0, "", "")
        return subprocess.CompletedProcess(["git"], 1, "", "no signature")

    monkeypatch.setattr(cli, "_git", fake_git)
    monkeypatch.delenv("PENGLAI_ALLOW_UNSIGNED_UPDATE", raising=False)
    monkeypatch.delenv("PENGLAI_UPDATE_REQUIRE_SIGNATURE", raising=False)
    ok, _ = cli._verify_release_integrity("abc123", remote="release")
    assert ok is False, "default path must require signature, not silently bypass"

    # 显式 bypass 才放行
    monkeypatch.setenv("PENGLAI_ALLOW_UNSIGNED_UPDATE", "1")
    ok, detail = cli._verify_release_integrity("abc123", remote="release")
    assert ok is True
    assert "PENGLAI_ALLOW_UNSIGNED_UPDATE" in detail
