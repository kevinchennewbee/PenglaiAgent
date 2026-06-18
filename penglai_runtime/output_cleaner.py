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
_INTERNAL_TAGS = ("think", "thinking", "summary", "tool_use", "file_content")
_TAG_NAMES_RE = "|".join(_INTERNAL_TAGS)
_TAG_RE = re.compile(
    rf"<(?P<tag>{_TAG_NAMES_RE})(?:\s[^>]*)?>.*?</(?P=tag)>",
    re.DOTALL | re.IGNORECASE,
)
_OPEN_TAG_RE = re.compile(rf"<(?:{_TAG_NAMES_RE})(?:\s[^>]*)?>", re.IGNORECASE)
_CLOSE_TAG_RE = re.compile(rf"</(?:{_TAG_NAMES_RE})>", re.IGNORECASE)
_SUMMARY_RE = re.compile(r"<summary>\s*(.*?)\s*</summary>", re.DOTALL)


def extract_latest_summary(text, *, limit=500):
    matches = _SUMMARY_RE.findall(str(text or ""))
    if not matches:
        return ""
    value = re.sub(r"\s+", " ", matches[-1]).strip()
    return value[:limit]


def has_internal_markup(text):
    value = str(text or "")
    return bool(_OPEN_TAG_RE.search(value) or _CLOSE_TAG_RE.search(value))


def _strip_internal_markup(text):
    value = str(text or "")
    prev = None
    while prev != value:
        prev = value
        value = _TAG_RE.sub("", value)
    match = _OPEN_TAG_RE.search(value)
    if match:
        value = value[:match.start()]
    value = _CLOSE_TAG_RE.sub("", value)
    return value


def clean_final_text(text, *, strip_file_markers=False):
    """Return concise text suitable for IM delivery.

    File markers are kept by default because DeliveryService needs to inspect
    them before channel adapters remove or render them.
    """
    value = _strip_internal_markup(text)
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
