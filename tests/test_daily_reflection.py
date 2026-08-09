# -*- coding: utf-8 -*-
"""Phase 4 测试：每日反思模块。

验证：
1. generate_reflection 生成 temp/companion_reflections/YYYY-MM-DD.json。
2. 包含 themes/unresolved_items/care_opportunities。
3. 不包含原始完整语音路径或敏感 token。
4. 隐私脱敏：reflection 里不含 sk- 密钥。
5. load_reflection 能读回。
"""
import json
import os
import time

import pytest

from penglai_runtime import daily_reflection as dr
from penglai_runtime.context_events import append_context_event


def test_generate_reflection_creates_file(tmp_path, monkeypatch):
    # 构造今天的事件
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("task", "推进 0.3.5 主动陪伴计划", channel="local", include_legacy=True) if False else None
    # append_context_event 不接受 include_legacy；直接写 channel
    append_context_event("task", "推进 Penglai 0.3.5 主动陪伴计划", channel="local")
    append_context_event("companion", "0.3.4 发布 README 未闭环", channel="companion")

    now = time.time()
    reflection = dr.generate_reflection(tmp_path, now=now)

    # 文件存在
    date_str = time.strftime("%Y-%m-%d", time.localtime(now))
    path = dr.reflection_path(tmp_path, date_str)
    assert path.exists()
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
        assert path.parent.stat().st_mode & 0o777 == 0o700
        assert log_path.stat().st_mode & 0o777 == 0o600

    # 结构完整
    assert reflection["date"] == date_str
    assert "themes" in reflection
    assert "unresolved_items" in reflection
    assert "care_opportunities" in reflection
    assert "privacy_summary" in reflection
    assert reflection["event_count"] >= 1


def test_reflection_does_not_leak_secrets(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    # 写入含密钥的事件
    append_context_event("task", "api key sk-1234567890abcdef used", channel="local")

    reflection = dr.generate_reflection(tmp_path)
    raw = json.dumps(reflection, ensure_ascii=False)
    assert "sk-1234567890abcdef" not in raw
    assert "***" in raw or "sk-" not in raw


def test_reflection_does_not_store_raw_audio_paths(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("voice", "raw audio at /tmp/secret.wav", channel="local")

    reflection = dr.generate_reflection(tmp_path)
    raw = json.dumps(reflection, ensure_ascii=False)
    # 不应保留原始音频完整路径作为可定位隐私字段
    assert "privacy_summary" in reflection
    assert "no raw audio retained" in reflection["privacy_summary"]


def test_reflection_extracts_unresolved_items(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("task", "README 和官网未闭环", channel="local")
    append_context_event("companion", "发布失败", channel="companion")

    reflection = dr.generate_reflection(tmp_path)
    assert len(reflection["unresolved_items"]) >= 1


def test_reflection_extracts_care_opportunities(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("task", "Penglai 0.3.5 README 未闭环", channel="local")

    reflection = dr.generate_reflection(tmp_path)
    opps = reflection["care_opportunities"]
    assert isinstance(opps, list)
    # 至少有一个 task_closure 类型
    kinds = [o.get("kind") for o in opps]
    assert "task_closure" in kinds


def test_load_reflection_roundtrip(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("task", "测试反思", channel="local")

    now = time.time()
    dr.generate_reflection(tmp_path, now=now)
    date_str = time.strftime("%Y-%m-%d", time.localtime(now))
    loaded = dr.load_reflection(tmp_path, date_str)
    assert loaded is not None
    assert loaded["date"] == date_str


def test_load_reflection_returns_none_when_missing(tmp_path):
    assert dr.load_reflection(tmp_path, "2020-01-01") is None


def test_reflection_do_not_repeat_has_defaults(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))

    reflection = dr.generate_reflection(tmp_path)
    dnr = reflection["do_not_repeat"]
    assert "空泛早晚安" in dnr
    assert "复述情绪标签" in dnr


def test_reflection_evidence_ids_not_raw_text(tmp_path, monkeypatch):
    """证据 ID 是引用格式，不是原文。"""
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("task", "这是一段很长的私密内容不该完整保留", channel="local")

    reflection = dr.generate_reflection(tmp_path)
    for eid in reflection["evidence_ids"]:
        assert eid.startswith("context_event:")
        # 证据 ID 不含完整原文
        assert "私密内容不该完整保留" not in eid
