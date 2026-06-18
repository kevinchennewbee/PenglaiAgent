# -*- coding: utf-8 -*-
"""User-facing output cleanup for Penglai Runtime Hub V5."""

import re

_TURN_MARKER_RE = re.compile(
    r"^\s*\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}\s*$",
    re.MULTILINE,
)
_TOOL_LINE_RE = re.compile(
    r"^\s*(?:🛠️\s+.*?|✅\s*工具.*?|❌\s*工具.*?|STDOUT\b.*?|ERR\b.*?)$",
    re.MULTILINE,
)
_TAG_RE = re.compile(
    r"<(?:thinking|summary|tool_use|file_content)>.*?</(?:thinking|summary|tool_use|file_content)>",
    re.DOTALL,
)
_SUMMARY_RE = re.compile(r"<summary>\s*(.*?)\s*</summary>", re.DOTALL)


def extract_latest_summary(text, *, limit=500):
    matches = _SUMMARY_RE.findall(str(text or ""))
    if not matches:
        return ""
    value = re.sub(r"\s+", " ", matches[-1]).strip()
    return value[:limit]


def clean_final_text(text, *, strip_file_markers=False):
    """Return concise text suitable for IM delivery.

    File markers are kept by default because DeliveryService needs to inspect
    them before channel adapters remove or render them.
    """
    value = str(text or "")
    value = _TAG_RE.sub("", value)
    value = _TURN_MARKER_RE.sub("", value)
    value = _TOOL_LINE_RE.sub("", value)
    if strip_file_markers:
        from plugins.penglai_artifacts import strip_file_markers

        value = strip_file_markers(value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def fallback_final_text(text):
    cleaned = clean_final_text(text, strip_file_markers=True)
    return cleaned if cleaned and cleaned != "..." else ""
