#!/usr/bin/env python3
"""
Penglai 0.4 - Minimal WeChat Adapter (IM -> TS Host bridge).

WeChat integration is complex: the iLink protocol (QR login, long-poll
getUpdates, AES-encrypted CDN media) lives in the 0.3 `frontends/wechatapp.py`
as `WxBotClient`. Rather than duplicate ~300 lines of iLink code, this module
provides only the **bridge layer** -- the message-forwarding logic that would
be inserted into `wechatapp.py`'s `on_message` handler to route WeChat text
through the 0.4 TypeScript Host instead of the 0.3 Python agent.

Two ways to use it:

1. Drop-in (recommended for migration): import the bridge layer and use
   `make_on_message` as the callback for the existing `WxBotClient.run_loop`,
   replacing wechatapp's own `on_message`:

       from wechat_adapter import WeChatHostBridge, make_on_message
       bridge = WeChatHostBridge()
       bot = WxBotClient()           # from frontends.wechatapp
       bot.run_loop(make_on_message(bot, bridge))

2. Standalone (proves the pattern end-to-end):

       python packages/host/bridge/wechat_adapter.py

   This lazily imports `WxBotClient` from `frontends/wechatapp.py`, runs QR
   login if needed, and drives the long-poll loop with the Host bridge.

Text in, text out. No media download/upload, no typing indicators, no
artifact delivery -- those stay in 0.3's wechatapp and can be reattached
later.

Credentials
-----------
WeChat allowed users are read from `mykey.py` (`wechat_allowed_users`), same
as 0.3. The iLink bot token lives in `~/.wxbot/token.json` (managed by
`WxBotClient`). The Host token is read from `~/.penglai/host.token` by
`im_bridge`.

Security
--------
IM is an untrusted surface (docs/0.4/01-CONSTITUTION.md §7.2) and is meant
to run under the Host's `chat_safe` policy (read-only). The Host enforces
policy at the Boundary; this bridge only forwards text. `_session_for` passes
`source="im"` to `open_im_session`, which makes the Host FORCE the
`chat_safe` policy profile on the session so untrusted IM input can never
drive write/edit/bash.
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

# ── paths / config ──────────────────────────────────────────────────────

_DEFAULT_WS = os.environ.get(
    "PENGLAI_IM_WORKSPACE",
    str(Path(__file__).resolve().parents[3]),
)
IM_WORKSPACE = _DEFAULT_WS
HOST_PORT = int(os.environ.get("PENGLAI_HOST_PORT", "14169"))
PROMPT_TIMEOUT = int(os.environ.get("PENGLAI_IM_TIMEOUT", "300"))

# iLink item type for a plain-text run (mirrors wechatapp.ITEM_TEXT).
_ITEM_TEXT = 1


# ── mykey.py loading (Feishu/WeChat share the same resolver shape) ──────

def _load_mykey() -> dict:
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
                print(f"[wechat_adapter] loaded config: {cand}", flush=True)
                return data
        except Exception as e:  # noqa: BLE001
            print(f"[wechat_adapter] failed to load {cand}: {e}", flush=True)
    return {}


def _wechat_allowed_users() -> set[str] | None:
    """Allowed WeChat user ids from mykey. None = not configured (deny all).

    Mirrors wechatapp._wechat_allowed_users but reads mykey directly instead
    of going through llmcore, so the bridge layer has no 0.3 agent deps.
    """
    cfg = _load_mykey()
    raw = cfg.get("wechat_allowed_users", None)
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [x.strip() for x in raw.replace(",", " ").split() if x.strip()]
    try:
        return {str(x).strip() for x in (raw or []) if str(x).strip()}
    except TypeError:
        return set()


def _is_allowed(uid: str, allowed: set[str] | None) -> bool:
    if allowed is None:
        return False  # not configured -> deny (wechatapp requires explicit list)
    return "*" in allowed or str(uid or "").strip() in allowed


# ── bridge layer ────────────────────────────────────────────────────────

class WeChatHostBridge:
    """Per-user Host session tracking + busy guard for WeChat turns.

    One instance per process. Each WeChat user (from_user_id) gets a
    dedicated Host session so multi-turn context survives across messages.
    """

    def __init__(self, workspace_path: str = IM_WORKSPACE, port: int = HOST_PORT):
        self.workspace_path = workspace_path
        self._bridge = PenglaiHostBridge(port=port)
        # from_user_id -> Host session_id
        self._sessions: dict[str, str] = {}
        self._lock = threading.Lock()
        # from_user_ids with an in-flight turn (Host rejects concurrent runs)
        self._busy: set[str] = set()

    def health(self) -> bool:
        return self._bridge.health()

    def _session_for(self, uid: str) -> str:
        with self._lock:
            sid = self._sessions.get(uid)
            if sid:
                return sid
        sess = self._bridge.open_im_session(
            self.workspace_path, title=f"WeChat IM {uid[:24]}", source="im"
        )
        # source="im" makes the Host force the chat_safe policy profile on this
        # session (read-only); the Host's policy.ts is the tool-access authority.
        with self._lock:
            existing = self._sessions.get(uid)
            if existing:
                return existing
            self._sessions[uid] = sess["id"]
            return sess["id"]

    def prompt_async(self, uid: str, text: str, callback) -> None:
        """Forward a turn to the Host on a background thread.

        `callback(result)` is invoked with the assistant text (str) on
        success or an Exception on failure. Caller is responsible for
        sending the reply to WeChat inside the callback.
        """
        try:
            session_id = self._session_for(uid)
        except Exception as e:  # noqa: BLE001 - Host down / no API key
            callback(e)
            return

        with self._lock:
            if uid in self._busy:
                callback(
                    RuntimeError("a turn is already running for this user")
                )
                return
            self._busy.add(uid)

        def _wrapped(result):
            with self._lock:
                self._busy.discard(uid)
            callback(result)

        self._bridge.prompt_async(
            text=text,
            session_id=session_id,
            timeout=PROMPT_TIMEOUT,
            callback=_wrapped,
        )


def _extract_text(msg: dict) -> str:
    """Flatten a WxBotClient message dict to plain text.

    Mirrors `WxBotClient.extract_text` but kept local so the bridge layer
    has no hard dependency on wechatapp at import time.
    """
    parts = []
    for item in msg.get("item_list", []) or []:
        if item.get("type") == _ITEM_TEXT and item.get("text_item"):
            t = item["text_item"].get("text", "")
            if t:
                parts.append(t)
    return "\n".join(parts).strip()


def make_on_message(bot, bridge: WeChatHostBridge, allowed: set[str] | None = None):
    """Build an `on_message(bot, msg)` callback for `WxBotClient.run_loop`.

    This is the drop-in replacement for wechatapp.py's own `on_message`:
    it authorizes the user, extracts text, forwards to the Host, and sends
    the reply back through `bot.send_text`. Media items are ignored (the
    minimal adapter is text-only).
    """
    if allowed is None:
        allowed = _wechat_allowed_users()

    def on_message(b, msg) -> None:
        uid = msg.get("from_user_id", "")
        ctx = msg.get("context_token", "")
        if not _is_allowed(uid, allowed):
            print(f"[wechat_adapter] deny unauthorized user: {uid}", flush=True)
            try:
                b.send_text(
                    uid,
                    "未授权访问：请在 mykey.py 配置 wechat_allowed_users 后再使用。",
                    context_token=ctx,
                )
            except Exception:
                pass
            return

        text = _extract_text(msg)
        if not text:
            # Media-only or empty: minimal adapter ignores it.
            try:
                b.send_text(
                    uid, "[minimal adapter] text only; media is ignored.",
                    context_token=ctx,
                )
            except Exception:
                pass
            return

        print(f"[wechat_adapter] recv [{uid}]: {text[:200]}", flush=True)

        def _reply(result) -> None:
            if isinstance(result, Exception):
                reply = f"[host error] {result}"
            else:
                reply = str(result or "").strip() or "(empty response)"
            try:
                b.send_text(uid, reply[:3000], context_token=ctx)
                print(
                    f"[wechat_adapter] sent reply len={len(reply)}",
                    flush=True,
                )
            except Exception as e:  # noqa: BLE001
                print(f"[wechat_adapter] send failed: {e}", flush=True)

        # Acknowledge so the user knows the turn started.
        try:
            b.send_text(uid, "🤔 思考中...", context_token=ctx)
        except Exception:
            pass

        bridge.prompt_async(uid, text, callback=_reply)

    return on_message


# ── standalone runner ───────────────────────────────────────────────────

def main() -> None:
    """Run the WeChat long-poll loop against the TS Host.

    Lazily imports `WxBotClient` / `AuthExpired` from the 0.3
    `frontends/wechatapp.py`. NOTE: importing that module currently has a
    side effect (it instantiates the 0.3 `GeneraticAgent` at import time).
    For a clean 0.4 run, refactor wechatapp.py to guard that under
    `if __name__ == "__main__":` so `WxBotClient` is importable without the
    0.3 agent. Until then the 0.3 agent is constructed but unused -- only
    the Host drives turns.
    """
    frontends_dir = str(Path(_BRIDGE_DIR).parents[3] / "frontends")
    if frontends_dir not in sys.path:
        sys.path.insert(0, frontends_dir)
    try:
        from wechatapp import WxBotClient, AuthExpired  # noqa: E402
    except ImportError as e:  # pragma: no cover - env guard
        print(
            "[wechat_adapter] cannot import WxBotClient from "
            f"frontends/wechatapp.py: {e}\nWeChat iLink client is required "
            "for the standalone runner. Use the drop-in form instead.",
            flush=True,
        )
        sys.exit(1)

    allowed = _wechat_allowed_users()
    if allowed is None:
        print(
            "[wechat_adapter] WARNING: wechat_allowed_users not set in "
            "mykey.py -> all users denied. Set it (or ['*']) to allow.",
            flush=True,
        )

    bridge = WeChatHostBridge()
    if not bridge.health():
        print(
            f"[wechat_adapter] WARNING: TS Host not reachable at "
            f"127.0.0.1:{HOST_PORT}. Start it with `npm run serve`. "
            "Messages will fail until it is up.",
            flush=True,
        )
    else:
        try:
            profiles = bridge._bridge.list_profiles()
            print(
                "[wechat_adapter] Host healthy; profiles: "
                + ", ".join(p.get("id", "?") for p in profiles),
                flush=True,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[wechat_adapter] profile list failed: {e}", flush=True)

    bot = WxBotClient()
    if not bot.token:
        # First run: QR login (WxBotClient prints the ASCII QR to stdout).
        try:
            bot.login_qr()
        except Exception as e:  # noqa: BLE001
            print(f"[wechat_adapter] QR login failed: {e}", flush=True)
            sys.exit(1)

    on_message = make_on_message(bot, bridge, allowed=allowed)
    print(
        "=" * 60
        + f"\n[wechat_adapter] WeChat IM -> TS Host bridge started "
        f"(bot_id={bot.bot_id})\nWorkspace: {IM_WORKSPACE}\n"
        f"Host: 127.0.0.1:{HOST_PORT}\nWaiting for messages...\n"
        + "=" * 60,
        flush=True,
    )
    try:
        bot.run_loop(on_message)
    except AuthExpired:
        print("[wechat_adapter] iLink token expired, exiting.", flush=True)
        sys.exit(2)
    except KeyboardInterrupt:
        print("[wechat_adapter] interrupted, exiting.", flush=True)


if __name__ == "__main__":
    main()
