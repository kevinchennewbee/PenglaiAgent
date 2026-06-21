# -*- coding: utf-8 -*-
"""Small per-session FIFO queue primitive for runtime tests."""

from collections import defaultdict, deque
from threading import Lock

from .contracts import QueueDecision


class SessionQueue:
    """Track one active task and FIFO pending events per session.

    This is a deterministic primitive for adapters and tests.  It does not run
    GA by itself.
    """

    def __init__(self):
        self._active = set()
        self._pending = defaultdict(deque)
        self._lock = Lock()

    def submit(self, session_id, event):
        sid = str(session_id)
        with self._lock:
            if sid not in self._active:
                self._active.add(sid)
                return QueueDecision(sid, accepted=True, started_now=True)
            self._pending[sid].append(event)
            return QueueDecision(
                sid,
                accepted=True,
                started_now=False,
                queue_no=len(self._pending[sid]),
                reason="session_busy",
            )

    def finish(self, session_id):
        sid = str(session_id)
        with self._lock:
            if self._pending[sid]:
                return self._pending[sid].popleft()
            self._active.discard(sid)
            self._pending.pop(sid, None)
            return None

    def cancel(self, session_id, *, drop_pending=False):
        sid = str(session_id)
        with self._lock:
            if drop_pending:
                self._pending.pop(sid, None)
                self._active.discard(sid)
                return None
            if self._pending[sid]:
                return self._pending[sid].popleft()
            self._active.discard(sid)
            self._pending.pop(sid, None)
            return None

    def pending_count(self, session_id):
        with self._lock:
            return len(self._pending[str(session_id)])

    def is_active(self, session_id):
        with self._lock:
            return str(session_id) in self._active

    def status(self, session_id):
        sid = str(session_id)
        with self._lock:
            return {
                "session_id": sid,
                "active": sid in self._active,
                "pending": len(self._pending[sid]),
            }
