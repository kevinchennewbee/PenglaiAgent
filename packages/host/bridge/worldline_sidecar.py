#!/usr/bin/env python3
"""Penglai 0.4 worldline (file-level rewind) tool sidecar.

Bridges the TS Core's `checkpoint` / `rewind` / `list_checkpoints` tools to the
0.3.6 `RewindStore` (frontends/worldline.py).

docs/0.4/05-PROTOCOL.md §4.3 + 12-UPSTREAM-SYNC.md §3: Worldline's
`apply_code` / `rewind_head` / `commit` become Core-called Tools, *not* a
second Loop. They rewind workspace *files* (file-level), complementing the Pi
Session JSONL tree which rewinds conversation turns (session-level).

Protocol
--------
stdin  : {"tool": "checkpoint"|"rewind"|"list_checkpoints",
          "args": {...}, "workspaceRoot": "..."}
stdout : {"ok": true|false, "text": "..."}

Snapshot semantics
------------------
`checkpoint` takes a FULL snapshot of the current workspace files (not just
deltas): it walks the tree, calls `track_pre_edit` on every existing file, and
also re-marks any previously-tracked file that has since been deleted (so the
node records it as absent). `commit()` then writes the current content of all
touched files into a new checkpoint node. `rewind` calls `apply_code(node_id)`
(restores every tracked file to that node's recorded state, including
deletions) and moves HEAD. `tracked` + `baseline` are persisted by
`RewindStore.save()`, so state survives across sidecar subprocess calls.

Only public RewindStore members are used (track_pre_edit / key / commit /
apply_code / rewind_head / linear_path + the nodes/head/tracked attributes).
"""

import json
import os
import sys
import time
import traceback


# Directories never snapshotted (heavy, generated, or internal state).
IGNORE_DIRS = {
    ".git", "node_modules", ".penglai", "__pycache__", "dist", "build",
    ".next", ".venv", "venv", ".idea", ".vscode", ".cache", ".mypy_cache",
    ".pytest_cache", "coverage",
}
MAX_FILES = 5000
MAX_FILE_BYTES = 10 * 1024 * 1024  # skip files larger than 10MB


def _repo_root():
    # packages/host/bridge/worldline_sidecar.py -> repo root (3 levels up).
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", ".."))


def _ensure_on_path():
    root = _repo_root()
    if root not in sys.path:
        sys.path.insert(0, root)


# Mirror RewindStore._abs without touching the private method.
def _rel_to_abs(rel, workspace_root):
    if os.path.isabs(rel) or (len(rel) > 1 and rel[1] == ":"):
        return os.path.normpath(rel)
    return os.path.normpath(os.path.join(workspace_root, rel))


def _walk_files(root):
    """Bounded generator of existing file abs paths under root."""
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored dirs in-place so os.walk does not descend into them.
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            try:
                if os.path.islink(full):
                    continue
                st = os.stat(full)
            except OSError:
                continue
            if st.st_size > MAX_FILE_BYTES:
                continue
            yield full
            count += 1
            if count >= MAX_FILES:
                return


# One RewindStore per workspace, cached for the lifetime of this process.
_stores = {}


def _store_for(workspace_root):
    if workspace_root in _stores:
        return _stores[workspace_root]
    _ensure_on_path()
    from frontends.worldline import RewindStore  # noqa: WPS433

    root = os.path.join(workspace_root, ".penglai", "worldline")
    os.makedirs(root, exist_ok=True)
    store = RewindStore(root, workspace_root)
    _stores[workspace_root] = store
    return store


def checkpoint(store, args, workspace_root):
    title = args.get("title") or "checkpoint"

    # 1. Track every currently-existing file so commit snapshots its content.
    count = 0
    for abs_path in _walk_files(workspace_root):
        store.track_pre_edit(abs_path)
        count += 1

    # 2. Re-mark previously-tracked files that no longer exist: track_pre_edit
    #    on a missing path records _ABSENT, so the node captures the deletion.
    deleted = 0
    for rel in list(store.tracked):
        if not os.path.exists(_rel_to_abs(rel, workspace_root)):
            store.track_pre_edit(_rel_to_abs(rel, workspace_root))
            deleted += 1

    nid = store.commit(title=title)
    return {
        "ok": True,
        "text": f"checkpoint created: {nid} ({title}) -- {count} files snapshotted, {deleted} deletions recorded",
    }


def rewind(store, args):
    nid = args.get("checkpoint_id")
    if not nid:
        return {"ok": False, "text": "rewind: missing checkpoint_id"}
    if nid not in store.nodes:
        return {"ok": False, "text": f"rewind: checkpoint not found: {nid}"}

    changed = store.apply_code(nid)  # [(rel, action)]
    store.rewind_head(nid)
    if changed:
        summary = ", ".join(f"{rel}:{action}" for rel, action in changed)
    else:
        summary = "no files changed"
    return {"ok": True, "text": f"rewound to {nid}: {summary}"}


def list_checkpoints(store, args):  # noqa: ARG001
    chain = store.linear_path()  # root -> HEAD
    if not chain:
        return {"ok": True, "text": "(no checkpoints yet)"}
    lines = []
    for nid in chain:
        nd = store.nodes.get(nid, {})
        title = nd.get("title", "")
        kind = nd.get("kind", "")
        created = nd.get("created")
        when = (
            time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(created))
            if created
            else ""
        )
        marker = "  (HEAD)" if nid == store.head else ""
        lines.append(f"{nid}\t{kind}\t{when}\t{title}{marker}")
    return {"ok": True, "text": "\n".join(lines)}


def _emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main():
    try:
        raw = sys.stdin.read()
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "text": f"failed to read stdin: {exc}"})
        return

    if not raw.strip():
        _emit({"ok": False, "text": "empty request"})
        return

    try:
        req = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "text": f"invalid JSON request: {exc}"})
        return

    tool = req.get("tool")
    args = req.get("args") or {}
    workspace_root = req.get("workspaceRoot") or os.getcwd()
    workspace_root = os.path.abspath(workspace_root)
    if not os.path.isdir(workspace_root):
        _emit({"ok": False, "text": f"workspaceRoot not a directory: {workspace_root}"})
        return

    try:
        store = _store_for(workspace_root)
    except Exception as exc:  # noqa: BLE001
        # Most likely: the `rich` dependency of frontends/worldline.py is
        # missing, or the repo layout changed. Surface a clear message.
        _emit(
            {
                "ok": False,
                "text": (
                    f"failed to init RewindStore: {type(exc).__name__}: {exc}\n"
                    + traceback.format_exc()
                ),
            }
        )
        return

    try:
        if tool == "checkpoint":
            out = checkpoint(store, args, workspace_root)
        elif tool == "rewind":
            out = rewind(store, args)
        elif tool == "list_checkpoints":
            out = list_checkpoints(store, args)
        else:
            out = {"ok": False, "text": f"unknown worldline tool: {tool}"}
    except Exception as exc:  # noqa: BLE001
        out = {
            "ok": False,
            "text": f"{type(exc).__name__}: {exc}\n" + traceback.format_exc(),
        }
    _emit(out)


if __name__ == "__main__":
    main()
