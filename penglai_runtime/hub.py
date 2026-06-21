# -*- coding: utf-8 -*-
"""Small Penglai runtime facade used by tests and channel adapters."""

from .runner import AgentRunner


class PenglaiRuntimeHub:
    """Stable facade around Penglai-owned runtime contracts.

    Channel adapters should normalize their input into InboundEvent and call
    this facade.  GA remains the handler behind the facade.
    """

    def __init__(self, *, runner=None, owner_user_ids=None):
        self.runner = runner or AgentRunner(owner_user_ids=owner_user_ids)

    def receive(self, event, handler=None, **kwargs):
        return self.runner.submit(event, handler, **kwargs)

    def complete(self, session_id):
        return self.runner.complete(session_id)

    def cancel(self, session_id, *, drop_pending=False):
        return self.runner.cancel(session_id, drop_pending=drop_pending)
