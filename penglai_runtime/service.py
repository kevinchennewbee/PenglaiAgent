# -*- coding: utf-8 -*-
"""Runtime Hub service layer for real adapters."""

import threading
from threading import Lock

from .hub import PenglaiRuntimeHub
from .contracts import QueueDecision
from .context_events import append_context_event
from .port import GenericAgentPort
from .runner import AgentRunner
from .session import SessionRouter
from .store import RuntimeStateStore


class RuntimeHubService:
    """Long-lived in-process Runtime Hub service.

    Adapters should keep one instance alive and submit normalized InboundEvent
    objects through it.  The service owns per-session serialization and one
    reusable AgentPort per session, so owner desktop/TUI/IM continuity can be
    implemented above GA without changing GA itself.
    """

    def __init__(
        self,
        *,
        owner_user_ids=None,
        store=None,
        store_path=None,
        port_factory=None,
        runner=None,
        context_log_path=None,
    ):
        self.router = SessionRouter(owner_user_ids=owner_user_ids)
        self.runner = runner or AgentRunner(router=self.router)
        self.hub = PenglaiRuntimeHub(runner=self.runner)
        self.store = store or RuntimeStateStore(store_path)
        self.port_factory = port_factory or self._default_port_factory
        self.context_log_path = context_log_path
        self._ports = {}
        self._locks = {}
        self._guard = Lock()
        # Per-session FIFO of queued dispatch contexts.  A queued event must
        # keep the port/callback/kwargs supplied by the adapter that submitted
        # it; reusing the active event's port leaks platform UI state such as
        # Feishu task cards.
        self._pending_dispatch = {}

    def _default_port_factory(self, session, event):
        return GenericAgentPort(source=event.channel)

    def _session_lock(self, session_id):
        with self._guard:
            lock = self._locks.get(session_id)
            if lock is None:
                lock = Lock()
                self._locks[session_id] = lock
            return lock

    def _session_port(self, session, event):
        with self._guard:
            port = self._ports.get(session.session_id)
            if port is None:
                port = self.port_factory(session, event)
                self._ports[session.session_id] = port
            return port

    def _context_enabled_for(self, event, session):
        if not self.context_log_path:
            return False
        if session.scope == "owner":
            return True
        return event.channel in {"desktop", "tui", "runtime-cli"}

    def _context_text_for_event(self, event):
        parts = []
        text = str(event.text or "").strip()
        if text:
            parts.append(text)
        if event.images:
            parts.append(f"[图片 {len(event.images)} 张]")
        if event.files:
            parts.append(f"[文件 {len(event.files)} 个]")
        if event.voice:
            parts.append(f"[语音 {len(event.voice)} 条]")
        return " ".join(parts).strip()

    def _record_context_event(self, kind, text, event, session, *, task_run=None, status=""):
        if not self._context_enabled_for(event, session):
            return
        text = str(text or "").strip()
        if not text:
            return
        metadata = {
            "session_id": session.session_id,
            "session_scope": session.scope,
            "event_id": event.event_id,
        }
        if task_run is not None:
            metadata["run_id"] = task_run.run_id
            metadata["status"] = task_run.status
        if status:
            metadata["status"] = status
        try:
            append_context_event(
                kind,
                text,
                channel=event.channel,
                actor=event.user_id if kind == "user_message" else "penglai",
                metadata=metadata,
                log_path=self.context_log_path,
            )
        except Exception:
            pass

    def receive_blocking(self, event, port=None, **kwargs):
        """Run one event through the real hub, serialized by session."""
        session = self.router.route(event)
        lock = self._session_lock(session.session_id)
        self.store.record_event(event, session)
        self._record_context_event("user_message", self._context_text_for_event(event), event, session)
        with lock:
            if port is None:
                port = self._session_port(session, event)
            result = self.hub.receive(event, port, **kwargs)
            self.store.record_run(result.task_run)
            self._record_context_event(
                "assistant_result",
                result.cleaned_output or result.task_run.result_text,
                event,
                session,
                task_run=result.task_run,
            )
            self.hub.complete(session.session_id)
            return result

    def submit(self, event, *, port=None, on_complete=None, **kwargs):
        """Non-blocking entry: queue the event and return a QueueDecision.

        - started_now=True: a background worker runs the event now; when it
          finishes the dispatcher pops the next queued event (if any) and
          runs it, marking it ``new_turn`` so the port resets GA history.
        - started_now=False: the event is queued; the caller should show a
          "queued #N" notice and return.  No blocking.

        ``on_complete(result)`` (if provided) is invoked on the worker thread
        after each event finishes, with the AgentRunResult.
        """
        session = self.router.route(event)
        self.store.record_event(event, session)
        self._record_context_event("user_message", self._context_text_for_event(event), event, session)
        lock = self._session_lock(session.session_id)
        if port is None:
            port = self._session_port(session, event)
        # Enqueue via the raw SessionQueue (non-blocking), NOT runner.submit
        # (which executes synchronously for started_now events).
        decision = self.runner.queue.submit(session.session_id, event)
        task_run = self.runner._new_task_run(event, session, decision)
        if not decision.started_now:
            # Queued: stash this event's own dispatch context so the dispatcher
            # can later use the correct adapter port and result callback.
            with self._guard:
                self._pending_dispatch.setdefault(session.session_id, []).append(
                    (event.event_id, port, on_complete, dict(kwargs))
                )
            return decision
        # Started now: run on a worker thread so submit() returns immediately.
        worker = threading.Thread(
            target=self._run_and_dispatch,
            args=(session, event, task_run, decision, port, on_complete, kwargs),
            name=f"penglai-dispatch-{session.session_id}",
            daemon=True,
        )
        worker.start()
        return decision

    def _run_and_dispatch(self, session, event, task_run, decision, port, on_complete, kwargs):
        """Run ``event`` then pop+run any queued events for the same session.

        The first event keeps its original metadata (continues GA history).
        Every subsequently dispatched event is marked ``new_turn=True`` so the
        port resets GA history — queued tasks are independent, not follow-ups.
        """
        session_id = session.session_id
        lock = self._session_lock(session_id)
        # First event: runner.submit already created the task_run.
        with lock:
            result = self.runner.run_started(event, task_run, decision, port, **kwargs)
            self.store.record_run(result.task_run)
            self._record_context_event(
                "assistant_result",
                result.cleaned_output or result.task_run.result_text,
                event,
                session,
                task_run=result.task_run,
            )
            if on_complete is not None:
                try:
                    on_complete(result)
                except Exception:
                    pass
            next_event = self.runner.complete(session_id)
        # Subsequent queued events.
        while next_event is not None:
            # Brief gap between queued tasks to avoid hammering LLM rate limits
            # (e.g. Ark free tier 429).  0.3.0 is single-worker; the gap is
            # cheap and the user already waited through the first task.
            threading.Event().wait(2.0)
            if next_event.metadata is None:
                next_event.metadata = {}
            next_event.metadata["new_turn"] = True
            # Retrieve the port/callback/kwargs stashed when this event was queued.
            queued_port = port
            queued_cb = None
            queued_kwargs = kwargs
            with self._guard:
                cb_list = self._pending_dispatch.get(session_id, [])
                for i, (eid, stored_port, cb, stored_kwargs) in enumerate(cb_list):
                    if eid == next_event.event_id:
                        queued_port = stored_port or port
                        queued_cb = cb
                        queued_kwargs = stored_kwargs or kwargs
                        cb_list.pop(i)
                        break
                if not cb_list:
                    self._pending_dispatch.pop(session_id, None)
            queued_decision = QueueDecision(
                session_id=session_id,
                accepted=True,
                started_now=True,
                queue_no=0,
                reason="dispatched",
            )
            with lock:
                result = self.runner.run_queued(next_event, queued_decision, queued_port, **queued_kwargs)
                self.store.record_run(result.task_run)
                self._record_context_event(
                    "assistant_result",
                    result.cleaned_output or result.task_run.result_text,
                    next_event,
                    session,
                    task_run=result.task_run,
                )
                if queued_cb is not None:
                    try:
                        queued_cb(result)
                    except Exception:
                        pass
                next_event = self.runner.complete(session_id)

    def recent_runs(self, *, session_id=None, limit=20):
        return self.store.recent_runs(session_id=session_id, limit=limit)

    def get_run(self, run_id):
        run = self.runner.get_run(run_id)
        if run is not None:
            permission = run.permission
            return {
                "run_id": run.run_id,
                "event_id": run.event_id,
                "session_id": run.session_id,
                "status": run.status,
                "worker_id": run.worker_id,
                "created_at": run.created_at,
                "started_at": run.started_at,
                "finished_at": run.finished_at,
                "result_text": run.result_text,
                "error": run.error,
                "permission": (
                    {
                        "request_id": permission.request_id,
                        "action": permission.action,
                        "prompt": permission.prompt,
                        "options": list(permission.options),
                        "metadata": permission.metadata or {},
                    }
                    if permission else {}
                ),
                "artifacts": list(run.artifacts or ()),
                "log_excerpt": run.log_excerpt,
                "metadata": run.metadata,
            }
        return self.store.get_run(run_id)

    def status(self, session_id):
        return self.hub.status(session_id)

    def status_for_event(self, event):
        session = self.router.route(event)
        return self.status(session.session_id)

    def cancel_session(self, session_id, *, drop_pending=False):
        next_event = self.hub.cancel(session_id, drop_pending=drop_pending)
        for run_id in self.runner._session_run_ids.get(str(session_id), ()):
            run = self.runner.get_run(run_id)
            if run is not None:
                self.store.record_run(run)
        return {
            "session_id": str(session_id),
            "next_event_id": getattr(next_event, "event_id", "") if next_event else "",
            "status": self.status(session_id),
        }
