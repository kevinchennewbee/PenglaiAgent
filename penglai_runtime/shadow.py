# -*- coding: utf-8 -*-
"""Shadow-mode audit records for the Penglai runtime.

Shadow mode is deliberately observation-only: it plans what the runtime would do, writes
a privacy-conscious JSONL record, and never sends messages or files.
"""

import hashlib
import json
import os
import time

from .delivery import plan_delivery
from .flags import shadow_enabled
from .output_cleaner import clean_final_text
from .redaction import redact_text


def _root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def default_shadow_log_path():
    return os.path.join(_root(), "temp", "penglai_runtime_shadow.jsonl")


def _hash(value):
    if not value:
        return ""
    return hashlib.sha256(str(value).encode("utf-8", "replace")).hexdigest()[:16]


def _artifact_record(artifact):
    path = artifact.realpath or artifact.path or artifact.raw
    return {
        "name": os.path.basename(str(path)),
        "path_hash": _hash(path),
        "status": artifact.status,
        "reason": artifact.reason,
        "kind": artifact.kind,
    }


def build_delivery_shadow_event(
    channel,
    raw_text,
    *,
    receive_id="",
    receive_id_type="",
    base_dir=None,
    exclude_paths=None,
    production_text=None,
):
    plan = plan_delivery(raw_text, base_dir=base_dir, exclude_paths=exclude_paths)
    clean_body = clean_final_text(raw_text, strip_file_markers=True)
    event = {
        "ts": time.time(),
        "type": "delivery_plan",
        "channel": str(channel or "unknown"),
        "receive_id_hash": _hash(receive_id),
        "receive_id_type": str(receive_id_type or ""),
        "text_preview": redact_text(clean_body)[:500],
        "production_preview": redact_text(production_text)[:500] if production_text is not None else "",
        "body_len": len(plan.body),
        "allowed_count": len(plan.allowed),
        "blocked_count": len(plan.blocked),
        "missing_count": len(plan.missing),
        "ignored_count": len(plan.ignored),
        "external_delivery": plan.external_delivery.delivered,
        "external_delivery_reason": plan.external_delivery.reason,
        "artifacts": [_artifact_record(a) for a in (plan.allowed + plan.blocked + plan.missing)],
    }
    notice = plan.blocked_notice(sent_count=0)
    if notice:
        event["notice_preview"] = redact_text(notice)[:500]
    return event


def write_shadow_event(event, *, log_path=None):
    path = log_path or default_shadow_log_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return path


def record_delivery_shadow(
    channel,
    raw_text,
    *,
    receive_id="",
    receive_id_type="",
    base_dir=None,
    exclude_paths=None,
    production_text=None,
    log_path=None,
    enabled=None,
):
    if enabled is None:
        enabled = shadow_enabled()
    if not enabled:
        return None
    event = build_delivery_shadow_event(
        channel,
        raw_text,
        receive_id=receive_id,
        receive_id_type=receive_id_type,
        base_dir=base_dir,
        exclude_paths=exclude_paths,
        production_text=production_text,
    )
    path = write_shadow_event(event, log_path=log_path)
    event["log_path"] = path
    return event
