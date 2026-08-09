#!/usr/bin/env python3
"""
Penglai 0.4 - Minimal Feishu Adapter (IM -> TS Host bridge).

Standalone script: receives Feishu text messages from allowed users and
forwards them to the 0.4 TypeScript Host via `im_bridge.PenglaiHostBridge`,
then returns the Host's reply as plain text. Text in, text out.

  python packages/host/bridge/feishu_adapter.py

This is intentionally minimal compared to the 0.3 `frontends/fsapp.py`
(~992 lines): no cards, no images, no audio, no file upload/download, no
task progress panels. The single goal is to prove an IM channel can talk to
the TS Host end-to-end. Rich media can be layered back on later by reusing
the 0.3 helpers.

Credentials
-----------
Feishu app credentials are read from `mykey.py` (same file 0.3 uses), looking
for `fs_app_id`, `fs_app_secret`, `fs_allowed_users`. The Host auth token is
read from `~/.penglai/host.token` by `im_bridge` (auto-created on first
`npm run serve`).

Security
--------
This is the IM surface -- an untrusted channel per the constitution
(docs/0.4/01-CONSTITUTION.md §7.2). It is designed to run under the Host's
`chat_safe` policy profile (read-only: `read` allowed; `write`/`edit`/`bash`
denied; sensitive key paths like `mykey.py` / `.env` / `*.pem` denied under
all profiles -- see `packages/host/src/policy.ts`). The Host enforces policy
at the Boundary; this adapter only forwards text and never bypasses it.

The Host's `session.create` RPC accepts a `source` param. This adapter passes
`source="im"`, which makes the Host FORCE the `chat_safe` policy profile on
the session (ignoring any caller-provided value), so untrusted IM input can
never drive write/edit/bash. See `_session_for` and `im_bridge.open_im_session`.

Prerequisites
-------------
1. TS Host running: `npm run serve` (binds 127.0.0.1:14169).
2. `~/.penglai/host.token` exists (auto-created by the Host).
3. At least one model profile has its API key env var set
   (GROK_API_KEY / DEEPSEEK_API_KEY / ZAI_API_KEY / OPENAI_API_KEY).
4. `mykey.py` populated with `fs_app_id` / `fs_app_secret`.
5. `lark_oapi` installed (`pip install lark-oapi`).
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

# Make `im_bridge` importable whether run as a script or a module.
_BRIDGE_DIR = Path(__file__).resolve().parent
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

from im_bridge import PenglaiHostBridge  # noqa: E402

try:
    import lark_oapi as lark  # noqa: E402
    from lark_oapi.api.im.v1 import (  # noqa: E402
        CreateMessageRequest,
        CreateMessageRequestBody,
    )
except ImportError:  # pragma: no cover - dependency guard
    print(
        "[feishu_adapter] missing dependency 'lark_oapi'. "
        "Install it with: pip install lark-oapi",
        flush=True,
    )
    raise


# ── paths ───────────────────────────────────────────────────────────────

# Default workspace the Host agent operates in for IM turns. Overridable via
# the PENGLAI_IM_WORKSPACE env var. Falls back to the repo root (two levels
# up from this file: packages/host/bridge -> packages/host -> repo root).
_DEFAULT_WS = os.environ.get(
    "PENGLAI_IM_WORKSPACE",
    str(Path(__file__).resolve().parents[3]),
)
IM_WORKSPACE = _DEFAULT_WS

# Host port (must match `npm run serve --port`, default 14169).
HOST_PORT = int(os.environ.get("PENGLAI_HOST_PORT", "14169"))

# Per-turn timeout forwarded to the bridge (seconds). IM turns can be slow.
PROMPT_TIMEOUT = int(os.environ.get("PENGLAI_IM_TIMEOUT", "300"))


# ── mykey.py loading (minimal version of fsapp.py's resolver) ───────────

def _load_mykey() -> dict:
    """Load mykey.py / mykey.json from the usual candidate locations.

    Mirrors the 0.3 search order (workspace root, ga_config, repo root)
    but only needs the Feishu fields. Returns {} if none found.
    """
    candidates = [
        Path(os.environ.get("GA_WORKSPACE_ROOT", "")) / "mykey.py",
        Path(os.environ.get("GA_WORKSPACE_ROOT", "")) / "mykey.json",
        Path(_DEFAULT_WS) / "mykey.py",
        Path(_DEFAULT_WS) / "mykey.json",
        _BRIDGE_DIR / "mykey.py",
    ]
    for cand in candidates:
        if not cand or not cand.exists():
            continue
        try:
            if cand.suffix == ".py":
                spec = importlib.util.spec_from_file_location(
                    f"_im_mykey_{uuid.uuid4().hex}", cand
                )
                if not spec or not spec.loader:
                    continue
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                data = {
                    k: v for k, v in vars(mod).items() if not k.startswith("_")
                }
            else:
                with open(cand, encoding="utf-8") as f:
                    data = json.load(f)
            if isinstance(data, dict):
                print(f"[feishu_adapter] loaded config: {cand}", flush=True)
                return data
        except Exception as e:  # noqa: BLE001
            print(f"[feishu_adapter] failed to load {cand}: {e}", flush=True)
    return {}


def _feishu_config() -> tuple[str, str, set[str], bool, str]:
    cfg = _load_mykey()
    app_id = str(cfg.get("fs_app_id", "") or "").strip()
    app_secret = str(cfg.get("fs_app_secret", "") or "").strip()
    raw_allowed = cfg.get("fs_allowed_users", [])
    if raw_allowed is None:
        allowed: set[str] = set()
    elif isinstance(raw_allowed, str):
        allowed = {raw_allowed.strip()} if raw_allowed.strip() else set()
    else:
        allowed = {str(x).strip() for x in raw_allowed if str(x).strip()}
    public = (not allowed) or ("*" in allowed)
    return app_id, app_secret, allowed, public, "(mykey.py)"


# ── cross-reconnect message dedup (port of fsapp._claim_message_once) ──

_DEDUP_TTL_SEC = 10 * 60
_DEDUP_MAX = 2000
_DEDUP_LOCK = threading.Lock()
_SEEN_MESSAGES: dict[str, float] = {}


def _claim_message_once(message_id: str) -> bool:
    """Best-effort dedup for Feishu reconnect redeliveries."""
    if not message_id:
        return True
    now = time.time()
    with _DEDUP_LOCK:
        expired = [
            mid for mid, ts in _SEEN_MESSAGES.items() if now - ts > _DEDUP_TTL_SEC
        ]
        for mid in expired:
            _SEEN_MESSAGES.pop(mid, None)
        if len(_SEEN_MESSAGES) > _DEDUP_MAX:
            for mid, _ in sorted(_SEEN_MESSAGES.items(), key=lambda it: it[1])[
                : len(_SEEN_MESSAGES) - _DEDUP_MAX
            ]:
                _SEEN_MESSAGES.pop(mid, None)
        if message_id in _SEEN_MESSAGES:
            return False
        _SEEN_MESSAGES[message_id] = now
        return True


# ── Host bridge + per-user session tracking ─────────────────────────────

# One bridge instance for the whole process (token loaded once).
_bridge: PenglaiHostBridge | None = None

# receive_id (chat_id or open_id) -> Host session_id. Reusing a session keeps
# multi-turn context inside the Host's transcript.
_sessions: dict[str, str] = {}
_sessions_lock = threading.Lock()

# receive_ids with an in-flight turn. The Host rejects a second concurrent
# run on the same session (session_busy), so we gate at the adapter too.
_busy: set[str] = set()
_busy_lock = threading.Lock()


def _get_bridge() -> PenglaiHostBridge:
    global _bridge
    if _bridge is None:
        _bridge = PenglaiHostBridge(port=HOST_PORT)
    return _bridge


def _session_for(receive_id: str) -> str:
    """Return an existing Host session_id for this receive_id, or create one.

    Creating the workspace+session up front (rather than inside prompt())
    lets us fail fast with a clear error if the Host is down or no model
    profile has an API key.
    """
    with _sessions_lock:
        sid = _sessions.get(receive_id)
        if sid:
            return sid
    bridge = _get_bridge()
    sess = bridge.open_im_session(
        IM_WORKSPACE, title=f"Feishu IM {receive_id[:24]}", source="im"
    )
    # source="im" makes the Host force the chat_safe policy profile on this
    # session (read-only); the Host's policy.ts is the tool-access authority.
    with _sessions_lock:
        # Another thread may have created one concurrently; keep the first.
        existing = _sessions.get(receive_id)
        if existing:
            return existing
        _sessions[receive_id] = sess["id"]
        return sess["id"]


# ── Feishu send (text only) ─────────────────────────────────────────────

_client: lark.Client | None = None
_client_lock = threading.Lock()


def _ensure_client(app_id: str, app_secret: str) -> lark.Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = (
                lark.Client.builder()
                .app_id(app_id)
                .app_secret(app_secret)
                .log_level(lark.LogLevel.INFO)
                .build()
            )
        return _client


def _send_text(receive_id: str, text: str, receive_id_type: str) -> str | None:
    """Send a plain text message. Returns message_id or None."""
    try:
        cli = _ensure_client(APP_ID, APP_SECRET)
        body = (
            CreateMessageRequest.builder()
            .receive_id_type(receive_id_type)
            .request_body(
                CreateMessageRequestBody.builder()
                .receive_id(receive_id)
                .msg_type("text")
                .content(json.dumps({"text": text}, ensure_ascii=False))
                .build()
            )
            .build()
        )
        r = cli.im.v1.message.create(body)
        if r.success():
            return r.data.message_id if r.data else None
        print(f"[feishu_adapter] send failed: {r.code}, {r.msg}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[feishu_adapter] send exception: {e}", flush=True)
        traceback.print_exc()
    return None


# ── message handling ────────────────────────────────────────────────────

def _extract_text(content_raw: str, msg_type: str) -> str:
    """Pull plain text out of a Feishu message body. Only `text` and `post`
    are decoded; everything else becomes a short placeholder so the user
    knows the minimal adapter didn't ingest it."""
    try:
        content = json.loads(content_raw) if content_raw else {}
    except Exception:  # noqa: BLE001
        return ""
    if msg_type == "text":
        return str(content.get("text", "") or "").strip()
    if msg_type == "post":
        # Post is a nested rich-text structure; flatten the text runs.
        root = content.get("post", content) if isinstance(content, dict) else {}
        if not isinstance(root, dict):
            return ""
        blocks = root
        if "content" not in root:
            for key in ("zh_cn", "en_us", "ja_jp"):
                if key in root and isinstance(root[key], dict):
                    blocks = root[key]
                    break
        title = blocks.get("title") if isinstance(blocks, dict) else None
        parts: list[str] = [title] if title else []
        for row in blocks.get("content", []) or []:
            if not isinstance(row, list):
                continue
            for el in row:
                if isinstance(el, dict) and el.get("tag") in ("text", "a"):
                    t = el.get("text", "")
                    if t:
                        parts.append(t)
                elif isinstance(el, dict) and el.get("tag") == "at":
                    parts.append(f"@{el.get('user_name', 'user')}")
        return " ".join(p for p in parts if p).strip()
    # Non-text types: tell the user this minimal adapter ignored it.
    return f"[unsupported message type: {msg_type}]"


