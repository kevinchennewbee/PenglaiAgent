# -*- coding: utf-8 -*-
"""Daily reflection — local, privacy-preserving companion memory artifact.

0.3.5 Phase 4：从 context events、companion 状态、语音情绪信号生成当天脱敏反思。
只写脱敏摘要和证据 ID，不保存原始语音和完整聊天原文。

输出：``temp/companion_reflections/YYYY-MM-DD.json``
"""

from __future__ import annotations

import json
import os
import time
from collections import Counter
from pathlib import Path

from .context_events import recent_context_events
from .redaction import redact_obj, redact_text


def reflections_dir(root: str | os.PathLike[str]) -> Path:
    return Path(root).resolve() / "temp" / "companion_reflections"


def reflection_path(root: str | os.PathLike[str], date_str: str | None = None) -> Path:
    date_str = date_str or time.strftime("%Y-%m-%d")
    return reflections_dir(root) / f"{date_str}.json"


def _today_events(root: str | os.PathLike[str], now: float | None = None):
    """读取今天的 context events（含 companion 通道和通用事件）。"""
    now = now or time.time()
    # 今天 00:00 的 ts
    tm = time.localtime(now)
    start_of_day = time.mktime(time.struct_time((tm.tm_year, tm.tm_mon, tm.tm_mday, 0, 0, 0, 0, 0, -1)))
    cutoff_hours = max(1, (now - start_of_day) / 3600 + 1)
    events = recent_context_events(
        limit=200,
        max_age_hours=cutoff_hours,
        include_legacy=True,
    )
    # 过滤掉今天之前的
    return [e for e in events if float(e.get("ts", 0) or 0) >= start_of_day]


def _extract_themes(events: list[dict]) -> list[str]:
    """从事件文本中抽取高频关键词作为主题（简单分词，脱敏后）。"""
    words = []
    for e in events:
        text = redact_text(e.get("text", ""))
        # 简单按标点和空格分词，取 2-8 字的片段
        for seg in text.replace(",", " ").replace("，", " ").replace(".", " ").replace("。", " ").split():
            seg = seg.strip()
            if 2 <= len(seg) <= 20:
                words.append(seg)
    counter = Counter(words)
    # 取前 5 个高频词作为主题
    return [w for w, _ in counter.most_common(5)]


def _extract_unresolved(events: list[dict]) -> list[str]:
    """从事件中识别未闭环事项（含 '未闭环'/'未完成'/'失败'/'error' 等标记）。"""
    markers = ("未闭环", "未完成", "失败", "error", "failed", "pending", "todo", "README", "官网")
    items = []
    for e in events:
        text = redact_text(e.get("text", ""))
        kind = str(e.get("kind", ""))
        if any(m in text.lower() or m in kind.lower() for m in [x.lower() for x in markers]):
            snippet = text[:120].strip()
            if snippet and snippet not in items:
                items.append(snippet)
    return items[:8]


def _extract_emotional_arc(events: list[dict]) -> str:
    """从情绪信号事件中推断当天情绪弧线（脱敏）。"""
    emotion_events = [e for e in events if e.get("kind") == "emotion" or "emotion" in str(e.get("metadata", {}))]
    if not emotion_events:
        # 从 companion 事件推断
        comp_events = [e for e in events if e.get("channel") == "companion"]
        if comp_events:
            return "用户今天有 companion 互动"
        return ""
    # 简单聚合情绪标签
    tags = []
    for e in emotion_events:
        meta = e.get("metadata") or {}
        tag = meta.get("emotion") or meta.get("emotion_label") or ""
        if tag and tag not in tags:
            tags.append(str(tag))
    if not tags:
        return "有情绪信号但无明确标签"
    return "当天情绪信号：" + "、".join(tags[:3])


def _extract_care_opportunities(events: list[dict]) -> list[dict]:
    """从事件中挖掘候选主动陪伴点（Phase 4 简化版，Phase 5 由 care_opportunities 接管）。"""
    opps = []
    # task_closure: 未闭环事项
    unresolved = _extract_unresolved(events)
    for item in unresolved[:3]:
        opps.append({
            "kind": "task_closure",
            "score": 0.8,
            "reason": redact_text(item)[:160],
            "suggested_opening": f"我注意到这件事还没闭环：{item[:60]}",
        })
    # emotional_carry: 负面情绪信号
    emotion_events = [e for e in events if e.get("kind") == "emotion"]
    if emotion_events:
        opps.append({
            "kind": "emotional_carry",
            "score": 0.7,
            "reason": "今天有负面情绪信号",
            "suggested_opening": "刚才那段听起来不太轻松，要不要我帮你把这件事拆一下？",
        })
    return opps[:5]


def _do_not_repeat_defaults() -> list[str]:
    """默认不再重复的话术（对齐 P2 原则）。"""
    return ["空泛早晚安", "复述情绪标签", "无依据的心理判断"]


def generate_reflection(
    root: str | os.PathLike[str],
    *,
    now: float | None = None,
    cfg: dict | None = None,
) -> dict:
    """生成当天反思 artifact 并写入 temp/companion_reflections/YYYY-MM-DD.json。

    只写脱敏摘要和证据 ID，不保存原始语音和完整聊天原文。
    返回反思字典。
    """
    now = now or time.time()
    date_str = time.strftime("%Y-%m-%d", time.localtime(now))
    events = _today_events(root, now)

    themes = _extract_themes(events)
    emotional_arc = _extract_emotional_arc(events)
    unresolved = _extract_unresolved(events)
    opportunities = _extract_care_opportunities(events)

    reflection = {
        "date": date_str,
        "generated_ts": now,
        "themes": themes,
        "emotional_arc": emotional_arc,
        "unresolved_items": unresolved,
        "care_opportunities": opportunities,
        "do_not_repeat": _do_not_repeat_defaults(),
        "privacy_summary": "no raw audio retained; only redacted event summaries",
        "event_count": len(events),
        # 证据 ID 引用（不存原文）
        "evidence_ids": [
            f"context_event:{float(e.get('ts', 0) or 0):.0f}:{e.get('kind', '')}"
            for e in events[:20]
        ],
    }

    # 写入文件（脱敏后）
    out_dir = reflections_dir(root)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = reflection_path(root, date_str)
    payload = redact_obj(reflection)
    tmp = out_path.with_name(f".{out_path.name}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    os.replace(tmp, out_path)
    return payload


def load_reflection(root: str | os.PathLike[str], date_str: str | None = None) -> dict | None:
    """加载指定日期的反思（缺失返回 None）。"""
    path = reflection_path(root, date_str)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
