# -*- coding: utf-8 -*-
"""Permission request helpers shared by runtime adapters."""

import re

from .contracts import PermissionRequest


def render_permission_text(request, *, include_click_hint=False):
    """Render a PermissionRequest as plain text for low capability channels."""
    if not isinstance(request, PermissionRequest):
        raise TypeError("request must be a PermissionRequest")
    labels = tuple((request.metadata or {}).get("option_labels") or request.options)
    lines = [
        f"**{request.prompt}**",
        "",
        (
            "请点击按钮，或直接回复序号/完整选项文字："
            if include_click_hint and labels else
            "请直接回复序号或完整选项文字："
            if labels else
            "请直接回复："
        ),
    ]
    for idx, option in enumerate(labels, 1):
        lines.append(f"{idx}. {option}")
    return "\n".join(lines).strip()


def permission_payload(request):
    """Return the safe UI payload for a PermissionRequest."""
    if not isinstance(request, PermissionRequest):
        raise TypeError("request must be a PermissionRequest")
    labels = tuple(str(x) for x in ((request.metadata or {}).get("option_labels") or request.options))
    values = tuple(str(x) for x in ((request.metadata or {}).get("option_values") or request.options))
    options = []
    for idx, label in enumerate(labels, 1):
        value = values[idx - 1] if idx - 1 < len(values) else label
        options.append({"index": idx, "label": label, "value": value})
    return {
        "request_id": request.request_id,
        "action": request.action,
        "prompt": request.prompt,
        "options": options,
        "allow_free_text": bool((request.metadata or {}).get("allow_free_text")),
    }


def resolve_permission_choice(text, request):
    """Resolve user text into a PermissionRequest option value."""
    if not isinstance(request, PermissionRequest):
        raise TypeError("request must be a PermissionRequest")
    value = str(text or "").strip()
    if not value:
        return None
    labels = tuple(str(x) for x in ((request.metadata or {}).get("option_labels") or request.options))
    values = tuple(str(x) for x in ((request.metadata or {}).get("option_values") or request.options))
    if re.fullmatch(r"\d{1,2}", value):
        idx = int(value) - 1
        if 0 <= idx < len(values):
            return values[idx]
    if not values:
        return value
    for idx, option in enumerate(values):
        candidates = {option}
        if idx < len(labels):
            candidates.add(labels[idx])
        if idx < len(request.options):
            candidates.add(request.options[idx])
        if value in candidates:
            return option
    return value if (request.metadata or {}).get("allow_free_text") else None
