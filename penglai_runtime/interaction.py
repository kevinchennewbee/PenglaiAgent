# -*- coding: utf-8 -*-
"""User interaction contracts for Penglai Runtime Hub V5.

Runtime owns the intent to ask the user.  Adapters own the exact rendering:
Feishu can show buttons, while channels without stable card support can render
the same request as numbered text and feed the reply back through the queue.
"""

from dataclasses import dataclass, field
import re
import uuid


INTERACTION_PROMPT_HINT = (
    "If you need to ask the user to choose, confirm, authorize, or provide "
    "missing information, use the ask_user tool. Penglai will render the "
    "interaction for the current IM channel; do not hand-roll channel-specific "
    "interactive card API calls."
)


@dataclass(frozen=True)
class InteractionOption:
    label: str
    value: str = ""
    description: str = ""

    @property
    def display(self):
        return self.description and f"{self.label}: {self.description}" or self.label


@dataclass(frozen=True)
class InteractionRequest:
    question: str
    options: tuple[InteractionOption, ...]
    request_id: str = ""
    title: str = ""
    allow_free_text: bool = True
    metadata: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.question.strip():
            raise ValueError("InteractionRequest.question must not be empty")
        if not self.options and not self.allow_free_text:
            raise ValueError("InteractionRequest.options must not be empty when free text is disabled")
        if not self.request_id:
            object.__setattr__(self, "request_id", uuid.uuid4().hex)


def _option_from_item(item):
    if isinstance(item, InteractionOption):
        return item
    if isinstance(item, dict):
        label = str(item.get("label") or item.get("text") or item.get("name") or item.get("value") or "").strip()
        value = str(item.get("value") or label).strip()
        description = str(item.get("description") or item.get("desc") or "").strip()
        if not label:
            return None
        return InteractionOption(label=label, value=value, description=description)
    text = str(item or "").strip()
    if not text:
        return None
    return InteractionOption(label=text, value=text)


def normalize_options(raw):
    if not isinstance(raw, (list, tuple)):
        return ()
    out = []
    seen = set()
    for item in raw:
        option = _option_from_item(item)
        if not option:
            continue
        key = option.value or option.label
        if key in seen:
            continue
        seen.add(key)
        out.append(option)
    return tuple(out)


def request_from_ask_user_event(event, *, request_id="", title=""):
    options = normalize_options((event or {}).get("candidates") or [])
    question = str((event or {}).get("question") or "请选择下一步操作：").strip() or "请选择下一步操作："
    return InteractionRequest(
        question=question,
        options=options,
        request_id=request_id,
        title=title,
        allow_free_text=not bool(options),
    )


def extract_interaction_event(ctx):
    exit_reason = (ctx or {}).get("exit_reason") or {}
    if not isinstance(exit_reason, dict) or exit_reason.get("result") != "EXITED":
        return None
    payload = exit_reason.get("data")
    if not isinstance(payload, dict):
        return None
    if payload.get("status") != "INTERRUPT" or payload.get("intent") != "HUMAN_INTERVENTION":
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    question = str(data.get("question") or "请选择下一步操作：").strip() or "请选择下一步操作："
    candidates = []
    for opt in normalize_options(data.get("candidates") or []):
        candidates.append(
            {"label": opt.label, "value": opt.value, "description": opt.description}
            if opt.description or (opt.value and opt.value != opt.label)
            else opt.label
        )
    return {"question": question, "candidates": candidates}


def interaction_request_from_turn(ctx, *, request_id="", title=""):
    event = extract_interaction_event(ctx)
    if not event:
        return None
    return request_from_ask_user_event(event, request_id=request_id, title=title)


def render_interaction_text(request, *, include_click_hint=False):
    lines = []
    if request.title:
        lines.extend([f"**{request.title}**", ""])
    lines.extend([
        f"**{request.question}**",
        "",
        (
            "请点击按钮，或直接回复序号/完整选项文字："
            if include_click_hint and request.options else
            "请直接回复序号或完整选项文字："
            if request.options else
            "请直接回复："
        ),
    ])
    for idx, option in enumerate(request.options, 1):
        lines.append(f"{idx}. {option.display}")
    return "\n".join(lines).strip()


def resolve_interaction_choice(text, request):
    value = str(text or "").strip()
    if not value:
        return None
    if re.fullmatch(r"\d{1,2}", value):
        idx = int(value) - 1
        if 0 <= idx < len(request.options):
            return request.options[idx].value or request.options[idx].label
    for option in request.options:
        candidates = {option.label, option.value, option.display}
        if value in {c for c in candidates if c}:
            return option.value or option.label
    return value if request.allow_free_text else None


def callback_value(request_id, index, *, action="interaction_choice"):
    return {
        "penglai_action": action,
        "request_id": request_id,
        "menu_id": request_id,
        "index": index,
    }


def parse_callback_value(value):
    if not isinstance(value, dict):
        return None
    action = value.get("penglai_action")
    if action not in ("interaction_choice", "ask_user"):
        return None
    try:
        index = int(value.get("index"))
    except Exception:
        return None
    request_id = value.get("request_id") or value.get("menu_id")
    if not request_id:
        return None
    return {"request_id": str(request_id), "index": index, "action": action}
