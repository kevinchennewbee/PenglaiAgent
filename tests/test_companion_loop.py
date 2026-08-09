# -*- coding: utf-8 -*-
"""Phase 1 测试：Companion Loop foundation / API skeleton。

验证：
1. companion_loop.py 的 state/profile/heartbeats/feedback/mode 读写稳定。
2. companion_feedback.py 的自适应学习原语（权重调整、降频、禁忌记录）。
3. 自适应状态只调倾向，不新增越权能力，不覆盖用户显式配置。
4. 脱敏：feedback 写入不保留原始敏感内容。
"""
import json
import os
import time

import pytest

from penglai_runtime import companion_loop as cl
from penglai_runtime import companion_feedback as cf


# ── companion_loop 基座 ──────────────────────────────────────────────────

def test_normalize_mode_accepts_valid_modes():
    assert cl.normalize_mode("present") == "present"
    assert cl.normalize_mode("off") == "off"
    assert cl.normalize_mode("quiet") == "quiet"
    assert cl.normalize_mode("active") == "active"


def test_normalize_mode_aliases_and_invalid():
    assert cl.normalize_mode("normal") == "present"  # 历史别名
    assert cl.normalize_mode("") == "present"  # 默认
    assert cl.normalize_mode("garbage") == "present"  # 非法回退默认
    assert cl.normalize_mode(None) == "present"


def test_companion_state_returns_dict(tmp_path):
    state = cl.companion_state(tmp_path)
    assert isinstance(state, dict)
    # 空状态返回 {}，不崩溃


def test_companion_profile_has_required_fields(tmp_path):
    profile = cl.companion_profile(tmp_path)
    assert profile["stage"] == "new"  # 默认初识
    assert profile["confirmed"] == {}
    assert profile["inferred"] == []
    assert profile["boundaries"] == []


def test_append_feedback_writes_jsonl(tmp_path):
    rec = cl.append_feedback(tmp_path, {"type": "test", "value": "hello", "context": {"k": "v"}})
    assert rec["type"] == "test"
    assert rec["value"] == "hello"
    path = cl.feedback_path(tmp_path)
    assert path.exists()
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 1
    data = json.loads(lines[0])
    assert data["type"] == "test"
    assert "ts" in data
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
        assert path.parent.stat().st_mode & 0o777 == 0o700


def test_append_feedback_redacts_secrets(tmp_path):
    """feedback 写入要脱敏，不保留 sk- 之类密钥。"""
    rec = cl.append_feedback(tmp_path, {"type": "leak", "value": "sk-1234567890abcdef"})
    assert "sk-" not in rec["value"] or "***" in rec["value"]


def test_companion_heartbeats_returns_list(tmp_path, monkeypatch):
    # 没有事件时返回空列表
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(tmp_path / "empty.jsonl"))
    items = cl.companion_heartbeats(limit=5)
    assert isinstance(items, list)


def test_temp_dir_created(tmp_path):
    d = cl.temp_dir(tmp_path)
    assert d.exists()
    assert d.name == "temp"


# ── companion_feedback 自适应 ────────────────────────────────────────────

def test_default_state_has_required_fields():
    state = cf.default_state()
    assert "opportunity_weights" in state
    assert "expression_preference" in state
    assert "negative_feedback" in state
    assert "learned_preferences" in state
    assert "outcome_stats" in state
    assert state["opportunity_weights"]["task_closure"] > 0


def test_load_state_returns_default_when_missing(tmp_path):
    state = cf.load_state(tmp_path)
    assert isinstance(state, dict)
    assert "opportunity_weights" in state


def test_save_and_load_state_roundtrip(tmp_path):
    state = cf.default_state()
    state = cf.adjust_opportunity_weight(state, "ritual", -0.5)
    cf.save_state(tmp_path, state)
    loaded = cf.load_state(tmp_path)
    assert loaded["opportunity_weights"]["ritual"] < cf.DEFAULT_OPPORTUNITY_WEIGHTS["ritual"]
    if os.name != "nt":
        assert cf.adaptation_path(tmp_path).stat().st_mode & 0o777 == 0o600


def test_adjust_opportunity_weight_clamps():
    state = cf.default_state()
    # 上限
    state = cf.adjust_opportunity_weight(state, "safety", +10)
    assert state["opportunity_weights"]["safety"] == cf._WEIGHT_MAX
    # 下限
    state = cf.adjust_opportunity_weight(state, "safety", -100)
    assert state["opportunity_weights"]["safety"] == cf._WEIGHT_MIN


