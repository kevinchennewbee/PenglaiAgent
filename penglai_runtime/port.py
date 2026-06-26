# -*- coding: utf-8 -*-
"""Thin AgentPort adapters for the Penglai Runtime Hub."""

import queue
import threading
import time
import uuid

from .interaction import interaction_request_from_turn


PENGLAI_IDENTITY_PROMPT = (
    "\n[蓬莱身份] 你是「蓬莱助手」，基于 GenericAgent 的开源个人管家发行版蓬莱。"
    "用户称呼你为\"主人\"。被问及身份/名字时以此为准，严禁自称底层模型名"
    "(如 MiniMax/Claude/GPT 等)或 API 提供商名。"
)


def ensure_penglai_identity_prompt(agent):
    """Attach Penglai release identity via GA's generic extra_sys_prompts slot.

    Mirrors upstream c85b59e: frontends push prompt strings into
    ``agent.extra_sys_prompts`` (a list) instead of mutating the backend's
    ``extra_sys_prompt`` attribute. Keeps GA core zero-pollution and lets
    Penglai identity ride the same slot as any other frontend injection.
    """
    try:
        slots = getattr(agent, "extra_sys_prompts", None)
        if slots is None:
            # GA core older than c85b59e — fall back to backend attribute.
            llmclient = getattr(agent, "llmclient", None)
            backend = getattr(llmclient, "backend", None)
            if backend is None:
                return
            existing = getattr(backend, "extra_sys_prompt", "") or ""
            if PENGLAI_IDENTITY_PROMPT not in existing:
                backend.extra_sys_prompt = PENGLAI_IDENTITY_PROMPT + "\n" + existing
            return
        if PENGLAI_IDENTITY_PROMPT not in slots:
            slots.append(PENGLAI_IDENTITY_PROMPT)
    except Exception:
        return


class AgentPort:
    """Minimal port used by the runtime runner to call a worker."""

    worker_id = "agent-port"

    def run(self, event):
        raise NotImplementedError


class CallableAgentPort(AgentPort):
    """Wrap an existing callable without changing the GA execution core."""

    def __init__(self, handler, *, worker_id="callable-agent"):
        if not callable(handler):
            raise TypeError("handler must be callable")
        self.handler = handler
        self.worker_id = str(worker_id or "callable-agent")

    def run(self, event):
        return self.handler(event)


def coerce_agent_port(value):
    if value is None:
        return None
    if isinstance(value, AgentPort):
        return value
    run = getattr(value, "run", None)
    if callable(run):
        return value
    if callable(value):
        return CallableAgentPort(value)
    raise TypeError("agent port must expose run(event) or be callable")


