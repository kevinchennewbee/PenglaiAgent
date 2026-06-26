# -*- coding: utf-8 -*-
"""Low-side-effect privacy and pre-release audit for Penglai."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import asdict, dataclass


ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


PRIVATE_EXACT_PATHS = {
    ".env",
    "auth.json",
    "model_responses.txt",
    "mykey.py",
    "mykey.json",
    "memory/global_mem.txt",
    "memory/global_mem_insight.txt",
    "temp/runtime_hub.token",
    "temp/runtime_hub.sqlite3",
}

PRIVATE_PREFIXES = (
    "_internal/",
    ".internal/",
    "temp/",
    "tmp/",
    "audit/",
    "tasks/",
    ".claude/",
    ".codex/",
    "penglai-migrate-backup-",
)

PRIVATE_SUFFIXES = (
    ".log",
    ".sqlite",
    ".sqlite3",
    ".db",
    ".pid",
)

SKIP_CONTENT_PREFIXES = (
    ".git/",
    ".venv/",
    "venv/",
    "env/",
    "node_modules/",
    "build/",
    "dist/",
    "temp/",
    "tmp/",
    "audit/",
    "_internal/",
    ".internal/",
)

SKIP_CONTENT_SUFFIXES = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".pyc",
    ".sqlite",
    ".sqlite3",
    ".db",
)

SECRET_RULES = (
    (
        "openai_style_key",
        re.compile(r"\b(?:sk|sk-proj|sk-ant|sk-or)-[A-Za-z0-9_\-]{20,}\b"),
    ),
    (
        "bearer_token",
        re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b", re.I),
    ),
    (
        "assigned_secret",
        re.compile(
            r"(?i)\b(api[_-]?key|apikey|secret|token|password|access[_-]?key|"
            r"secret[_-]?key|app[_-]?secret|client[_-]?secret)\b\s*[:=]\s*"
            r"['\"][A-Za-z0-9_./+=-]{16,}['\"]?"
        ),
    ),
)


@dataclass(frozen=True)
class Finding:
    item_id: str
    priority: str
    category: str
    status: str
    path: str
    reason: str
    detail: str = ""

    def to_dict(self):
        return asdict(self)


def _run_git(args, *, root=ROOT):
    cmd = ["git", "-C", root] + list(args)
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except Exception as exc:
        return subprocess.CompletedProcess(cmd, 1, "", str(exc))


def _split_nul(text):
    return [part for part in (text or "").split("\0") if part]


def _norm_rel(path):
    rel = str(path or "").replace("\\", "/").lstrip("./")
    while rel.startswith("../"):
        rel = rel[3:]
    return rel


def classify_private_path(path):
    rel = _norm_rel(path)
    base = os.path.basename(rel)
    if rel in PRIVATE_EXACT_PATHS or base in {"mykey.py", "mykey.json", ".env"}:
        return "private_config_or_runtime_secret"
    if rel.endswith(".bak") and base.startswith("mykey.py"):
        return "private_config_backup"
    if any(rel.startswith(prefix) for prefix in PRIVATE_PREFIXES):
        return "local_runtime_or_internal_path"
    if any(rel.endswith(suffix) for suffix in PRIVATE_SUFFIXES):
        return "runtime_log_or_state"
    if rel.startswith("memory/") and rel not in {
        "memory/memory_management_sop.md",
        "memory/web_setup_sop.md",
    }:
        if rel.endswith(".jsonl") or "/archive" in rel or "/raw" in rel:
            return "runtime_memory_artifact"
    return ""


def _content_scan_allowed(rel):
    rel = _norm_rel(rel)
    if any(rel.startswith(prefix) for prefix in SKIP_CONTENT_PREFIXES):
        return False
    if any(rel.lower().endswith(suffix) for suffix in SKIP_CONTENT_SUFFIXES):
        return False
    return True


def scan_text_for_secrets(text):
    findings = []
    for line_no, line in enumerate(str(text or "").splitlines(), start=1):
        for rule_id, pattern in SECRET_RULES:
            if pattern.search(line):
                findings.append({"rule_id": rule_id, "line": line_no})
                break
    return findings


def scan_file_for_secrets(path, *, max_bytes=512 * 1024):
    try:
        if os.path.getsize(path) > max_bytes:
            return []
        with open(path, "rb") as f:
            raw = f.read(max_bytes + 1)
    except OSError:
        return []
    if b"\0" in raw:
        return []
    text = raw.decode("utf-8", errors="replace")
    return scan_text_for_secrets(text)


def _git_available(root):
    r = _run_git(["rev-parse", "--is-inside-work-tree"], root=root)
    return r.returncode == 0 and (r.stdout or "").strip() == "true"


def _git_list(args, *, root):
    r = _run_git(args + ["-z"], root=root)
    if r.returncode != 0:
        return []
    return _split_nul(r.stdout)


def _dirty_count(root):
    r = _run_git(["status", "--porcelain"], root=root)
    if r.returncode != 0:
        return 0
    return len([line for line in (r.stdout or "").splitlines() if line.strip()])


def _git_value(args, *, root):
    r = _run_git(args, root=root)
    return (r.stdout or "").strip() if r.returncode == 0 else ""


def audit(
    *,
    root=ROOT,
    include_ignored=True,
    scan_ignored=False,
    strict_release=False,
    max_file_bytes=512 * 1024,
):
    """Return a structured privacy and pre-release audit.

    The default mode fails only for privacy blockers.  Release blockers are
    reported separately so local preview work can proceed without
    pretending the branch is publishable.
    """
    root = os.path.realpath(root)
    findings = []
    git_ok = _git_available(root)
    tracked = []
    untracked = []
    ignored = []

    if git_ok:
        tracked = _git_list(["ls-files"], root=root)
        untracked = _git_list(["ls-files", "--others", "--exclude-standard"], root=root)
        if include_ignored:
            ignored = _git_list(
                ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
                root=root,
            )
    else:
        findings.append(Finding(
            "git_unavailable",
            "P1",
            "release",
            "release_blocker_before_publish",
            ".",
            "发布前隐私审计需要 git 工作区，才能确认实际会发布哪些文件。",
        ))

    for rel in tracked:
        kind = classify_private_path(rel)
        if kind:
            findings.append(Finding(
                "tracked_private_path",
                "P0",
                "privacy",
                "privacy_blocker",
                rel,
                "私有 runtime/config 路径已被 git 跟踪，发布时会被带出。",
                kind,
            ))

    for rel in untracked:
        kind = classify_private_path(rel)
        if kind:
            findings.append(Finding(
                "untracked_private_path",
                "P1",
                "privacy",
                "local_private_untracked",
                rel,
                "本地私有 runtime/config 路径未被跟踪；需要继续排除在发布产物外。",
                kind,
            ))

    for rel in ignored:
        kind = classify_private_path(rel)
        if kind:
            findings.append(Finding(
                "ignored_private_path",
                "observe",
                "privacy",
                "local_ignored_private",
                rel,
                "本地存在 ignored 私有/runtime 路径，当前已排除在 git 外。",
                kind,
            ))

    scan_paths = list(dict.fromkeys(tracked + untracked + (ignored if scan_ignored else [])))
    for rel in scan_paths:
        rel = _norm_rel(rel)
        if not _content_scan_allowed(rel):
            continue
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            continue
        hits = scan_file_for_secrets(path, max_bytes=max_file_bytes)
        for hit in hits:
            is_ignored = rel in ignored
            is_tracked = rel in tracked
            status = "local_ignored_secret" if is_ignored and not is_tracked else "privacy_blocker"
            findings.append(Finding(
                "content_secret_match",
                "P0" if status == "privacy_blocker" else "observe",
                "privacy",
                status,
                rel,
                "内容扫描命中疑似密钥值；具体值已故意不打印。",
                f"{hit['rule_id']}:第 {hit['line']} 行",
            ))

    dirty = _dirty_count(root) if git_ok else 0
    if dirty:
        findings.append(Finding(
            "dirty_worktree",
            "P1",
            "release",
            "release_blocker_before_publish",
            ".",
            "工作区存在本地改动；任何发布前都必须先完成、暂存并复核。",
            f"{dirty} 个改动路径",
        ))

    try:
        from .deprecations import audit as legacy_audit

        legacy = legacy_audit(root=root, include_runtime=False)
        for item in legacy.get("items", []):
            if item.get("status") == "release_blocker_before_public_docs":
                findings.append(Finding(
                    item.get("item_id", "release_legacy_surface"),
                    item.get("priority", "P1"),
                    "release",
                    "release_blocker_before_publish",
                    item.get("legacy", ""),
                    item.get("reason", ""),
                    item.get("replacement", ""),
                ))
    except Exception as exc:
        findings.append(Finding(
            "release_legacy_audit_error",
            "P1",
            "release",
            "release_blocker_before_publish",
            ".",
            "无法运行旧发布面审计。",
            str(exc),
        ))

    data_findings = [item.to_dict() for item in findings]
    privacy_blockers = [item for item in data_findings if item["status"] == "privacy_blocker"]
    release_blockers = [item for item in data_findings if item["status"] == "release_blocker_before_publish"]
    privacy_ok = not privacy_blockers
    release_ready = privacy_ok and not release_blockers
    ok = release_ready if strict_release else privacy_ok

    return {
        "ok": ok,
        "privacy_ok": privacy_ok,
        "release_ready": release_ready,
        "strict_release": bool(strict_release),
        "privacy_blocker_count": len(privacy_blockers),
        "release_blocker_count": len(release_blockers),
        "finding_count": len(data_findings),
        "git": {
            "available": git_ok,
            "branch": _git_value(["rev-parse", "--abbrev-ref", "HEAD"], root=root) if git_ok else "",
            "head": _git_value(["rev-parse", "--short", "HEAD"], root=root) if git_ok else "",
            "dirty_count": dirty,
            "tracked_count": len(tracked),
            "untracked_count": len(untracked),
            "ignored_count": len(ignored),
        },
        "findings": data_findings,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="审计蓬莱隐私与发布前卫生")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--strict-release", action="store_true", help="存在发布阻断项时返回非零")
    parser.add_argument("--no-ignored", action="store_true", help="跳过 ignored 路径清单")
    parser.add_argument("--scan-ignored", action="store_true", help="同时扫描 ignored 本地文件内容")
    args = parser.parse_args(argv)

    data = audit(
        include_ignored=not args.no_ignored,
        scan_ignored=args.scan_ignored,
        strict_release=args.strict_release,
    )
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"隐私审计：{'通过' if data['privacy_ok'] else '阻断'}")
        print(f"发布就绪：{'是' if data['release_ready'] else '否'}")
        print(
            f"隐私阻断项：{data['privacy_blocker_count']}；"
            f"发布阻断项：{data['release_blocker_count']}；"
            f"发现项：{data['finding_count']}"
        )
        for item in data["findings"]:
            print(f"- {item['priority']} {item['item_id']}: {item['status']} {item['path']}")
            if item.get("detail"):
                print(f"  详情：{item['detail']}")
            print(f"  原因：{item['reason']}")
    return 0 if data["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
