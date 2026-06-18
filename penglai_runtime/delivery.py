# -*- coding: utf-8 -*-
"""Outbound artifact planning for the V5 runtime test surface."""

from dataclasses import dataclass, field
import re
from typing import Tuple

from plugins.penglai_artifacts import (
    Artifact,
    classify_file_markers,
    strip_file_markers,
    summarize_blocked,
)

from .output_cleaner import clean_final_text


@dataclass(frozen=True)
class ExternalDeliveryEvidence:
    delivered: bool
    reason: str = ""
    message_ids: Tuple[str, ...] = ()
    file_keys: Tuple[str, ...] = ()


@dataclass(frozen=True)
class DeliveryPlan:
    original_text: str
    body: str
    allowed: Tuple[Artifact, ...]
    blocked: Tuple[Artifact, ...]
    missing: Tuple[Artifact, ...]
    ignored: Tuple[Artifact, ...]
    external_delivery: ExternalDeliveryEvidence = field(
        default_factory=lambda: ExternalDeliveryEvidence(False)
    )

    @property
    def allowed_paths(self):
        return tuple(a.realpath for a in self.allowed)

    @property
    def has_work(self):
        return bool(self.body or self.allowed or self.blocked)

    @property
    def withheld(self):
        return self.blocked + self.missing

    def blocked_notice(self, *, sent_count=0):
        withheld = self.withheld
        if not withheld:
            return ""
        reasons, examples = summarize_blocked(withheld)
        sent = f"已发送 {sent_count} 个安全文件；" if sent_count else ""
        return f"⛔ 蓬莱安全策略：{sent}{len(withheld)} 个文件未外发（{reasons}）。\n{examples}"

    def user_text(self, *, sent_count=0):
        parts = []
        if self.body:
            parts.append(self.body)
        notice = self.blocked_notice(sent_count=sent_count)
        if notice:
            parts.append(notice)
        return "\n\n".join(parts).strip()


_MESSAGE_ID_RE = re.compile(r"\b(?:message_id\s*[:：]?\s*)?(om_[A-Za-z0-9_-]{8,})\b")
_FILE_KEY_RE = re.compile(r"\b(?:file_key\s*[:：]?\s*)?((?:file|img|media|audio)_v\d+_[A-Za-z0-9_-]{8,})\b")
_DELIVERY_SUCCESS_RE = re.compile(r"(发送成功|成功发出|已通过.*?API.*?发|message_id\s*[:：]|code\s*=\s*0|回执)")


def detect_external_delivery(text):
    """Detect when a model already sent via an IM/vendor API.

    This is deliberately conservative: a message id alone is not enough. We need
    a send-success signal plus a vendor receipt shape, so normal prose mentioning
    ids does not suppress Penglai's own delivery.
    """
    raw = str(text or "")
    message_ids = tuple(dict.fromkeys(_MESSAGE_ID_RE.findall(raw)))
    file_keys = tuple(dict.fromkeys(_FILE_KEY_RE.findall(raw)))
    has_success = bool(_DELIVERY_SUCCESS_RE.search(raw))
    delivered = bool(has_success and message_ids and (file_keys or "code=0" in raw or "code = 0" in raw))
    reason = "external_api_receipt" if delivered else ""
    return ExternalDeliveryEvidence(
        delivered=delivered,
        reason=reason,
        message_ids=message_ids,
        file_keys=file_keys,
    )


def plan_delivery(text, *, base_dir=None, exclude_paths=None):
    """Plan text and files without sending anything."""
    cleaned = clean_final_text(text)
    artifacts = tuple(classify_file_markers(
        cleaned,
        base_dir=base_dir,
        exclude_paths=exclude_paths or (),
    ))
    allowed = tuple(a for a in artifacts if a.status == "allowed")
    blocked = tuple(a for a in artifacts if a.status == "blocked")
    missing = tuple(a for a in artifacts if a.status == "missing")
    ignored = tuple(a for a in artifacts if a.status == "ignored")
    body = re.sub(r"\n{3,}", "\n\n", strip_file_markers(cleaned)).strip()
    return DeliveryPlan(
        original_text=str(text or ""),
        body=body,
        allowed=allowed,
        blocked=blocked,
        missing=missing,
        ignored=ignored,
        external_delivery=detect_external_delivery(cleaned),
    )