class GenericAgentInstancePort(AgentPort):
    """Thin port that calls an already-created GenericAgent instance."""

    worker_id = "generic-agent"

    def __init__(
        self,
        *,
        agent,
        prompt_builder=None,
        source="runtime-hub",
        timeout=1200,
        turn_hook=None,
    ):
        if agent is None:
            raise ValueError("agent must not be None")
        self.agent = agent
        self.prompt_builder = prompt_builder
        self.source = str(source or "runtime-hub")
        self.timeout = float(timeout)
        self.turn_hook = turn_hook

    def _prompt(self, event):
        if callable(self.prompt_builder):
            return self.prompt_builder(event)
        from .channel_runtime import compose_prompt

        return compose_prompt(event.text)

    def run(self, event):
        agent = self.agent
        if agent is None:
            raise RuntimeError("GenericAgent 实例不可用")
        ensure_penglai_identity_prompt(agent)
        # Queued (independent) tasks reset GA history so they don't continue
        # the previous task's context.  Non-queued tasks continue history,
        # preserving owner cross-channel conversation continuity.
        if (getattr(event, "metadata", None) or {}).get("new_turn"):
            try:
                agent.history = []
            except Exception:
                pass
        images = tuple(getattr(event, "images", ()) or ())
        hook_key = f"penglai_rt_{getattr(event, 'event_id', '')}_{uuid.uuid4().hex}"
        state = {"interaction": None, "done": None}

        def hook(turn_ctx):
            try:
                if callable(self.turn_hook):
                    self.turn_hook(turn_ctx)
                request = interaction_request_from_turn(turn_ctx, request_id=hook_key, title="权限确认")
                if request is not None:
                    state["interaction"] = request
                    return
                exit_reason = (turn_ctx or {}).get("exit_reason") or {}
                is_final = (
                    isinstance(exit_reason, dict)
                    and exit_reason.get("result") == "CURRENT_TASK_DONE"
                )
                if is_final:
                    data = exit_reason.get("data")
                    if isinstance(data, str):
                        state["done"] = data
                        return
                    if hasattr(data, "content"):
                        state["done"] = data.content
                        return
                    resp = (turn_ctx or {}).get("response")
                    if resp is not None:
                        state["done"] = resp.content if hasattr(resp, "content") else str(resp)
            except Exception as exc:
                state["done"] = f"GA turn hook error: {exc}"

        if not hasattr(agent, "_turn_end_hooks"):
            agent._turn_end_hooks = {}
        agent._turn_end_hooks[hook_key] = hook
        had_verbose = hasattr(agent, "verbose")
        previous_verbose = getattr(agent, "verbose", None)
        if had_verbose:
            try:
                agent.verbose = False
            except Exception:
                pass
        try:
            try:
                dq = agent.put_task(self._prompt(event), source=self.source, images=images)
            except TypeError:
                dq = agent.put_task(self._prompt(event), source=self.source)
            return self._wait_for_result(dq, state)
        finally:
            if had_verbose:
                try:
                    agent.verbose = previous_verbose
                except Exception:
                    pass
            try:
                agent._turn_end_hooks.pop(hook_key, None)
            except Exception:
                pass

    def _wait_for_result(self, dq, state):
        deadline = time.time() + self.timeout
        last = ""
        while True:
            if state.get("interaction") is not None:
                return {"interaction": state["interaction"]}
            if state.get("done") is not None:
                return state["done"]
            remaining = max(0.1, min(1.0, deadline - time.time()))
            if time.time() >= deadline:
                raise TimeoutError(f"GenericAgentPort timed out after {int(self.timeout)}s")
            try:
                item = dq.get(True, remaining)
            except queue.Empty:
                continue
            if not isinstance(item, dict):
                continue
            if state.get("interaction") is not None:
                return {"interaction": state["interaction"]}
            if state.get("done") is not None:
                return state["done"]
            if "done" in item:
                if state.get("interaction") is not None:
                    return {"interaction": state["interaction"]}
                return item.get("done", "")
            if "next" in item:
                last = item.get("next", last)


class GenericAgentPort(GenericAgentInstancePort):
    """Thin port that creates and calls the existing GenericAgent SDK."""

    def __init__(
        self,
        *,
        agent_factory=None,
        prompt_builder=None,
        source="runtime-hub",
        timeout=1200,
        turn_hook=None,
    ):
        self.agent_factory = agent_factory
        self._owned_agent = None
        self._thread = None
        self.turn_hook = turn_hook
        super().__init__(
            agent=self,
            prompt_builder=prompt_builder,
            source=source,
            timeout=timeout,
            turn_hook=turn_hook,
        )

    def _ensure_agent(self):
        if self._owned_agent is not None:
            return self._owned_agent
        factory = self.agent_factory
        if factory is None:
            from agentmain import GenericAgent

            factory = GenericAgent
        try:
            agent = factory()
        except Exception as exc:
            msg = str(exc) or type(exc).__name__
            if "modulo by zero" in msg or "list index out of range" in msg:
                raise RuntimeError(
                    "GenericAgent 初始化失败：没有可用 LLM 配置；请先配置 mykey.py 或通过 penglai setup 配置模型。"
                ) from exc
            raise RuntimeError(f"GenericAgent 初始化失败：{msg}") from exc
        if not getattr(agent, "llmclients", None):
            raise RuntimeError("GenericAgent 初始化失败：没有可用 LLM 配置；请先配置 mykey.py 或通过 penglai setup 配置模型。")
        agent.verbose = False
        if self._thread is None:
            self._thread = threading.Thread(
                target=agent.run,
                daemon=True,
                name="penglai-runtime-ga",
            )
            self._thread.start()
        self._owned_agent = agent
        return agent

    def run(self, event):
        agent = self._ensure_agent()
        port = GenericAgentInstancePort(
            agent=agent,
            prompt_builder=self.prompt_builder,
            source=self.source,
            timeout=self.timeout,
            turn_hook=self.turn_hook,
        )
        return port.run(event)
