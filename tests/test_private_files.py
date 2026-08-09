# -*- coding: utf-8 -*-
import os

import llmcore
from frontends import session_names
from frontends import continue_cmd
from penglai_runtime.private_files import (
    append_private_line,
    atomic_write_private,
    ensure_private_dir,
)


def _assert_mode(path, expected):
    if os.name != "nt":
        assert os.stat(path).st_mode & 0o777 == expected


def test_private_file_primitives_are_atomic_and_owner_only(tmp_path):
    directory = tmp_path / "private"
    file_path = directory / "state.json"
    log_path = directory / "events.jsonl"
    ensure_private_dir(directory)
    atomic_write_private(file_path, '{"state":1}')
    append_private_line(log_path, '{"event":2}')
    assert file_path.read_text("utf-8") == '{"state":1}'
    assert log_path.read_text("utf-8").splitlines() == ['{"event":2}']
    _assert_mode(directory, 0o700)
    _assert_mode(file_path, 0o600)
    _assert_mode(log_path, 0o600)


def test_private_file_primitives_refuse_symlink_overwrite(tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("owner-data", encoding="utf-8")
    link = tmp_path / "private.json"
    link.symlink_to(victim)
    try:
        atomic_write_private(link, "replacement")
        raise AssertionError("symlinked private file was accepted")
    except RuntimeError as exc:
        assert "symlink" in str(exc) or "regular file" in str(exc)
    assert victim.read_text("utf-8") == "owner-data"


def test_session_names_registry_is_private_and_atomic(tmp_path, monkeypatch):
    log_dir = tmp_path / "model_responses"
    registry = log_dir / "session_names.json"
    monkeypatch.setattr(session_names, "_LOG_DIR", str(log_dir))
    monkeypatch.setattr(session_names, "_REG_PATH", str(registry))
    session_names._save({"model_responses_1.txt": "发布审计"})
    assert session_names._load()["model_responses_1.txt"] == "发布审计"
    _assert_mode(log_dir, 0o700)
    _assert_mode(registry, 0o600)


def test_llm_diagnostic_log_is_private_and_redacted(tmp_path):
    log = tmp_path / "model_responses.txt"
    llmcore._write_llm_log(
        "response",
        "Authorization: Bearer secret-owner-token",
        log_path=str(log),
        model="test-model",
    )
    content = log.read_text("utf-8")
    assert "secret-owner-token" not in content
    assert "[REDACTED]" in content or "***" in content
    _assert_mode(tmp_path, 0o700)
    _assert_mode(log, 0o600)


def test_conversation_snapshot_is_private_and_refuses_symlink(tmp_path, monkeypatch):
    monkeypatch.setattr(continue_cmd, "_LOG_DIR", str(tmp_path))
    monkeypatch.setattr(
        continue_cmd,
        "_LOG_GLOB",
        str(tmp_path / "model_responses_*.txt"),
    )
    current = tmp_path / f"model_responses_{os.getpid()}.txt"
    current.write_text(
        '=== Prompt === now\n{"content":"owner"}\n'
        '=== Response === now\n{"content":"done"}\n',
        encoding="utf-8",
    )
    snapshot = continue_cmd._snapshot_current_log()
    assert snapshot is not None
    assert current.read_text("utf-8") == ""
    _assert_mode(current, 0o600)
    _assert_mode(snapshot, 0o600)

    victim = tmp_path / "victim.txt"
    victim.write_text('=== Prompt === now\nsecret\n=== Response === now\ndone\n', encoding="utf-8")
    current.unlink()
    current.symlink_to(victim)
    assert continue_cmd._snapshot_current_log() is None
    assert "secret" in victim.read_text("utf-8")
