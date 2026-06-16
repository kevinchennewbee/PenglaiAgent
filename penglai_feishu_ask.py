# -*- coding: utf-8 -*-
"""Feishu ask_user helpers for Penglai's wrapper layer.

GA exposes ask_user as an EXITED/HUMAN_INTERVENTION payload.  The upstream
Feishu frontend renders only the final text, so Penglai adds a channel-side
adapter that makes the question and choices visible without changing GA core.
"""
import re


def normalize_candidates(raw):
    if not isinstance(raw, (list, tuple)):
        return []
    out = []
    for item in raw:
        if item is None:
            continue
        text = str(item).strip()
        if text:
            out.append(text)
    return out


def extract_ask_user_event(ctx):
    exit_reason = (ctx or {}).get("exit_reason") or {}
    if exit_reason.get("result") != "EXITED":
        return None
    payload = exit_reason.get("data")
    if not isinstance(payload, dict):
        return None
    if payload.get("status") != "INTERRUPT" or payload.get("intent") != "HUMAN_INTERVENTION":
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    candidates = normalize_candidates(data.get("candidates") or [])
    if not candidates:
        return None
    question = str(data.get("question") or "请选择下一步操作：").strip() or "请选择下一步操作："
    return {"question": question, "candidates": candidates}


def resolve_choice(text, event):
    """Map a manual Feishu reply to a candidate.

    Accepts 1-based numbers and exact candidate text.  Returns None when the
    message is not intended as a choice so normal chat can continue.
    """
    if not event:
        return None
    value = str(text or "").strip()
    if not value:
        return None
    candidates = event.get("candidates") or []
    if re.fullmatch(r"\d{1,2}", value):
        idx = int(value) - 1
        if 0 <= idx < len(candidates):
            return candidates[idx]
    for candidate in candidates:
        if value == candidate:
            return candidate
    return None


def render_ask_user_text(base_text, event, include_buttons=False):
    question = str((event or {}).get("question") or "请选择下一步操作：").strip()
    candidates = (event or {}).get("candidates") or []
    lines = []
    if base_text:
        lines.append(str(base_text).rstrip())
        lines.append("")
    lines.append(f"**{question}**")
    lines.append("")
    lines.append("请点击按钮，或直接回复序号/完整选项文字：" if include_buttons
                 else "请直接回复序号或完整选项文字：")
    for idx, candidate in enumerate(candidates, 1):
        lines.append(f"{idx}. {candidate}")
    return "\n".join(lines).strip()


def build_ask_user_elements(base_text, event, menu_id=None, include_buttons=True):
    content = render_ask_user_text(base_text, event, include_buttons=include_buttons and bool(menu_id))
    elements = [{"tag": "markdown", "content": content}]
    if include_buttons and menu_id:
        for idx, candidate in enumerate(event.get("candidates") or []):
            label = f"{idx + 1}. {candidate}"
            if len(label) > 80:
                label = label[:77] + "..."
            elements.append({
                "tag": "button",
                "text": {"tag": "plain_text", "content": label},
                "type": "primary" if idx == 0 else "default",
                "value": {
                    "penglai_action": "ask_user",
                    "menu_id": menu_id,
                    "index": idx,
                },
            })
    return elements
