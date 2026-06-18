# -*- coding: utf-8 -*-
"""Feishu ask_user helpers for Penglai's wrapper layer.

GA exposes ask_user as an EXITED/HUMAN_INTERVENTION payload.  The upstream
Feishu frontend renders only the final text, so Penglai adds a channel-side
adapter that makes the question and choices visible without changing GA core.
"""
from penglai_runtime.interaction import (
    callback_value,
    normalize_options,
    render_interaction_text,
    request_from_ask_user_event,
    resolve_interaction_choice,
)


def normalize_candidates(raw):
    return [option.display for option in normalize_options(raw)]


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
    options = normalize_options(data.get("candidates") or [])
    if not options:
        return None
    question = str(data.get("question") or "请选择下一步操作：").strip() or "请选择下一步操作："
    candidates = [
        (
            {"label": opt.label, "value": opt.value, "description": opt.description}
            if opt.description or (opt.value and opt.value != opt.label)
            else opt.label
        )
        for opt in options
    ]
    return {"question": question, "candidates": candidates}


def resolve_choice(text, event):
    """Map a manual Feishu reply to a candidate.

    Accepts 1-based numbers and exact candidate text.  Returns None when the
    message is not intended as a choice so normal chat can continue.
    """
    if not event:
        return None
    return resolve_interaction_choice(text, request_from_ask_user_event(event, request_id="manual"))


def render_ask_user_text(base_text, event, include_buttons=False):
    request = request_from_ask_user_event(event, request_id="manual")
    lines = []
    if base_text:
        lines.append(str(base_text).rstrip())
        lines.append("")
    lines.append(render_interaction_text(request, include_click_hint=include_buttons))
    return "\n".join(lines).strip()


def build_ask_user_elements(base_text, event, menu_id=None, include_buttons=True):
    request = request_from_ask_user_event(event, request_id=menu_id or "")
    content = render_ask_user_text(base_text, event, include_buttons=include_buttons and bool(menu_id))
    elements = [{"tag": "markdown", "content": content}]
    if include_buttons and menu_id:
        for idx, option in enumerate(request.options):
            label = f"{idx + 1}. {option.display}"
            if len(label) > 80:
                label = label[:77] + "..."
            elements.append({
                "tag": "button",
                "text": {"tag": "plain_text", "content": label},
                "type": "primary" if idx == 0 else "default",
                "behaviors": [{
                    "type": "callback",
                    "value": callback_value(request.request_id, idx),
                }],
            })
    return elements
