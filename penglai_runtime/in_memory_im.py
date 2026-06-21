# -*- coding: utf-8 -*-
"""In-memory IM adapter for contract tests and runtime shadow experiments."""

from .contracts import InboundEvent
from .delivery import DeliveryService
from .queueing import SessionQueue
from .session import SessionRouter


class InMemoryIMAdapter:
    """A test adapter that records delivery decisions without network effects."""

    def __init__(self, owner_user_ids=None):
        self.router = SessionRouter(owner_user_ids=owner_user_ids)
        self.queue = SessionQueue()
        self.sent_texts = []
        self.sent_files = []
        self.delivery = DeliveryService(
            send_file=self._send_file,
            send_text=self._send_text,
        )

    def receive(self, event):
        if not isinstance(event, InboundEvent):
            raise TypeError("event must be an InboundEvent")
        session = self.router.route(event)
        decision = self.queue.submit(session.session_id, event)
        return session, decision

    def finish(self, session_id):
        return self.queue.finish(session_id)

    def deliver(self, raw_text, *, base_dir=None, exclude_paths=None):
        return self.delivery.deliver(
            raw_text,
            base_dir=base_dir,
            exclude_paths=exclude_paths,
        )

    def _send_text(self, text):
        self.sent_texts.append(text)
        return True

    def _send_file(self, path):
        self.sent_files.append(path)
        return True
