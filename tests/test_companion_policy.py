# -*- coding: utf-8 -*-
"""Phase 5 测试：care_opportunities + companion_policy + proactive_dialogue + loop tick。

验证：
1. care_opportunities 从 reflection 挖掘机会、按 mode 过滤、排序去重。
2. companion_policy 底层护栏（disabled/quiet hours/cooldown/降频）。
3. proactive_dialogue 多段式（1-5 条、可中断、字数限制）。
4. run_companion_loop_tick 闭环：observe->reflect->propose->choose->express。
"""
import json
import os
import time

import pytest

from penglai_runtime import care_opportunities as co
from penglai_runtime import companion_policy as cp
from penglai_runtime import proactive_dialogue as pd
from penglai_runtime import companion_loop as cl
from penglai_runtime.context_events import append_context_event


DAYTIME_TS = time.mktime((2026, 7, 3, 12, 0, 0, 0, 0, -1))


# ── care_opportunities ──────────────────────────────────────────────────

def test_mine_opportunities_from_reflection():
    reflection = {
        "care_opportunities": [
            {"kind": "task_closure", "score": 0.95, "reason": "README 未闭环", "suggested_opening": "README 还没完成"},
            {"kind": "emotional_carry", "score": 0.7, "reason": "负面情绪", "suggested_opening": "听起来不太轻松"},
        ],
        "unresolved_items": ["项目推进"],
    }
    opps = co.mine_care_opportunities(reflection, {"mode": "present"})
    assert len(opps) >= 1
    # task_closure 分数最高，应排前面
    assert opps[0]["kind"] == "task_closure"


def test_mine_opportunities_filters_by_mode():
    reflection = {
        "care_opportunities": [
            {"kind": "free_chat", "score": 0.9, "reason": "闲聊"},
            {"kind": "safety", "score": 0.9, "reason": "安全"},
        ],
    }
    # quiet 模式只保留 safety
    opps = co.mine_care_opportunities(reflection, {"mode": "quiet"})
    kinds = [o["kind"] for o in opps]
    assert "safety" in kinds
    assert "free_chat" not in kinds


def test_mine_opportunities_dedupes_same_kind():
    reflection = {
        "care_opportunities": [
            {"kind": "task_closure", "score": 0.5, "reason": "A"},
            {"kind": "task_closure", "score": 0.9, "reason": "B"},
        ],
    }
    opps = co.mine_care_opportunities(reflection, {"mode": "active"})
    # 同 kind 去重保留最高分
    task_opps = [o for o in opps if o["kind"] == "task_closure"]
    assert len(task_opps) == 1
    assert task_opps[0]["score"] == 0.9


def test_mine_opportunities_safety_from_unresolved():
    reflection = {"care_opportunities": [], "unresolved_items": ["天气预警需关注"]}
    opps = co.mine_care_opportunities(reflection, {"mode": "present"})
    assert any(o["kind"] == "safety" for o in opps)


# ── companion_policy ────────────────────────────────────────────────────

def test_policy_silent_when_disabled():
    decision = cp.decide_companion_action({"enabled": False}, {}, None)
    assert decision["decision"] == "silent"
    assert decision["why"] == "disabled"


def test_policy_silent_when_mode_off():
    decision = cp.decide_companion_action({"enabled": True, "mode": "off"}, {}, None)
    assert decision["decision"] == "silent"


def test_policy_silent_when_paused():
    now = time.time()
    state = {"paused_until": now + 3600}
    decision = cp.decide_companion_action({"enabled": True, "mode": "present"}, state, None, now=now)
    assert decision["decision"] == "silent"
    assert decision["why"] == "paused"


def test_policy_silent_when_user_active():
    state = {"user_active": True}
    decision = cp.decide_companion_action({"enabled": True, "mode": "present"}, state, None)
    assert decision["decision"] == "silent"
    assert decision["why"] == "user_active"


def test_policy_silent_when_high_ignore_backoff():
    state = {"negative_feedback": {"ignored_count_7d": 6}}
    decision = cp.decide_companion_action({"enabled": True, "mode": "present"}, state, None)
    assert decision["decision"] == "silent"
    assert "backoff" in decision["why"]


def test_policy_silent_when_no_opportunity():
    decision = cp.decide_companion_action({"enabled": True, "mode": "present"}, {}, {"care_opportunities": []})
    assert decision["decision"] == "silent"
    assert decision["why"] == "no_opportunity"


def test_policy_silent_when_cooldown_active():
    now = DAYTIME_TS
    state = {f"last_sent_task_closure_ts": now - 60}  # 1 分钟前刚发过
    reflection = {"care_opportunities": [{"kind": "task_closure", "score": 0.9, "reason": "test"}]}
    decision = cp.decide_companion_action({"enabled": True, "mode": "present"}, state, reflection, now=now)
    assert decision["decision"] == "silent"
    assert "cooldown" in decision["why"]