def _on_host_reply(receive_id: str, receive_id_type: str, result) -> None:
    """Callback for bridge.prompt_async: send the reply (or error) to Feishu."""
    try:
        with _busy_lock:
            _busy.discard(receive_id)
        if isinstance(result, Exception):
            text = f"[host error] {result}"
        else:
            text = str(result or "").strip() or "(empty response)"
    except Exception as e:  # noqa: BLE001
        text = f"[adapter error] {e}"
    _send_text(receive_id, text, receive_id_type)


def handle_message(data) -> None:
    """lark EventDispatcherHandler callback for P2ImMessageReceiveV1."""
    event = data.event
    message = event.message
    sender = event.sender
    message_id = getattr(message, "message_id", "") or ""

    if not _claim_message_once(message_id):
        print(f"[feishu_adapter] skip duplicate: {message_id}", flush=True)
        return

    open_id = sender.sender_id.open_id
    chat_id = message.chat_id
    if not PUBLIC_ACCESS and open_id not in ALLOWED_USERS:
        print(f"[feishu_adapter] unauthorized user: {open_id}", flush=True)
        return

    text = _extract_text(message.content, message.message_type)
    if not text:
        rid = chat_id or open_id
        rtype = "chat_id" if chat_id else "open_id"
        _send_text(rid, f"[minimal adapter] cannot handle message type "
                        f"'{message.message_type}'. Send text only.", rtype)
        return

    receive_id = chat_id or open_id
    receive_id_type = "chat_id" if chat_id else "open_id"
    print(
        f"[feishu_adapter] recv [{open_id}] ({message.message_type}): "
        f"{text[:200]}",
        flush=True,
    )

    # Busy guard: one in-flight turn per receive_id.
    with _busy_lock:
        if receive_id in _busy:
            _send_text(
                receive_id,
                "当前会话已有任务在运行，请等待完成后再发消息。",
                receive_id_type,
            )
            return
        _busy.add(receive_id)

    # Resolve (or create) the Host session for this user/chat.
    try:
        session_id = _session_for(receive_id)
    except Exception as e:  # noqa: BLE001 - Host down / no API key
        with _busy_lock:
            _busy.discard(receive_id)
        _send_text(
            receive_id,
            f"[adapter] cannot reach Host: {e}\n"
            "Is `npm run serve` running and a model API key set?",
            receive_id_type,
        )
        return

    # Acknowledge receipt so the user knows the turn started.
    _send_text(receive_id, "🤔 思考中...", receive_id_type)

    # Forward to the Host on a background thread; reply arrives via callback.
    bridge = _get_bridge()
    bridge.prompt_async(
        text=text,
        session_id=session_id,
        timeout=PROMPT_TIMEOUT,
        callback=lambda res, rid=receive_id, rt=receive_id_type: _on_host_reply(
            rid, rt, res
        ),
    )


