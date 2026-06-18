# -*- coding: utf-8 -*-
"""Text fallback adapter for GA ask_user events on IM channels.

Feishu can render native cards. Other IM adapters can still share the same
InteractionRequest contract by rendering a numbered text prompt and feeding the
chosen value back into the next agent turn.
"""

import asyncio
import queue as Q
import time
import traceback
import types
import uuid

from .interaction import (
    INTERACTION_PROMPT_HINT,
    interaction_request_from_turn,
    render_interaction_text,
    resolve_interaction_choice,
)


def _default_file_hint():
    try:
        from frontends.chatapp_common import FILE_HINT
        return FILE_HINT
    except Exception:
        return "If you need to show files to user, use [FILE:filepath] in your response."


def _compose_prompt(file_hint, text):
    return f"{file_hint}\n{INTERACTION_PROMPT_HINT}\n\n{text}"


def install_text_interaction_adapter(app, *, file_hint=None, include_click_hint=False):
    """Patch an IM app instance so GA ask_user works without channel buttons.

    This is a Penglai wrapper-layer adapter. It does not alter GA core or the
    upstream frontend modules; it only replaces the live app instance's
    run_agent method after the app is created by the Penglai launcher.
    """
    if getattr(app, "_penglai_text_interaction_patched", False):
        return False
    agent = getattr(app, "agent", None)
    if agent is None or not hasattr(app, "send_text"):
        return False

    pending = {}
    file_hint = file_hint or _default_file_hint()
    original_run_agent = getattr(app, "run_agent", None)

    async def run_agent(self, chat_id, text, **ctx):
        waiting = pending.get(chat_id)
        if waiting:
            chosen = resolve_interaction_choice(text, waiting)
            if chosen is None:
                await self.send_text(chat_id, render_interaction_text(waiting), **ctx)
                return
            pending.pop(chat_id, None)
            text = chosen

        state = {"running": True}
        self.user_tasks[chat_id] = state
        hook_key = f"penglai_text_{getattr(self, 'source', 'im')}_{chat_id}_{uuid.uuid4().hex}"
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
                print(f"[penglai text interaction] hook error: {e}")

        try:
            await self.send_text(chat_id, "思考中...", **ctx)
            if not hasattr(self.agent, "_turn_end_hooks"):
                self.agent._turn_end_hooks = {}
            self.agent._turn_end_hooks[hook_key] = hook
            source = getattr(self, "source", "chat")
            dq = self.agent.put_task(_compose_prompt(file_hint, text), source=source)
            last_ping = time.time()
            ping_interval = getattr(self, "ping_interval", 20)

            while state["running"] and not result["sent"]:
                if result["request"] is not None:
                    break
                try:
                    item = await asyncio.to_thread(dq.get, True, 1)
                except Q.Empty:
                    if getattr(self.agent, "is_running", False) and time.time() - last_ping > ping_interval:
                        await self.send_text(chat_id, "⏳ 还在处理中，请稍等...", **ctx)
                        last_ping = time.time()
                    continue
                if item and "done" in item:
                    finish(item.get("done", ""))

            if result["request"] is not None:
                pending[chat_id] = result["request"]
                await self.send_text(
                    chat_id,
                    render_interaction_text(result["request"], include_click_hint=include_click_hint),
                    **ctx,
                )
            elif result["raw"] is not None:
                await self.send_done(chat_id, result["raw"], **ctx)
            elif not state["running"]:
                await self.send_text(chat_id, "⏹️ 已停止", **ctx)
            else:
                await self.send_text(chat_id, "⚠️ Agent 异常退出，请重试", **ctx)
        except Exception as e:
            print(f"[{getattr(self, 'label', 'IM')}] text interaction run_agent error: {e}")
            traceback.print_exc()
            await self.send_text(chat_id, f"❌ 错误: {e}", **ctx)
        finally:
            if hasattr(self.agent, "_turn_end_hooks"):
                self.agent._turn_end_hooks.pop(hook_key, None)
            self.user_tasks.pop(chat_id, None)

    app._penglai_text_interaction_patched = True
    app._penglai_text_interaction_pending = pending
    app._penglai_original_run_agent = original_run_agent
    app.run_agent = types.MethodType(run_agent, app)
    return True
