# -*- coding: utf-8 -*-
"""Small data contracts for the Penglai runtime layer."""

from dataclasses import dataclass, field
import time
import uuid
from typing import Any, Dict, Optional, Tuple


def _new_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex}"


class RunStatus:
    """Stable runtime status strings for TaskRun and adapters."""

    PENDING = "pending"
    RUNNING = "running"
    WAITING_PERMISSION = "waiting_permission"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = {SUCCEEDED, FAILED, CANCELLED}


@dataclass(frozen=True)
class InboundEvent:
    """Normalized user input from IM, desktop, or voice.

    Channel adapters should create this record and keep channel-specific API
    details outside the core runtime path.
    """

    event_id: str
    channel: str
    user_id: str
    text: str = ""
    chat_id: str = ""
    chat_type: str = "private"  # private | group | room
    images: Tuple[str, ...] = ()
    files: Tuple[str, ...] = ()
    voice: Tuple[str, ...] = ()
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_group(self) -> bool:
        return self.chat_type in {"group", "room"}


@dataclass(frozen=True)
class SessionRef:
    """Resolved Penglai session identity."""

    session_id: str
    scope: str  # owner | private | group
    channel: str
    user_id: str
    chat_id: str = ""


@dataclass(frozen=True)
class QueueDecision:
    """Result of submitting an event to a per-session FIFO queue."""

    session_id: str
    accepted: bool
    started_now: bool
    queue_no: int = 0
    reason: str = ""


@dataclass(frozen=True)
class PermissionRequest:
    """Unified request for user confirmation or authorization."""

    action: str
    prompt: str
    options: Tuple[str, ...] = ()
    request_id: str = field(default_factory=lambda: _new_id("perm"))
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not str(self.action or "").strip():
            raise ValueError("PermissionRequest.action must not be empty")
        if not str(self.prompt or "").strip():
            raise ValueError("PermissionRequest.prompt must not be empty")
        object.__setattr__(self, "options", tuple(str(x) for x in (self.options or ())))


@dataclass
class TaskRun:
    """One Penglai runtime task run bound to a normalized event and session."""

    event_id: str
    session_id: str
    run_id: str = field(default_factory=lambda: _new_id("run"))
    status: str = RunStatus.PENDING
    worker_id: str = "single-worker"
    created_at: float = field(default_factory=time.time)
    started_at: float = 0.0
    finished_at: float = 0.0
    result_text: str = ""
    error: str = ""
    permission: Optional[PermissionRequest] = None
    artifacts: Tuple[str, ...] = ()
    log_excerpt: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def terminal(self):
        return self.status in RunStatus.TERMINAL

    def _terminal_blocked(self, attempted):
        self.metadata.setdefault("blocked_terminal_transitions", []).append(
            {
                "from": self.status,
                "to": str(attempted),
                "ts": time.time(),
            }
        )
        return self

    def start(self, *, worker_id=None):
        if self.terminal:
            return self._terminal_blocked(RunStatus.RUNNING)
        if worker_id:
            self.worker_id = str(worker_id)
        self.status = RunStatus.RUNNING
        self.started_at = self.started_at or time.time()
        return self

    def wait_permission(self, request):
        if self.terminal:
            return self._terminal_blocked(RunStatus.WAITING_PERMISSION)
        self.status = RunStatus.WAITING_PERMISSION
        self.permission = request
        self.finished_at = time.time()
        return self

    def succeed(self, text="", *, artifacts=()):
        if self.terminal:
            return self._terminal_blocked(RunStatus.SUCCEEDED)
        self.status = RunStatus.SUCCEEDED
        self.result_text = str(text or "")
        self.artifacts = tuple(str(path) for path in (artifacts or ()) if str(path))
        self.finished_at = time.time()
        return self

    def fail(self, error):
        if self.terminal:
            return self._terminal_blocked(RunStatus.FAILED)
        self.status = RunStatus.FAILED
        self.error = str(error or "")
        self.finished_at = time.time()
        return self

    def cancel(self, reason=""):
        if self.terminal:
            return self._terminal_blocked(RunStatus.CANCELLED)
        self.status = RunStatus.CANCELLED
        self.error = str(reason or "cancelled")
        self.finished_at = time.time()
        return self
