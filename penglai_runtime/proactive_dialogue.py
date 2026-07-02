# -*- coding: utf-8 -*-
"""Proactive dialogue — 把单个 care opportunity 转成 1-5 条可中断短消息。

0.3.5 Phase 5：控制节奏、间隔、总字数和 stop 条件。
根据当前情景选择单条、两段、三段或四段。为每条消息记录 step 类型和证据。
"""

from __future__ import annotations

import time
from typing import Optional

from .redaction import redact_text


# 多段式约束（对齐计划 4.5.3）
MAX_STEPS = 5
MAX_TOTAL_CHARS = 260
MIN_INTERVAL_SEC = 6
MAX_INTERVAL_SEC = 20

# step 类型
STEP_KNOCK = "knock"
STEP_REASON = "reason"
STEP_CONTEXT = "context"
STEP_OFFER = "offer"
STEP_CLOSE = "close"


def build_dialogue_plan(
    opportunity: dict,
    cfg: dict,
    state: dict,
    scene: dict | None = None,
) -> dict:
    """把单个 care opportunity 转成可中断的多段对话计划。

    返回 dialogue_plan：
    {
      "decision": "speak",
      "style": "single"|"staged",
      "max_steps": int,
      "interruptible": true,
      "steps": [{"type":..., "text":..., "send_after_sec":..., "requires_reply":...}],
      "stop_if_user_replies": true,
      "stop_if_user_active": true,
      "evidence_ids": [...],
    }
    """
    opportunity = opportunity or {}
    cfg = cfg or {}
    state = state or {}
    scene = scene or {}
    kind = str(opportunity.get("kind", "task_closure"))
    score = float(opportunity.get("score", 0))
    opening = redact_text(opportunity.get("suggested_opening", ""))
    reason = redact_text(opportunity.get("reason", ""))

    # safety/free_chat 用单条
    if kind in ("safety", "free_chat"):
        return _single_plan(opportunity, opening or reason)

    # ritual 无具体由头时静默
    if kind == "ritual" and not opening:
        return _single_plan(opportunity, "")

    # 低分用单条
    if score < 0.6:
        return _single_plan(opportunity, opening or reason)

    # staged：根据情景选 2-4 段
    hour = time.localtime().tm_hour
    is_evening = 17 <= hour <= 22
    is_deep_night = hour >= 23 or hour < 6

    if is_deep_night:
        # 深夜最多 1 条轻提示
        return _single_plan(opportunity, opening or reason)

    steps = []

    # step 1: 敲门
    knock = _knock_text(scene, is_evening)
    steps.append({
        "type": STEP_KNOCK,
        "text": knock,
        "send_after_sec": 0,
        "requires_reply": False,
    })

    # step 2: 说明由头
    steps.append({
        "type": STEP_REASON,
        "text": _reason_text(kind, reason, opening),
        "send_after_sec": MIN_INTERVAL_SEC + 2,
        "requires_reply": False,
    })

    # step 3: 带出上下文（task_closure/emotional_carry 才有）
    if kind in ("task_closure", "emotional_carry") and reason:
        steps.append({
            "type": STEP_CONTEXT,
            "text": _context_text(kind, reason, scene),
            "send_after_sec": MIN_INTERVAL_SEC + 6,
            "requires_reply": False,
        })

    # step 4: 给选择
    if not is_evening or len(steps) < 3:
        steps.append({
            "type": STEP_OFFER,
            "text": _offer_text(kind, scene),
            "send_after_sec": MIN_INTERVAL_SEC + 9,
            "requires_reply": True,
        })

    # 限制总条数和总字数
    steps = _trim_to_limits(steps)

    return {
        "decision": "speak",
        "style": "staged" if len(steps) > 1 else "single",
        "max_steps": len(steps),
        "interruptible": True,
        "steps": steps,
        "stop_if_user_replies": True,
        "stop_if_user_active": True,
        "evidence_ids": opportunity.get("evidence_ids", [])[:5],
    }


def should_continue_dialogue(plan: dict, state: dict, latest_activity: dict | None = None) -> bool:
    """判断是否应该继续发送下一条多段消息。

    停止条件：
    1. 用户已回复
    2. 用户变为活跃
    3. 进入勿扰时段
    4. 已发完全部步骤
    """
    plan = plan or {}
    latest_activity = latest_activity or {}

    if latest_activity.get("user_replied"):
        return False
    if latest_activity.get("user_active"):
        return False

    now = latest_activity.get("now", time.time())
    hour = time.localtime(now).tm_hour
    if hour >= 23 or hour < 6:
        return False

    sent_count = int(state.get("dialogue_sent_count", 0))
    max_steps = int(plan.get("max_steps", 1))
    if sent_count >= max_steps:
        return False

    return True


def _single_plan(opportunity: dict, text: str) -> dict:
    return {
        "decision": "speak",
        "style": "single",
        "max_steps": 1,
        "interruptible": True,
        "steps": [{
            "type": STEP_OFFER,
            "text": redact_text(text)[:120],
            "send_after_sec": 0,
            "requires_reply": False,
        }],
        "stop_if_user_replies": True,
        "stop_if_user_active": True,
        "evidence_ids": opportunity.get("evidence_ids", [])[:5],
    }


def _knock_text(scene: dict, is_evening: bool) -> str:
    if is_evening:
        return "老板，这个点你可能在收尾或者路上，有个小事想打扰一下。"
    return "老板，在吗？有个小事想打扰你一下。"


def _reason_text(kind: str, reason: str, opening: str) -> str:
    if kind == "task_closure":
        return f"有件事还没闭环：{reason[:80]}" if reason else "有件事还没闭环，想帮你盯一下。"
    if kind == "emotional_carry":
        return "刚才那段听起来不太轻松，我先不分析，就想接一下。"
    if kind == "relationship_memory":
        return "有件你之前在意的事，我想起来了。"
    return opening[:100] if opening else reason[:100]


def _context_text(kind: str, reason: str, scene: dict) -> str:
    if kind == "task_closure":
        return f"具体是：{reason[:100]}。我可以帮你把它拆成下一步。"
    if kind == "emotional_carry":
        return "你不用先把话说完整，先把最难受的那一点告诉我就行。"
    return reason[:100]


def _offer_text(kind: str, scene: dict) -> str:
    if kind == "task_closure":
        return "要不要我先把明天第一步要改的三个文件列出来？"
    if kind == "emotional_carry":
        return "如果你只是想安静一会儿，我也可以陪你，不急着分析。要不要？"
    return "要不要我帮你看看？"


def _trim_to_limits(steps: list[dict]) -> list[dict]:
    """限制总条数和总字数。"""
    if len(steps) > MAX_STEPS:
        steps = steps[:MAX_STEPS]
    total = sum(len(s.get("text", "")) for s in steps)
    if total > MAX_TOTAL_CHARS:
        # 从后往前截断
        while len(steps) > 1 and sum(len(s.get("text", "")) for s in steps) > MAX_TOTAL_CHARS:
            steps.pop()
    return steps
