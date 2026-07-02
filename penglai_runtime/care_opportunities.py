# -*- coding: utf-8 -*-
"""Care opportunity miner — 从每日反思挖掘主动陪伴点。

0.3.5 Phase 5：把 reflection 转为候选主动陪伴点，打分、去重、降频。
生成 speak/silent/defer 候选。不堆规则，只用少量打分函数。
"""

from __future__ import annotations

import time
from typing import Optional

from .redaction import redact_text


# 机会类型默认是否可主动（对齐计划 4.3）
DEFAULT_ACTIVE_BY_MODE = {
    "safety": {"quiet": True, "present": True, "active": True},
    "task_closure": {"quiet": False, "present": True, "active": True},
    "emotional_carry": {"quiet": False, "present": True, "active": True},
    "relationship_memory": {"quiet": False, "present": False, "active": True},
    "ritual": {"quiet": False, "present": False, "active": True},
    "free_chat": {"quiet": False, "present": False, "active": False},
}


def mine_care_opportunities(reflection: dict, cfg: dict, now: float | None = None) -> list[dict]:
    """从 reflection 挖掘候选主动陪伴点。

    返回排序后的机会列表（score 降序）。每个机会含 kind/score/reason/suggested_opening。
    """
    now = now or time.time()
    reflection = reflection or {}
    cfg = cfg or {}
    mode = str(cfg.get("mode", "present")).lower()

    opportunities = []
    # 直接复用 reflection 里已有的 care_opportunities（Phase 4 生成）
    for opp in reflection.get("care_opportunities", []):
        item = {
            "kind": str(opp.get("kind", "task_closure")),
            "score": float(opp.get("score", 0.5)),
            "reason": redact_text(opp.get("reason", "")),
            "suggested_opening": redact_text(opp.get("suggested_opening", "")),
        }
        opportunities.append(item)

    # safety：检查 reflection 里是否有安全/天气类信号
    unresolved = [str(u).lower() for u in reflection.get("unresolved_items", [])]
    if any(kw in " ".join(unresolved) for kw in ("天气", "安全", "异常", "风险", "weather", "safety")):
        opportunities.append({
            "kind": "safety",
            "score": 0.9,
            "reason": "检测到安全或天气类信号",
            "suggested_opening": "有个安全/天气提醒需要你看一下。",
        })

    # ritual：早晚锚点（只在有具体由头时才加分，对齐 P1）
    hour = time.localtime(now).tm_hour
    if 6 <= hour <= 9:
        opportunities.append({
            "kind": "ritual",
            "score": 0.3,
            "reason": "早晨锚点",
            "suggested_opening": "",
        })
    elif 21 <= hour <= 23:
        opportunities.append({
            "kind": "ritual",
            "score": 0.3,
            "reason": "晚间锚点",
            "suggested_opening": "",
        })

    # 按当前 mode 过滤不可主动的类型
    filtered = []
    for opp in opportunities:
        kind = opp["kind"]
        active_map = DEFAULT_ACTIVE_BY_MODE.get(kind, {})
        if active_map.get(mode, True):
            filtered.append(opp)

    return rank_opportunities(filtered, cfg)


def rank_opportunities(items: list[dict], cfg: dict) -> list[dict]:
    """排序 + 去重。按 score 降序，同 kind 去重保留最高分。"""
    seen_kinds = {}
    for item in items:
        kind = item["kind"]
        if kind not in seen_kinds or item["score"] > seen_kinds[kind]["score"]:
            seen_kinds[kind] = item
    ranked = sorted(seen_kinds.values(), key=lambda x: x["score"], reverse=True)
    return ranked
