#!/usr/bin/env python3
"""
Penglai desktop bridge.

Clear split:
1) AgentManager: owns desktop sessions and routes prompts through Runtime Hub.
2) Transport: HTTP is the command/data channel; WebSocket only pushes small
   session-state notifications.

HTTP API:
  GET    /status
  POST   /tts/say
  GET    /tts/audio/{name}
  GET    /runtime/status?session_id=owner:default
  GET    /runtime/runs?session_id=owner:default&limit=20
  GET    /config
  POST   /config
  GET    /model-profiles
  GET    /sessions
  POST   /session/new
  GET    /session/{sid}
  DELETE /session/{sid}
  POST   /session/{sid}/prompt
  GET    /session/{sid}/messages?after=0&limit=200
  POST   /session/{sid}/cancel

WS API:
  GET /ws -> events only, e.g.
  {"type":"session-state","sessionId":"sess-...","state":"running","seq":3,"updatedAt":...}
"""
from __future__ import annotations

import asyncio, contextlib, hmac, importlib, json, os, platform, py_compile, re, secrets, sys
import threading, time, traceback, uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from aiohttp import web, WSMsgType

APP_DIR = Path(__file__).resolve().parent
BRIDGE_TOKEN = os.environ.get("PENGLAI_DESKTOP_BRIDGE_TOKEN") or secrets.token_urlsafe(32)
BRIDGE_TOKEN_HEADER = "X-Penglai-Bridge-Token"
LOOPBACK_BIND_HOSTS = {"127.0.0.1", "localhost", "::1"}
MYKEY_UPDATE_ALLOWLIST = {
    "native_oai_config",
    "native_claude_config",
    "mixin_config",
    "penglai_lang",
    "fs_app_id",
    "fs_app_secret",
    "fs_owner_open_id",
    "fs_allowed_users",
    "wechat_enabled",
    "wechat_allowed_users",
    "companion_enabled",
    "companion_mode",
    "companion_relationship_style",
    "companion_voice_gender",
    "critic_model",
    "critic_mode",
    "tinyfish_key",
    "tavily_key",
    "firecrawl_key",
}
SENSITIVE_KEY_PARTS = ("key", "secret", "token", "password", "apikey")
PROTECTED_PATH_PREFIXES = (
    "/status",
    "/config",
    "/model-profiles",
    "/sessions",
    "/session/",
    "/ops/",
    "/runtime/",
    "/companion/",
    "/tts/",
    "/path/open",
)

# L2.1: 状态变更操作（update-apply 等）的二次确认令牌池：{token: (command, timestamp)}
_PENDING_STATE_CONFIRMS = {}
_STATE_CONFIRM_TTL_SECONDS = 60


def _cleanup_state_confirms(now=None):
    now = time.time() if now is None else float(now)
    expired = [
        token for token, (_name, ts) in list(_PENDING_STATE_CONFIRMS.items())
        if now - ts > _STATE_CONFIRM_TTL_SECONDS
    ]
    for token in expired:
        _PENDING_STATE_CONFIRMS.pop(token, None)


def find_default_ga_root() -> Path:
    candidates = [
        APP_DIR / "..",
        APP_DIR / ".." / "..",
        APP_DIR / ".." / "GenericAgent",
        APP_DIR / ".." / ".." / "GenericAgent",
    ]
    for p in candidates:
        root = p.resolve()
        if (root / "agentmain.py").exists():
            return root
    return APP_DIR.parent.parent.resolve()


DEFAULT_GA_ROOT = find_default_ga_root()
if str(DEFAULT_GA_ROOT) not in sys.path:
    sys.path.insert(0, str(DEFAULT_GA_ROOT))

from penglai_runtime.redaction import redact_text as _redact_secret_text

# --bootstrap: minimal HTTP + setup endpoints, defer heavy runtime imports.
# Used by the Tauri shell before mykey.py / runtime config exists so the setup
# wizard can drive configuration through bridge HTTP endpoints instead of the
# Rust layer inlining Python.
BOOTSTRAP_MODE = "--bootstrap" in sys.argv

if not BOOTSTRAP_MODE:
    try:
        from penglai_runtime import tts_service
        from penglai_runtime.channel_runtime import ChannelRuntimeBridge
        from penglai_runtime.context_events import default_context_log_path
        from penglai_runtime.control_api import (
            command_catalog,
            ops_checks,
            read_ops_logs,
            run_ops_command,
            _is_loopback_host,
        )
        from penglai_runtime.permissions import permission_payload, render_permission_text, resolve_permission_choice
        from penglai_runtime.port import GenericAgentInstancePort
        from penglai_runtime.service import RuntimeHubService
    except Exception:
        tts_service = None
        ChannelRuntimeBridge = None
        default_context_log_path = None
        command_catalog = None
        ops_checks = None
        read_ops_logs = None
        run_ops_command = None
        _is_loopback_host = None
        permission_payload = None
        render_permission_text = None
        resolve_permission_choice = None
        GenericAgentInstancePort = None
        RuntimeHubService = None
else:
    # Bootstrap mode: serve setup endpoints only, runtime stays None.
    tts_service = None
    ChannelRuntimeBridge = None
    default_context_log_path = None
    command_catalog = None
    ops_checks = None
    read_ops_logs = None
    run_ops_command = None
    _is_loopback_host = None
    permission_payload = None
    render_permission_text = None
    resolve_permission_choice = None
    GenericAgentInstancePort = None
    RuntimeHubService = None

