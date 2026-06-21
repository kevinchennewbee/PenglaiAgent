# -*- coding: utf-8 -*-
"""Memory-write hygiene for the Penglai runtime layer.

This module does not replace GA memory.  It classifies whether Penglai should
even propose a memory write, so runtime noise and channel artifacts do not
pollute scarce long-term memory.
"""

from dataclasses import dataclass
import re
from typing import Tuple

from .shadow import redact_text


_RUNTIME_NOISE_RE = re.compile(
    r"(LLM Running|调用工具|code_run|file_read|file_write|模型输出被截断|"
    r"<summary>|</summary>|<think>|</think>|Turn\s+\d+|message_id|file_key|"
    r"tenant_access_token|penglai_runtime_shadow|send status\s+200)",
    re.I,
)
_SECRET_RE = re.compile(
    r"(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+|"
    r"(api[_-]?key|token|secret|password|client_secret|app_secret)\s*[:=])",
    re.I,
)
_PREFERENCE_RE = re.compile(
    r"(以后|下次|默认|长期|记住|保存记忆|不要再|不能|必须|只能|优先|固定流程|规则)"
)
_PROJECT_RULE_RE = re.compile(
    r"(GA上游|GenericAgent|蓬莱层|Mac mini|macmini|腾讯云|release/main|"
    r"main分支|飞书|微信|IM|客户端|全新架构|runtime|0\.2\.\d+|0\.3\.\d+)",
    re.I,
)
_WORKING_RE = re.compile(r"(bug|问题|失败|报错|修复|待办|验证|测试|hotfix|回归|发布)", re.I)


@dataclass(frozen=True)
class MemoryDecision:
    level: str
    should_write: bool
    reason: str
    text: str = ""
    signals: Tuple[str, ...] = ()


class MemoryGovernor:
    """Classify memory candidates without writing them.

    Levels are intentionally coarse:
    - none: do not write
    - working: task-local/project-local note candidate
    - user_pref: durable user preference or workflow boundary
    - global_rule: durable project rule that affects future sessions
    """

    def classify(self, text, *, context=None):
        raw = str(text or "").strip()
        if not raw:
            return MemoryDecision("none", False, "empty")

        signals = []
        if _SECRET_RE.search(raw):
            return MemoryDecision(
                "none",
                False,
                "contains_secret_shape",
                redact_text(raw)[:500],
                ("secret",),
            )

        if _RUNTIME_NOISE_RE.search(raw):
            signals.append("runtime_noise")
            if not _PREFERENCE_RE.search(raw):
                return MemoryDecision(
                    "none",
                    False,
                    "runtime_or_tool_noise",
                    redact_text(raw)[:500],
                    tuple(signals),
                )

        has_pref = bool(_PREFERENCE_RE.search(raw))
        has_project = bool(_PROJECT_RULE_RE.search(raw))
        has_working = bool(_WORKING_RE.search(raw))

        if has_pref and has_project:
            level = "global_rule" if re.search(r"(必须|只能|不能|规则|固定流程)", raw) else "user_pref"
            signals.extend(["preference", "project"])
            return MemoryDecision(level, True, "durable_project_preference", redact_text(raw)[:500], tuple(signals))

        if has_pref:
            signals.append("preference")
            return MemoryDecision("user_pref", True, "durable_user_preference", redact_text(raw)[:500], tuple(signals))

        if has_project and has_working:
            signals.extend(["project", "working"])
            return MemoryDecision("working", True, "project_working_context", redact_text(raw)[:500], tuple(signals))

        if has_working:
            signals.append("working")
            return MemoryDecision("working", True, "task_working_context", redact_text(raw)[:500], tuple(signals))

        return MemoryDecision("none", False, "ordinary_chat")
