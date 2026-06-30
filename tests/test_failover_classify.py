# -*- coding: utf-8 -*-
import types

import llmcore


def test_classify_failover_reason_matrix(monkeypatch):
    monkeypatch.setenv("PENGLAI_FAILOVER_CLASSIFY", "1")
    cases = [
        (429, "", "", llmcore.FailoverReason.RATE_LIMIT),
        (503, "", "", llmcore.FailoverReason.SERVER_ERROR),
        (None, "服务过载，请稍后重试", "", llmcore.FailoverReason.OVERLOADED),
        (None, "访问量过大", "", llmcore.FailoverReason.OVERLOADED),
        (401, "", "", llmcore.FailoverReason.AUTH_PERMANENT),
        (404, "", "", llmcore.FailoverReason.MODEL_NOT_FOUND),
        (None, "", "ChunkedEncodingError", llmcore.FailoverReason.TRANSIENT),
        (None, "", "", llmcore.FailoverReason.TERMINAL),
    ]
    for status, body, error_type, expected in cases:
        assert llmcore._classify_failover_reason(status, body, error_type) == expected


def test_failover_classify_disabled_when_env_off(monkeypatch):
    monkeypatch.setenv("PENGLAI_FAILOVER_CLASSIFY", "0")
    assert llmcore._classify_failover_reason(503, "") is None


def test_stream_retry_does_not_sleep_on_server_error_when_classify_on(monkeypatch):
    monkeypatch.setenv("PENGLAI_FAILOVER_CLASSIFY", "1")
    sleeps = []
    monkeypatch.setattr(llmcore.time, "sleep", lambda seconds: sleeps.append(seconds))

    class Resp:
        status_code = 503
        headers = {}
        text = "服务过载"

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(llmcore.requests, "post", lambda *a, **kw: Resp())
    sess = types.SimpleNamespace(
        max_retries=3,
        stream=False,
        connect_timeout=1,
        read_timeout=1,
        proxies=None,
        verify=True,
    )

    chunks = list(llmcore._stream_with_retry(sess, "https://example.invalid", {}, {}, lambda _r: iter(())))
    assert sleeps == []
    assert chunks == ["!!!Failover[OVERLOADED]: HTTP 503: 服务过载"]


def test_read_bounded_rejects_oversize():
    class Resp:
        def iter_content(self, chunk_size=8192):
            yield b"a" * 4
            yield b"b" * 4

    try:
        llmcore.read_bounded(Resp(), max_bytes=6)
    except ValueError as exc:
        assert "response exceeded" in str(exc)
    else:
        raise AssertionError("oversize response should fail")
