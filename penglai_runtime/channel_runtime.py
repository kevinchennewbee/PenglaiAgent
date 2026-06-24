# -*- coding: utf-8 -*-
"""Shared Penglai runtime bridge for real channel adapters.

The bridge is deliberately adapter-side: SDK loops, credentials, uploads, and
native widgets stay in each frontend, while Penglai-owned contracts are applied
consistently before and after the GA turn.
"""

import asyncio
import inspect
import os
import threading
import traceback
import types
import uuid

from .contracts import InboundEvent, RunStatus
from .interaction import (
    INTERACTION_PROMPT_HINT,
)
from .memory_governor import MemoryGovernor
from .permissions import render_permission_text, resolve_permission_choice
from .port import GenericAgentInstancePort
from .service import RuntimeHubService
from .session import SessionRouter
from .shadow import record_delivery_shadow
from .context_events import default_context_log_path, recent_context_prompt


def default_file_hint():
    try:
        from frontends.chatapp_common import FILE_HINT

        return FILE_HINT
    except Exception:
        return "If you need to show files to user, use [FILE:filepath] in your response."


def owner_user_ids_from_mykeys():
    try:
        from llmcore import mykeys
    except Exception:
        return set()
    keys = (
        "fs_owner_open_id",
        "fs_allowed_users",
        "tg_allowed_users",
        "discord_allowed_users",
        "dingtalk_allowed_users",
        "qq_allowed_users",
        "wecom_allowed_users",
        "penglai_owner_ids",
    )
    out = set()
    for key in keys:
        value = mykeys.get(key, [])
        if isinstance(value, str):
            value = [value]
        for item in value or []:
            text = str(item or "").strip()
            if text and text != "*":
                out.add(text)
    return out


def compose_prompt(text, *, file_hint=None, session=None, session_id="", session_scope=""):
    if session is not None:
        session_id = getattr(session, "session_id", "") or session_id
        session_scope = getattr(session, "scope", "") or session_scope
    context = recent_context_prompt(
        session_id=session_id,
        scopes=(session_scope,) if session_scope else None,
    )
    parts = [file_hint or default_file_hint(), INTERACTION_PROMPT_HINT]
    if context:
        parts.append(context)
    parts.append(str(text or ""))
    return "\n\n".join(parts)


class ChannelRuntimeBridge:
    """Small stateful bridge shared by IM/desktop/voice adapters."""

    def __init__(self, *, channel, owner_user_ids=None, file_hint=None):
        self.channel = str(channel or "unknown")
        self.file_hint = file_hint or default_file_hint()
        self.router = SessionRouter(owner_user_ids=owner_user_ids or owner_user_ids_from_mykeys())
        self.memory = MemoryGovernor()
        self.pending_interactions = {}
        self.pending_permissions = {}
        self.last_sessions = {}
        self.memory_decisions = []
        self.shadow_events = []
        self.runtime_service = None

    def event(
        self,
        *,
        event_id=None,
        user_id="",
        text="",
        chat_id="",
        chat_type="private",
        images=None,
        files=None,
        voice=None,
        metadata=None,
    ):
        event = InboundEvent(
            event_id=str(event_id or uuid.uuid4().hex),
            channel=self.channel,
            user_id=str(user_id or chat_id or "unknown"),
            text=str(text or ""),
            chat_id=str(chat_id or ""),
            chat_type=str(chat_type or "private"),
            images=tuple(images or ()),
            files=tuple(files or ()),
            voice=tuple(voice or ()),
            metadata=dict(metadata or {}),
        )
        session = self.router.route(event)
        self.last_sessions[event.chat_id or event.user_id] = session
        return event, session

    def prompt(self, text, *, event=None, session=None):
        if session is None and event is not None:
            try:
                session = self.router.route(event)
            except Exception:
                session = None
        return compose_prompt(text, file_hint=self.file_hint, session=session)

    def default_user_id(self, fallback="desktop"):
        owner_ids = sorted(getattr(self.router, "owner_user_ids", set()) or [])
        return owner_ids[0] if owner_ids else fallback

    def record_memory(self, text, *, context=None):
        decision = self.memory.classify(text, context=context)
        self.memory_decisions.append(decision)
        return decision

    def record_shadow(self, raw_text, **kwargs):
        event = record_delivery_shadow(self.channel, raw_text, **kwargs)
        if event:
            self.shadow_events.append(event)
        return event


def _callable_result(value):
    return value() if callable(value) else value


def _default_user_id(chat_id, ctx):
    for key in ("user_id", "sender_id", "open_id", "uid"):
        value = ctx.get(key)
        if value:
            return value
    return chat_id


def _supported_kwargs(func, ctx):
    if not ctx:
        return {}
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return dict(ctx)
    for param in sig.parameters.values():
        if param.kind == inspect.Parameter.VAR_KEYWORD:
            return dict(ctx)
    positional_names = {"self", "chat_id", "content", "raw_text", "text"}
    allowed = {
        name
        for name, param in sig.parameters.items()
        if param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        and name not in positional_names
    }
    return {key: value for key, value in ctx.items() if key in allowed}