def test_learn_replied_increases_weight():
    state = cf.default_state()
    before = state["opportunity_weights"]["task_closure"]
    state = cf.learn_from_companion_outcome(
        decision={"opportunity": {"kind": "task_closure"}, "expression": {"mode": "staged"}},
        outcome="replied",
        recent_events=[],
        state=state,
    )
    after = state["opportunity_weights"]["task_closure"]
    assert after > before, "replied should increase weight"
    # 连续忽略计数被重置
    assert state["negative_feedback"]["ignored_count_7d"] == 0


def test_learn_ignored_single_slightly_decreases():
    state = cf.default_state()
    before = state["opportunity_weights"]["ritual"]
    state = cf.learn_from_companion_outcome(
        decision={"opportunity": {"kind": "ritual"}},
        outcome="ignored",
        recent_events=[],
        state=state,
    )
    after = state["opportunity_weights"]["ritual"]
    assert after <= before
    assert state["negative_feedback"]["ignored_count_7d"] == 1


def test_learn_consecutive_ignored_significantly_decreases():
    state = cf.default_state()
    before = state["opportunity_weights"]["ritual"]
    for _ in range(cf._IGNORE_BACKOFF_THRESHOLD + 1):
        state = cf.learn_from_companion_outcome(
            decision={"opportunity": {"kind": "ritual"}},
            outcome="ignored",
            recent_events=[],
            state=state,
        )
    after = state["opportunity_weights"]["ritual"]
    assert after < before - cf._WEIGHT_STEP, "consecutive ignores should back off significantly"
    # 应记录一条学习偏好
    assert any("降频" in p for p in state["learned_preferences"])


def test_learn_stopped_records_taboo_and_quiet_window():
    state = cf.default_state()
    state = cf.learn_from_companion_outcome(
        decision={"opportunity": {"kind": "free_chat"}},
        outcome="stopped",
        recent_events=[],
        state=state,
    )
    assert state["negative_feedback"]["stopped_count_7d"] == 1
    assert any("free_chat" in p for p in state["learned_preferences"])
    # quiet window 被记录（当前小时）
    assert len(state["quiet_windows"]) >= 1


def test_learn_failed_does_not_touch_user_preferences():
    state = cf.default_state()
    before = state["opportunity_weights"]["task_closure"]
    state = cf.learn_from_companion_outcome(
        decision={"opportunity": {"kind": "task_closure"}},
        outcome="failed",
        recent_events=[],
        state=state,
    )
    # 投递失败不学习用户偏好
    assert state["opportunity_weights"]["task_closure"] == before
    assert state["negative_feedback"]["ignored_count_7d"] == 0
    assert state["outcome_stats"]["counts"]["failed"] == 1
    assert state["outcome_stats"]["last_kind"] == "task_closure"


def test_learn_silent_records_outcome_without_learning_preference():
    state = cf.default_state()
    before = json.dumps(state, sort_keys=True)
    state = cf.learn_from_companion_outcome(
        decision={"opportunity": {"kind": "ritual"}},
        outcome="silent",
        recent_events=[],
        state=state,
    )
    # silent 只更新 updated_ts，不影响偏好
    assert state["opportunity_weights"]["ritual"] == cf.DEFAULT_OPPORTUNITY_WEIGHTS["ritual"]
    assert state["outcome_stats"]["counts"]["silent"] == 1
    assert state["outcome_stats"]["last_outcome"] == "silent"


def test_adaptation_state_redacts_secrets_on_save(tmp_path):
    state = cf.default_state()
    state = cf.add_learned_preference(state, "user said sk-1234567890abcdef")
    cf.save_state(tmp_path, state)
    raw = cf.adaptation_path(tmp_path).read_text(encoding="utf-8")
    assert "sk-1234567890abcdef" not in raw
    assert "***" in raw


def test_add_learned_preference_dedupes_and_caps(tmp_path):
    state = cf.default_state()
    for i in range(60):
        state = cf.add_learned_preference(state, f"pref_{i % 5}")  # 5 unique repeated
    assert len(state["learned_preferences"]) <= 50
    assert len(set(state["learned_preferences"])) <= 5


def test_add_quiet_window_validates_hour():
    state = cf.default_state()
    state = cf.add_quiet_window(state, 3)
    state = cf.add_quiet_window(state, 3)  # dedupe
    assert state["quiet_windows"] == [3]
    state = cf.add_quiet_window(state, 25)  # invalid ignored
    assert 25 not in state["quiet_windows"]


def test_adaptation_does_not_create_new_opportunity_kinds():
    """自适应只能调既有类型权重，不能凭空新增越权能力。"""
    state = cf.default_state()
    original_kinds = set(state["opportunity_weights"].keys())
    state = cf.learn_from_companion_outcome(
        decision={"opportunity": {"kind": "task_closure"}},
        outcome="replied",
        recent_events=[],
        state=state,
    )
    assert set(state["opportunity_weights"].keys()) == original_kinds
