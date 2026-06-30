# -*- coding: utf-8 -*-
"""Penglai runtime contract surface.

This package defines Penglai-layer contracts that can be tested without
changing the GenericAgent execution core.
"""

VERSION = "0.3.4"

from .contracts import InboundEvent, PermissionRequest, RunStatus, SessionRef, TaskRun
from .hub import PenglaiRuntimeHub
from .port import AgentPort, CallableAgentPort, GenericAgentInstancePort, GenericAgentPort
from .service import RuntimeHubService
from .store import RuntimeStateStore
from .control_api import RuntimeControlHTTPServer, make_server as make_runtime_control_server

__all__ = [
    "VERSION",
    "AgentPort",
    "CallableAgentPort",
    "GenericAgentInstancePort",
    "GenericAgentPort",
    "InboundEvent",
    "PenglaiRuntimeHub",
    "PermissionRequest",
    "RunStatus",
    "RuntimeControlHTTPServer",
    "RuntimeHubService",
    "RuntimeStateStore",
    "SessionRef",
    "TaskRun",
    "make_runtime_control_server",
]
