# -*- coding: utf-8 -*-
"""Shared secret redaction for logs, runtime audits, and IM ingress gates."""

from __future__ import annotations

import json
import re
from typing import Any


_SECRET_VALUE = "***"
_SK_RE = re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9._-]{7,}\b")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}", re.I)
_COMMON_TOKEN_RE = re.compile(
    r"\b(?:ghp|github_pat|xox[baprs]|ya29)\_[A-Za-z0-9._-]{12,}\b"
)
_JSON_KV_RE = re.compile(
    r"(?i)([\"']?(?:api[_\s-]?key|access[_\s-]?token|token|secret|password|"
    r"client_secret|app_secret|tenant_access_token)[\"']?\s*[:=：]\s*[\"'])"
    r"([^\"'\s,;\]\)}]{3,})([\"'])"
)
_BARE_KV_RE = re.compile(
    r"(?i)(\b(?:api[_\s-]?key|access[_\s-]?token|token|secret|password|"
    r"client_secret|app_secret|tenant_access_token)\b\s*[:=：]\s*)"
    r"([^\"'\s,;\]\)}]{3,})"
)


def redact_text(text: Any) -> str:
    """Return text with common API keys and tokens replaced by ``***``."""
    value = str(text or "")
    value = _SK_RE.sub("sk-***", value)
    value = _BEARER_RE.sub("Bearer ***", value)
    value = _COMMON_TOKEN_RE.sub("***", value)
    value = _JSON_KV_RE.sub(lambda m: f"{m.group(1)}{_SECRET_VALUE}{m.group(3)}", value)
    value = _BARE_KV_RE.sub(lambda m: f"{m.group(1)}{_SECRET_VALUE}", value)
    return value


def contains_secret(text: Any) -> bool:
    """Best-effort detection for user-supplied credentials."""
    value = str(text or "")
    return redact_text(value) != value


def redact_obj(value: Any) -> Any:
    """Recursively redact secrets in JSON-like data without changing shape."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {k: redact_obj(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_obj(v) for v in value]
    return value


def redact_json(value: Any, **json_kwargs: Any) -> str:
    return json.dumps(redact_obj(value), ensure_ascii=False, **json_kwargs)

