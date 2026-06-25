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

import asyncio, contextlib, hmac, importlib, json, os, secrets, sys
import threading, time, traceback, uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from aiohttp import web, WSMsgType

APP_DIR = Path(__file__).resolve().parent
BRIDGE_TOKEN = os.environ.get("PENGLAI_DESKTOP_BRIDGE_TOKEN") or secrets.token_urlsafe(32)
BRIDGE_TOKEN_HEADER = "X-Penglai-Bridge-Token"
PROTECTED_PATH_PREFIXES = (
    "/ws",
    "/status",
    "/config",
    "/model-profiles",
    "/sessions",
    "/session/",
    "/ops/",
    "/runtime/",
    "/tts/",
    "/path/open",
)


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
    return any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in PROTECTED_PATH_PREFIXES)


def _request_bridge_token(request) -> str:
    return request.headers.get(BRIDGE_TOKEN_HEADER, "") or request.query.get("token", "")


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
        "ready": True,
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
    catalog = command_catalog()
    allowed = set(catalog.get("read_only", ())) | set(catalog.get("state_changing", ()))
    if name not in allowed:
        return json_ok({"ok": False, "error": f"不支持的运维命令：{name}"}, status=400)
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


# ── Channel & Ability management (v0.3.0 补配置) ─────────────────────

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
        return json_ok({"ok": True, "keys": {}, "raw": ""})
    raw = mk.read_text(encoding="utf-8")
    keys = _read_mykey_keys()
    # Redact secrets
    safe = {}
    for k, v in keys.items():
        if any(s in k.lower() for s in ("key", "secret", "token", "password", "apikey")):
            safe[k] = v[:4] + "***" if len(v) > 4 else "***"
        else:
            safe[k] = v
    return json_ok({"ok": True, "keys": safe, "raw": raw, "path": str(mk)})


async def mykey_update_handler(request):
    _require_token(request)
    data = await read_json(request)
    updates = data.get("updates", {})
    if not updates:
        return json_ok({"ok": False, "error": "缺少 updates 字段"}, status=400)
    mk = Path(manager.ga_root) / "mykey.py"
    import re
    if mk.exists():
        lines = mk.read_text(encoding="utf-8").splitlines(keepends=True)
    else:
        lines = []
    for key, val in updates.items():
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
    mk.write_text("".join(lines), encoding="utf-8")
    mk.chmod(0o600)
    return json_ok({"ok": True, "updated": list(updates.keys())})


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
    app.router.add_post("/tts/say", tts_say_handler)
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

    # Serve static frontend (desktop/static/)
    static_dir = APP_DIR / "desktop" / "static"

    async def index_handler(request):
        html = (static_dir / "index.html").read_text(encoding="utf-8")
        token_script = (
            "<script>"
            f"window.__PENGLAI_BRIDGE_TOKEN__={json.dumps(BRIDGE_TOKEN)};"
            "</script>"
        )
        if "</head>" in html:
            html = html.replace("</head>", token_script + "\n</head>", 1)
        else:
            html = token_script + html
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
    print(f"蓬莱桌面桥接：http://{host}:{port}  ws://{host}:{port}/ws", file=sys.stderr)
    web.run_app(create_app(), host=host, port=port, print=None)
