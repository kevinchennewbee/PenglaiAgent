# -*- coding: utf-8 -*-
"""Deterministic Penglai runtime coordinator for contract tests.

AgentRunner is not a new agent and does not replace GA.  It coordinates the
Penglai-owned contracts around GA: session routing, queue decisions, output
cleanup, delivery planning, and memory-write hygiene.
"""

from dataclasses import dataclass
from typing import Any, Callable, Optional

from .contracts import (
    InboundEvent,
    PermissionRequest,
    QueueDecision,
    RunStatus,
    SessionRef,
    TaskRun,
)
from .delivery import DeliveryResult, DeliveryService
from .interaction import InteractionRequest
from .memory_governor import MemoryDecision, MemoryGovernor
from .output_cleaner import clean_final_text
from .port import coerce_agent_port
from .queueing import SessionQueue
from .session import SessionRouter


@dataclass(frozen=True)
class AgentRunResult:
    event: InboundEvent
    session: SessionRef
    decision: QueueDecision
    task_run: TaskRun
    raw_output: str = ""
    cleaned_output: str = ""
    delivery: Optional[DeliveryResult] = None
    interaction: Optional[InteractionRequest] = None
    permission: Optional[PermissionRequest] = None
    memory: Optional[MemoryDecision] = None

    @property
    def queued(self):
        return self.decision.accepted and not self.decision.started_now

    @property
    def status(self):
        return self.task_run.status


