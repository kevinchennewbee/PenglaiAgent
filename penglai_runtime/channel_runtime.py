# -*- coding: utf-8 -*-
"""Shared Penglai runtime bridge for real channel adapters.

The bridge is deliberately adapter-side: SDK loops, credentials, uploads, and
native widgets stay in each frontend, while Penglai-owned contracts are applied
consistently before and after the GA turn.
"""

import asyncio
import inspect
import os
import queue as Q
import time
import traceback
import types
import uuid

from .contracts import InboundEvent
from .interaction import (
    INTERACTION_PROMPT_HINT,
    interaction_request_from_turn,
    render_interaction_text,
    resolve_interaction_choice,
)
from .memory_governor import MemoryGovernor
from .session import SessionRouter
from .shadow import record_delivery_shadow
from .context_events import recent_context_prompt


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


def compose_prompt(text, *, file_hint=None):
    context = recent_context_prompt()
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
        self.pending_messages = {}
        self.last_sessions = {}
        self.memory_decisions = []
        self.shadow_events = []

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

    def prompt(self, text):
        return compose_prompt(text, file_hint=self.file_hint)

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

    async def run_agent(self, chat_id, text, **ctx):
        chat_key = str(chat_id)
        waiting = bridge.pending_interactions.get(chat_key)
        if waiting:
            chosen = resolve_interaction_choice(text, waiting)
            if chosen is None:
                await _send_text(
                    self,
                    chat_id,
                    render_interaction_text(waiting, include_click_hint=include_click_hint),
                    ctx,
                )
                return
            bridge.pending_interactions.pop(chat_key, None)
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
        if state_key in self.user_tasks:
            queue = bridge.pending_messages.setdefault(state_key, [])
            queue.append((chat_id, text, dict(ctx)))
            await _send_text(self, chat_id, "已收到，当前会话还有任务在运行；这条消息会等当前任务结束后继续。", ctx)
            return

        state = {"running": True, "session_id": session.session_id}
        self.user_tasks[state_key] = state
        if chat_key != state_key:
            self.user_tasks[chat_key] = state
        hook_key = f"penglai_v5_{bridge.channel}_{state_key}_{uuid.uuid4().hex}"
        result = {"raw": None, "sent": False, "request": None}

        def finish(raw):
            if result["sent"]:
                return
            result["raw"] = raw
            result["sent"] = True

        def hook(turn_ctx):
            try:
                if turn_ctx.get("exit_reason"):
                    request = interaction_request_from_turn(turn_ctx, request_id=hook_key)
                    if request is not None:
                        result["request"] = request
                        result["sent"] = True
                        return
                    resp = turn_ctx.get("response")
                    finish(resp.content if hasattr(resp, "content") else str(resp))
            except Exception as e:
                print(f"[penglai runtime {bridge.channel}] hook error: {e}")

        try:
            await _send_text(self, chat_id, "思考中...", ctx)
            if not hasattr(agent_obj, "_turn_end_hooks"):
                agent_obj._turn_end_hooks = {}
            agent_obj._turn_end_hooks[hook_key] = hook
            dq = agent_obj.put_task(bridge.prompt(event.text), source=bridge.channel)
            last_ping = time.time()
            ping_interval = getattr(self, "ping_interval", 20)

            while state["running"] and not result["sent"]:
                try:
                    item = await asyncio.to_thread(dq.get, True, 1)
                except Q.Empty:
                    if getattr(agent_obj, "is_running", False) and time.time() - last_ping > ping_interval:
                        await _send_text(self, chat_id, "⏳ 还在处理中，请稍等...", ctx)
                        last_ping = time.time()
                    continue
                if item and "done" in item:
                    finish(item.get("done", ""))

            if result["request"] is not None:
                bridge.pending_interactions[chat_key] = result["request"]
                if callable(render_interaction):
                    rendered = await render_interaction(self, chat_id, result["request"], **ctx)
                    if rendered:
                        return
                await _send_text(
                    self,
                    chat_id,
                    render_interaction_text(result["request"], include_click_hint=include_click_hint),
                    ctx,
                )
            elif result["raw"] is not None:
                bridge.record_memory(result["raw"], context={"channel": bridge.channel, "session_id": session.session_id})
                bridge.record_shadow(
                    result["raw"],
                    receive_id=chat_key,
                    receive_id_type=ctx.get("receive_id_type") or ("group" if ctx.get("is_group") else "private"),
                    base_dir=ctx.get("base_dir"),
                    exclude_paths=ctx.get("exclude_paths"),
                    production_text=result["raw"],
                )
                await _send_done(self, chat_id, result["raw"], ctx)
            elif not state["running"]:
                await _send_text(self, chat_id, "⏹️ 已停止", ctx)
            else:
                await _send_text(self, chat_id, "⚠️ Agent 异常退出，请重试", ctx)
        except Exception as e:
            print(f"[{getattr(self, 'label', bridge.channel)}] Penglai runtime run_agent error: {e}")
            traceback.print_exc()
            await _send_text(self, chat_id, f"❌ 错误: {e}", ctx)
        finally:
            if hasattr(agent_obj, "_turn_end_hooks"):
                agent_obj._turn_end_hooks.pop(hook_key, None)
            self.user_tasks.pop(state_key, None)
            if chat_key != state_key:
                self.user_tasks.pop(chat_key, None)
            pending = bridge.pending_messages.get(state_key) or []
            if pending:
                next_chat_id, next_text, next_ctx = pending.pop(0)
                if not pending:
                    bridge.pending_messages.pop(state_key, None)
                asyncio.create_task(self.run_agent(next_chat_id, next_text, **next_ctx))

    app._penglai_runtime_channel_patched = True
    app._penglai_runtime_bridge = bridge
    app._penglai_original_run_agent = original_run_agent
    app.run_agent = types.MethodType(run_agent, app)
    return True
