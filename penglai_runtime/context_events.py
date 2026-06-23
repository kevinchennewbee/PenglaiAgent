# -*- coding: utf-8 -*-
"""Small local event log for first-class proactive/context events."""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

from .redaction import redact_obj, redact_text


def _root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def default_context_log_path():
    override = os.environ.get("PENGLAI_CONTEXT_EVENTS_LOG")
    if override:
        return os.path.realpath(os.path.expanduser(override))
    return os.path.join(_root(), "temp", "penglai_context_events.jsonl")


def _hash(value):
    if not value:
        return ""
    return hashlib.sha256(str(value).encode("utf-8", "replace")).hexdigest()[:16]


def append_context_event(kind, text, *, channel="", actor="", metadata=None, log_path=None):
    path = log_path or default_context_log_path()
    event = {
        "ts": time.time(),
        "kind": str(kind or "event"),
        "channel": str(channel or ""),
        "actor_hash": _hash(actor),
        "text": redact_text(text)[:800],
        "metadata": redact_obj(metadata or {}),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return event


def recent_context_events(*, limit=6, max_age_hours=72, log_path=None):
    path = log_path or default_context_log_path()
    if not os.path.exists(path):
        return []
    cutoff = time.time() - max_age_hours * 3600
    events = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    event = json.loads(line)
                except Exception:
                    continue
                if float(event.get("ts", 0) or 0) >= cutoff:
                    events.append(event)
    except Exception:
        return []
    return events[-limit:]


def recent_context_prompt(*, limit=6, max_age_hours=72, log_path=None):
    events = recent_context_events(limit=limit, max_age_hours=max_age_hours, log_path=log_path)
    if not events:
        return ""
    lines = ["[Recent Penglai proactive/context events]"]
    for event in events:
        ts = time.strftime("%Y-%m-%d %H:%M", time.localtime(float(event.get("ts", 0) or 0)))
        kind = event.get("kind", "event")
        channel = event.get("channel") or "local"
        text = str(event.get("text") or "").replace("\n", " ").strip()
        if text:
            lines.append(f"- {ts} {channel}/{kind}: {text[:220]}")
    return "\n".join(lines) if len(lines) > 1 else ""