for _s in (sys.stdout, sys.stderr):
    with contextlib.suppress(Exception):
        _s.reconfigure(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Agent management layer
# ---------------------------------------------------------------------------

@dataclass
class Session:
    id: str
    title: str = "新对话"
    cwd: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    messages: List[dict] = field(default_factory=list)
    msg_seq: int = 0
    partial: Optional[dict] = None
    status: str = "idle"  # idle|running|error|cancelled
    agent: Any = None
    thread: Optional[threading.Thread] = None
    cancel_requested: bool = False
    last_error: str = ""
    runtime_session_id: str = ""
    pending_permission: Any = None


class AgentManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.ga_root = str(DEFAULT_GA_ROOT)
        self.config: Dict[str, Any] = {}
        self.sessions: Dict[str, Session] = {}
        self.active_session_id: Optional[str] = None
        self.runtime_bridge = ChannelRuntimeBridge(channel="desktop", owner_user_ids={"owner"}) if ChannelRuntimeBridge else None
        self._runtime_service = None

    @property
    def mykey_path(self) -> str:
        return str(Path(self.ga_root) / "mykey.py")

    def ensure_ga_import_path(self) -> Path:
        root = Path(self.ga_root).resolve()
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        return root

    def make_agent(self, sess: Session):
        root = self.ensure_ga_import_path()
        old_cwd = os.getcwd()
        try:
            os.chdir(sess.cwd or str(root))
            agentmain = importlib.import_module("agentmain")
            GA = getattr(agentmain, "GenericAgent")
            agent = GA()
            agent.inc_out = True
            agent.verbose = True
            threading.Thread(target=agent.run, daemon=True, name=f"GA-{sess.id}").start()
            return agent
        finally:
            with contextlib.suppress(Exception):
                os.chdir(old_cwd)

    def list_model_profiles(self):
        self.ensure_ga_import_path()
        try:
            agentmain = importlib.import_module("agentmain")
            agent = agentmain.GenericAgent()
            if hasattr(agent, "list_llms"):
                return [{"id": i, "name": name, "active": active} for i, name, active in agent.list_llms()]
        except Exception as e:
            print(f"get model profiles failed: {e}", file=sys.stderr)
        return []

    def snapshot(self, sess: Session, include_messages: bool = True) -> dict:
        out = {
            "sessionId": sess.id,
            "id": sess.id,
            "title": sess.title,
            "cwd": sess.cwd,
            "status": sess.status,
            "createdAt": sess.created_at,
            "updatedAt": sess.updated_at,
            "lastError": sess.last_error,
            "msgSeq": sess.msg_seq,
            "runtimeSessionId": sess.runtime_session_id,
            "waitingPermission": bool(sess.pending_permission),
        }
        if include_messages:
            out["messages"] = list(sess.messages)
            out["partial"] = dict(sess.partial) if sess.partial else None
        return out

    def add_message(self, sess: Session, role: str, content: str, **extra) -> dict:
        sess.msg_seq += 1
        msg = {"id": sess.msg_seq, "role": role, "content": content, "ts": time.time()}
        msg.update(extra)
        sess.messages.append(msg)
        sess.updated_at = time.time()
        if role == "user" and content.strip() and sess.title in {"New chat", "新对话"}:
            sess.title = content.strip().replace("\n", " ")[:40]
        return msg

    def create_session(self, cwd: Optional[str] = None) -> Session:
        sid = "sess-" + uuid.uuid4().hex[:12]
        sess = Session(id=sid, cwd=str(cwd or self.ga_root))
        with self.lock:
            self.sessions[sid] = sess
            self.active_session_id = sid
        emit_session_state(sess, "created")
        return sess

    def runtime_service(self):
        if self.runtime_bridge is None or RuntimeHubService is None or GenericAgentInstancePort is None:
            raise RuntimeError("蓬莱中枢桥接不可用")
        if self._runtime_service is not None:
            return self._runtime_service

        def port_factory(_session_ref, incoming):
            desktop_sid = str((incoming.metadata or {}).get("desktop_session_id") or incoming.chat_id or "")
            sess = self.get_session(desktop_sid)
            if sess.agent is None:
                sess.agent = self.make_agent(sess)
            return GenericAgentInstancePort(
                agent=sess.agent,
                prompt_builder=lambda evt: self.runtime_bridge.prompt(evt.text, event=evt),
                source="desktop",
                timeout=float(self.config.get("runtimeTimeout") or 1200),
            )

        self._runtime_service = RuntimeHubService(
            owner_user_ids={"owner"},
            port_factory=port_factory,
            context_log_path=default_context_log_path() if default_context_log_path else None,
        )
        return self._runtime_service

    def get_session(self, sid: str) -> Session:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            return sess

    def delete_session(self, sid: str) -> dict:
        with self.lock:
            sess = self.sessions.pop(sid, None)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            if self.active_session_id == sid:
                self.active_session_id = next(iter(self.sessions), None)
            if sess.agent and hasattr(sess.agent, "abort"):
                with contextlib.suppress(Exception):
                    sess.agent.abort()
        emit_session_state(sess, "closed")
        return {"ok": True, "sessionId": sid}

    def submit_prompt(self, sid: str, prompt: Any, images: Optional[list] = None) -> dict:
        prompt, image_ids = normalize_prompt(prompt, images)
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            extra = {}
            if image_ids:
                extra["image_ids"] = image_ids
            if sess.pending_permission is not None:
                if resolve_permission_choice is None:
                    raise web.HTTPInternalServerError(text=json.dumps({"error": "权限解析器不可用"}, ensure_ascii=False), content_type="application/json")
                chosen = resolve_permission_choice(prompt, sess.pending_permission)
                if chosen is None:
                    user_msg = self.add_message(sess, "user", prompt, **extra)
                    perm_extra = {}
                    if permission_payload is not None:
                        perm_extra["permission"] = permission_payload(sess.pending_permission)
                    self.add_message(sess, "assistant", render_permission_text(sess.pending_permission), **perm_extra)
                    emit_session_state(sess, "idle")
                    return {"ok": True, "sessionId": sid, "accepted": True, "userMessageId": user_msg["id"], "seq": sess.msg_seq, "waitingPermission": True}
                sess.pending_permission = None
                prompt = chosen
            if self.runtime_bridge is None:
                raise web.HTTPInternalServerError(text=json.dumps({"error": "蓬莱中枢不可用"}, ensure_ascii=False), content_type="application/json")
            event, session_ref = self.runtime_bridge.event(
                event_id=f"desktop_{sid}_{uuid.uuid4().hex}",
                user_id=sid,
                chat_id=sid,
                chat_type="private",
                text=prompt,
                images=image_ids,
                metadata={"cwd": sess.cwd, "image_ids": image_ids, "desktop_session_id": sid},
            )
            extra["runtime_session_id"] = session_ref.session_id
            sess.runtime_session_id = session_ref.session_id
            user_msg = self.add_message(sess, "user", prompt, **extra)
            # Unified中枢 submit: if the session is busy, queue instead of 409.
            svc = self.runtime_service()
            done_evt = threading.Event()
            holder = {}

            def _on_complete(result):
                holder["result"] = result
                done_evt.set()

            decision = svc.submit(
                event,
                on_complete=_on_complete,
                base_dir=sess.cwd,
                send_body=False,
                send_notice=False,
            )
            if not decision.started_now:
                # Queued by the中枢.  Keep a waiter thread alive so the queued
                # result is written back into this desktop session when the hub
                # dispatches it later.
                sess.status = "queued"
                sess.cancel_requested = False
                sess.last_error = ""
                sess.partial = None
                t = threading.Thread(
                    target=self.run_runtime_turn,
                    args=(sess, event, done_evt, holder),
                    daemon=True,
                    name=f"QueuedTurn-{sid}",
                )
                sess.thread = t
                t.start()
                seq = sess.msg_seq
                emit_state = "queued"
            else:
                sess.status = "running"
                sess.cancel_requested = False
                sess.last_error = ""
                sess.partial = {"id": sess.msg_seq + 1, "role": "assistant", "content": "", "ts": time.time(), "partial": True}
                t = threading.Thread(target=self.run_runtime_turn, args=(sess, event, done_evt, holder), daemon=True, name=f"Turn-{sid}")
                sess.thread = t
                t.start()
                seq = sess.msg_seq
                emit_state = "running"
        emit_session_state(sess, emit_state)
        if not decision.started_now:
            return {"ok": True, "sessionId": sid, "accepted": True, "queued": True,
                    "queue_no": decision.queue_no, "userMessageId": user_msg["id"], "seq": seq}
        return {"ok": True, "sessionId": sid, "accepted": True, "userMessageId": user_msg["id"], "seq": seq}

    def run_runtime_turn(self, sess: Session, event, done_evt=None, holder=None):
        try:
            if done_evt is not None:
                # submit() already started the event; wait for completion.
                while not done_evt.wait(timeout=0.5):
                    if sess.cancel_requested:
                        break
                result = holder.get("result") if holder else None
            else:
                result = self.runtime_service().receive_blocking(
                    event,
                    base_dir=sess.cwd,
                    send_body=False,
                    send_notice=False,
                )
            full = (result.raw_output or result.cleaned_output or result.task_run.result_text) if result else ""
            if not full:
                full = "(completed)"
            if sess.cancel_requested:
                with self.lock:
                    sess.partial = None
                    # Ensure status stays cancelled (don't overwrite)
                    if sess.status != "cancelled":
                        sess.status = "cancelled"
                    sess.updated_at = time.time()
                emit_session_state(sess, "cancelled")
                return
            with self.lock:
                sess.partial = None
                if result.permission is not None:
                    sess.pending_permission = result.permission
                    perm_extra = {}
                    if permission_payload is not None:
                        perm_extra["permission"] = permission_payload(result.permission)
                    self.add_message(sess, "assistant", render_permission_text(result.permission), **perm_extra)
                    sess.status = "idle"
                    sess.last_error = ""
                    sess.updated_at = time.time()
                    emit_state = "idle"
                elif result.status == "failed":
                    sess.status = "error"
                    sess.last_error = result.task_run.error or "中枢任务失败"
                    self.add_message(sess, "error", sess.last_error)
                    emit_state = "error"
                elif result.status == "cancelled":
                    sess.status = "cancelled"
                    sess.updated_at = time.time()
                    emit_state = "cancelled"
                else:
                    # Strip trailing [Info] Final response to user. marker
                    import re as _re
                    full = _re.sub(r'\n*`{5}\n*\[Info\] Final response to user\.\n*`{5}\s*$', '', full)
                    if self.runtime_bridge is not None:
                        self.runtime_bridge.record_memory(full, context={"channel": "desktop", "session_id": sess.runtime_session_id or sess.id})
                        self.runtime_bridge.record_shadow(
                            full,
                            receive_id=sess.id,
                            receive_id_type="desktop_session",
                            production_text=full,
                        )
                    self.add_message(sess, "assistant", full)
                    sess.status = "idle"
                    sess.last_error = ""
                    emit_state = "idle"
            emit_session_state(sess, emit_state)
        except Exception as e:
            tb = traceback.format_exc()
            with self.lock:
                sess.partial = None
                sess.status = "error"
                sess.last_error = str(e)
                self.add_message(sess, "error", str(e))
            print(tb, file=sys.stderr)
            emit_session_state(sess, "error")

    def run_agent_turn(self, sess: Session, prompt: str, images: Optional[list] = None):
        event, session_ref = self.runtime_bridge.event(
            event_id=f"desktop_{sess.id}_{uuid.uuid4().hex}",
            user_id=sess.id,
            chat_id=sess.id,
            chat_type="private",
            text=prompt,
            images=images or (),
            metadata={"cwd": sess.cwd, "desktop_session_id": sess.id},
        )
        sess.runtime_session_id = session_ref.session_id
        return self.run_runtime_turn(sess, event)

    def messages(self, sid: str, after: int = 0, limit: int = 200) -> dict:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            msgs = [m for m in sess.messages if int(m.get("id", 0)) > after]
            if limit > 0:
                msgs = msgs[-limit:]
            return {
                "sessionId": sid,
                "status": sess.status,
                "messages": msgs,
                "partial": dict(sess.partial) if sess.partial else None,
                "msgSeq": sess.msg_seq,
                "updatedAt": sess.updated_at,
                "lastError": sess.last_error,
            }

    def cancel(self, sid: str) -> dict:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            sess.cancel_requested = True
            if sess.agent and hasattr(sess.agent, "abort"):
                with contextlib.suppress(Exception):
                    sess.agent.abort()
            if sess.runtime_session_id:
                with contextlib.suppress(Exception):
                    self.runtime_service().cancel_session(sess.runtime_session_id, drop_pending=True)
            sess.status = "cancelled"
            sess.partial = None
            sess.updated_at = time.time()
        emit_session_state(sess, "cancelled")
        return {"ok": True, "sessionId": sid}


import base64
import tempfile

# Shared temp dir for image uploads (persists for process lifetime)
_UPLOAD_DIR = Path(tempfile.gettempdir()) / "ga_web2_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _desktop_tts_dir() -> Path:
    return (Path(manager.ga_root) / "temp" / "desktop_tts").resolve()


def _save_image_data(data_url: str, img_id: str) -> str:
    """Save a data URL to disk, return absolute path."""
    # data:image/png;base64,xxxxx
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
    else:
        b64 = data_url
        header = ""
    ext = "png"
    if "jpeg" in header or "jpg" in header:
        ext = "jpg"
    elif "webp" in header:
        ext = "webp"
    elif "gif" in header:
        ext = "gif"
    fpath = _UPLOAD_DIR / f"{img_id}.{ext}"
    fpath.write_bytes(base64.b64decode(b64))
    return str(fpath)


def normalize_prompt(prompt: Any, images: Optional[list] = None):
    """Normalize prompt and images.
    
    images: list of dicts {"id": "img-xxx", "dataUrl": "data:..."} or plain data URLs.
    Returns: (prompt_text_with_image_tags, image_ids_list)
    """
    images = list(images or [])
    if isinstance(prompt, list):
        text_parts = []
        for part in prompt:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                if part.get("type") in ("text", "input_text"):
                    text_parts.append(str(part.get("text") or part.get("content") or ""))
                elif part.get("type") in ("image", "input_image"):
                    url = part.get("image_url") or part.get("url") or part.get("data")
                    if isinstance(url, dict):
                        url = url.get("url")
                    if url:
                        images.append(url)
        prompt = "\n".join([p for p in text_parts if p])

    # Process images: save to disk, build [image:path] tags
    image_ids = []
    image_tags = []
    for img in images:
        if isinstance(img, dict):
            img_id = img.get("id") or f"img-{uuid.uuid4().hex[:8]}"
            data_url = img.get("dataUrl") or img.get("data_url") or ""
        else:
            # Plain data URL string
            img_id = f"img-{uuid.uuid4().hex[:8]}"
            data_url = str(img)
        if data_url:
            path = _save_image_data(data_url, img_id)
            image_tags.append(f"[image:{path}]")
            image_ids.append(img_id)

    # Append image tags to prompt
    final_prompt = str(prompt or "")
    if image_tags:
        final_prompt = final_prompt + "\n" + "\n".join(image_tags)

    return final_prompt, image_ids


manager = AgentManager()


# ---------------------------------------------------------------------------
# Transport layer: WS notification only
# ---------------------------------------------------------------------------

class WsHub:
    def __init__(self):
        self.websockets: Set[web.WebSocketResponse] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def emit(self, obj: dict):
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._broadcast(obj), self.loop)

    async def _broadcast(self, obj: dict):
        data = json.dumps(obj, ensure_ascii=False, default=str)
        dead = set()
        for ws in list(self.websockets):
            try:
                await ws.send_str(data)
            except Exception:
                dead.add(ws)
        self.websockets.difference_update(dead)


