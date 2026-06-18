# -*- coding: utf-8 -*-
"""Shared Penglai artifact handling for IM outbound files.

The LLM may mention the control syntax in prose, for example `[FILE:...]`.
Only real local artifacts should be sent; examples and placeholders are ignored.
"""
from dataclasses import dataclass
import os
import re

BLOCKED_OUTBOUND_SUFFIXES = (".py", ".env", ".key", ".sh", ".pem")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".tiff", ".tif"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg"}
AUDIO_EXTS = {".opus", ".mp3", ".wav", ".m4a", ".aac", ".flac"}

_FILE_RE = re.compile(r"\[FILE:([^\]\r\n]+)(?:\]|(?=\r?\n)|$)")
_PLACEHOLDERS = {
    "...", "filepath", "<filepath>", "file_path", "<file_path>",
    "path", "<path>", "/path/to/file", "/path/to/file.ext",
    "/absolute/path", "/absolute/path/to/file",
}
_CODELIKE_CHARS = set("[]{}*?|")


@dataclass(frozen=True)
class Artifact:
    raw: str
    path: str
    realpath: str
    status: str       # allowed | blocked | missing | ignored
    reason: str
    kind: str         # image | video | audio | file | unknown


def strip_file_markers(text):
    return _FILE_RE.sub("", text or "").strip()


def file_markers(text):
    return [m.strip().strip("\"'") for m in _FILE_RE.findall(text or "")]


def artifact_kind(path):
    ext = os.path.splitext(str(path))[1].lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    return "file" if ext else "unknown"


def is_sensitive_suffix(path):
    return os.path.basename(str(path)).lower().endswith(BLOCKED_OUTBOUND_SUFFIXES)


def is_outbound_allowed(file_path):
    try:
        rp = os.path.realpath(os.path.expanduser(str(file_path)))
    except Exception:
        return False, "路径解析失败", None
    if not os.path.isfile(rp):
        return False, "文件不存在", None
    if is_sensitive_suffix(rp):
        return False, "敏感后缀文件禁止自动外发", None
    return True, "", rp


def _looks_pathlike(marker):
    if not marker:
        return False
    expanded = os.path.expanduser(marker)
    if os.path.isabs(expanded) or marker.startswith("~"):
        return True
    if "/" in marker or "\\" in marker:
        return True
    return bool(os.path.splitext(marker)[1])


def _is_placeholder(marker):
    s = (marker or "").strip()
    low = s.lower()
    if low in _PLACEHOLDERS:
        return True
    if low.startswith(("/path/", "/absolute/", "/your/")):
        return True
    if s.startswith("<") and s.endswith(">"):
        return True
    return False


def _resolve(marker, base_dir=None):
    expanded = os.path.expanduser(marker)
    if os.path.isabs(expanded):
        return expanded
    if base_dir:
        base = os.path.realpath(os.path.expanduser(str(base_dir)))
        candidates = [os.path.join(base, expanded)]
        norm = os.path.normpath(expanded)
        base_name = os.path.basename(base)
        if norm == base_name or norm.startswith(base_name + os.sep):
            candidates.append(os.path.join(os.path.dirname(base), norm))
        for candidate in candidates:
            if os.path.isfile(os.path.realpath(candidate)):
                return candidate
        return candidates[0]
    return expanded


def classify_file_markers(text, base_dir=None, exclude_paths=None):
    """Return unique Artifact records for every `[FILE:...]` marker.

    `ignored` entries are intentional non-files such as placeholders or code
    examples. They should not be shown to the user as security warnings.
    """
    exclude = {os.path.realpath(os.path.expanduser(str(p))) for p in (exclude_paths or []) if p}
    out, seen = [], set()
    for raw in file_markers(text):
        marker = raw.strip()
        resolved = _resolve(marker, base_dir)
        exists = os.path.isfile(os.path.realpath(resolved))

        if _is_placeholder(marker) or (not exists and not _looks_pathlike(marker)):
            art = Artifact(raw, marker, "", "ignored", "占位符", "unknown")
        elif not exists and any(ch in marker for ch in _CODELIKE_CHARS):
            art = Artifact(raw, marker, "", "ignored", "示例或代码片段", "unknown")
        else:
            ok, why, rp = is_outbound_allowed(resolved)
            if ok and rp in exclude:
                art = Artifact(raw, resolved, rp, "ignored", "入站文件", artifact_kind(rp))
            elif ok:
                art = Artifact(raw, resolved, rp, "allowed", "", artifact_kind(rp))
            else:
                status = "blocked" if why != "文件不存在" else "missing"
                art = Artifact(raw, resolved, "", status, why, artifact_kind(resolved))

        key = art.realpath or f"{art.status}:{art.path}"
        if key in seen:
            continue
        seen.add(key)
        out.append(art)
    return out


def allowed_paths(text, base_dir=None, exclude_paths=None):
    return [a.realpath for a in classify_file_markers(text, base_dir, exclude_paths)
            if a.status == "allowed"]


def blocked_artifacts(text, base_dir=None, exclude_paths=None):
    return [a for a in classify_file_markers(text, base_dir, exclude_paths)
            if a.status in ("blocked", "missing")]


def summarize_blocked(blocked):
    by_reason = {}
    for art in blocked:
        by_reason[art.reason] = by_reason.get(art.reason, 0) + 1
    reasons = "；".join(f"{why} {n} 个" for why, n in by_reason.items())
    examples = "；".join(
        f"{os.path.basename(str(a.path)) or str(a.raw)}（{a.reason}）"
        for a in blocked[:3]
    )
    if len(blocked) > 3:
        examples += f"；另 {len(blocked) - 3} 个"
    return reasons, examples
