# -*- coding: utf-8 -*-
"""Small fail-closed primitives for local privacy-bearing runtime files."""

from __future__ import annotations

import os
import stat
import tempfile


def _owned_by_current_user(info: os.stat_result) -> bool:
    return not hasattr(os, "geteuid") or info.st_uid == os.geteuid()


def ensure_private_dir(directory: str | os.PathLike[str]) -> str:
    path = os.path.abspath(os.fspath(directory))
    os.makedirs(path, mode=0o700, exist_ok=True)
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise RuntimeError(f"private data directory is not a regular directory: {path}")
    if not _owned_by_current_user(info):
        raise RuntimeError(f"private data directory is not owned by the current user: {path}")
    os.chmod(path, 0o700)
    return path


def harden_private_file(path: str | os.PathLike[str], *, max_bytes: int | None = None) -> str:
    target = os.path.abspath(os.fspath(path))
    info = os.lstat(target)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f"private data file must be a regular file, not a symlink: {target}")
    if not _owned_by_current_user(info):
        raise RuntimeError(f"private data file is not owned by the current user: {target}")
    if max_bytes is not None and info.st_size > max_bytes:
        raise RuntimeError(f"private data file exceeds {max_bytes} bytes: {target}")
    os.chmod(target, 0o600)
    return target


def atomic_write_private(
    path: str | os.PathLike[str],
    data: str | bytes,
    *,
    max_bytes: int | None = None,
) -> str:
    target = os.path.abspath(os.fspath(path))
    directory = ensure_private_dir(os.path.dirname(target))
    payload = data.encode("utf-8") if isinstance(data, str) else bytes(data)
    if max_bytes is not None and len(payload) > max_bytes:
        raise RuntimeError(f"private data payload exceeds {max_bytes} bytes: {target}")
    if os.path.lexists(target):
        harden_private_file(target, max_bytes=max_bytes)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(target)}.", dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        os.chmod(target, 0o600)
        return target
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def append_private_line(path: str | os.PathLike[str], line: str) -> str:
    target = os.path.abspath(os.fspath(path))
    ensure_private_dir(os.path.dirname(target))
    if os.path.lexists(target):
        harden_private_file(target)
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(target, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        payload = line if line.endswith("\n") else line + "\n"
        os.write(descriptor, payload.encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return target