hub = WsHub()


def emit_session_state(sess: Session, state_name: str):
    hub.emit({
        "type": "session-state",
        "sessionId": sess.id,
        "state": state_name,
        "status": sess.status,
        "seq": sess.msg_seq,
        "updatedAt": sess.updated_at,
        "title": sess.title,
    })


async def ws_handler(request):
    if not _same_bridge_origin(request, request.headers.get("Origin", "")):
        raise web.HTTPUnauthorized(
            text=json.dumps({"ok": False, "error": "非本机同源请求已拒绝"}, ensure_ascii=False),
            content_type="application/json",
        )
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    hub.websockets.add(ws)
    await ws.send_str(json.dumps({
        "type": "bridge-ready",
        "penglaiRoot": manager.ga_root,
        "gaRoot": manager.ga_root,
        "mykeyPath": manager.mykey_path,
        "http": True,
        "wsEventsOnly": True,
    }, ensure_ascii=False))
    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            # WS is intentionally not a data/command channel anymore.
            with contextlib.suppress(Exception):
                data = json.loads(msg.data)
                if data.get("action") == "ping":
                    await ws.send_str(json.dumps({"type": "pong", "ts": time.time()}, ensure_ascii=False))
    hub.websockets.discard(ws)
    return ws


# ---------------------------------------------------------------------------
# Transport layer: HTTP command/data API
# ---------------------------------------------------------------------------

def _host_name(host: str) -> str:
    value = (host or "").strip()
    if value.startswith("[") and "]" in value:
        return value[1:value.index("]")]
    return value.rsplit(":", 1)[0]


def _same_bridge_origin(request, origin: str) -> bool:
    if not origin:
        return True
    try:
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        origin_host = parsed.hostname or ""
        request_host = _host_name(request.host)
        if _is_loopback_host is None:
            loopback = request_host.lower() in {"localhost", "127.0.0.1", "::1"}
        else:
            loopback = _is_loopback_host(request_host)
        return bool(loopback and parsed.scheme == request.scheme and parsed.netloc == request.host and origin_host)
    except Exception:
        return False


def cors_headers(request):
    headers = {
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": f"Content-Type,{BRIDGE_TOKEN_HEADER}",
    }
    origin = request.headers.get("Origin", "")
    if origin and _same_bridge_origin(request, origin):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return headers


def _requires_bridge_auth(request) -> bool:
    path = request.path or ""
    if path.startswith("/tts/audio/"):
        return False
    return any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in PROTECTED_PATH_PREFIXES)


def _request_bridge_token(request) -> str:
    return request.headers.get(BRIDGE_TOKEN_HEADER, "")


def _bridge_auth_ok(request) -> bool:
    token = _request_bridge_token(request)
    return bool(token and hmac.compare_digest(token, BRIDGE_TOKEN))


@web.middleware
async def desktop_security_middleware(request, handler):
    if request.method == "OPTIONS":
        status = 204 if _same_bridge_origin(request, request.headers.get("Origin", "")) else 403
        return web.Response(status=status, headers=cors_headers(request))
    if _requires_bridge_auth(request):
        if not _same_bridge_origin(request, request.headers.get("Origin", "")):
            return web.json_response(
                {"ok": False, "error": "非本机同源请求已拒绝"},
                status=401,
                headers=cors_headers(request),
                dumps=lambda x: json.dumps(x, ensure_ascii=False, default=str),
            )
        if not _bridge_auth_ok(request):
            return web.json_response(
                {"ok": False, "error": "桌面桥接 token 缺失或无效"},
                status=401,
                headers=cors_headers(request),
                dumps=lambda x: json.dumps(x, ensure_ascii=False, default=str),
            )
    resp = await handler(request)
    for k, v in cors_headers(request).items():
        resp.headers[k] = v
    return resp


def json_ok(data: dict, status: int = 200):
    return web.json_response(data, status=status, dumps=lambda x: json.dumps(x, ensure_ascii=False, default=str))


async def read_json(request) -> dict:
    if request.can_read_body:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}


async def status_handler(request):
    return json_ok({
        "ok": True,
        "running": True,
        "ready": not BOOTSTRAP_MODE,
        "bootstrap": BOOTSTRAP_MODE,
        "penglaiRoot": manager.ga_root,
        "gaRoot": manager.ga_root,
        "mykeyPath": manager.mykey_path,
        "sessionCount": len(manager.sessions),
        "activeSessionId": manager.active_session_id,
        "ws": "/ws",
        "transport": {"http": True, "wsEventsOnly": True},
    })


async def get_config_handler(request):
    return json_ok({"penglaiRoot": manager.ga_root, "gaRoot": manager.ga_root, "mykeyPath": manager.mykey_path, "config": manager.config})


async def save_config_handler(request):
    data = await read_json(request)
    cfg = data.get("config", data)
    if isinstance(cfg, dict):
        manager.config.update(cfg)
    return json_ok({"ok": True, "penglaiRoot": manager.ga_root, "gaRoot": manager.ga_root, "mykeyPath": manager.mykey_path, "config": manager.config})


async def model_profiles_handler(request):
    return json_ok({"profiles": manager.list_model_profiles()})


async def list_sessions_handler(request):
    with manager.lock:
        sessions = [manager.snapshot(s, include_messages=False) for s in manager.sessions.values()]
    return json_ok({"sessions": sessions, "activeSessionId": manager.active_session_id})


async def new_session_handler(request):
    data = await read_json(request)
    sess = manager.create_session(cwd=data.get("cwd") or data.get("path"))
    return json_ok({"ok": True, "sessionId": sess.id, "session": manager.snapshot(sess)}, status=201)


async def get_session_handler(request):
    sid = request.match_info["sid"]
    sess = manager.get_session(sid)
    return json_ok({"sessionId": sid, "session": manager.snapshot(sess), "messages": list(sess.messages), "partial": sess.partial})


async def delete_session_handler(request):
    sid = request.match_info["sid"]
    return json_ok(manager.delete_session(sid))


async def prompt_handler(request):
    sid = request.match_info["sid"]
    data = await read_json(request)
    prompt = data.get("prompt", data.get("content", data.get("message", "")))
    images = data.get("images") or []
    return json_ok(manager.submit_prompt(sid, prompt, images))


async def messages_handler(request):
    sid = request.match_info["sid"]
    after = int(request.query.get("after") or request.query.get("afterId") or 0)
    limit = int(request.query.get("limit") or 200)
    return json_ok(manager.messages(sid, after=after, limit=limit))


async def cancel_handler(request):
    sid = request.match_info["sid"]
    return json_ok(manager.cancel(sid))


def _ops_origin_allowed(request) -> bool:
    return _same_bridge_origin(request, request.headers.get("Origin", ""))


def _require_ops_available(request):
    if not _ops_origin_allowed(request):
        raise web.HTTPUnauthorized(text=json.dumps({"ok": False, "error": "非本机来源已拒绝"}, ensure_ascii=False), content_type="application/json")
    if command_catalog is None or ops_checks is None or read_ops_logs is None or run_ops_command is None:
        raise web.HTTPServiceUnavailable(text=json.dumps({"ok": False, "error": "蓬莱运维控制不可用"}, ensure_ascii=False), content_type="application/json")


def _require_token(request):
    """Validate loopback origin + bridge token for channel/ability/mykey/doctor handlers.

    Previously this symbol was referenced by 9 handlers but never defined, causing
    NameError → HTTP 500 on /channels /abilities /mykey /doctor.  Mirrors the
    checks done by ``desktop_security_middleware`` for PROTECTED paths.
    """
    if not _same_bridge_origin(request, request.headers.get("Origin", "")):
        raise web.HTTPUnauthorized(text=json.dumps({"ok": False, "error": "非本机同源请求已拒绝"}, ensure_ascii=False), content_type="application/json")
    if not _bridge_auth_ok(request):
        raise web.HTTPUnauthorized(text=json.dumps({"ok": False, "error": "桌面桥接 token 缺失或无效"}, ensure_ascii=False), content_type="application/json")


async def ops_commands_handler(request):
    _require_ops_available(request)
    return json_ok(command_catalog())


async def ops_checks_handler(request):
    _require_ops_available(request)
    data = await asyncio.to_thread(ops_checks, root=manager.ga_root)
    return json_ok(data)


async def ops_logs_handler(request):
    _require_ops_available(request)
    channel = request.query.get("channel", "feishu")
    lines = int(request.query.get("lines") or 80)
    data = await asyncio.to_thread(read_ops_logs, channel, root=manager.ga_root, lines=lines)
    return json_ok(data)


async def ops_command_get_handler(request):
    _require_ops_available(request)
    name = request.query.get("name", "")
    catalog = command_catalog()
    read_only = set(catalog.get("read_only", ()))
    state_changing = set(catalog.get("state_changing", ()))
    if name in state_changing:
        return json_ok({"ok": False, "error": f"{name} 需要通过 POST 执行"}, status=400)
    if name not in read_only:
        return json_ok({"ok": False, "error": f"不支持的运维命令：{name}"}, status=400)
    try:
        data = await asyncio.to_thread(run_ops_command, name, root=manager.ga_root, allow_state=False)
    except ValueError as exc:
        return json_ok({"ok": False, "error": str(exc)}, status=400)
    return json_ok(data)