class AgentRunner:
    """Coordinate one normalized event through Penglai-owned contracts."""

    def __init__(
        self,
        *,
        owner_user_ids=None,
        router=None,
        queue=None,
        delivery=None,
        memory=None,
    ):
        self.router = router or SessionRouter(owner_user_ids=owner_user_ids)
        self.queue = queue or SessionQueue()
        self.delivery = delivery or DeliveryService()
        self.memory = memory or MemoryGovernor()
        self.runs = {}
        self._event_run_ids = {}
        self._active_run_ids = {}
        self._session_run_ids = {}

    def submit(
        self,
        event,
        handler: Optional[Callable[[InboundEvent], Any]] = None,
        *,
        base_dir=None,
        exclude_paths=None,
        send_body=True,
        send_notice=True,
        fail_on_delivery_failure=False,
    ):
        if not isinstance(event, InboundEvent):
            raise TypeError("event must be an InboundEvent")
        session = self.router.route(event)
        decision = self.queue.submit(session.session_id, event)
        task_run = self._new_task_run(event, session, decision)
        if not decision.started_now:
            return AgentRunResult(
                event=event,
                session=session,
                decision=decision,
                task_run=task_run,
            )

        port = coerce_agent_port(handler)
        worker_id = getattr(port, "worker_id", None) if port is not None else "single-worker"
        task_run.start(worker_id=worker_id)
        self._active_run_ids[session.session_id] = task_run.run_id
        return self._execute(event, session, decision, task_run, port, base_dir=base_dir,
                             exclude_paths=exclude_paths, send_body=send_body, send_notice=send_notice,
                             fail_on_delivery_failure=fail_on_delivery_failure)

    def run_started(self, event, task_run, decision, port, *, base_dir=None, exclude_paths=None,
                    send_body=True, send_notice=True, fail_on_delivery_failure=False):
        """Execute an event whose TaskRun was already created by submit.

        Used by the service dispatcher for the first (non-queued) event.
        Starts the task_run and records it as the active run for the session.
        """
        session = self.router.route(event)
        if task_run.status == RunStatus.PENDING:
            task_run.start(worker_id=getattr(port, "worker_id", None))
        self._active_run_ids[session.session_id] = task_run.run_id
        return self._execute(event, session, decision, task_run, port,
                             base_dir=base_dir, exclude_paths=exclude_paths,
                             send_body=send_body, send_notice=send_notice,
                             fail_on_delivery_failure=fail_on_delivery_failure)

    def run_queued(self, event, decision, port, *, base_dir=None, exclude_paths=None,
                   send_body=True, send_notice=True, fail_on_delivery_failure=False):
        """Execute a queued event (popped by the dispatcher after complete()).

        ``event.metadata['new_turn']`` is expected to be set by the caller so
        the port resets GA history.  A fresh TaskRun is created and started;
        queue.submit is NOT called again (the event was already queued).
        """
        session = self.router.route(event)
        task_run = self._new_task_run(event, session, decision)
        task_run.start(worker_id=getattr(port, "worker_id", None))
        self._active_run_ids[session.session_id] = task_run.run_id
        return self._execute(event, session, decision, task_run, port,
                             base_dir=base_dir, exclude_paths=exclude_paths,
                             send_body=send_body, send_notice=send_notice,
                             fail_on_delivery_failure=fail_on_delivery_failure)

    def _execute(self, event, session, decision, task_run, port, *,
                 base_dir=None, exclude_paths=None, send_body=True, send_notice=True,
                 fail_on_delivery_failure=False):
        try:
            raw, interaction, permission = self._run_port(event, port)
        except Exception as exc:
            if not task_run.terminal:
                task_run.fail(exc)
            task_run.log_excerpt = str(exc or "")[:1000]
            return AgentRunResult(
                event=event,
                session=session,
                decision=decision,
                task_run=task_run,
                raw_output="",
                cleaned_output="",
            )
        if task_run.terminal:
            return AgentRunResult(
                event=event,
                session=session,
                decision=decision,
                task_run=task_run,
                raw_output=raw,
                cleaned_output="",
            )
        if interaction is None and permission is None and not str(raw or "").strip():
            exc = RuntimeError("模型结束但没有返回可见结果")
            task_run.fail(exc)
            task_run.log_excerpt = str(exc)[:1000]
            return AgentRunResult(
                event=event,
                session=session,
                decision=decision,
                task_run=task_run,
                raw_output="",
                cleaned_output="",
            )
        cleaned = clean_final_text(raw)
        if interaction is None and permission is None and not str(cleaned or "").strip():
            exc = RuntimeError("模型结束但没有返回可见结果")
            task_run.fail(exc)
            task_run.log_excerpt = str(raw or exc)[:1000]
            return AgentRunResult(
                event=event,
                session=session,
                decision=decision,
                task_run=task_run,
                raw_output=raw,
                cleaned_output=cleaned,
            )
        delivery_result = None
        if raw and interaction is None and permission is None:
            delivery_result = self.delivery.deliver(
                raw,
                base_dir=base_dir,
                exclude_paths=exclude_paths,
                send_body=send_body,
                send_notice=send_notice,
            )
        memory_decision = self.memory.classify(raw or event.text)
        if fail_on_delivery_failure and delivery_result is not None:
            if delivery_result.failed_body or delivery_result.failed_paths:
                reason = "投递失败"
                failed = []
                if delivery_result.failed_body:
                    failed.append("body")
                failed.extend(delivery_result.failed_paths)
                if failed:
                    reason += ": " + ", ".join(str(item) for item in failed[:5])
                task_run.fail(reason)
                task_run.log_excerpt = reason[:1000]
                task_run.metadata["delivery_failed"] = {
                    "body": bool(delivery_result.failed_body),
                    "files": list(delivery_result.failed_paths),
                }
                return AgentRunResult(
                    event=event,
                    session=session,
                    decision=decision,
                    task_run=task_run,
                    raw_output=raw,
                    cleaned_output=cleaned,
                    delivery=delivery_result,
                    memory=memory_decision,
                )
        if permission is not None:
            task_run.wait_permission(permission)
        elif interaction is not None:
            permission = self._permission_from_interaction(interaction)
            task_run.wait_permission(permission)
        else:
            if task_run.terminal:
                return AgentRunResult(
                    event=event,
                    session=session,
                    decision=decision,
                    task_run=task_run,
                    raw_output=raw,
                    cleaned_output=cleaned,
                    delivery=delivery_result,
                    memory=memory_decision,
                )
            artifacts = ()
            if delivery_result is not None:
                artifacts = (
                    delivery_result.sent_paths
                    or delivery_result.skipped_paths
                    or delivery_result.plan.allowed_paths
                )
                task_run.metadata["delivery"] = {
                    "sent": len(delivery_result.sent_paths),
                    "skipped": len(delivery_result.skipped_paths),
                    "blocked": len(delivery_result.plan.withheld),
                    "failed": len(delivery_result.failed_paths),
                }
            task_run.succeed(cleaned, artifacts=artifacts)
        return AgentRunResult(
            event=event,
            session=session,
            decision=decision,
            task_run=task_run,
            raw_output=raw,
            cleaned_output=cleaned,
            delivery=delivery_result,
            interaction=interaction,
            permission=permission,
            memory=memory_decision,
        )

    def complete(self, session_id):
        sid = str(session_id)
        self._active_run_ids.pop(sid, None)
        return self.queue.finish(sid)

    def cancel(self, session_id, *, drop_pending=False):
        sid = str(session_id)
        active = self._active_run_ids.pop(sid, None)
        if active and active in self.runs:
            self.runs[active].cancel("cancelled by runtime")
        if drop_pending:
            for run_id in self._session_run_ids.get(sid, ()):
                run = self.runs.get(run_id)
                if run and run.status == RunStatus.PENDING:
                    run.cancel("dropped by runtime")
        return self.queue.cancel(sid, drop_pending=drop_pending)

    def status(self, session_id):
        sid = str(session_id)
        queue_status = self.queue.status(sid)
        active_id = self._active_run_ids.get(sid, "")
        active = self.runs.get(active_id)
        return {
            "session_id": sid,
            "queue": queue_status,
            "active_run_id": active_id,
            "active_status": active.status if active else "",
            "run_count": len(self._session_run_ids.get(sid, ())),
        }

    def get_run(self, run_id):
        return self.runs.get(str(run_id))

    def _new_task_run(self, event, session, decision):
        existing_id = self._event_run_ids.get(event.event_id)
        existing = self.runs.get(existing_id) if existing_id else None
        if existing is not None and existing.status == RunStatus.PENDING:
            existing.metadata.update(
                {
                    "channel": event.channel,
                    "scope": session.scope,
                    "queue_no": decision.queue_no,
                    "queue_reason": decision.reason,
                }
            )
            return existing
        task = TaskRun(
            event_id=event.event_id,
            session_id=session.session_id,
            metadata={
                "channel": event.channel,
                "scope": session.scope,
                "queue_no": decision.queue_no,
                "queue_reason": decision.reason,
            },
        )
        self.runs[task.run_id] = task
        self._event_run_ids[event.event_id] = task.run_id
        self._session_run_ids.setdefault(session.session_id, []).append(task.run_id)
        return task

    def _run_port(self, event, port):
        if port is None:
            return "", None, None
        value = port.run(event)
        permission = None
        if isinstance(value, InteractionRequest):
            return "", value, None
        if isinstance(value, PermissionRequest):
            return "", None, value
        if isinstance(value, dict):
            raw = str(value.get("text") or value.get("raw") or "")
            interaction = value.get("interaction")
            if interaction is not None and not isinstance(interaction, InteractionRequest):
                raise TypeError("interaction must be an InteractionRequest")
            permission = value.get("permission")
            if permission is not None and not isinstance(permission, PermissionRequest):
                raise TypeError("permission must be a PermissionRequest")
            return raw, interaction, permission
        return str(value or ""), None, None

    def _permission_from_interaction(self, interaction):
        labels = tuple(option.display for option in interaction.options)
        values = tuple(option.value or option.label for option in interaction.options)
        return PermissionRequest(
            action="interaction",
            prompt=interaction.question,
            options=labels,
            request_id=interaction.request_id,
            metadata={
                "title": interaction.title,
                "option_labels": labels,
                "option_values": values,
                "allow_free_text": interaction.allow_free_text,
            },
        )
