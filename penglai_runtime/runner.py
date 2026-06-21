# -*- coding: utf-8 -*-
"""Deterministic Penglai runtime coordinator for contract tests.

AgentRunner is not a new agent and does not replace GA.  It coordinates the
Penglai-owned contracts around GA: session routing, queue decisions, output
cleanup, delivery planning, and memory-write hygiene.
"""

from dataclasses import dataclass
from typing import Any, Callable, Optional

from .contracts import InboundEvent, QueueDecision, SessionRef
from .delivery import DeliveryResult, DeliveryService
from .interaction import InteractionRequest
from .memory_governor import MemoryDecision, MemoryGovernor
from .output_cleaner import clean_final_text
from .queueing import SessionQueue
from .session import SessionRouter


@dataclass(frozen=True)
class AgentRunResult:
    event: InboundEvent
    session: SessionRef
    decision: QueueDecision
    raw_output: str = ""
    cleaned_output: str = ""
    delivery: Optional[DeliveryResult] = None
    interaction: Optional[InteractionRequest] = None
    memory: Optional[MemoryDecision] = None

    @property
    def queued(self):
        return self.decision.accepted and not self.decision.started_now


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

    def submit(
        self,
        event,
        handler: Optional[Callable[[InboundEvent], Any]] = None,
        *,
        base_dir=None,
        exclude_paths=None,
        send_body=True,
        send_notice=True,
    ):
        if not isinstance(event, InboundEvent):
            raise TypeError("event must be an InboundEvent")
        session = self.router.route(event)
        decision = self.queue.submit(session.session_id, event)
        if not decision.started_now:
            return AgentRunResult(event=event, session=session, decision=decision)

        raw, interaction = self._run_handler(event, handler)
        cleaned = clean_final_text(raw)
        delivery_result = None
        if raw and interaction is None:
            delivery_result = self.delivery.deliver(
                raw,
                base_dir=base_dir,
                exclude_paths=exclude_paths,
                send_body=send_body,
                send_notice=send_notice,
            )
        memory_decision = self.memory.classify(raw or event.text)
        return AgentRunResult(
            event=event,
            session=session,
            decision=decision,
            raw_output=raw,
            cleaned_output=cleaned,
            delivery=delivery_result,
            interaction=interaction,
            memory=memory_decision,
        )

    def complete(self, session_id):
        return self.queue.finish(session_id)

    def cancel(self, session_id, *, drop_pending=False):
        return self.queue.cancel(session_id, drop_pending=drop_pending)

    def _run_handler(self, event, handler):
        if handler is None:
            return "", None
        value = handler(event)
        if isinstance(value, InteractionRequest):
            return "", value
        if isinstance(value, dict):
            raw = str(value.get("text") or value.get("raw") or "")
            interaction = value.get("interaction")
            if interaction is not None and not isinstance(interaction, InteractionRequest):
                raise TypeError("interaction must be an InteractionRequest")
            return raw, interaction
        return str(value or ""), None
