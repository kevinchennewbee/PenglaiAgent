# -*- coding: utf-8 -*-
"""Session routing rules for the Penglai runtime surface."""

import re

from .contracts import InboundEvent, SessionRef


def _clean_part(value):
    text = str(value or "").strip()
    text = re.sub(r"[^A-Za-z0-9_.:-]+", "_", text)
    return text.strip("_") or "unknown"


class SessionRouter:
    """Map normalized inbound events to isolated Penglai sessions.

    Owner private entries may share one personal default session.  Group chats
    and non-owner users are isolated by default.
    """

    def __init__(self, owner_user_ids=None, owner_session_id="owner:default"):
        self.owner_user_ids = {str(x) for x in (owner_user_ids or []) if str(x)}
        self.owner_session_id = owner_session_id

    def route(self, event):
        if not isinstance(event, InboundEvent):
            raise TypeError("event must be an InboundEvent")
        channel = _clean_part(event.channel)
        user_id = _clean_part(event.user_id)
        chat_id = _clean_part(event.chat_id or event.user_id)

        if event.is_group:
            return SessionRef(
                session_id=f"{channel}:group:{chat_id}",
                scope="group",
                channel=event.channel,
                user_id=event.user_id,
                chat_id=event.chat_id,
            )

        if event.user_id in self.owner_user_ids:
            return SessionRef(
                session_id=self.owner_session_id,
                scope="owner",
                channel=event.channel,
                user_id=event.user_id,
                chat_id=event.chat_id,
            )

        return SessionRef(
            session_id=f"{channel}:user:{user_id}",
            scope="private",
            channel=event.channel,
            user_id=event.user_id,
            chat_id=event.chat_id,
        )
