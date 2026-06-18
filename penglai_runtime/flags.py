# -*- coding: utf-8 -*-
"""Feature flags for V5 test behavior."""

import os


def env_flag(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return bool(default)
    return str(raw).strip().lower() in {"1", "true", "yes", "on", "y"}


def runtime_enabled():
    return env_flag("PENGLAI_RUNTIME_HUB", False)


def shadow_enabled():
    return env_flag("PENGLAI_RUNTIME_HUB_SHADOW", False)
