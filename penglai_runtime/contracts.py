# -*- coding: utf-8 -*-
"""Small data contracts for the Penglai Runtime Hub V5 test build."""

from dataclasses import dataclass, field
from typing import Any, Dict, Tuple


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