async def ops_command_post_handler(request):
    _require_ops_available(request)
    body = await read_json(request)
    name = body.get("command", "")
    timeout = body.get("timeout")
    confirm_token = body.get("confirm_token", "")
    catalog = command_catalog()
    state_changing = set(catalog.get("state_changing", ()))
    allowed = set(catalog.get("read_only", ())) | state_changing
    if name not in allowed:
        return json_ok({"ok": False, "error": f"不支持的运维命令：{name}"}, status=400)
    _cleanup_state_confirms()
    # L2.1 安全：desktop bridge 已经要求 loopback origin + bridge token。
    # 0.3.4 桌面按钮默认直接执行；只有显式 require_two_step 的调用者走二次确认。
    if name in state_changing and not confirm_token and body.get("require_two_step"):
        import secrets as _sec
        token = _sec.token_urlsafe(16)
        _PENDING_STATE_CONFIRMS[token] = (name, time.time())
        return json_ok({"ok": False, "need_confirm": True, "confirm_token": token,
                        "message": f"即将执行高危操作 {name}，请确认。此操作可能重启服务或更新运行时。"})
    if name in state_changing and confirm_token:
        pending = _PENDING_STATE_CONFIRMS.pop(confirm_token, None)
        if pending is None or pending[0] != name:
            return json_ok({"ok": False, "error": "确认令牌无效或已过期，请重新发起"}, status=400)
        # 令牌 60 秒有效
        if time.time() - pending[1] > _STATE_CONFIRM_TTL_SECONDS:
            return json_ok({"ok": False, "error": "确认令牌已过期，请重新发起"}, status=400)
    try:
        data = await asyncio.to_thread(run_ops_command, name, root=manager.ga_root, allow_state=True, timeout=timeout)
    except ValueError as exc:
        return json_ok({"ok": False, "error": str(exc)}, status=400)
    return json_ok(data)


def _active_runtime_session_id() -> str:
    sid = ""
    with manager.lock:
        active = manager.sessions.get(manager.active_session_id or "")
        if active is not None:
            sid = active.runtime_session_id or ""
    return sid or "owner:default"


def _require_runtime_read_available(request):
    if not _ops_origin_allowed(request):
        raise web.HTTPUnauthorized(text=json.dumps({"ok": False, "error": "非本机来源已拒绝"}, ensure_ascii=False), content_type="application/json")
    if RuntimeHubService is None:
        raise web.HTTPServiceUnavailable(text=json.dumps({"ok": False, "error": "蓬莱中枢不可用"}, ensure_ascii=False), content_type="application/json")


def _require_desktop_tts_available(request):
    if not _ops_origin_allowed(request):
        raise web.HTTPUnauthorized(text=json.dumps({"ok": False, "error": "非本机来源已拒绝"}, ensure_ascii=False), content_type="application/json")
    if tts_service is None:
        raise web.HTTPServiceUnavailable(text=json.dumps({"ok": False, "error": "本地语音输出不可用"}, ensure_ascii=False), content_type="application/json")


async def tts_say_handler(request):
    _require_desktop_tts_available(request)
    body = await read_json(request)
    text = str(body.get("text") or "").strip()
    if not text:
        return json_ok({"ok": False, "error": "缺少要朗读的文本"}, status=400)
    if len(text) > 1200:
        text = text[:1200]
    voice = str(body.get("voice") or "").strip() or None
    desktop_tts_dir = _desktop_tts_dir()
    desktop_tts_dir.mkdir(parents=True, exist_ok=True)
    output = desktop_tts_dir / f"desktop_tts_{int(time.time())}_{uuid.uuid4().hex[:8]}.wav"
    result = await asyncio.to_thread(
        tts_service.synthesize,
        text,
        output_path=str(output),
        voice=voice,
        allow_download=False,
        stream=False,
    )
    if not result.get("ok"):
        status = 503 if "missing" in str(result.get("error", "")).lower() else 500
        return json_ok(result, status=status)
    audio = dict(result.get("audio") or {})
    audio["url"] = f"/tts/audio/{output.name}"
    return json_ok({"ok": True, "audio": audio, "audio_url": audio["url"], "provider": "moss-tts-nano"})


async def tts_audio_handler(request):
    _require_desktop_tts_available(request)
    name = Path(request.match_info.get("name", "")).name
    if not name or name != request.match_info.get("name") or not name.endswith(".wav"):
        return json_ok({"ok": False, "error": "不支持的音频文件名"}, status=400)
    desktop_tts_dir = _desktop_tts_dir()
    target = (desktop_tts_dir / name).resolve()
    try:
        target.relative_to(desktop_tts_dir)
    except ValueError:
        return json_ok({"ok": False, "error": "音频路径越界"}, status=400)
    if not target.is_file():
        return json_ok({"ok": False, "error": "音频文件不存在"}, status=404)
    return web.FileResponse(target, headers={"Content-Type": "audio/wav"})


async def tts_voices_handler(request):
    """GET /tts/voices — 列出可用声音档案（0.3.5 新增）。"""
    _require_token(request)
    from penglai_runtime.voice_profiles import list_voice_profiles, resolve_voice

    keys = _read_mykey_keys()
    gender = keys.get("companion_voice_gender") or "auto"
    persona = keys.get("companion_persona") or keys.get("companion_relationship_style") or "butler"
    voices = list_voice_profiles(public_only=True)
    # 标注当前默认会解析到哪个声音
    sample_zh = resolve_voice("你好", gender=gender, persona=persona)
    sample_en = resolve_voice("hello", gender=gender, persona=persona)
    return json_ok({
        "ok": True,
        "voices": voices,
        "current": {
            "gender": gender,
            "persona": persona,
            "zh_sample": sample_zh,
            "en_sample": sample_en,
        },
    })


# ── Channel & Ability management (v0.3.1 补配置) ─────────────────────

CHANNEL_REGISTRY = (
    ("feishu",   "飞书 Feishu",       "推荐·已实测·扫码即用"),
    ("wechat",   "微信 WeChat",       "已实测·扫码登录个人微信"),
    ("dingtalk", "钉钉 DingTalk",     "扫码自动建应用·待实测"),
    ("qq",       "QQ",                "扫码自动建应用·待实测"),
    ("telegram", "Telegram",          "贴 token 接入·待实测"),
    ("discord",  "Discord",           "贴 token 接入·待实测"),
    ("wecom",    "企业微信 WeCom",    "贴 token 接入·待实测"),
)

ABILITY_REGISTRY = (
    ("voice",     "语音转写",   "本地 SenseVoice，转写+情绪+声学事件"),
    ("tts",       "语音输出",   "本地 MOSS-TTS-Nano，CPU 合成"),
    ("companion", "主动陪伴",   "独立心跳进程，勿扰时段守护"),
    ("critic",    "批判脑",     "异厂商复核防幻觉"),
    ("intel",     "情报矩阵",   "多源搜索交叉验证"),
)

def _find_python():
    """Find a working Python interpreter."""
    import sys, os
    # Prefer .venv python
    venv_py = Path(manager.ga_root) / ".venv" / "bin" / "python"
    if not venv_py.exists():
        venv_py = Path(manager.ga_root) / ".venv" / "Scripts" / "python.exe"
    if venv_py.exists():
        return str(venv_py)
    return sys.executable

