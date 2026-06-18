# -*- coding: utf-8 -*-
"""Outbound artifact planning for the V5 runtime test surface."""

from dataclasses import dataclass
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
class DeliveryPlan:
    original_text: str
    body: str
    allowed: Tuple[Artifact, ...]
    blocked: Tuple[Artifact, ...]
    missing: Tuple[Artifact, ...]
    ignored: Tuple[Artifact, ...]

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
    )
