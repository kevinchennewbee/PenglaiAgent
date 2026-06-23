# -*- coding: utf-8 -*-
"""Single source of truth for Penglai release identity."""

from __future__ import annotations

import os
import json
import platform
import subprocess
import sys
from dataclasses import dataclass, asdict

try:
    import tomllib
except Exception:  # pragma: no cover - Python <3.11 fallback
    tomllib = None


ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
BUILD_INFO_FILENAME = ".penglai-build.json"


def _run_git(args, *, root=ROOT, timeout=5):
    try:
        return subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception:
        return subprocess.CompletedProcess(["git", *args], 1, "", "")


def _read_project_version(root=ROOT):
    candidates = (
        os.path.join(root, "installer", "pyproject.toml"),
        os.path.join(root, "pyproject.toml"),
    )
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            raw = open(path, "rb").read()
            if tomllib:
                data = tomllib.loads(raw.decode("utf-8"))
                version = data.get("project", {}).get("version")
                if version:
                    return str(version)
            text = raw.decode("utf-8", "replace")
            for line in text.splitlines():
                if line.strip().startswith("version"):
                    return line.split("=", 1)[1].strip().strip("\"'")
        except Exception:
            continue
    return "unknown"


def _release_remote(root=ROOT):
    preferred = os.environ.get("PENGLAI_RELEASE_REMOTE", "").strip()
    names = [preferred] if preferred else []
    names.extend(["release", "origin", "upstream"])
    seen = set()
    for name in names:
        if not name or name in seen:
            continue
        seen.add(name)
        r = _run_git(["remote", "get-url", name], root=root)
        url = (r.stdout or "").strip()
        if r.returncode == 0 and url:
            return name, url
    return "", ""


def _read_build_info(root=ROOT):
    path = os.path.join(root, BUILD_INFO_FILENAME)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _info_str(data, key):
    value = data.get(key)
    if value is None:
        return ""
    return str(value).strip()


def _info_bool(data, key):
    value = data.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _python_version(path):
    try:
        r = subprocess.run(
            [path, "-c", "import sys; print(sys.version.split()[0])"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0:
            return (r.stdout or "").strip()
    except Exception:
        pass
    return ""


@dataclass(frozen=True)
class VersionMetadata:
    version: str
    runtime_version: str
    commit: str
    branch: str
    dirty: bool
    source: str
    remote: str
    remote_url: str
    docker: bool
    build_commit: str
    build_time: str
    image_tag: str
    python: str
    service_python: str
    platform: str

    def to_dict(self):
        return asdict(self)


def collect_version_metadata(root=ROOT):
    try:
        from penglai_runtime import VERSION as runtime_version
    except Exception:
        runtime_version = ""

    build_info = _read_build_info(root)
    commit = _info_str(build_info, "commit") or os.environ.get("PENGLAI_BUILD_COMMIT", "").strip()
    branch = _info_str(build_info, "branch") or os.environ.get("PENGLAI_BUILD_BRANCH", "").strip()
    dirty = _info_bool(build_info, "dirty")
    if _run_git(["rev-parse", "--is-inside-work-tree"], root=root).stdout.strip() == "true":
        commit = _run_git(["rev-parse", "--short=12", "HEAD"], root=root).stdout.strip() or commit
        branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], root=root).stdout.strip() or branch
        dirty = bool(_run_git(["status", "--porcelain"], root=root).stdout.strip())
    remote, remote_url = _release_remote(root=root)
    remote = remote or _info_str(build_info, "remote")
    remote_url = remote_url or _info_str(build_info, "remote_url")
    docker = os.environ.get("PENGLAI_DOCKER") == "1" or os.path.exists("/.dockerenv")
    source = _info_str(build_info, "source") or os.environ.get("PENGLAI_INSTALL_SOURCE", "").strip()
    if not source:
        source = "docker" if docker else ("git" if commit else "source")
    service_py = os.path.join(root, ".venv", "bin", "python")
    service_python = _python_version(service_py) if os.path.exists(service_py) else sys.version.split()[0]
    build_commit = _info_str(build_info, "build_commit") or _info_str(build_info, "commit") or os.environ.get("PENGLAI_BUILD_COMMIT", "").strip()
    build_time = _info_str(build_info, "build_time") or os.environ.get("PENGLAI_BUILD_TIME", "").strip()
    image_tag = _info_str(build_info, "image_tag") or os.environ.get("PENGLAI_IMAGE_TAG", "").strip()
    return VersionMetadata(
        version=_read_project_version(root),
        runtime_version=runtime_version,
        commit=commit or "unknown",
        branch=branch or "unknown",
        dirty=dirty,
        source=source,
        remote=remote,
        remote_url=remote_url,
        docker=docker,
        build_commit=build_commit,
        build_time=build_time,
        image_tag=image_tag,
        python=sys.version.split()[0],
        service_python=service_python,
        platform=platform.platform(),
    )


def format_version_text(meta=None):
    meta = meta or collect_version_metadata()
    dirty = " dirty" if meta.dirty else ""
    lines = [
        f"Penglai {meta.version} ({meta.runtime_version or 'runtime unknown'})",
        f"source={meta.source} branch={meta.branch} commit={meta.commit}{dirty}",
        f"remote={meta.remote or 'none'} {meta.remote_url}".rstrip(),
    ]
    if meta.docker or meta.image_tag or meta.build_commit or meta.build_time:
        lines.append(
            "docker="
            + ("yes" if meta.docker else "no")
            + f" image={meta.image_tag or 'unknown'} build_commit={meta.build_commit or 'unknown'} build_time={meta.build_time or 'unknown'}"
        )
    lines.append(f"python={meta.python} service_python={meta.service_python} platform={meta.platform}")
    return "\n".join(lines)


def compact_version_line(meta=None):
    meta = meta or collect_version_metadata()
    dirty = "+" if meta.dirty else ""
    return f"Penglai {meta.version} / {meta.runtime_version or 'runtime unknown'} / {meta.branch}@{meta.commit}{dirty}"