def _read_mykey_keys():
    """Parse mykey.py into a dict of key-value pairs (strings only)."""
    mk = Path(manager.ga_root) / "mykey.py"
    if not mk.exists():
        return {}
    import re
    keys = {}
    with open(mk, "r", encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^(\w+)\s*=\s*(.+)$", line.strip())
            if m:
                val = m.group(2).strip().strip("'\"").strip()
                # Handle triple-quoted strings or other complex values as-is
                if val.startswith(("'", '"')):
                    val = val.strip("'\"")
                keys[m.group(1)] = val
    return keys


def _mask_secret_value(value):
    if isinstance(value, str):
        return value[:4] + "***" if len(value) > 4 else "***"
    return "***"


def _safe_mykey_value(key, value):
    key_l = str(key or "").lower()
    if any(part in key_l for part in SENSITIVE_KEY_PARTS):
        return _mask_secret_value(value)
    if isinstance(value, dict):
        return {str(k): _safe_mykey_value(k, v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe_mykey_value("", item) for item in value]
    if isinstance(value, str):
        return _redact_secret_text(value)
    return value


def _channel_status():
    """Return channel status list based on config existence and process check."""
    import subprocess, platform
    keys = _read_mykey_keys()
    channels = []
    for cid, cname, cdesc in CHANNEL_REGISTRY:
        configured = False
        running = False
        if cid == "feishu":
            configured = bool(keys.get("fs_app_id") and keys.get("fs_app_secret"))
            # Check if feishu process is running
            try:
                if platform.system() == "Windows":
                    out = subprocess.check_output(["tasklist", "/FI", "IMAGENAME eq python.exe"], timeout=3).decode("utf-8", errors="replace")
                    running = "penglai_feishu" in out
                else:
                    subprocess.check_output(["pgrep", "-f", "penglai_feishu"], timeout=3)
                    running = True
            except Exception:
                running = False
        elif cid == "wechat":
            configured = bool(keys.get("wx_app_id")) or Path(manager.ga_root).joinpath("frontends", "wechatapp.py").exists()
        elif cid in ("dingtalk", "qq", "telegram", "discord", "wecom"):
            # Check if channel config key exists
            configured = bool(keys.get(f"{cid}_token") or keys.get(f"{cid}_app_id"))
        channels.append({
            "id": cid, "name": cname, "desc": cdesc,
            "configured": configured, "running": running,
        })
    return channels

def _ability_status():
    """Return ability status list."""
    import subprocess, platform, os
    keys = _read_mykey_keys()
    abilities = []
    for aid, aname, adesc in ABILITY_REGISTRY:
        enabled = False
        if aid == "voice":
            enabled = os.path.isdir(os.path.expanduser("~/penglai-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"))
        elif aid == "tts":
            enabled = os.path.isdir(os.path.expanduser("~/penglai-models/moss-tts-nano"))
        elif aid == "companion":
            enabled = keys.get("companion_enabled", "").lower() == "true"
        elif aid == "critic":
            enabled = bool(keys.get("critic_mode"))
        elif aid == "intel":
            enabled = bool(keys.get("tinyfish_key") or keys.get("tavily_key") or keys.get("firecrawl_key"))
        abilities.append({"id": aid, "name": aname, "desc": adesc, "enabled": enabled})
    return abilities


async def channels_list_handler(request):
    _require_token(request)
    return json_ok({"ok": True, "channels": _channel_status()})


async def channel_enable_handler(request):
    _require_token(request)
    name = request.match_info.get("name", "")
    valid = [c[0] for c in CHANNEL_REGISTRY]
    if name not in valid:
        return json_ok({"ok": False, "error": f"未知渠道: {name}"}, status=400)
    try:
        import subprocess, platform
        py = _find_python()
        cmd = [py, str(Path(manager.ga_root) / "penglai"), "enable", name]
        proc = subprocess.run(cmd, cwd=manager.ga_root, capture_output=True, text=True, timeout=120)
        ok = proc.returncode == 0
        return json_ok({"ok": ok, "stdout": proc.stdout, "stderr": proc.stderr})
    except Exception as e:
        return json_ok({"ok": False, "error": str(e)[:200]}, status=500)


async def channel_disable_handler(request):
    _require_token(request)
    name = request.match_info.get("name", "")
    valid = [c[0] for c in CHANNEL_REGISTRY]
    if name not in valid:
        return json_ok({"ok": False, "error": f"未知渠道: {name}"}, status=400)
    # Disable: remove config keys from mykey.py
    import re
    mk = Path(manager.ga_root) / "mykey.py"
    if not mk.exists():
        return json_ok({"ok": False, "error": "mykey.py 不存在"}, status=404)
    # Simple approach: just report that manual config removal may be needed
    return json_ok({"ok": True, "message": f"渠道 {name} 已标记禁用。如需彻底移除，请编辑 mykey.py 删除相关凭证。"})


async def abilities_list_handler(request):
    _require_token(request)
    return json_ok({"ok": True, "abilities": _ability_status()})


async def ability_enable_handler(request):
    _require_token(request)
    name = request.match_info.get("name", "")
    valid = [a[0] for a in ABILITY_REGISTRY]
    if name not in valid:
        return json_ok({"ok": False, "error": f"未知能力: {name}"}, status=400)
    try:
        import subprocess
        py = _find_python()
        cmd = [py, str(Path(manager.ga_root) / "penglai"), "enable", name]
        proc = subprocess.run(cmd, cwd=manager.ga_root, capture_output=True, text=True, timeout=300)
        ok = proc.returncode == 0
        return json_ok({"ok": ok, "stdout": proc.stdout, "stderr": proc.stderr})
    except Exception as e:
        return json_ok({"ok": False, "error": str(e)[:200]}, status=500)


async def ability_disable_handler(request):
    _require_token(request)
    name = request.match_info.get("name", "")
    valid = [a[0] for a in ABILITY_REGISTRY]
    if name not in valid:
        return json_ok({"ok": False, "error": f"未知能力: {name}"}, status=400)
    return json_ok({"ok": True, "message": f"能力 {name} 已标记禁用。部分能力需编辑 mykey.py 彻底关闭。"})


async def mykey_read_handler(request):
    _require_token(request)
    mk = Path(manager.ga_root) / "mykey.py"
    if not mk.exists():
        return json_ok({"ok": True, "keys": {}, "path": str(mk)})
    keys = _read_mykey_keys()
    # Redact secrets
    safe = {}
    for k, v in keys.items():
        safe[k] = _safe_mykey_value(k, v)
    return json_ok({"ok": True, "keys": safe, "path": str(mk)})


async def mykey_update_handler(request):
    _require_token(request)
    data = await read_json(request)
    updates = data.get("updates", {})
    if not updates:
        return json_ok({"ok": False, "error": "缺少 updates 字段"}, status=400)
    mk = Path(manager.ga_root) / "mykey.py"
    if mk.exists():
        lines = mk.read_text(encoding="utf-8").splitlines(keepends=True)
    else:
        lines = []
    existing_keys = set(_read_mykey_keys().keys())
    for key, val in updates.items():
        key = str(key or "")
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key) or key.startswith("__"):
            return json_ok({"ok": False, "error": f"非法配置项名称: {key}"}, status=400)
        if key not in MYKEY_UPDATE_ALLOWLIST and key not in existing_keys:
            return json_ok({"ok": False, "error": f"不允许通过桌面接口新增未知配置项: {key}"}, status=400)
        val_str = repr(str(val)) if not isinstance(val, bool) else str(val)
        found = False
        for i, line in enumerate(lines):
            m = re.match(rf"^{re.escape(key)}\s*=", line.strip())
            if m:
                lines[i] = f"{key} = {val_str}\n"
                found = True
                break
        if not found:
            lines.append(f"{key} = {val_str}\n")
    if mk.exists():
        import datetime, shutil
        bak = mk.with_name(f"mykey.py.bak.{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(mk, bak)
    tmp = mk.with_name(f".{mk.name}.tmp.{uuid.uuid4().hex}")
    tmp.write_text("".join(lines), encoding="utf-8")
    _chmod_private(tmp)
    try:
        py_compile.compile(str(tmp), doraise=True)
    except Exception as exc:
        try:
            tmp.unlink()
        except OSError:
            pass
        return json_ok({"ok": False, "error": f"mykey.py 语法校验失败: {exc}"}, status=400)
    os.replace(tmp, mk)
    _chmod_private(mk)
    return json_ok({"ok": True, "updated": list(updates.keys())})


def _write_mykey_updates(updates: dict):
    mk = Path(manager.ga_root) / "mykey.py"
    if mk.exists():
        lines = mk.read_text(encoding="utf-8").splitlines(keepends=True)
    else:
        lines = []
    existing_keys = set(_read_mykey_keys().keys())
    for key, val in updates.items():
        key = str(key or "")
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key) or key.startswith("__"):
            raise ValueError(f"非法配置项名称: {key}")
        if key not in MYKEY_UPDATE_ALLOWLIST and key not in existing_keys:
            raise ValueError(f"不允许通过桌面接口新增未知配置项: {key}")
        val_str = str(val) if isinstance(val, bool) else repr(str(val))
        found = False
        for i, line in enumerate(lines):
            if re.match(rf"^{re.escape(key)}\s*=", line.strip()):
                lines[i] = f"{key} = {val_str}\n"
                found = True
                break
        if not found:
            lines.append(f"{key} = {val_str}\n")
    if mk.exists():
        import datetime, shutil
        bak = mk.with_name(f"mykey.py.bak.{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(mk, bak)
    tmp = mk.with_name(f".{mk.name}.tmp.{uuid.uuid4().hex}")
    tmp.write_text("".join(lines), encoding="utf-8")
    _chmod_private(tmp)
    try:
        py_compile.compile(str(tmp), doraise=True)
    except Exception:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise
    os.replace(tmp, mk)
    _chmod_private(mk)
    return {"ok": True, "updated": list(updates.keys())}


async def companion_config_handler(request):
    _require_token(request)
    from penglai_runtime.companion_loop import companion_profile, companion_state, normalize_mode

    keys = _read_mykey_keys()
    enabled = str(keys.get("companion_enabled", "")).lower() == "true"
    mode = normalize_mode(keys.get("companion_mode") or "present")
    state = companion_state(manager.ga_root)
    return json_ok({
        "ok": True,
        "enabled": enabled,
        "mode": "off" if not enabled else mode,
        "normalizedMode": mode,
        "relationshipStyle": keys.get("companion_relationship_style") or "butler",
        "voiceGender": keys.get("companion_voice_gender") or "auto",
        "lastReason": state.get("last_reason", ""),
        "lastDecision": state.get("last_decision", ""),
        "lastResult": state.get("last_result", ""),
        "lastCheckTs": state.get("last_check_ts", 0),
        "profile": companion_profile(manager.ga_root),
    })


async def companion_heartbeats_handler(request):
    _require_token(request)
    from penglai_runtime.companion_loop import companion_heartbeats

    try:
        limit = int(request.query.get("limit") or 20)
    except Exception:
        limit = 20
    return json_ok({"ok": True, "heartbeats": companion_heartbeats(limit=limit)})


async def companion_mode_handler(request):
    _require_token(request)
    from penglai_runtime.companion_loop import normalize_mode

    data = await read_json(request)
    mode = str(data.get("mode") or "").strip().lower()
    if mode == "normal":
        mode = "present"
    if mode not in {"off", "quiet", "present", "active"}:
        return json_ok({"ok": False, "error": "mode 必须是 off|quiet|present|active"}, status=400)
    updates = {"companion_enabled": mode != "off"}
    if mode != "off":
        updates["companion_mode"] = normalize_mode(mode)
    try:
        result = _write_mykey_updates(updates)
    except Exception as exc:
        return json_ok({"ok": False, "error": str(exc)[:240]}, status=400)
    result.update({"mode": mode, "enabled": mode != "off"})
    return json_ok(result)


async def companion_feedback_handler(request):
    _require_token(request)
    from penglai_runtime.companion_loop import append_feedback

    data = await read_json(request)
    rec = append_feedback(manager.ga_root, data)
    return json_ok({"ok": True, "feedback": rec})


async def companion_voice_handler(request):
    """POST /companion/voice — 设置默认声音性别（0.3.5）。"""
    _require_token(request)
    data = await read_json(request)
    gender = str(data.get("gender") or "").strip().lower()
    norm = {"m": "male", "f": "female"}
    gender = norm.get(gender, gender)
    if gender not in ("male", "female", "auto"):
        return json_ok({"ok": False, "error": "gender 必须是 male|female|auto"}, status=400)
    try:
        result = _write_mykey_updates({"companion_voice_gender": gender})
    except Exception as exc:
        return json_ok({"ok": False, "error": str(exc)[:240]}, status=400)
    # 返回解析到的声音样本
    from penglai_runtime.voice_profiles import resolve_voice
    keys = _read_mykey_keys()
    persona = keys.get("companion_persona") or "butler"
    result.update({
        "gender": gender,
        "zh_sample": resolve_voice("你好", gender=gender, persona=persona),
        "en_sample": resolve_voice("hello", gender=gender, persona=persona),
    })
    return json_ok(result)


async def companion_persona_handler(request):
    """POST /companion/persona — 设置人格风格（0.3.5）。"""
    _require_token(request)
    data = await read_json(request)
    persona = str(data.get("persona") or "").strip().lower()
    if persona not in ("butler", "steady_male", "warm_female", "custom"):
        return json_ok({"ok": False, "error": "persona 必须是 butler|steady_male|warm_female|custom"}, status=400)
    try:
        result = _write_mykey_updates({
            "companion_persona": persona,
            "companion_relationship_style": persona,
        })
    except Exception as exc:
        return json_ok({"ok": False, "error": str(exc)[:240]}, status=400)
    result.update({"persona": persona})
    return json_ok(result)


async def companion_why_handler(request):
    """GET /companion/why — 展示最近主动陪伴决策原因（0.3.5）。"""
    _require_token(request)
    from penglai_runtime.companion_loop import companion_state

    state = companion_state(manager.ga_root)
    return json_ok({
        "ok": True,
        "last_decision": state.get("last_decision", ""),
        "last_reason": state.get("last_reason", ""),
        "last_trigger_kind": state.get("last_trigger_kind", ""),
        "last_result": state.get("last_result", ""),
        "last_check_ts": state.get("last_check_ts", 0),
        "last_sent_ts": state.get("last_sent_ts", 0),
        "last_sent_body": state.get("last_sent_body", ""),
    })


async def companion_reflection_handler(request):
    """GET /companion/reflection — 最近每日反思摘要（0.3.5）。"""
    _require_token(request)
    import os as _os
    refl_dir = _os.path.join(manager.ga_root, "temp", "companion_reflections")
    latest = None
    latest_path = ""
    try:
        if _os.path.isdir(refl_dir):
            files = sorted(f for f in _os.listdir(refl_dir) if f.endswith(".json"))
            if files:
                latest_path = _os.path.join(refl_dir, files[-1])
                with open(latest_path, encoding="utf-8") as f:
                    latest = json.loads(f.read())
    except Exception as exc:
        return json_ok({"ok": False, "error": str(exc)[:240]}, status=500)
    if not latest:
        return json_ok({"ok": True, "reflection": None,
                        "note": "尚无每日反思（Phase 4 落地后生成）"})
    return json_ok({"ok": True, "reflection": latest, "path": latest_path})


async def companion_test_handler(request):
    """POST /companion/test — 干跑一次主动陪伴决策（0.3.5）。"""
    _require_token(request)
    data = await read_json(request) if request.can_read_body else {}
    send = bool(data.get("send"))
    py = _find_python()
    args = [py, os.path.join(manager.ga_root, "penglai"), "companion", "test"]
    args.append("--send" if send else "--dry-run")
    args.append("--json")
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=30, cwd=manager.ga_root)
    except Exception as exc:
        return json_ok({"ok": False, "error": str(exc)[:240]}, status=500)
    try:
        payload = json.loads(proc.stdout or "{}")
    except Exception:
        payload = {"raw_stdout": (proc.stdout or "")[:500]}
    return json_ok({"ok": proc.returncode == 0, "returncode": proc.returncode,
                    "result": payload, "stderr": (proc.stderr or "")[:500]})


async def doctor_handler(request):
    _require_token(request)
    import subprocess, platform, os, socket
    report = {"ok": True, "checks": []}

    def add_check(name, ok, detail=""):
        report["checks"].append({"name": name, "ok": ok, "detail": str(detail)[:300]})

    # Python check
    py = _find_python()
    try:
        ver = subprocess.check_output([py, "--version"], timeout=5).decode().strip()
        add_check("Python", True, ver)
    except Exception as e:
        add_check("Python", False, str(e))

    # mykey.py check
    mk = Path(manager.ga_root) / "mykey.py"
    add_check("mykey.py", mk.exists(), f"路径: {mk}")

    # Bridge check
    try:
        s = socket.socket()
        s.settimeout(2)
        r = s.connect_ex(("127.0.0.1", 14168))
        s.close()
        add_check("桌面桥接", r == 0, "端口 14168" + (" 正常" if r == 0 else " 未监听"))
    except Exception as e:
        add_check("桌面桥接", False, str(e))

    # Channel checks
    for ch in _channel_status():
        add_check(f"渠道 {ch['name']}", ch["configured"], "已配置" if ch["configured"] else "未配置")

    # WeChat allowlist check: 有微信 token 但无 wechat_allowed_users = critical
    try:
        keys = _read_mykey_keys()
        wx_token = bool(keys.get("wx_app_id")) or bool(keys.get("wx_token_path"))
        wx_token = wx_token or Path.home().joinpath(".wxbot").exists()
        allow = keys.get("wechat_allowed_users")
        allow_set = allow not in (None, "", [], [""])
        if wx_token and not allow_set:
            add_check(
                "微信白名单",
                False,
                "检测到微信 token 但未配置 wechat_allowed_users；通道处于 fail-closed。"
                "请在 mykey.py 设置 wechat_allowed_users=['your_openid'] 或桌面配置中写入。",
            )
        elif wx_token and allow_set:
            add_check("微信白名单", True, "wechat_allowed_users 已配置")
    except Exception as e:
        add_check("微信白名单", True, f"检测跳过：{e}")

    # Ability checks
    for ab in _ability_status():
        add_check(f"能力 {ab['name']}", ab["enabled"], "已启用" if ab["enabled"] else "未启用")

    # Disk space
    try:
        usage = os.statvfs(manager.ga_root)
        free_gb = (usage.f_frsize * usage.f_bavail) / (1024**3)
        add_check("磁盘空间", free_gb > 1, f"{free_gb:.1f} GB 可用")
    except Exception:
        add_check("磁盘空间", True, "无法检测")

    # All ok?
    report["all_ok"] = all(c["ok"] for c in report["checks"])

    return json_ok(report)


# ── Setup wizard endpoints (replaces lib.rs inline Python ops) ──────────
# These endpoints move the 9 setup operations that previously lived as
# format!()-built Python source strings in lib.rs into the bridge.  The Rust
# shell now calls them over HTTP (see setup_op in lib.rs).  In --bootstrap
# mode these are the primary endpoints; runtime endpoints return 503.

def _penglai_cli_path() -> str:
    return str(Path(manager.ga_root) / "penglai")


def _chmod_private(path) -> None:
    """Set file permissions to owner-only (0o600).

    On Windows, os.chmod(0o600) collapses to read-only (0o400) because Windows
    only honors the writable bit.  This would prevent subsequent writes to
    mykey.py (reconfiguration) or global_mem_insight.txt (runtime memory
    updates).  On Windows we skip the chmod and rely on filesystem ACLs; on
    Unix we set 0o600 as expected.
    """
    if platform.system() == "Windows":
        return
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def _list_penglai_processes() -> list:
    """List running penglai-related processes across platforms.

    On Unix uses pgrep; on Windows uses wmic/tasklist.  Returns a list of
    {"pid": str, "name": str} dicts.  Used by setup_service_status_handler.
    """
    try:
        if platform.system() == "Windows":
            out = subprocess.check_output(
                ["wmic", "process", "where",
                 "name='python.exe' or name='pythonw.exe'",
                 "get", "processid,commandline"],
                timeout=5,
            ).decode("utf-8", errors="replace")
            results = []
            for line in out.strip().splitlines()[1:]:  # skip header
                line = line.strip()
                if not line:
                    continue
                parts = line.rsplit(None, 1)
                if len(parts) == 2 and "penglai" in parts[0].lower():
                    results.append({"pid": parts[1], "name": "penglai"})
            return results
        else:
            out = subprocess.check_output(
                ["pgrep", "-f", "penglai"], timeout=3
            ).decode("utf-8", errors="replace")
            return [{"pid": line.strip(), "name": "penglai"}
                    for line in out.strip().splitlines() if line.strip()]
    except Exception:
        return []


def _try_penglai_setup_only(modules: str, params: dict):
    """Attempt to delegate to ``penglai setup --only <modules> --json``.

    Returns ``None`` when the CLI does not yet support ``--only`` (Phase 1
    work) so the caller can fall back to the direct-write path.  When the CLI
    accepts the flag, returns its parsed JSON result dict.

    NOTE: penglai_setup.py's main() has a TTY check that rejects non-interactive
    invocations (subprocess with piped stdin).  We detect that case and return
    None so the caller falls back to direct write — without this, single-module
    calls like --only identity would return a non-None failure dict and the
    fallback would never trigger, leaving the desktop wizard unable to write
    identity/mykey.
    """
    import subprocess
    py = _find_python()
    cmd = [py, _penglai_cli_path(), "setup", "--only", modules, "--json"]
    try:
        proc = subprocess.run(
            cmd,
            cwd=manager.ga_root,
            capture_output=True,
            text=True,
            timeout=300,
            input=json.dumps(params, ensure_ascii=False),
        )
    except Exception:
        return None
    combined = (proc.stdout or "") + (proc.stderr or "")
    low = combined.lower()
    # CLI rejected --only / --json (not yet implemented by Phase 1) → fall back
    if proc.returncode != 0 and (
        "unrecognized" in low or "invalid choice" in low or "invalid arguments" in low
        or "no such option" in low or "usage:" in low
    ):
        return None
    # CLI rejected because stdin is not a TTY (non-interactive invocation).
    # This is expected when called from the desktop bridge subprocess.  Fall
    # back to direct write instead of returning a failure dict.
    if proc.returncode != 0 and "交互终端" in combined:
        return None
    if proc.returncode != 0:
        return {"ok": False, "error": combined[:500], "source": "penglai setup --only"}
    try:
        data = json.loads(proc.stdout)
        if isinstance(data, dict):
            data.setdefault("ok", True)
            return data
    except Exception:
        pass
    return {"ok": True, "stdout": proc.stdout, "source": "penglai setup --only"}


async def setup_list_providers_handler(request):
    _require_token(request)
    import yaml  # type: ignore
    data = None
    try:
        with open(Path(manager.ga_root) / "penglai_providers.yaml", "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception:
        pass
    if data is None:
        data = {
            "wizard_order": ["deepseek", "volcengine", "bailian", "zhipu", "minimax",
                              "moonshot", "openrouter", "hunyuan", "xunfei", "agnes", "custom"],
            "providers": {},
        }
    return json_ok(data)


async def setup_test_llm_handler(request):
    _require_token(request)
    import urllib.request
    body = await read_json(request)
    base = str(body.get("base_url") or "").rstrip("/")
    model = str(body.get("model") or "")
    key = str(body.get("api_key") or "")
    try:
        req = urllib.request.Request(
            f"{base}/chat/completions",
            data=json.dumps({"model": model, "messages": [{"role": "user", "content": "回复两个字：蓬莱"}], "max_tokens": 64}).encode(),
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=40)
        result = json.loads(resp.read())
        content = result["choices"][0]["message"]["content"]
        return json_ok({"ok": True, "content": content})
    except Exception as e:
        return json_ok({"ok": False, "error": str(e)[:200]}, status=500)


async def setup_feishu_qr_init_handler(request):
    _require_token(request)
    import urllib.request
    try:
        req = urllib.request.Request(
            "https://accounts.feishu.cn/oauth/v1/app/registration",
            data=b"action=init",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp = urllib.request.urlopen(req, timeout=20)
        data = json.loads(resp.read())
        if "client_secret" not in str(data.get("supported_auth_methods", "")):
            return json_ok({"ok": False, "error": "Feishu device flow not available, use manual mode"})
        req2 = urllib.request.Request(
            "https://accounts.feishu.cn/oauth/v1/app/registration",
            data=b"action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp2 = urllib.request.urlopen(req2, timeout=20)
        data2 = json.loads(resp2.read())
        return json_ok({
            "ok": True,
            "device_code": data2.get("device_code", ""),
            "qr_url": data2.get("verification_uri_complete", ""),
            "expires_in": data2.get("expires_in", 600),
            "interval": data2.get("interval", 2),
        })
    except Exception as e:
        return json_ok({"ok": False, "error": str(e)[:200]}, status=500)


async def setup_feishu_qr_poll_handler(request):
    _require_token(request)
    import urllib.request
    body = await read_json(request)
    device_code = str(body.get("device_code") or "")
    try:
        req = urllib.request.Request(
            "https://accounts.feishu.cn/oauth/v1/app/registration",
            data=f"action=poll&device_code={device_code}&tp=ob_app".encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp = urllib.request.urlopen(req, timeout=20)
        data = json.loads(resp.read())
        if "client_id" in data and "client_secret" in data:
            return json_ok({"status": "ok", "app_id": data["client_id"], "app_secret": data["client_secret"]})
        if "access_denied" in str(data):
            return json_ok({"status": "denied"})
        if "expired" in str(data).lower():
            return json_ok({"status": "expired"})
        return json_ok({"status": "waiting"})
    except Exception as e:
        return json_ok({"status": "error", "error": str(e)[:200]}, status=500)


async def setup_feishu_verify_handler(request):
    _require_token(request)
    import urllib.request
    body = await read_json(request)
    app_id = str(body.get("app_id") or "")
    app_secret = str(body.get("app_secret") or "")
    try:
        payload = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode()
        req = urllib.request.Request(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=20)
        data = json.loads(resp.read())
        if data.get("code") == 0:
            return json_ok({"ok": True, "tenant_access_token": "valid"})
        return json_ok({"ok": False, "error": "code={} msg={}".format(data.get("code"), data.get("msg", ""))})
    except Exception as e:
        return json_ok({"ok": False, "error": str(e)[:200]}, status=500)


async def setup_write_identity_handler(request):
    _require_token(request)
    body = await read_json(request)
    agent_name = str(body.get("agent_name") or "蓬莱助手 Penglai")
    user_name = str(body.get("user_name") or "主人")
    # Task 8: delegate to CLI when --only is available.
    cli_result = _try_penglai_setup_only("identity", {"agent_name": agent_name, "user_name": user_name})
    if cli_result is not None:
        return json_ok(cli_result)
    # Fallback: direct write (moved from lib.rs inline Python).
    import os
    mem_dir = Path(manager.ga_root) / "memory"
    mem_dir.mkdir(parents=True, exist_ok=True)
    ins_path = mem_dir / "global_mem_insight.txt"
    base = f'''# [Global Memory Insight]
L0: ../memory/memory_management_sop.md
L2: global_mem.txt (当前空)
L3: cleanup/scheduled/autonomous/plan/subagent/web_setup
L4: ../memory/L4_raw_sessions/

# 规则
1. 行动验证: 无工具执行结果不写入记忆
2. 交叉验证: 关键事实至少两个独立来源
3. 读后即改: 修改前必须先读当前内容
4. 闭环: 每次任务结束做记忆结算
5. SOP 优先: 匹配到场景先读对应 SOP

[身份]
我是「{agent_name}」，基于 GenericAgent 的开源个人管家发行版蓬莱。用户称呼：{user_name}。
被问及身份/名字时以此为准，勿自称底层模型名。

[蓬莱SOP]
penglai_checkpoint_sop: 长任务打检查点
penglai_compress_sop: 记忆压缩
penglai_channels_sop: IM渠道管理（penglai enable <渠道>）
penglai_memsig_sop: 长期事实写入（时间戳+取代旧条目）
scheduled_task_sop: 提醒/定时任务（注意注入安全）
penglai_weather_sop: 天气（Open-Meteo 免费）
版本更新: penglai update --check / --apply，禁止裸 git 命令

[蓬莱规则]
IM 图片: 读 penglai_im_vision_sop，用 ask_vision(backend='openai')，勿先 OCR
语音: 包含[audio:文件名]时，首个工具调用必须是 transcribe(path=该音频路径)
'''
    existing = ""
    if ins_path.exists():
        existing = ins_path.read_text(encoding="utf-8")
    if existing and "[身份]" in existing:
        for tag in ["[身份]", "[蓬莱SOP]", "[蓬莱规则]"]:
            idx = existing.find(tag)
            if idx >= 0:
                end = existing.find("[", idx + 1)
                existing = existing[:idx] + ("" if end < 0 else existing[end:])
        ins_path.write_text(existing.strip() + "\n\n" + base, encoding="utf-8")
    else:
        ins_path.write_text(base, encoding="utf-8")
    _chmod_private(ins_path)
    return json_ok({"ok": True, "path": str(ins_path), "source": "bridge-direct"})


async def setup_write_mykey_handler(request):
    _require_token(request)
    body = await read_json(request)
    # Task 8: delegate to CLI when --only is available.
    modules = ["llm"]
    if body.get("fs_app_id"):
        modules.append("feishu")
    if body.get("companion"):
        modules.append("companion")
    if body.get("critic_model"):
        modules.append("critic")
    if body.get("tinyfish_key") or body.get("tavily_key") or body.get("firecrawl_key"):
        modules.append("intel")
    cli_result = _try_penglai_setup_only(",".join(modules), body)
    if cli_result is not None:
        return json_ok(cli_result)
    # Fallback: direct write (moved from lib.rs inline Python).
    import os, shutil, datetime
    mk = Path(manager.ga_root) / "mykey.py"
    if mk.exists():
        bak = mk.with_name(f"mykey.py.bak.{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(mk, bak)
    llm_name = str(body.get("llm_name") or "DeepSeek")
    llm_key = str(body.get("llm_key") or "")
    llm_base = str(body.get("llm_base") or "https://api.deepseek.com")
    llm_model = str(body.get("llm_model") or "deepseek-v4-flash")
    lang = str(body.get("lang") or "zh")
    fs_app_id = str(body.get("fs_app_id") or "")
    fs_app_secret = str(body.get("fs_app_secret") or "")
    fs_owner_open_id = str(body.get("fs_owner_open_id") or "")
    companion = bool(body.get("companion"))
    critic_model = str(body.get("critic_model") or "")
    critic_mode = "smart" if critic_model else ""
    tinyfish_key = str(body.get("tinyfish_key") or "")
    tavily_key = str(body.get("tavily_key") or "")
    firecrawl_key = str(body.get("firecrawl_key") or "")

    parts = [f"""# mykey.py -- 由 Penglai Desktop 生成
native_oai_config = {{
    'name': {llm_name!r},
    'apikey': {llm_key!r},
    'apibase': {llm_base!r},
    'model': {llm_model!r},
    'max_retries': 3,
}}
mixin_config = {{
    'llm_nos': [{llm_name!r}],
    'max_retries': 2,
    'base_delay': 2,
}}
penglai_lang = {lang!r}
fs_app_id = {fs_app_id!r}
fs_app_secret = {fs_app_secret!r}
fs_allowed_users = []
fs_owner_open_id = {fs_owner_open_id!r}
"""]
    if companion:
        parts.append("companion_enabled = True\n")
    if critic_model:
        parts.append(f"critic_model = {critic_model!r}\ncritic_mode = {critic_mode!r}\n")
    if tinyfish_key:
        parts.append(f"tinyfish_key = {tinyfish_key!r}\n")
    if tavily_key:
        parts.append(f"tavily_key = {tavily_key!r}\n")
    if firecrawl_key:
        parts.append(f"firecrawl_key = {firecrawl_key!r}\n")
    mk.write_text("".join(parts), encoding="utf-8")
    _chmod_private(mk)
    return json_ok({"ok": True, "path": str(mk), "source": "bridge-direct"})


async def setup_service_status_handler(request):
    _require_token(request)
    import socket
    result = {"services": [], "bridge": False}
    s = socket.socket()
    s.settimeout(1)
    if s.connect_ex(("127.0.0.1", 14168)) == 0:
        result["bridge"] = True
    s.close()
    # Cross-platform process listing (pgrep on Unix, wmic on Windows)
    result["services"] = _list_penglai_processes()
    return json_ok(result)


async def setup_check_main_update_handler(request):
    _require_token(request)
    import subprocess, os
    cwd = manager.ga_root
    if not os.path.exists(os.path.join(cwd, ".git")):
        return json_ok({"has_update": False, "detail": "not a git install"})
    try:
        subprocess.run(
            ["git", "fetch", "release", "main", "--depth=1"],
            cwd=cwd, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        behind = subprocess.check_output(
            ["git", "rev-list", "--count", "HEAD..release/main"],
            cwd=cwd, timeout=10,
        ).decode().strip()
        has = int(behind) > 0
        return json_ok({"has_update": has, "behind": behind, "detail": f"{behind} commits behind main"})
    except Exception as e:
        return json_ok({"has_update": False, "detail": str(e)[:200]})


# ============================================================
# 迁移：从 Hermes / OpenClaw 搬家（M1.1 桌面端接入）
# 复用 penglai_migrate 的 detect/build_plan/preview/apply，桌面只做 HTTP I/O。
# 三步：detect（探测）→ preview（dry-run 预览）→ apply（落盘）
# ============================================================

async def setup_migrate_detect_handler(request):
    """探测本机是否有 Hermes/OpenClaw 旧管家。返回命中的源列表。"""
    _require_token(request)
    try:
        import sys
        cwd = manager.ga_root
        if str(cwd) not in sys.path:
            sys.path.insert(0, str(cwd))
        import penglai_migrate as pm
        hits = pm.detect()
        return json_ok({
            "found": len(hits) > 0,
            "sources": [{"id": h[0], "home": h[1], "label": h[2]} for h in hits],
        })
    except Exception as e:
        return json_ok({"found": False, "error": str(e)[:200], "sources": []})


async def setup_migrate_preview_handler(request):
    """对指定源做 dry-run 预览，返回四件搬运计划（secret 默认脱敏）。"""
    _require_token(request)
    body = await read_json(request)
    src_id = str(body.get("src_id") or "")
    home = str(body.get("home") or "")
    with_secrets = bool(body.get("with_secrets"))
    if not src_id or not home:
        return json_ok({"ok": False, "error": "missing src_id or home"}, status=400)
    try:
        import sys
        cwd = manager.ga_root
        if str(cwd) not in sys.path:
            sys.path.insert(0, str(cwd))
        import penglai_migrate as pm
        plan = pm.build_plan(src_id, home, {"with_secrets": with_secrets})
        # 只返回脱敏后的可读预览。plan 内含从旧配置解析出的 API key /
        # 渠道 secret，不能原样回给前端或落入桌面 WebView 调试面板。
        preview_lines = pm._preview_lines(plan, with_secrets)
        return json_ok({
            "preview_text": "\n".join(preview_lines),
            "with_secrets": with_secrets,
            "summary": {
                "src_id": plan.get("src_id", ""),
                "label": plan.get("label", ""),
                "home": plan.get("home", ""),
                "memory_sections": {k: len(v) for k, v in (plan.get("memory") or {}).items()},
                "channels_detected": list(plan.get("channels_detected") or []),
                "has_persona": bool(plan.get("persona")),
                "deferred_count": len(plan.get("deferred") or []),
            },
        })
    except Exception as e:
        return json_ok({"ok": False, "error": f"迁移预览失败：{e}"}, status=500)


async def setup_migrate_apply_handler(request):
    """执行迁移落盘：先 _backup()，再 apply()。返回五态 results。"""
    _require_token(request)
    body = await read_json(request)
    src_id = str(body.get("src_id") or "")
    home = str(body.get("home") or "")
    with_secrets = bool(body.get("with_secrets"))
    agent_name = str(body.get("agent_name") or "")
    if not src_id or not home:
        return json_ok({"ok": False, "error": "missing src_id or home"}, status=400)
    try:
        import sys
        cwd = manager.ga_root
        if str(cwd) not in sys.path:
            sys.path.insert(0, str(cwd))
        import penglai_migrate as pm
        plan = pm.build_plan(src_id, home, {"with_secrets": with_secrets})
        if agent_name:
            plan["agent_name"] = agent_name
        backup_dir = pm._backup()
        results = pm.apply(plan, {"with_secrets": with_secrets})
        return json_ok({
            "results": results,
            "backup_dir": backup_dir,
            "agent_name": plan.get("agent_name") or "",
        })
    except Exception as e:
        return json_ok({"ok": False, "error": f"迁移执行失败：{e}"}, status=500)



async def runtime_status_handler(request):
    _require_runtime_read_available(request)
    session_id = request.query.get("session_id") or _active_runtime_session_id()
    data = await asyncio.to_thread(manager.runtime_service().status, session_id)
    return json_ok({"ok": True, "session_id": session_id, "session": data})


async def runtime_runs_handler(request):
    _require_runtime_read_available(request)
    raw_session_id = request.query.get("session_id", "")
    session_id = raw_session_id if raw_session_id not in {"", "active"} else (_active_runtime_session_id() if raw_session_id == "active" else None)
    limit = max(1, min(int(request.query.get("limit") or 20), 100))
    rows = await asyncio.to_thread(manager.runtime_service().recent_runs, session_id=session_id, limit=limit)
    return json_ok({"ok": True, "session_id": session_id or "", "runs": rows})


async def path_open_handler(request):
    data = await read_json(request)
    kind = data.get("kind", "")
    if kind == "mykey":
        target = Path(manager.ga_root) / "mykey.py"
    elif kind == "mykeyTemplate":
        target = Path(manager.ga_root) / "mykey_template.py"
    elif kind == "penglaiRoot":
        target = Path(manager.ga_root)
    else:
        return json_ok({"ok": False, "error": f"不支持的打开目标：{kind or 'empty'}"}, status=400)
    target = target.resolve()
    if not target.exists():
        return json_ok({"ok": False, "error": f"未找到文件：{target}"})
    # Actually open the file with the system default editor
    import subprocess, platform
    if platform.system() == "Windows":
        os.startfile(str(target))
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])
    return json_ok({"ok": True, "path": str(target)})


def create_app():
    app = web.Application(middlewares=[desktop_security_middleware])
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/status", status_handler)
    app.router.add_get("/config", get_config_handler)
    app.router.add_post("/config", save_config_handler)
    app.router.add_get("/model-profiles", model_profiles_handler)
    app.router.add_get("/sessions", list_sessions_handler)
    app.router.add_post("/session/new", new_session_handler)
    app.router.add_get("/session/{sid}", get_session_handler)
    app.router.add_delete("/session/{sid}", delete_session_handler)
    app.router.add_post("/session/{sid}/prompt", prompt_handler)
    app.router.add_get("/session/{sid}/messages", messages_handler)
    app.router.add_post("/session/{sid}/cancel", cancel_handler)
    app.router.add_get("/ops/commands", ops_commands_handler)
    app.router.add_get("/ops/checks", ops_checks_handler)
    app.router.add_get("/ops/logs", ops_logs_handler)
    app.router.add_get("/ops/command", ops_command_get_handler)
    app.router.add_post("/ops/command", ops_command_post_handler)
    app.router.add_get("/runtime/status", runtime_status_handler)
    app.router.add_get("/runtime/runs", runtime_runs_handler)
    app.router.add_get("/companion/config", companion_config_handler)
    app.router.add_get("/companion/heartbeats", companion_heartbeats_handler)
    app.router.add_post("/companion/mode", companion_mode_handler)
    app.router.add_post("/companion/voice", companion_voice_handler)
    app.router.add_post("/companion/persona", companion_persona_handler)
    app.router.add_get("/companion/why", companion_why_handler)
    app.router.add_get("/companion/reflection", companion_reflection_handler)
    app.router.add_post("/companion/test", companion_test_handler)
    app.router.add_post("/companion/feedback", companion_feedback_handler)
    app.router.add_post("/tts/say", tts_say_handler)
    app.router.add_get("/tts/voices", tts_voices_handler)
    app.router.add_get("/tts/audio/{name}", tts_audio_handler)
    app.router.add_post("/path/open", path_open_handler)
    app.router.add_get("/channels", channels_list_handler)
    app.router.add_post("/channels/{name}/enable", channel_enable_handler)
    app.router.add_post("/channels/{name}/disable", channel_disable_handler)
    app.router.add_get("/abilities", abilities_list_handler)
    app.router.add_post("/abilities/{name}/enable", ability_enable_handler)
    app.router.add_post("/abilities/{name}/disable", ability_disable_handler)
    app.router.add_get("/mykey", mykey_read_handler)
    app.router.add_post("/mykey", mykey_update_handler)
    app.router.add_get("/doctor", doctor_handler)
    # Setup wizard endpoints (replaces lib.rs inline Python ops, Task 7)
    app.router.add_get("/setup/list_providers", setup_list_providers_handler)
    app.router.add_post("/setup/test_llm", setup_test_llm_handler)
    app.router.add_post("/setup/feishu/qr_init", setup_feishu_qr_init_handler)
    app.router.add_post("/setup/feishu/qr_poll", setup_feishu_qr_poll_handler)
    app.router.add_post("/setup/feishu/verify", setup_feishu_verify_handler)
    app.router.add_post("/setup/write_identity", setup_write_identity_handler)
    app.router.add_post("/setup/write_mykey", setup_write_mykey_handler)
    app.router.add_get("/setup/service_status", setup_service_status_handler)
    app.router.add_get("/setup/check_main_update", setup_check_main_update_handler)
    app.router.add_get("/setup/migrate/detect", setup_migrate_detect_handler)
    app.router.add_post("/setup/migrate/preview", setup_migrate_preview_handler)
    app.router.add_post("/setup/migrate/apply", setup_migrate_apply_handler)

    # Serve static frontend (desktop/static/)
    static_dir = APP_DIR / "desktop" / "static"

    async def index_handler(request):
        html = (static_dir / "index.html").read_text(encoding="utf-8")
        bootstrap_script = (
            "<script>"
            f"window.__PENGLAI_BOOTSTRAP__={json.dumps(BOOTSTRAP_MODE)};"
            "</script>"
        )
        if "</head>" in html:
            html = html.replace("</head>", bootstrap_script + "\n</head>", 1)
        else:
            html = bootstrap_script + html
        return web.Response(text=html, content_type="text/html", charset="utf-8")

    app.router.add_get("/", index_handler)
    app.router.add_static("/", static_dir, show_index=False)

    async def on_startup(app):
        hub.loop = asyncio.get_running_loop()

    app.on_startup.append(on_startup)
    return app


if __name__ == "__main__":
    host = os.environ.get("BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("BRIDGE_PORT", "14168"))
    if host not in LOOPBACK_BIND_HOSTS:
        print(f"拒绝启动桌面桥接：BRIDGE_HOST 必须是本机回环地址，当前为 {host}", file=sys.stderr)
        sys.exit(2)
    mode_tag = " [bootstrap]" if BOOTSTRAP_MODE else ""
    print(f"蓬莱桌面桥接{mode_tag}：http://{host}:{port}  ws://{host}:{port}/ws", file=sys.stderr)
    web.run_app(create_app(), host=host, port=port, print=None)