# ── main loop (long-connection with reconnect) ─────────────────────────

APP_ID, APP_SECRET, ALLOWED_USERS, PUBLIC_ACCESS, CONFIG_PATH = _feishu_config()


def main() -> None:
    if not APP_ID or not APP_SECRET:
        print(
            "[feishu_adapter] Feishu credentials missing. Set fs_app_id and "
            "fs_app_secret in mykey.py.",
            flush=True,
        )
        sys.exit(1)

    # Pre-flight: warn (don't hard-fail) if the Host isn't up yet. The IM
    # long-connection can start independently; per-message calls will surface
    # the error to the user if the Host is still down.
    bridge = _get_bridge()
    if not bridge.health():
        print(
            "[feishu_adapter] WARNING: TS Host not reachable at "
            f"127.0.0.1:{HOST_PORT}. Start it with `npm run serve`. "
            "Messages will fail until it is up.",
            flush=True,
        )
    else:
        try:
            profiles = bridge.list_profiles()
            print(
                "[feishu_adapter] Host healthy; profiles: "
                + ", ".join(p.get("id", "?") for p in profiles),
                flush=True,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[feishu_adapter] Host up but profile list failed: {e}", flush=True)

    _ensure_client(APP_ID, APP_SECRET)
    handler = (
        lark.EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(handle_message)
        .build()
    )

    retry_delay = 5
    while True:
        try:
            cli = lark.ws.Client(
                APP_ID,
                APP_SECRET,
                event_handler=handler,
                log_level=lark.LogLevel.INFO,
            )
            print(
                "=" * 60
                + "\n[feishu_adapter] Feishu IM -> TS Host bridge started "
                f"(long-connection)\nApp ID: {APP_ID}\nWorkspace: "
                f"{IM_WORKSPACE}\nHost: 127.0.0.1:{HOST_PORT}\n"
                + "Waiting for messages...\n" + "=" * 60,
                flush=True,
            )
            cli.start()
            retry_delay = 5
        except KeyboardInterrupt:
            print("[feishu_adapter] interrupted, exiting.", flush=True)
            raise
        except Exception as e:  # noqa: BLE001
            print(
                f"[feishu_adapter] long-connection dropped: {e}", flush=True
            )
            traceback.print_exc()
        print(
            f"[feishu_adapter] reconnecting in {retry_delay}s...", flush=True
        )
        time.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, 120)


if __name__ == "__main__":
    main()
