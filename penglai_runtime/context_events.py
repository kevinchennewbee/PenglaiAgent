# -*- coding: utf-8 -*-
"""Small local event log for first-class proactive/context events."""

from __future__ import annotations

import hashlib
import json
import os
import time

from .redaction import redact_obj, redact_text
from .private_files import append_private_line, harden_private_file


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


def _metadata(event):
    data = event.get("metadata") if isinstance(event, dict) else None
    return data if isinstance(data, dict) else {}


def _metadata_value(event, key):
    value = event.get(key) if isinstance(event, dict) else ""
    if value not in (None, ""):
        return str(value)
    value = _metadata(event).get(key)
    return str(value) if value not in (None, "") else ""


def _event_session_id(event):
    return _metadata_value(event, "session_id")


def _event_session_scope(event):
    return _metadata_value(event, "session_scope")


def _normalize_scopes(scopes):
    if scopes is None:
        return None
    if isinstance(scopes, str):
        return {scopes} if scopes else set()
    return {str(item) for item in scopes if str(item)}


def append_context_event(
    kind,
    text,
    *,
    channel="",
    actor="",
    metadata=None,
    session_id="",
    session_scope="",
    chat_id="",
    log_path=None,
):
    path = log_path or default_context_log_path()
    safe_metadata = redact_obj(metadata or {})
    session_id = str(session_id or safe_metadata.get("session_id") or "")
    session_scope = str(session_scope or safe_metadata.get("session_scope") or "")
    if session_id:
        safe_metadata.setdefault("session_id", session_id)
    if session_scope:
        safe_metadata.setdefault("session_scope", session_scope)
    event = {
        "ts": time.time(),
        "kind": str(kind or "event"),
        "channel": str(channel or ""),
        "actor_hash": _hash(actor),
        "text": redact_text(text)[:800],
        "metadata": safe_metadata,
    }
    if session_id:
        event["session_id"] = session_id
    if session_scope:
        event["session_scope"] = session_scope
    if chat_id:
        event["chat_hash"] = _hash(chat_id)
    append_private_line(path, json.dumps(event, ensure_ascii=False, sort_keys=True))
    return event


def _matches_boundary(event, *, session_id="", scopes=None, channel="", include_legacy=False):
    if channel and str(event.get("channel") or "") != str(channel):
        return False
    wanted_scopes = _normalize_scopes(scopes)
    event_session_id = _event_session_id(event)
    event_scope = _event_session_scope(event)
    has_context_boundary = bool(event_session_id or event_scope)
    boundary_requested = bool(session_id or wanted_scopes is not None or channel)
    if boundary_requested and not has_context_boundary and not include_legacy:
        return False
    if session_id and has_context_boundary and event_session_id != str(session_id):
        return False
    if session_id and not has_context_boundary and not include_legacy:
        return False
    if wanted_scopes is not None and has_context_boundary and event_scope not in wanted_scopes:
        return False
    if wanted_scopes is not None and not has_context_boundary and not include_legacy:
        return False
    return True


def recent_context_events(
    *,
    limit=6,
    max_age_hours=72,
    log_path=None,
    session_id="",
    scopes=None,
    channel="",
    include_legacy=False,
):
    path = log_path or default_context_log_path()
    if not os.path.exists(path):
        return []
    harden_private_file(path)
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
                    if _matches_boundary(
                        event,
                        session_id=session_id,
                        scopes=scopes,
                        channel=channel,
                        include_legacy=include_legacy,
                    ):
                        events.append(event)
    except Exception:
        return []
    return events[-limit:]


def recent_context_prompt(
    *,
    limit=6,
    max_age_hours=72,
    log_path=None,
    session_id="",
    scopes=None,
    channel="",
    include_legacy=False,
):
    if not (session_id or scopes is not None or channel or include_legacy):
        return ""
    events = recent_context_events(
        limit=limit,
        max_age_hours=max_age_hours,
        log_path=log_path,
        session_id=session_id,
        scopes=scopes,
        channel=channel,
        include_legacy=include_legacy,
    )
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
