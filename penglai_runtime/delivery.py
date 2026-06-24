# -*- coding: utf-8 -*-
"""Outbound artifact planning and execution for the Penglai runtime surface."""

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


@dataclass(frozen=True)
class DeliveryResult:
    plan: DeliveryPlan
    sent_paths: Tuple[str, ...] = ()
    failed_paths: Tuple[str, ...] = ()
    skipped_paths: Tuple[str, ...] = ()
    notice: str = ""
    sent_body: bool = False

    @property
    def sent_count(self):
        return len(self.sent_paths) + len(self.skipped_paths)


_MESSAGE_ID_RE = re.compile(r"\b(?:message_id\s*[:：]?\s*)?(om_[A-Za-z0-9_-]{8,})\b")
_FILE_KEY_RE = re.compile(r"\b(?:file_key\s*[:：]?\s*)?((?:file|img|media|audio)_v\d+_[A-Za-z0-9_-]{8,})\b")
_DELIVERY_SUCCESS_RE = re.compile(
    r"(发送成功|成功发出|已通过.*?API.*?发|message_id\s*[:：]|code\s*=\s*0|回执)"
)
_STRONG_DELIVERY_SUCCESS_RE = re.compile(
    r"(已发送|已发到|已发给|已投递|已投递到|三步全过|"
    r"send\s+status\s+200|send\s+200|飞书消息已投递|消息已投递)",
    re.I,
)


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
    has_code_zero = bool(re.search(r"(?:code\s*[=:]\s*0|[\"']code[\"']\s*:\s*0)", raw, re.I))
    has_strong_success = bool(_STRONG_DELIVERY_SUCCESS_RE.search(raw))
    delivered = bool(has_success and message_ids and (file_keys or has_code_zero or has_strong_success))
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


class DeliveryService:
    """Execute a delivery plan through channel-specific callbacks.

    IM adapters should provide small callbacks for their own transport while
    keeping Penglai's file-marker parsing, duplicate suppression, and blocked
    notice policy in this shared layer.
    """

    def __init__(self, *, send_file=None, send_text=None, send_audio=None, audit=None):
        self.send_file = send_file
        self.send_text = send_text
        self.send_audio = send_audio
        self.audit = audit

    def deliver(
        self,
        text,
        *,
        base_dir=None,
        exclude_paths=None,
        send_body=True,
        send_notice=True,
    ):
        plan = plan_delivery(text, base_dir=base_dir, exclude_paths=exclude_paths)
        sent_body = False
        sent_paths = []
        failed_paths = []
        skipped_paths = []

        if send_body and plan.body:
            sent_body = self._send_text(plan.body)

        if plan.external_delivery.delivered and plan.allowed:
            skipped_paths = [a.realpath for a in plan.allowed]
            self._audit(
                "send_files",
                {"skipped": len(skipped_paths), "reason": plan.external_delivery.reason},
                blocked=False,
                reason="外部 API 已交付，跳过蓬莱重复外发",
            )
        else:
            for art in plan.allowed:
                if self._send_artifact(art):
                    sent_paths.append(art.realpath)
                else:
                    failed_paths.append(art.realpath)

        notice = plan.blocked_notice(sent_count=len(sent_paths) + len(skipped_paths))
        if notice:
            self._audit(
                "send_files",
                {
                    "blocked": len(plan.withheld),
                    "sent": len(sent_paths),
                    "skipped": len(skipped_paths),
                },
                blocked=True,
                reason="批量外发预检拦截",
            )
            if send_notice:
                self._send_text(notice)

        return DeliveryResult(
            plan=plan,
            sent_paths=tuple(sent_paths),
            failed_paths=tuple(failed_paths),
            skipped_paths=tuple(skipped_paths),
            notice=notice,
            sent_body=sent_body,
        )

    def _send_file(self, path):
        if not callable(self.send_file):
            return False
        try:
            return bool(self.send_file(path))
        except Exception:
            return False

    def _send_audio(self, path):
        if not callable(self.send_audio):
            return False
        try:
            return bool(self.send_audio(path))
        except Exception:
            return False

    def _send_artifact(self, artifact):
        if artifact.kind == "audio" and self._send_audio(artifact.realpath):
            return True
        return self._send_file(artifact.realpath)

    def _send_text(self, text):
        if not callable(self.send_text):
            return False
        try:
            return bool(self.send_text(text))
        except Exception:
            return False

    def _audit(self, event, payload, *, blocked=False, reason=""):
        if not callable(self.audit):
            return
        try:
            self.audit(event, payload, blocked=blocked, reason=reason)
        except Exception:
            pass
