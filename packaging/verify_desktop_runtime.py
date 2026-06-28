#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verify a desktop-bundled Penglai runtime payload."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
from pathlib import Path


PRIVATE_BASENAMES = {".env", "mykey.py", "mykey.json", "auth.json"}
PRIVATE_PARTS = {"_internal", ".git", "secrets", "temp", "tmp", "audit"}
ROOT_MANIFEST_FILE = "manifest.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"desktop runtime verification failed: {message}")


def safe_payload_path(root: Path, rel: str) -> Path:
    rel_path = Path(rel)
    if rel_path.is_absolute():
        fail(f"absolute manifest path: {rel}")
    if any(part in ("", ".", "..") for part in rel_path.parts):
        fail(f"unsafe manifest path: {rel}")
    return root / rel_path


def is_private_payload_path(rel: str) -> str:
    rel_path = Path(rel)
    if rel_path.name in PRIVATE_BASENAMES:
        return f"private file leaked into payload: {rel}"
    parts = rel_path.parts
    if parts and parts[0] == "python":
        return ""
    if any(part in PRIVATE_PARTS for part in parts):
        return f"private/internal path leaked into payload: {rel}"
    return ""


def normalized_os(value: str) -> str:
    return {
        "darwin": "macos",
        "win32": "windows",
        "cygwin": "windows",
        "msys": "windows",
        "linux": "linux",
    }.get(value, value)


def normalized_machine(value: str) -> str:
    return {
        "amd64": "x86_64",
        "x86_64": "x86_64",
        "arm64": "aarch64",
        "aarch64": "aarch64",
    }.get(value.lower(), value.lower())


