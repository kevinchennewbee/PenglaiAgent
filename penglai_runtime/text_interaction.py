# -*- coding: utf-8 -*-
"""Text fallback adapter for GA ask_user events on IM channels.

This module is now a compatibility facade over the shared Penglai channel runtime.
Existing launchers can keep calling install_text_interaction_adapter(), while
the actual main path goes through InboundEvent, SessionRouter, InteractionRequest,
MemoryGovernor, and shadow delivery contracts.
"""

from .channel_runtime import compose_prompt, default_file_hint, install_channel_runtime_adapter


def _default_file_hint():
    return default_file_hint()


def _compose_prompt(file_hint, text):
    return compose_prompt(text, file_hint=file_hint)


def install_text_interaction_adapter(app, *, file_hint=None, include_click_hint=False):
    ok = install_channel_runtime_adapter(
        app,
        file_hint=file_hint or _default_file_hint(),
        include_click_hint=include_click_hint,
    )
    if ok:
        app._penglai_text_interaction_patched = True
        app._penglai_text_interaction_pending = app._penglai_runtime_bridge.pending_permissions
    return ok
