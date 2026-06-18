# -*- coding: utf-8 -*-
"""Fake IM adapter for contract tests and V5 shadow experiments."""

from .contracts import InboundEvent
from .delivery import plan_delivery
from .queueing import SessionQueue
from .session import SessionRouter


class FakeIMAdapter:
    """A minimal adapter that records delivery decisions without side effects."""

    def __init__(self, owner_user_ids=None):
        self.router = SessionRouter(owner_user_ids=owner_user_ids)
        self.queue = SessionQueue()
        self.sent_texts = []
        self.sent_files = []

    def receive(self, event):
        if not isinstance(event, InboundEvent):
            raise TypeError("event must be an InboundEvent")
        session = self.router.route(event)
        decision = self.queue.submit(session.session_id, event)
        return session, decision

    def finish(self, session_id):
        return self.queue.finish(session_id)

    def deliver(self, raw_text, *, base_dir=None, exclude_paths=None):
        plan = plan_delivery(raw_text, base_dir=base_dir, exclude_paths=exclude_paths)
        if plan.body:
            self.sent_texts.append(plan.body)
        for path in plan.allowed_paths:
            self.sent_files.append(path)
        notice = plan.blocked_notice(sent_count=len(plan.allowed_paths))
        if notice:
            self.sent_texts.append(notice)
        return plan
