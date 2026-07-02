# -*- coding: utf-8 -*-
"""Companion policy — 汇总护栏、mode、quiet hours、cooldown、机会分数。

0.3.5 Phase 5：决定说不说、什么时候说、用什么声音、走什么渠道。
底层护栏负责"能不能做"，policy 负责综合判断"该不该做、怎么做"。
"""

from __future__ import annotations

import time
from typing import Optional

from .redaction import redact_text


# 冷却时间（秒）：同一类机会在冷却内不重复触发
DEFAULT_COOLDOWN_SEC = {
    "safety": 300,        # 5 分钟
    "task_closure": 1800, # 30 分钟
    "emotional_carry": 1800,
    "relationship_memory": 3600,
    "ritual": 3600,       # 1 小时（早晚锚点）
    "free_chat": 7200,    # 2 小时
}

# 默认勿扰时段（小时，24h 制）
DEFAULT_QUIET_HOURS = (22, 8)  # 22:00-08:00


def _in_quiet_hours(now: float, quiet_hours: tuple = DEFAULT_QUIET_HOURS) -> bool:
    """判断当前是否在勿扰时段。"""
    if not quiet_hours:
        return False
    hour = time.localtime(now).tm_hour
    start, end = quiet_hours
    if start <= end:
        return start <= hour < end
    # 跨午夜：如 22-8
    return hour >= start or hour < end


def decide_companion_action(
    cfg: dict,
    state: dict,
    reflection: dict | None,
    now: float | None = None,
    *,
    opportunities: list[dict] | None = None,
) -> dict:
    """综合判断本次 Companion Loop tick 的行动。

    返回 CompanionDecision：
    {
      "decision": "speak" | "silent" | "defer",
      "opportunity": {"kind": ..., "score": ...} | None,
      "expression": {"mode": "single"|"staged", "voice": ...},
      "why": "...",
      "evidence_ids": [...],
    }

    底层护栏（直接 silent）：
    - companion disabled
    - quiet hours（除 safety）
    - 用户活跃输入（state 标记）
    - 最近主动过且冷却未过
    - 没有投递目标
    - 最近多次无人回应已降频
    """
    now = now or time.time()
    cfg = cfg or {}
    state = state or {}
    reflection = reflection or {}

    # 护栏 1：disabled
    if not cfg.get("enabled"):
        return _silent("disabled", state)
    mode = str(cfg.get("mode", "present")).lower()
    if mode == "off":
        return _silent("mode_off", state)

    # 护栏 2：paused
    paused_until = float(state.get("paused_until", 0) or 0)
    if paused_until and now < paused_until:
        return _silent("paused", state)

    # 护栏 3：quiet hours（safety 例外）
    quiet_hours = cfg.get("quiet_hours") or DEFAULT_QUIET_HOURS
    in_quiet = _in_quiet_hours(now, quiet_hours if isinstance(quiet_hours, tuple) else tuple(quiet_hours))

    # 护栏 4：用户活跃（state 标记）
    if state.get("user_active"):
        return _silent("user_active", state)

    # 护栏 5：连续无回应降频
    neg = state.get("negative_feedback") or {}
    ignored_7d = int(neg.get("ignored_count_7d", 0))
    if ignored_7d >= 5 and mode != "active":
        return _silent("backoff_high_ignore", state)

    # 获取机会（外部传入或从 reflection 挖掘）
    if opportunities is None:
        from .care_opportunities import mine_care_opportunities
        opportunities = mine_care_opportunities(reflection, cfg, now)

    if not opportunities:
        return _silent("no_opportunity", state)

    # 取最高分机会
    best = opportunities[0]
    kind = best.get("kind", "")
    score = float(best.get("score", 0))

    # quiet hours 时非 safety 直接 silent
    if in_quiet and kind != "safety":
        return _silent("quiet_hours", state)

    # quiet mode 只说 safety
    if mode == "quiet" and kind != "safety":
        return _silent("skipped_by_mode_quiet", state)

    # 冷却检查
    cooldown_key = f"last_sent_{kind}_ts"
    last_sent = float(state.get(cooldown_key, 0) or 0)
    cooldown = DEFAULT_COOLDOWN_SEC.get(kind, 1800)
    if last_sent and (now - last_sent) < cooldown:
        return _silent(f"cooldown_{kind}", state)

    # 低分静默（present 模式需强证据）
    threshold = 0.5 if mode == "present" else 0.3 if mode == "active" else 0.8
    if score < threshold:
        return _silent("low_score", state)

    # 决定表达方式
    from .voice_profiles import resolve_voice
    gender = cfg.get("voice_gender", "auto")
    persona = cfg.get("persona", cfg.get("relationship_style", "butler"))
    voice = resolve_voice(best.get("suggested_opening", "你好"), gender=gender, persona=persona)

    # 多段式：task_closure/emotional_carry 适合 staged
    expr_mode = "staged" if kind in ("task_closure", "emotional_carry", "relationship_memory") and score >= 0.7 else "single"

    return {
        "decision": "speak",
        "opportunity": {"kind": kind, "score": score},
        "expression": {"mode": expr_mode, "voice": voice},
        "why": redact_text(best.get("reason", "")),
        "evidence_ids": reflection.get("evidence_ids", [])[:5],
        "suggested_opening": redact_text(best.get("suggested_opening", "")),
    }


def _silent(reason: str, state: dict) -> dict:
    return {
        "decision": "silent",
        "opportunity": None,
        "expression": None,
        "why": reason,
        "evidence_ids": [],
    }