async def _send_text(app, chat_id, content, ctx):
    return await app.send_text(chat_id, content, **_supported_kwargs(app.send_text, ctx))


async def _send_done(app, chat_id, raw_text, ctx):
    return await app.send_done(chat_id, raw_text, **_supported_kwargs(app.send_done, ctx))


def install_channel_runtime_adapter(
    app,
    *,
    channel=None,
    file_hint=None,
    owner_user_ids=None,
    include_click_hint=False,
    get_agent=None,
    render_interaction=None,
):
    """Patch an app instance so the main turn goes through runtime contracts.

    The patch is intentionally conservative: existing channel send_text,
    send_done, upload, and command methods are reused.
    """
    if getattr(app, "_penglai_runtime_channel_patched", False):
        return False
    if not hasattr(app, "send_text"):
        return False

    channel = channel or getattr(app, "source", None) or getattr(app, "label", "chat").lower()
    bridge = ChannelRuntimeBridge(channel=channel, owner_user_ids=owner_user_ids, file_hint=file_hint)
    original_run_agent = getattr(app, "run_agent", None)
    if not callable(original_run_agent):
        original_run_agent = None
    if not hasattr(app, "user_tasks"):
        app.user_tasks = {}

    def runtime_service(self):
        service = bridge.runtime_service
        if service is not None:
            return service

        def port_factory(_session, incoming):
            agent_obj = _callable_result(
                get_agent(self, incoming.chat_id) if get_agent else getattr(self, "agent", None)
            )
            if agent_obj is None:
                raise RuntimeError("Agent 未就绪，请稍后重试")
            return GenericAgentInstancePort(
                agent=agent_obj,
                prompt_builder=lambda evt: bridge.prompt(evt.text, event=evt),
                source=bridge.channel,
                timeout=float(getattr(self, "runtime_timeout", 1200)),
            )

        service = RuntimeHubService(
            owner_user_ids=getattr(bridge.router, "owner_user_ids", set()),
            port_factory=port_factory,
            context_log_path=default_context_log_path(),
        )
        bridge.runtime_service = service
        self._penglai_runtime_hub_service = service
        return service

    async def run_agent(self, chat_id, text, **ctx):
        chat_key = str(chat_id)
        if str(text or "").strip() in {"/stop", "/cancel", "/abort"}:
            return await cancel_runtime_session(self, chat_id, **ctx)
        waiting = bridge.pending_permissions.get(chat_key)
        if waiting:
            chosen = resolve_permission_choice(text, waiting)
            if chosen is None:
                await _send_text(
                    self,
                    chat_id,
                    render_permission_text(waiting, include_click_hint=include_click_hint),
                    ctx,
                )
                return
            bridge.pending_permissions.pop(chat_key, None)
            text = chosen

        agent_obj = _callable_result(get_agent(self, chat_id) if get_agent else getattr(self, "agent", None))
        if agent_obj is None:
            if original_run_agent is not None:
                return await original_run_agent(chat_id, text, **ctx)
            await _send_text(self, chat_id, "⚠️ Agent 未就绪，请稍后重试", ctx)
            return

        event, session = bridge.event(
            event_id=ctx.get("msg_id") or ctx.get("message_id") or uuid.uuid4().hex,
            user_id=_default_user_id(chat_id, ctx),
            chat_id=chat_key,
            chat_type="group" if ctx.get("is_group") else "private",
            text=text,
            images=ctx.get("images") or (),
            files=ctx.get("files") or (),
            voice=ctx.get("voice") or (),
            metadata=ctx,
        )
        state_key = session.session_id
        service = runtime_service(self)

        # Unified中枢 queue: submit is non-blocking.  When the session is busy
        # the event is queued by the hub (not by this adapter) and we just tell
        # the user.  When it starts now, we run it to completion inline (the
        # hub's dispatcher handles any subsequently queued events on its worker
        # thread; we only need to wait for *this* event's result here).
        loop = asyncio.get_event_loop()
        done_evt = threading.Event()
        run_holder = {}
        queued_delivery = {"enabled": False, "scheduled": False}

        async def _deliver_result(run_result):
            if run_result is None:
                await _send_text(self, chat_id, "⏹️ 已停止", ctx)
            elif run_result.permission is not None:
                bridge.pending_permissions[chat_key] = run_result.permission
                if callable(render_interaction):
                    rendered = await render_interaction(self, chat_id, run_result.permission, **ctx)
                    if rendered:
                        return
                await _send_text(
                    self,
                    chat_id,
                    render_permission_text(run_result.permission, include_click_hint=include_click_hint),
                    ctx,
                )
            elif run_result.status == RunStatus.SUCCEEDED:
                raw = run_result.raw_output or run_result.cleaned_output or run_result.task_run.result_text
                bridge.record_memory(raw, context={"channel": bridge.channel, "session_id": session.session_id})
                bridge.record_shadow(
                    raw,
                    receive_id=chat_key,
                    receive_id_type=ctx.get("receive_id_type") or ("group" if ctx.get("is_group") else "private"),
                    base_dir=ctx.get("base_dir"),
                    exclude_paths=ctx.get("exclude_paths"),
                    production_text=raw,
                )
                await _send_done(self, chat_id, raw, ctx)
            elif run_result.status == RunStatus.CANCELLED:
                await _send_text(self, chat_id, "⏹️ 已停止", ctx)
            elif run_result.status == RunStatus.FAILED:
                await _send_text(self, chat_id, f"❌ 错误: {run_result.task_run.error}", ctx)
            else:
                await _send_text(self, chat_id, "⚠️ Agent 异常退出，请重试", ctx)

        def _schedule_queued_delivery(result):
            if queued_delivery["scheduled"]:
                return
            queued_delivery["scheduled"] = True
            fut = asyncio.run_coroutine_threadsafe(_deliver_result(result), loop)

            def _log_delivery_error(done):
                try:
                    done.result()
                except Exception as exc:
                    print(f"[{getattr(self, 'label', bridge.channel)}] 排队结果投递失败：{exc}")

            fut.add_done_callback(_log_delivery_error)

        def _on_complete(result):
            run_holder["result"] = result
            if queued_delivery["enabled"]:
                _schedule_queued_delivery(result)
            done_evt.set()

        decision = service.submit(event, on_complete=_on_complete, base_dir=ctx.get("base_dir"),
                                   exclude_paths=ctx.get("exclude_paths"),
                                   send_body=False, send_notice=False)
        if not decision.started_now:
            queued_delivery["enabled"] = True
            if "result" in run_holder:
                _schedule_queued_delivery(run_holder["result"])
            await _send_text(self, chat_id, f"已收到，当前会话还有任务在运行；这条消息已排队 #{decision.queue_no}，会等当前任务结束后继续。", ctx)
            return

        state = {"running": True, "session_id": session.session_id}
        self.user_tasks[state_key] = state
        if chat_key != state_key:
            self.user_tasks[chat_key] = state
        try:
            await _send_text(self, chat_id, "思考中...", ctx)
            # Wait for the hub worker to finish this event.
            while not done_evt.wait(timeout=0.5):
                if not state["running"]:
                    break
            run_result = run_holder.get("result")
            if not state["running"] and run_result is None:
                await _send_text(self, chat_id, "⏹️ 已停止", ctx)
            elif run_result is not None:
                await _deliver_result(run_result)
            elif not state["running"]:
                await _send_text(self, chat_id, "⏹️ 已停止", ctx)
            else:
                await _send_text(self, chat_id, "⚠️ Agent 异常退出，请重试", ctx)
        except Exception as e:
            print(f"[{getattr(self, 'label', bridge.channel)}] 蓬莱中枢 run_agent 错误：{e}")
            traceback.print_exc()
            await _send_text(self, chat_id, f"❌ 错误: {e}", ctx)
        finally:
            self.user_tasks.pop(state_key, None)
            if chat_key != state_key:
                self.user_tasks.pop(chat_key, None)

    async def cancel_runtime_session(self, chat_id, **ctx):
        chat_key = str(chat_id)
        event, session = bridge.event(
            event_id=ctx.get("msg_id") or ctx.get("message_id") or f"cancel_{uuid.uuid4().hex}",
            user_id=_default_user_id(chat_id, ctx),
            chat_id=chat_key,
            chat_type="group" if ctx.get("is_group") else "private",
            text="/stop",
            metadata=ctx,
        )
        service = runtime_service(self)
        data = service.cancel_session(session.session_id, drop_pending=True)
        for key, state in list(getattr(self, "user_tasks", {}).items()):
            if key in {chat_key, session.session_id} or (state or {}).get("session_id") == session.session_id:
                try:
                    state["running"] = False
                except Exception:
                    pass
                self.user_tasks.pop(key, None)
        bridge.pending_permissions.pop(chat_key, None)
        agent_obj = _callable_result(get_agent(self, chat_key) if get_agent else getattr(self, "agent", None))
        abort = getattr(agent_obj, "abort", None)
        if callable(abort):
            try:
                abort()
            except Exception:
                pass
        await _send_text(self, chat_id, "⏹️ 已请求停止当前任务", ctx)
        return data

    app._penglai_runtime_channel_patched = True
    app._penglai_runtime_bridge = bridge
    app._penglai_original_run_agent = original_run_agent
    app.cancel_runtime_session = types.MethodType(cancel_runtime_session, app)
    app.run_agent = types.MethodType(run_agent, app)
    return True
