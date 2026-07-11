# -*- coding: utf-8 -*-
"""Companion feedback learning — lightweight adaptation state.

0.3.5 Phase 1 基座：从 companion 投递结果（sent/silent/failed/stopped）和用户后续
回复（replied/ignored/interrupted）中更新少量自适应倾向。只调权重和偏好，不新增
专用硬编码触发源，不覆盖用户显式配置。

自适应状态文件：``temp/companion_adaptation.json``，结构见 ``default_state()``。
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .redaction import redact_obj, redact_text


# 默认机会类型权重（>1 增强倾向，<1 降频）。只能影响倾向，不能凭空新增越权能力。
DEFAULT_OPPORTUNITY_WEIGHTS = {
    "safety": 1.2,
    "task_closure": 1.1,
    "emotional_carry": 0.9,
    "relationship_memory": 0.8,
    "ritual": 0.4,
    "free_chat": 0.3,
}

# 表达方式默认偏好
DEFAULT_EXPRESSION_PREF = {
    "single": 0.6,
    "staged": 0.4,
    "voice": 0.2,
}


def default_state() -> dict:
    """返回一份干净的初始自适应状态。"""
    return {
        "opportunity_weights": dict(DEFAULT_OPPORTUNITY_WEIGHTS),
        "expression_preference": dict(DEFAULT_EXPRESSION_PREF),
        "negative_feedback": {
            "ignored_count_7d": 0,
            "stopped_count_7d": 0,
        },
        "learned_preferences": [],
        "quiet_windows": [],
        "positive_patterns": [],
        "negative_patterns": [],
        "outcome_stats": {
            "counts": {},
            "last_outcome": "",
            "last_kind": "",
            "last_mode": "",
            "last_ts": 0,
        },
        "updated_ts": 0,
    }


def adaptation_path(root: str | os.PathLike[str]) -> Path:
    return Path(root).resolve() / "temp" / "companion_adaptation.json"


def load_state(root: str | os.PathLike[str]) -> dict:
    """加载自适应状态；缺失或损坏返回 default。"""
    state = default_state()
    path = adaptation_path(root)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            # 合并而非替换，保证新增字段有默认值
            for key, val in state.items():
                if key not in data:
                    data[key] = val
            state = data
    except Exception:
        pass
    # 保证必需字段存在
    state.setdefault("opportunity_weights", dict(DEFAULT_OPPORTUNITY_WEIGHTS))
    state.setdefault("expression_preference", dict(DEFAULT_EXPRESSION_PREF))
    state.setdefault("negative_feedback", {"ignored_count_7d": 0, "stopped_count_7d": 0})
    state.setdefault("learned_preferences", [])
    state.setdefault("quiet_windows", [])
    state.setdefault("positive_patterns", [])
    state.setdefault("negative_patterns", [])
    state.setdefault("outcome_stats", {
        "counts": {}, "last_outcome": "", "last_kind": "",
        "last_mode": "", "last_ts": 0,
    })
    state.setdefault("updated_ts", 0)
    return redact_obj(state)


def save_state(root: str | os.PathLike[str], state: dict) -> dict:
    """持久化自适应状态（脱敏后写入）。"""
    path = adaptation_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    state = dict(state or {})
    state["updated_ts"] = time.time()
    payload = redact_obj(state)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)
    return payload


# ── 学习原语 ──────────────────────────────────────────────────────────────

# 权重调整步长：单次反馈最多影响这么多，防止一次忽略就彻底杀掉一类机会。
_WEIGHT_STEP = 0.12
_WEIGHT_MIN = 0.1
_WEIGHT_MAX = 2.0
# 连续忽略多少次后显著降频
_IGNORE_BACKOFF_THRESHOLD = 3


def _clamp_weight(value: float) -> float:
    return max(_WEIGHT_MIN, min(_WEIGHT_MAX, float(value)))


def adjust_opportunity_weight(state: dict, kind: str, delta: float) -> dict:
    """调整某类机会的权重，夹在 [_WEIGHT_MIN, _WEIGHT_MAX]。"""
    weights = dict(state.get("opportunity_weights") or {})
    current = float(weights.get(kind, 1.0))
    weights[kind] = _clamp_weight(current + delta)
    state["opportunity_weights"] = weights
    return state


def adjust_expression_preference(state: dict, mode: str, delta: float) -> dict:
    """调整表达方式偏好（single/staged/voice）的倾向。"""
    prefs = dict(state.get("expression_preference") or {})
    current = float(prefs.get(mode, 0.5))
    prefs[mode] = max(0.0, min(1.0, current + delta))
    state["expression_preference"] = prefs
    return state


def record_negative_feedback(state: dict, feedback_type: str) -> dict:
    """记录负面反馈（ignored/stopped），累计 7 天计数。"""
    neg = dict(state.get("negative_feedback") or {})
    key = f"{feedback_type}_count_7d"
    neg[key] = int(neg.get(key, 0)) + 1
    state["negative_feedback"] = neg
    return state


def add_learned_preference(state: dict, text: str) -> dict:
    """记录一条学习到的偏好（脱敏）。去重，最多保留 50 条。"""
    text = redact_text(str(text or "")).strip()
    if not text:
        return state
    prefs = list(state.get("learned_preferences") or [])
    if text not in prefs:
        prefs.append(text)
    state["learned_preferences"] = prefs[-50:]
    return state


def add_quiet_window(state: dict, hour: int) -> dict:
    """记录一个常被打断/无回应的小时窗口（0-23）。"""
    hour = int(hour)
    if not 0 <= hour <= 23:
        return state
    windows = list(state.get("quiet_windows") or [])
    if hour not in windows:
        windows.append(hour)
        windows.sort()
    state["quiet_windows"] = windows[-24:]
    return state


def learn_from_companion_outcome(decision: dict, outcome: str, recent_events: list | None, state: dict) -> dict:
    """从一次主动陪伴结果学习，更新轻量自适应状态。

    decision: 上一轮 CompanionDecision（含 opportunity.kind, expression.mode 等）
    outcome:  "replied" | "ignored" | "interrupted" | "stopped" | "failed" | "silent"
    recent_events: 最近 companion 事件（用于判断连续忽略）

    更新原则（对齐 0.3.5 计划 6.3）：
    - 用户回应并继续对话：增强该类机会和表达方式
    - 用户忽略：轻微降权，不立刻判定失败
    - 用户连续忽略：显著降频
    - 用户打断/关闭：立即停止并记录禁忌
    - 投递失败：不学习用户偏好，只记录系统失败
    """
    state = dict(state or default_state())
    decision = decision or {}
    outcome = str(outcome or "").lower()
    kind = str(decision.get("opportunity", {}).get("kind") or decision.get("kind") or "")
    mode = str(decision.get("expression", {}).get("mode") or decision.get("mode") or "")

    # Persist an auditable, secret-free outcome trail for every wired result.
    # This is telemetry, not preference learning: failed/silent still leave all
    # user weights and negative-feedback counters untouched.
    stats = dict(state.get("outcome_stats") or {})
    counts = dict(stats.get("counts") or {})
    if outcome:
        counts[outcome] = int(counts.get(outcome, 0)) + 1
    stats.update({
        "counts": counts,
        "last_outcome": outcome,
        "last_kind": kind,
        "last_mode": mode,
        "last_ts": time.time(),
    })
    state["outcome_stats"] = stats

    if outcome == "replied":
        if kind:
            adjust_opportunity_weight(state, kind, +_WEIGHT_STEP)
        if mode:
            adjust_expression_preference(state, mode, +_WEIGHT_STEP * 0.8)
        # 回应是正面信号，重置该类的连续忽略计数
        neg = dict(state.get("negative_feedback") or {})
        neg["ignored_count_7d"] = 0
        state["negative_feedback"] = neg
    elif outcome == "ignored":
        record_negative_feedback(state, "ignored")
        if kind:
            # 单次忽略轻微降权
            adjust_opportunity_weight(state, kind, -_WEIGHT_STEP * 0.5)
        # 连续忽略超过阈值则显著降频
        ignored_count = int(state.get("negative_feedback", {}).get("ignored_count_7d", 0))
        if ignored_count >= _IGNORE_BACKOFF_THRESHOLD and kind:
            adjust_opportunity_weight(state, kind, -_WEIGHT_STEP * 1.5)
            add_learned_preference(state, f"连续 {ignored_count} 次忽略 {kind} 类主动陪伴，已降频")
    elif outcome in ("interrupted", "stopped"):
        record_negative_feedback(state, "stopped")
        if kind:
            adjust_opportunity_weight(state, kind, -_WEIGHT_STEP)
            add_learned_preference(state, f"用户打断/停止了 {kind} 类主动陪伴，应降频")
        # 记录当前小时为 quiet window 候选
        try:
            hour = int(time.localtime().tm_hour)
            add_quiet_window(state, hour)
        except Exception:
            pass
    elif outcome == "failed":
        # 投递失败不学习用户偏好，只记录系统失败
        pass
    elif outcome == "silent":
        # silent 是主动选择静默，不是反馈，不学习
        pass

    return state