def normalize_package_name(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def verify_payload(
    root: Path,
    require_venv: bool = False,
    require_bundled_python: bool = False,
    forbid_venv: bool = False,
    enforce_platform: bool = True,
) -> dict:
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        fail(f"manifest missing: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"manifest is not valid JSON: {exc}")

    if manifest.get("schema") != 1:
        fail(f"unsupported schema: {manifest.get('schema')}")
    if manifest.get("kind") != "penglai-desktop-runtime":
        fail(f"unexpected kind: {manifest.get('kind')}")

    platform_info = manifest.get("platform") or {}
    if not platform_info.get("os") or not platform_info.get("machine"):
        fail("platform.os and platform.machine are required")
    if enforce_platform:
        expected_os = normalized_os(sys.platform)
        actual_os = normalized_os(str(platform_info["os"]))
        if actual_os != expected_os:
            fail(f"platform os mismatch: expected {expected_os}, got {platform_info['os']}")
        expected_machine = normalized_machine(platform.machine())
        actual_machine = normalized_machine(str(platform_info["machine"]))
        if actual_machine != expected_machine:
            fail(f"platform machine mismatch: expected {expected_machine}, got {platform_info['machine']}")

    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        fail("manifest.files must be a non-empty list")
    paths = {}
    for item in files:
        rel = item.get("path")
        if not isinstance(rel, str) or not rel:
            fail(f"invalid file entry path: {item}")
        path = safe_payload_path(root, rel)
        if not path.is_file():
            fail(f"manifest file missing or not a file: {rel}")
        expected_size = item.get("size")
        if path.stat().st_size != expected_size:
            fail(f"size mismatch for {rel}: expected {expected_size}, got {path.stat().st_size}")
        expected_sha = item.get("sha256")
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            fail(f"sha256 mismatch for {rel}: expected {expected_sha}, got {actual_sha}")
        private_error = is_private_payload_path(rel)
        if private_error:
            fail(private_error)
        paths[rel] = item

    actual_files = set()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel == ROOT_MANIFEST_FILE:
            continue
        actual_files.add(rel)
    manifest_files = set(paths)
    extra_files = sorted(actual_files - manifest_files)
    if extra_files:
        sample = ", ".join(extra_files[:5])
        fail(f"payload contains files not listed in manifest: {sample}")
    missing_actual = sorted(manifest_files - actual_files)
    if missing_actual:
        sample = ", ".join(missing_actual[:5])
        fail(f"manifest lists files missing from payload scan: {sample}")

    entrypoints = manifest.get("entrypoints") or {}
    for key, rel in {"cli": "source/penglai", "bridge": "source/frontends/desktop_bridge.py"}.items():
        if entrypoints.get(key) != rel:
            fail(f"entrypoint {key} must be {rel}")
        if rel not in paths:
            fail(f"entrypoint {key} missing from manifest files: {rel}")

    python_relpath = str(manifest.get("python_relpath") or "").strip().replace("\\", "/")
    python_kind = str(manifest.get("python_kind") or "").strip()
    python_scope = str(manifest.get("python_scope") or "").strip()
    if require_venv:
        require_bundled_python = True
        if python_kind and python_kind != "venv":
            fail(f"--require-venv was set but python_kind is {python_kind}")
    if require_bundled_python and not python_relpath:
        fail("--require-bundled-python was set but manifest.python_relpath is empty")
    if python_relpath:
        if python_kind not in {"standalone", "embedded", "venv"}:
            fail(f"python_kind must be standalone, embedded, or venv when python_relpath is set: {python_kind}")
        if python_scope not in {"runtime", "source"}:
            fail(f"python_scope must be runtime or source when python_relpath is set: {python_scope}")
        if forbid_venv and (python_kind == "venv" or any(part in {".venv", "venv", "env"} for part in Path(python_relpath).parts)):
            fail("venv-style Python is forbidden for this payload")
        if require_venv and not any(part == ".venv" for part in Path(python_relpath).parts):
            fail("--require-venv was set but python_relpath does not point at .venv")
        python_manifest_path = python_relpath if python_scope == "runtime" else f"source/{python_relpath}"
        if python_manifest_path not in paths:
            fail(f"bundled python is not listed in manifest files: {python_manifest_path}")
        python_path = safe_payload_path(root if python_scope == "runtime" else root / "source", python_relpath)
        if not python_path.is_file():
            fail(f"bundled python missing or not a file: {python_relpath}")
        if not str(manifest.get("python_version") or "").strip():
            fail("python_version is required when python_relpath is set")
        core_deps = manifest.get("core_deps")
        if not isinstance(core_deps, list) or not core_deps:
            fail("core_deps must be non-empty when python_relpath is set")
        dependency_lock = manifest.get("dependency_lock")
        if not isinstance(dependency_lock, list) or not dependency_lock:
            fail("dependency_lock must be non-empty when python_relpath is set")
        locked = set()
        for dep in dependency_lock:
            name = normalize_package_name(str(dep.get("name", "")))
            version = str(dep.get("version", "")).strip()
            if not name or not version:
                fail(f"dependency_lock entry must include name and version: {dep}")
            locked.add(name)
        for dep in core_deps:
            name = normalize_package_name(str(dep))
            if name not in locked:
                fail(f"dependency_lock missing core dependency: {dep}")

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload", help="path to penglai-runtime payload directory")
    parser.add_argument("--require-venv", action="store_true", help="require a bundled source/.venv Python")
    parser.add_argument("--require-bundled-python", action="store_true", help="require any bundled Python declared in manifest")
    parser.add_argument("--forbid-venv", action="store_true", help="reject venv-style bundled Python; use standalone/embedded Python instead")
    parser.add_argument("--allow-platform-mismatch", action="store_true", help="skip local platform check")
    args = parser.parse_args()

    manifest = verify_payload(
        Path(args.payload).resolve(),
        require_venv=args.require_venv,
        require_bundled_python=args.require_bundled_python,
        forbid_venv=args.forbid_venv,
        enforce_platform=not args.allow_platform_mismatch,
    )
    print(json.dumps({
        "ok": True,
        "files": len(manifest.get("files") or []),
        "python_relpath": manifest.get("python_relpath") or "",
        "python_kind": manifest.get("python_kind") or "",
        "python_scope": manifest.get("python_scope") or "",
        "locked_deps": len(manifest.get("dependency_lock") or []),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