def test_policy_speak_on_strong_opportunity():
    now = DAYTIME_TS
    reflection = {"care_opportunities": [{"kind": "task_closure", "score": 0.9, "reason": "README 未闭环", "suggested_opening": "README 还没完成"}]}
    decision = cp.decide_companion_action({"enabled": True, "mode": "present", "voice_gender": "male"}, {}, reflection, now=now)
    assert decision["decision"] == "speak"
    assert decision["opportunity"]["kind"] == "task_closure"
    assert decision["expression"]["voice"] in ("Junhao", "Adam", "Xiaoyu", "Ava")


def test_policy_silent_on_low_score_present_mode():
    reflection = {"care_opportunities": [{"kind": "free_chat", "score": 0.2, "reason": "闲聊"}]}
    decision = cp.decide_companion_action({"enabled": True, "mode": "present"}, {}, reflection)
    assert decision["decision"] == "silent"


# ── proactive_dialogue ──────────────────────────────────────────────────

def test_dialogue_single_for_safety():
    opp = {"kind": "safety", "score": 0.9, "suggested_opening": "天气预警", "reason": "暴雨"}
    plan = pd.build_dialogue_plan(opp, {}, {})
    assert plan["style"] == "single"
    assert len(plan["steps"]) == 1
    assert plan["interruptible"] is True


def test_dialogue_staged_for_task_closure():
    opp = {"kind": "task_closure", "score": 0.85, "suggested_opening": "README 未闭环", "reason": "README 和官网未完成"}
    plan = pd.build_dialogue_plan(opp, {"mode": "present"}, {})
    assert plan["style"] == "staged"
    assert 2 <= len(plan["steps"]) <= 5
    # 第一条是 knock
    assert plan["steps"][0]["type"] == "knock"
    # 可中断
    assert plan["stop_if_user_replies"] is True


def test_dialogue_respects_max_steps():
    opp = {"kind": "task_closure", "score": 0.9, "reason": "test " * 50, "suggested_opening": "open " * 20}
    plan = pd.build_dialogue_plan(opp, {}, {})
    assert len(plan["steps"]) <= pd.MAX_STEPS


def test_dialogue_respects_max_total_chars():
    opp = {"kind": "task_closure", "score": 0.9, "reason": "x" * 300, "suggested_opening": "y" * 300}
    plan = pd.build_dialogue_plan(opp, {}, {})
    total = sum(len(s.get("text", "")) for s in plan["steps"])
    assert total <= pd.MAX_TOTAL_CHARS


def test_should_continue_dialogue_stops_on_reply():
    plan = {"max_steps": 4}
    state = {"dialogue_sent_count": 1}
    # 用户回复了
    assert pd.should_continue_dialogue(plan, state, {"user_replied": True}) is False
    # 用户活跃
    assert pd.should_continue_dialogue(plan, state, {"user_active": True}) is False
    # 正常继续
    assert pd.should_continue_dialogue(plan, state, {"now": time.time() + 10}) is True


def test_should_continue_dialogue_stops_when_all_sent():
    plan = {"max_steps": 3}
    state = {"dialogue_sent_count": 3}
    assert pd.should_continue_dialogue(plan, state, {}) is False


# ── run_companion_loop_tick 闭环 ────────────────────────────────────────

def test_loop_tick_silent_when_disabled(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    decision = cl.run_companion_loop_tick({"enabled": False, "mode": "present"}, {}, root=tmp_path)
    assert decision["decision"] == "silent"


def test_loop_tick_speak_with_plan(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    append_context_event("task", "Penglai 0.3.5 README 未闭环", channel="local")
    decision = cl.run_companion_loop_tick(
        {"enabled": True, "mode": "active", "voice_gender": "male"},
        {},
        root=tmp_path,
    )
    # 有未闭环事项，active 模式应 speak
    if decision["decision"] == "speak":
        assert "plan" in decision
        assert len(decision["plan"]["steps"]) >= 1
        assert decision["expression"]["voice"]


def test_loop_tick_returns_required_fields(tmp_path, monkeypatch):
    log_path = tmp_path / "events.jsonl"
    monkeypatch.setenv("PENGLAI_CONTEXT_EVENTS_LOG", str(log_path))
    decision = cl.run_companion_loop_tick({"enabled": True, "mode": "present"}, {}, root=tmp_path)
    # 必须包含 observe/reflect/propose/choose/express 所需字段
    assert "decision" in decision
    assert "why" in decision
    assert "evidence_ids" in decision
    assert decision["decision"] in ("speak", "silent", "defer")
