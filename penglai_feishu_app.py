# -*- coding: utf-8 -*-
"""Penglai Feishu launcher.

This wrapper keeps upstream `frontends/fsapp.py` untouched and layers Penglai
runtime behavior on top of it.  It is intentionally small: import upstream,
patch Feishu ask_user rendering, then delegate to upstream main().
"""
import asyncio
import argparse
import ast
import hashlib
import json
import os
import queue as Q
import re
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(1, os.path.join(ROOT, "frontends"))
os.chdir(ROOT)

from penglai_feishu_ask import (  # noqa: E402
    build_ask_user_elements,
    extract_ask_user_event,
    render_ask_user_text,
    resolve_choice,
)
from penglai_runtime import VERSION  # noqa: E402
from penglai_runtime.output_cleaner import clean_final_text, has_internal_markup  # noqa: E402
from penglai_runtime.delivery import DeliveryService  # noqa: E402
from penglai_runtime.contracts import (  # noqa: E402
    InboundEvent,
    PermissionRequest,
    QueueDecision,
    RunStatus,
    SessionRef,
    TaskRun,
)
from penglai_runtime.interaction import parse_callback_value, request_from_ask_user_event  # noqa: E402
from penglai_runtime.permissions import permission_payload, render_permission_text  # noqa: E402
from penglai_runtime.port import GenericAgentInstancePort  # noqa: E402
from penglai_runtime.runner import AgentRunResult  # noqa: E402
from penglai_runtime.context_events import default_context_log_path  # noqa: E402
from penglai_runtime.redaction import contains_secret, redact_text  # noqa: E402
from penglai_runtime.service import RuntimeHubService  # noqa: E402
from penglai_runtime.version import compact_version_line, format_version_text  # noqa: E402
from plugins.penglai_artifacts import file_markers, strip_file_markers  # noqa: E402


_ASK_STATE = {}
_ASK_BY_MENU = {}
_ASK_LOCK = threading.Lock()
_TASK_BY_ID = {}
_TASK_LOCK = threading.Lock()
PENGLAI_IM_FILE_HINT = (
    "If you need to show files to user, use [FILE:filepath] in your response. "
    "Do not read channel-specific send-file SOPs or call Feishu/IM upload APIs directly; "
    "Penglai owns outbound delivery for every IM channel. "
    "If you need to ask the user to choose, confirm, authorize, or provide missing information, "
    "use the ask_user tool and let Penglai render the interaction for this IM channel; "
    "do not create Feishu interactive cards by direct API calls. "
    "If the user sent images, use the attached local image path and memory/penglai_im_vision_sop.md; "
    "do not answer image-content questions from filenames, EXIF, OCR-only guesses, or model-name assumptions. "
    "If this prompt came from an IM channel, that channel is currently active; "
    "do not report the current IM service as stopped unless the user explicitly asks for service diagnostics."
)

_SECRET_BLOCK_REPLY = (
    "⚠️ 检测到疑似 API Key / token / secret。为避免密钥进入聊天记录、模型上下文或日志，"
    "这条消息已被拦截且不会交给 LLM。请在服务器终端使用 `penglai setup` 或直接修改本机配置文件完成密钥配置。"
)
_TEXT_KEYS = ("text", "content", "plain_text", "message", "body", "title")
_RESOURCE_KEYS = {
    "image": ("image_key",),
    "audio": ("file_key", "audio_key"),
    "file": ("file_key",),
    "media": ("file_key", "media_key"),
}
_MESSAGE_META_KEYS = {
    "message_type",
    "msg_type",
    "message_id",
    "root_id",
    "parent_id",
    "chat_id",
    "chat_type",
    "create_time",
    "update_time",
    "sender",
    "mentions",
}
_KNOWN_MESSAGE_TYPES = {
    "text",
    "post",
    "image",
    "audio",
    "file",
    "media",
    "sticker",
    "share_chat",
    "share_user",
    "interactive",
    "share_calendar_event",
    "system",
    "merge_forward",
}


def _redact_log_text(text):
    return redact_text(text)


def _secret_blocked(text):
    return contains_secret(text)


def _compose_agent_prompt(file_hint, text, *, session_id="", session_scope=""):
    from penglai_runtime.context_events import recent_context_prompt

    context = recent_context_prompt(
        session_id=session_id,
        scopes=(session_scope,) if session_scope else None,
    )
    parts = [file_hint]
    if context:
        parts.append(context)
    parts.append(str(text or ""))
    return "\n\n".join(parts)


def _permission_to_ask_event(permission):
    payload = permission_payload(permission)
    candidates = [
        {
            "label": str(option["label"]),
            "value": str(option["value"]),
            "description": "",
        }
        for option in payload["options"]
    ]
    return {
        "question": payload["prompt"],
        "candidates": candidates,
        "_penglai_runtime_permission": True,
        "_penglai_permission_payload": payload,
    }


def _runtime_cancel_callback_value(task_id):
    return {
        "penglai_action": "runtime_cancel",
        "task_id": str(task_id or ""),
    }


def _parse_runtime_cancel_value(value):
    if not isinstance(value, dict):
        return ""
    if value.get("penglai_action") != "runtime_cancel":
        return ""
    return str(value.get("task_id") or value.get("request_id") or value.get("menu_id") or "").strip()


def _message_type(message):
    value = getattr(message, "message_type", "") or ""
    value = getattr(value, "value", value)
    text = str(value or "").strip()
    low = text.lower()
    if low in _KNOWN_MESSAGE_TYPES:
        return low
    suffix = low.rsplit(".", 1)[-1]
    if suffix in _KNOWN_MESSAGE_TYPES:
        return suffix
    for known in _KNOWN_MESSAGE_TYPES:
        if f"value='{known}'" in low or f'value="{known}"' in low:
            return known
    return text


def _looks_like_message_type_placeholder(text, msg_type, message=None):
    value = str(text or "").strip()
    if not (value.startswith("[") and value.endswith("]")):
        return False
    inner = value[1:-1].strip()
    if not inner:
        return False
    raw_type = str(getattr(message, "message_type", "") or "").strip()
    low = inner.lower()
    msg = str(msg_type or "").lower()
    if msg and low in {msg, f"messagetype.{msg}"}:
        return True
    if raw_type and inner == raw_type:
        return True
    if "messagetype" in low or low.startswith("namespace("):
        return True
    if msg and (low.endswith(f".{msg}") or f"value='{msg}'" in low or f'value="{msg}"' in low):
        return True
    return False


def _parse_structured_string(value):
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return json.loads(text)
    except Exception:
        pass
    if text[:1] in ("{", "[") and text[-1:] in ("}", "]"):
        try:
            return ast.literal_eval(text)
        except Exception:
            pass
    return text


def _object_to_mapping(raw):
    for method in ("to_dict", "dict", "model_dump"):
        fn = getattr(raw, method, None)
        if callable(fn):
            try:
                data = fn()
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
    data = getattr(raw, "__dict__", None)
    return data if isinstance(data, dict) else None


def _text_from_message_content(raw, *, _depth=0):
    """Extract Feishu text content from SDK variants.

    Upstream fsapp handles the common JSON-string shape. Some lark-oapi
    deliveries expose `message.content` as a dict/object or plain text, which
    made `/new` and every other slash command look like an empty text message.
    """
    if raw is None or _depth > 5 or callable(raw):
        return ""
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8", "replace")
        except Exception:
            return ""
    if isinstance(raw, dict):
        data = raw
    elif isinstance(raw, (list, tuple)):
        texts = [
            _text_from_message_content(item, _depth=_depth + 1)
            for item in raw
        ]
        return "\n".join([text for text in texts if text]).strip()
    elif isinstance(raw, str):
        parsed = _parse_structured_string(raw)
        if isinstance(parsed, str):
            return parsed
        data = parsed
    else:
        for attr in ("text", "content", "raw", "body", "message"):
            value = getattr(raw, attr, None)
            text = _text_from_message_content(value, _depth=_depth + 1)
            if text:
                return text
        data = _object_to_mapping(raw)
        if data is None:
            value = str(raw).strip()
            if value and not re.search(r"<[^>]+ object at 0x[0-9A-Fa-f]+>", value):
                return _text_from_message_content(value, _depth=_depth + 1)
            return ""
    if not isinstance(data, dict):
        return ""
    for key in _TEXT_KEYS:
        text = _text_from_message_content(data.get(key), _depth=_depth + 1)
        if text:
            return text
    for key, value in data.items():
        key_text = str(key)
        if key_text.startswith("_") or key_text in _MESSAGE_META_KEYS:
            continue
        text = _text_from_message_content(value, _depth=_depth + 1)
        if text:
            return text
    return ""


def _text_from_message(message):
    for attr in ("content", "text", "raw", "body", "message"):
        text = _text_from_message_content(getattr(message, attr, None))
        if text:
            return text
    return _text_from_message_content(message)


def _find_message_value(raw, names, *, _depth=0):
    if raw is None or _depth > 5 or callable(raw):
        return ""
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8", "replace")
        except Exception:
            return ""
    if isinstance(raw, str):
        parsed = _parse_structured_string(raw)
        if isinstance(parsed, str):
            return ""
        raw = parsed
    if isinstance(raw, dict):
        for name in names:
            value = raw.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key, value in raw.items():
            key_text = str(key)
            if key_text.startswith("_") or key_text in _MESSAGE_META_KEYS:
                continue
            found = _find_message_value(value, names, _depth=_depth + 1)
            if found:
                return found
        return ""
    if isinstance(raw, (list, tuple)):
        for item in raw:
            found = _find_message_value(item, names, _depth=_depth + 1)
            if found:
                return found
        return ""
    data = _object_to_mapping(raw)
    if isinstance(data, dict):
        return _find_message_value(data, names, _depth=_depth + 1)
    return ""


def _media_message_fallback(fs, message, msg_type):
    key = _find_message_value(getattr(message, "content", None), _RESOURCE_KEYS.get(msg_type, ()))
    message_id = str(getattr(message, "message_id", "") or "")
    image_paths = []
    if key and hasattr(fs, "_download_and_save_media"):
        content = {"image_key": key} if msg_type == "image" else {"file_key": key}
        try:
            file_path, filename = fs._download_and_save_media(msg_type, content, message_id)
        except Exception as e:
            print(f"[penglai feishu] media fallback download failed type={msg_type}: {e}", flush=True)
            file_path, filename = None, None
        if file_path and filename:
            if msg_type == "image":
                image_paths.append(file_path)
            return fs._describe_media(msg_type, file_path, filename), image_paths
    return f"[{msg_type}]", image_paths


def _install_text_message_fallback(fs):
    original = getattr(fs, "_build_user_message", None)
    if not callable(original) or getattr(original, "_penglai_text_fallback", False):
        return False

    def _build_user_message(message):
        msg_type = _message_type(message)
        try:
            text, images = original(message)
        except Exception as e:
            print(f"[penglai feishu] upstream message parse failed type={msg_type}: {e}", flush=True)
            text, images = "", []
        if msg_type == "text":
            fallback_text = _text_from_message(message)
            if fallback_text and (not text or _looks_like_message_type_placeholder(text, msg_type, message)):
                text = fallback_text
                print("[penglai feishu] text message content fallback used", flush=True)
            elif not text:
                content = getattr(message, "content", None)
                print(
                    "[penglai feishu] text message empty after fallback "
                    f"content_type={type(content).__name__}",
                    flush=True,
                )
        elif msg_type in _RESOURCE_KEYS and (
            not text or _looks_like_message_type_placeholder(text, msg_type, message)
        ):
            text, images = _media_message_fallback(fs, message, msg_type)
            print(f"[penglai feishu] media message fallback used type={msg_type}", flush=True)
        return text, images

    _build_user_message._penglai_text_fallback = True
    fs._build_user_message = _build_user_message
    return True


def _install_display_cleaners(fs):
    fs.FILE_HINT = PENGLAI_IM_FILE_HINT
    fs._clean = lambda text: clean_final_text(text)
    fs._extract_files = lambda text: file_markers(text)
    fs._strip_files = lambda text: strip_file_markers(text)

    trunc_tail = getattr(fs, "_TRUNC_TAIL", 300)

    def _display_text(text):
        cleaned = clean_final_text(text, strip_file_markers=True)
        if cleaned:
            return cleaned
        if has_internal_markup(text):
            return ""
        tail = (text or "").strip()[-trunc_tail:]
        return "⚠️ 模型输出被截断或为空" + (f"\n…{tail}" if tail else "")

    fs._display_text = _display_text


def _is_markdown_table_row(line):
    text = str(line or "").strip()
    return "|" in text and text.count("|") >= 2


def _is_markdown_table_separator(line):
    text = str(line or "").strip().strip("|")
    if "|" not in text:
        return False
    cells = [cell.strip().replace(" ", "") for cell in text.split("|")]
    return len(cells) >= 2 and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells)


def _markdown_table_to_text_block(lines):
    rows = []
    for idx, line in enumerate(lines):
        if idx == 1 and _is_markdown_table_separator(line):
            continue
        cells = [cell.strip() for cell in str(line or "").strip().strip("|").split("|")]
        rows.append(" | ".join(cells))
    return "```text\n" + "\n".join(rows).strip() + "\n```"


def _card_safe_markdown(text):
    """Render Markdown tables as text blocks for Feishu card reliability.

    Feishu interactive cards reject messages when markdown content expands into
    too many table elements. Plain text delivery still gets the model's original
    answer; this only adapts the card payload to the platform's limits.
    """
    lines = str(text or "").splitlines()
    out = []
    i = 0
    in_fence = False
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            i += 1
            continue
        if (
            not in_fence
            and i + 1 < len(lines)
            and _is_markdown_table_row(line)
            and _is_markdown_table_separator(lines[i + 1])
        ):
            block = [line, lines[i + 1]]
            i += 2
            while i < len(lines) and _is_markdown_table_row(lines[i]):
                block.append(lines[i])
                i += 1
            out.append(_markdown_table_to_text_block(block))
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def _sanitize_card_elements(value):
    if isinstance(value, list):
        return [_sanitize_card_elements(item) for item in value]
    if isinstance(value, dict):
        data = {key: _sanitize_card_elements(item) for key, item in value.items()}
        if data.get("tag") == "markdown" and isinstance(data.get("content"), str):
            data["content"] = _card_safe_markdown(data["content"])
        return data
    return value


def _install_card_markdown_safety(fs):
    original = getattr(fs, "_card_raw", None)
    if not callable(original) or getattr(original, "_penglai_card_markdown_safety", False):
        return False

    def _card_raw(elements):
        return original(_sanitize_card_elements(elements))

    _card_raw._penglai_card_markdown_safety = True
    fs._card_raw = _card_raw
    return True



def _patch_lark_ws_card_dispatch():
    """Work around lark-oapi WebSocket clients that drop CARD frames.

    Some 1.x releases accept register_p2_card_action_trigger(), but return
    before dispatching MessageType.CARD in the long-connection client.  Keep the
    fix in Penglai's wrapper layer so GA and the third-party package stay
    untouched.
    """
    try:
        import inspect
        import lark_oapi.ws.client as ws_client
    except Exception as e:
        print(f"[WARN] 飞书卡片回调兼容检查失败: {e}", flush=True)
        return False
    method = getattr(ws_client.Client, "_handle_data_frame", None)
    if getattr(method, "_penglai_card_dispatch_patch", False):
        return True
    try:
        src = inspect.getsource(method)
    except Exception:
        src = ""
    if "MessageType.CARD" in src and "_do_without_validation(pl)" in src and "elif message_type == MessageType.CARD" not in src:
        return True
    if "MessageType.CARD" in src and "return" not in src:
        return True

    async def _handle_data_frame(self, frame):
        hs = frame.headers
        msg_id = ws_client._get_by_key(hs, ws_client.HEADER_MESSAGE_ID)
        trace_id = ws_client._get_by_key(hs, ws_client.HEADER_TRACE_ID)
        sum_ = ws_client._get_by_key(hs, ws_client.HEADER_SUM)
        seq = ws_client._get_by_key(hs, ws_client.HEADER_SEQ)
        type_ = ws_client._get_by_key(hs, ws_client.HEADER_TYPE)

        pl = frame.payload
        if int(sum_) > 1:
            pl = self._combine(msg_id, int(sum_), int(seq), pl)
            if pl is None:
                return

        message_type = ws_client.MessageType(type_)
        ws_client.logger.debug(self._fmt_log(
            "receive message, message_type: {}, message_id: {}, trace_id: {}, payload: {}",
            message_type.value, msg_id, trace_id, pl.decode(ws_client.UTF_8)))

        resp = ws_client.Response(code=ws_client.http.HTTPStatus.OK)
        try:
            start = int(round(ws_client.time.time() * 1000))
            if message_type in (ws_client.MessageType.EVENT, ws_client.MessageType.CARD):
                result = self._event_handler._do_without_validation(pl)
            else:
                return
            end = int(round(ws_client.time.time() * 1000))
            header = hs.add()
            header.key = ws_client.HEADER_BIZ_RT
            header.value = str(end - start)
            if result is not None:
                resp.data = ws_client.base64.b64encode(
                    ws_client.JSON.marshal(result).encode(ws_client.UTF_8))
        except Exception as e:
            ws_client.logger.error(self._fmt_log(
                "handle message failed, message_type: {}, message_id: {}, trace_id: {}, err: {}",
                message_type.value, msg_id, trace_id, e))
            resp = ws_client.Response(code=ws_client.http.HTTPStatus.INTERNAL_SERVER_ERROR)

        frame.payload = ws_client.JSON.marshal(resp).encode(ws_client.UTF_8)
        await self._write_message(frame.SerializeToString())

    _handle_data_frame._penglai_card_dispatch_patch = True
    ws_client.Client._handle_data_frame = _handle_data_frame
    print("[penglai feishu] 已启用 lark-oapi WebSocket CARD 回调兼容补丁", flush=True)
    return True


def _remember_ask(
    chat_key,
    event,
    *,
    menu_id=None,
    receive_id=None,
    receive_id_type="open_id",
    user_id=None,
    chat_type=None,
):
    with _ASK_LOCK:
        _ASK_STATE[chat_key] = event
        if menu_id:
            _ASK_BY_MENU[menu_id] = {
                "chat_key": chat_key,
                "event": event,
                "receive_id": receive_id or chat_key,
                "receive_id_type": receive_id_type,
                "user_id": user_id,
                "chat_type": chat_type,
            }


def _remember_task(
    task_id,
    chat_key,
    *,
    receive_id=None,
    receive_id_type="open_id",
    user_id=None,
    chat_type=None,
    session_id="",
    card=None,
):
    with _TASK_LOCK:
        _TASK_BY_ID[str(task_id)] = {
            "chat_key": chat_key,
            "receive_id": receive_id or chat_key,
            "receive_id_type": receive_id_type,
            "user_id": user_id,
            "chat_type": chat_type,
            "session_id": session_id,
            "card": card,
        }


def _get_task(task_id):
    with _TASK_LOCK:
        item = _TASK_BY_ID.get(str(task_id))
        return dict(item) if item else None


def _pop_task(task_id):
    with _TASK_LOCK:
        return _TASK_BY_ID.pop(str(task_id), None)


def _choice_text_for_agent(event, choice):
    text = str(choice or "").strip()
    if not text:
        return text
    if not (event or {}).get("_penglai_direct"):
        return text
    question = str((event or {}).get("question") or "上一个问题").strip()
    return f"用户对「{question}」的选择/回答：{text}"


def _pop_choice(chat_key, text):
    with _ASK_LOCK:
        event = _ASK_STATE.get(chat_key)
        choice = resolve_choice(text, event)
        if choice is None:
            return None
        if choice is not None:
            _ASK_STATE.pop(chat_key, None)
            for menu_id, item in list(_ASK_BY_MENU.items()):
                if item.get("chat_key") == chat_key:
                    _ASK_BY_MENU.pop(menu_id, None)
        return _choice_text_for_agent(event, choice)


def _pop_menu_choice(menu_id, index):
    with _ASK_LOCK:
        item = _ASK_BY_MENU.get(menu_id)
        if not item:
            return None
        event = item.get("event") or {}
        try:
            options = request_from_ask_user_event(event, request_id=menu_id).options
        except Exception:
            options = ()
        try:
            idx = int(index)
        except Exception:
            idx = -1
        if not (0 <= idx < len(options)):
            return None
        _ASK_BY_MENU.pop(menu_id, None)
        chat_key = item.get("chat_key")
        if chat_key:
            _ASK_STATE.pop(chat_key, None)
        option = options[idx]
        choice = _choice_text_for_agent(event, option.value or option.label)
        picked = {
            "chat_key": chat_key,
            "choice": choice,
            "receive_id": item.get("receive_id") or chat_key,
            "receive_id_type": item.get("receive_id_type") or "open_id",
        }
        if item.get("user_id"):
            picked["user_id"] = item.get("user_id")
        if item.get("chat_type"):
            picked["chat_type"] = item.get("chat_type")
        return picked


def _cancel_ask(chat_key):
    with _ASK_LOCK:
        _ASK_STATE.pop(chat_key, None)
        for menu_id, item in list(_ASK_BY_MENU.items()):
            if item.get("chat_key") == chat_key:
                _ASK_BY_MENU.pop(menu_id, None)


def _install_task_card_cancel_button(fs):
    task_card = getattr(fs, "_TaskCard", None)
    original_build = getattr(task_card, "_build", None)
    if not callable(original_build) or getattr(task_card, "_penglai_cancel_button_patch", False):
        return False

    def _build_with_cancel(self):
        raw = original_build(self)
        if not getattr(self, "_penglai_cancel_enabled", False):
            return raw
        task_id = str(getattr(self, "_penglai_task_id", "") or "")
        if not task_id:
            return raw
        button = {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "停止任务"},
            "type": "danger",
            "behaviors": [{
                "type": "callback",
                "value": _runtime_cancel_callback_value(task_id),
            }],
        }
        try:
            if isinstance(raw, str):
                payload = json.loads(raw)
                elements = payload.setdefault("body", {}).setdefault("elements", [])
                elements.extend([{"tag": "hr"}, button])
                return json.dumps(payload, ensure_ascii=False)
            if isinstance(raw, dict):
                payload = json.loads(json.dumps(raw, ensure_ascii=False))
                elements = payload.setdefault("body", {}).setdefault("elements", [])
                elements.extend([{"tag": "hr"}, button])
                return payload
        except Exception as e:
            print(f"[penglai feishu runtime] cancel button render failed: {e}", flush=True)
        return raw

    task_card._build = _build_with_cancel
    task_card._penglai_cancel_button_patch = True
    return True


_CN_OPTION_COUNTS = {
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_EXPLICIT_CHOICE_RE = re.compile(
    r"(飞书)?(选项卡|按钮|卡片)|让我选择|让我选|请我选择|请我选|"
    r"([二两三四五六七八九]|[2-9])\s*选\s*一|选择\s*[A-H]",
    re.I,
)
_EXPLICIT_FREE_TEXT_RE = re.compile(
    r"(问我|询问我|向我确认|让我补充).*(不要给候选项|不带候选|不用候选|直接回复|缺哪个|缺哪|缺什么|需要.*信息)",
    re.I | re.S,
)
_FINAL_CHOICE_QUESTION_RE = re.compile(
    r"(要做哪种|要做哪个|选哪|选择|请选择|哪一个|哪种|要不要|是否|您想|你想|可以.*吗|[?？])",
    re.I,
)
_FINAL_CHOICE_LINE_RE = re.compile(
    r"^\s*(?:[-*+•·]\s*)?(?:\d+[.)、]\s*)?([A-H])\s*[.)、:：]\s*(.{1,200})\s*$",
    re.I,
)


def _extract_option_count(text):
    m = re.search(r"([二两三四五六七八九]|[2-9])\s*选\s*一", text or "")
    if not m:
        return 0
    raw = m.group(1)
    if raw.isdigit():
        return int(raw)
    return _CN_OPTION_COUNTS.get(raw, 0)


def _extract_explicit_options(text):
    value = str(text or "")
    labeled = []
    for letter, desc in re.findall(r"\b([A-H])\s*[:：.]\s*([^,，;；。\n]{1,40})", value, re.I):
        display = f"{letter.upper()}: {desc.strip()}"
        if display not in labeled:
            labeled.append(display)
    if labeled:
        return labeled[:8]
    letters = []
    for letter in re.findall(r"(?<![A-Za-z0-9])([A-H])(?![A-Za-z0-9])", value.upper()):
        if letter not in letters:
            letters.append(letter)
    count = _extract_option_count(value)
    if not letters and count:
        letters = [chr(ord("A") + i) for i in range(min(count, 8))]
    if count and len(letters) < count:
        for i in range(count):
            letter = chr(ord("A") + i)
            if letter not in letters:
                letters.append(letter)
    return letters[:8]


def _extract_interaction_question(text, *, has_options):
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    topic = ""
    m = re.search(r"主题(?:是|为|关于)?\s*([^,，。；;]+)", value)
    if m:
        topic = m.group(1).strip()
    if not topic:
        m = re.search(r"关于\s*([^,，。；;]+)", value)
        if m:
            topic = m.group(1).strip()
    if topic and has_options:
        return f"{topic}，请选择一个选项："
    if topic:
        return f"请补充{topic}相关信息："
    m = re.search(r"(?:问我|询问我|向我确认)\s*([^,，。；;]+)", value)
    if m:
        question = m.group(1).strip()
        if question:
            return question if question.endswith(("?", "？", "：", ":")) else question + "："
    return "请选择一个选项：" if has_options else "请补充需要的信息："


def _explicit_interaction_event(text):
    value = str(text or "")
    options = _extract_explicit_options(value)
    if options and _EXPLICIT_CHOICE_RE.search(value):
        return {
            "question": _extract_interaction_question(value, has_options=True),
            "candidates": options,
            "_penglai_direct": True,
        }
    if _EXPLICIT_FREE_TEXT_RE.search(value):
        return {
            "question": _extract_interaction_question(value, has_options=False),
            "candidates": [],
            "_penglai_direct": True,
        }
    return None


def _clean_choice_line(text):
    value = str(text or "").strip()
    value = re.sub(r"^[>｜|]\s*", "", value)
    value = re.sub(r"^\*\*(.*)\*\*$", r"\1", value).strip()
    return value


def _extract_final_choice_interaction(text):
    """Promote a final-text A/B/C follow-up into a real Feishu choice card.

    This is intentionally narrow.  The preferred path is still GA ask_user;
    this only catches final answers that end with a question plus explicit
    A/B/C choices, so regular reports with lettered lists remain plain text.
    """
    lines = str(text or "").splitlines()
    end = len(lines)
    while end > 0 and not lines[end - 1].strip():
        end -= 1
    if end <= 0:
        return None

    start = end
    options = []
    while start > 0:
        line = lines[start - 1]
        if not line.strip():
            if options:
                break
            start -= 1
            continue
        match = _FINAL_CHOICE_LINE_RE.match(line)
        if not match:
            break
        options.append((match.group(1).upper(), _clean_choice_line(match.group(2))))
        start -= 1
    options.reverse()
    if len(options) < 2:
        return None

    letters = [letter for letter, _ in options]
    expected = [chr(ord("A") + i) for i in range(len(letters))]
    if letters != expected:
        return None

    question_idx = start - 1
    while question_idx >= 0 and not lines[question_idx].strip():
        question_idx -= 1
    if question_idx < 0:
        return None
    question = _clean_choice_line(lines[question_idx])
    if not _FINAL_CHOICE_QUESTION_RE.search(question):
        return None

    body_lines = lines[:question_idx]
    while body_lines and not body_lines[-1].strip():
        body_lines.pop()
    candidates = [
        {"label": letter, "value": desc, "description": desc}
        for letter, desc in options
        if desc
    ]
    if len(candidates) < 2:
        return None
    return "\n".join(body_lines).strip(), {
        "question": question,
        "candidates": candidates,
        "_penglai_direct": True,
    }


def _wait_heartbeat_float(name, default):
    try:
        return max(0.0, float(os.getenv(name, str(default))))
    except Exception:
        return float(default)


def _wait_heartbeat_int(name, default):
    try:
        return max(0, int(os.getenv(name, str(default))))
    except Exception:
        return int(default)


def _start_waiting_card_heartbeat(
    card,
    task_id,
    active_task_id,
    stop_event=None,
    *,
    first_delay=None,
    repeat_delay=None,
    max_updates=None,
):
    """Keep Feishu's active task card visibly alive while the model is silent."""
    if card is None:
        return None
    if stop_event is None:
        stop_event = threading.Event()
    if first_delay is None:
        first_delay = _wait_heartbeat_float("PENGLAI_FEISHU_WAIT_HEARTBEAT_FIRST_SEC", 30.0)
    if repeat_delay is None:
        repeat_delay = _wait_heartbeat_float("PENGLAI_FEISHU_WAIT_HEARTBEAT_REPEAT_SEC", 60.0)
    if max_updates is None:
        max_updates = _wait_heartbeat_int("PENGLAI_FEISHU_WAIT_HEARTBEAT_MAX_UPDATES", 3)
    if max_updates <= 0:
        return None

    def _current_task_id():
        try:
            return active_task_id() if callable(active_task_id) else active_task_id
        except Exception:
            return None

    def _worker():
        delay = first_delay
        for idx in range(max_updates):
            if stop_event.wait(delay):
                return
            if _current_task_id() != task_id:
                return
            if not getattr(card, "_penglai_cancel_enabled", False):
                return
            try:
                card.status = "⏳ 仍在等待模型响应"
                push = getattr(card, "_push", None)
                if callable(push):
                    push()
            except Exception as e:
                print(f"[penglai feishu runtime] wait heartbeat failed: {e}", flush=True)
                return
            delay = repeat_delay

    thread = threading.Thread(
        target=_worker,
        name=f"penglai-feishu-wait-heartbeat-{task_id}",
        daemon=True,
    )
    thread.start()
    return thread


def _feishu_delivery_service(fs_mod, rid, receive_id_type):
    """Build a DeliveryService wired to Feishu send primitives.

    Penglai owns file-marker parsing, blocked-notice policy, and duplicate
    suppression; Feishu only provides transport callbacks.  Routing every
    outbound message through this keeps Feishu on the same safety path as
    WeChat (and the DingTalk/QQ/WeCom channel bridge).
    """
    def _send_text(text):
        if not (text or "").strip():
            return False
        try:
            return bool(fs_mod.send_message(rid, text, receive_id_type=receive_id_type))
        except Exception:
            return False

    def _send_file(path):
        try:
            return bool(fs_mod._send_local_file(rid, path, receive_id_type))
        except Exception:
            return False

    def _send_audio(path):
        try:
            return bool(fs_mod._send_local_audio(rid, path, receive_id_type))
        except Exception:
            return False

    return DeliveryService(send_text=_send_text, send_file=_send_file, send_audio=_send_audio)


def _try_owner_control_api(*, text, user_id, chat_id, chat_type, images=None, timeout=1200):
    """Forward an owner message to the Runtime Hub control API /message.

    Returns the response dict on success, or None if the control API is not
    available (connection refused, missing token).  Callers should fall back
    to the local Hub when None is returned.
    """
    from penglai_runtime.control_api import default_token_path

    token_path = default_token_path()
    if not os.path.exists(token_path):
        return None
    try:
        with open(token_path, encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        return None
    if not token:
        return None
    body = {
        "text": str(text or ""),
        "channel": "feishu",
        "user_id": str(user_id or ""),
        "chat_id": str(chat_id or ""),
        "chat_type": str(chat_type or "private"),
        "timeout": float(timeout),
    }
    if images:
        body["images"] = list(images)
    url = "http://127.0.0.1:8765/message"
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json", "X-Penglai-Token": token},
    )
    try:
        with urllib.request.urlopen(req, timeout=float(timeout) + 5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def _control_api_to_run_result(resp, event):
    """Convert a control API /message response dict to an AgentRunResult."""
    session = SessionRef(
        session_id=str(resp.get("session_id") or ""),
        scope=str(resp.get("scope") or "owner"),
        channel=str(resp.get("channel") or event.channel),
        user_id=event.user_id,
        chat_id=event.chat_id,
    )
    decision = QueueDecision(
        session_id=session.session_id,
        accepted=True,
        started_now=True,
        queue_no=0,
        reason="control_api",
    )
    output = str(resp.get("output") or "")
    task_run = TaskRun(
        event_id=event.event_id,
        session_id=session.session_id,
        run_id=str(resp.get("run_id") or ""),
        status=str(resp.get("status") or RunStatus.SUCCEEDED),
        worker_id=str(resp.get("worker_id") or "single-worker"),
        result_text=output,
        error=str(resp.get("error") or ""),
    )
    perm_dict = resp.get("permission") or {}
    permission = None
    if perm_dict and perm_dict.get("action") and perm_dict.get("prompt"):
        permission = PermissionRequest(
            action=str(perm_dict["action"]),
            prompt=str(perm_dict["prompt"]),
            options=tuple(perm_dict.get("options") or ()),
            request_id=str(perm_dict.get("request_id") or ""),
            metadata=dict(perm_dict.get("metadata") or {}),
        )
    return AgentRunResult(
        event=event,
        session=session,
        decision=decision,
        task_run=task_run,
        raw_output=output,
        cleaned_output=output,
        permission=permission,
    )


def _patch(fs):
    if getattr(fs, "_PENGLAI_FEISHU_PATCHED", False):
        return
    fs._PENGLAI_FEISHU_PATCHED = True
    _install_display_cleaners(fs)
    _install_card_markdown_safety(fs)
    _install_text_message_fallback(fs)
    _install_task_card_cancel_button(fs)

    orig_handle_message = fs.handle_message
    orig_run_agent = fs.FeishuApp.run_agent
    orig_handle_command = fs.FeishuApp.handle_command

    def _cancel_task_card(card, status="⏹️ 已请求停止"):
        if card is None:
            return
        try:
            card._penglai_cancel_enabled = False
            card.status = status
            card.final = "已请求停止当前任务。"
            card._push()
        except Exception as e:
            print(f"[penglai feishu runtime] cancel card patch failed: {e}", flush=True)

    def _finish_ask_card_text(card, text, event, menu_id):
        if text.startswith("⚠️ 模型输出被截断或为空"):
            text = ""
        card._penglai_cancel_enabled = False
        elements = build_ask_user_elements(text, event, menu_id=menu_id, include_buttons=True)
        card.status = "🧭 等待选择"
        card.final = None
        rendered = fs._card_raw(elements)
        ok = fs._patch_card(card.msg_id, rendered) if card.msg_id else False
        if not ok:
            _feishu_delivery_service(fs, card.rid, card.rtype).deliver(
                render_ask_user_text(text, event), send_body=True
            )

    def _finish_ask_card(card, raw, event, menu_id):
        _finish_ask_card_text(card, fs._display_text(raw), event, menu_id)

    def _final_display_text(raw):
        text = fs._display_text(raw)
        if text.startswith("⚠️ 模型输出被截断或为空"):
            try:
                files = fs._extract_files(raw)
            except Exception:
                files = []
            if files:
                return "✅ 工具流程已结束，正在发送生成文件。若未收到文件，请回复“重发文件”。"
            return "⚠️ 工具流程已结束，但最终回复为空。请补充说明要我继续检查还是重跑。"
        return text

    def _card_done(card, raw):
        card._penglai_cancel_enabled = False
        text = _final_display_text(raw)
        if hasattr(card, "steps"):
            card.steps = []
        if text.startswith("⚠️ 工具流程已结束"):
            card.status = "⚠️ 已结束但回复为空"
            card.final = text
            if not card._push():
                card._fallback_text(text, final=True)
            return
        if not text:
            card.status = "✅ 已完成"
            card.final = None
            if not card._push():
                card._fallback_text("✅ 已完成", final=True)
            return
        card.done(text)

    def _card_queued(card, queue_no, msg):
        card._penglai_cancel_enabled = False
        if hasattr(card, "steps"):
            card.steps = []
        card.status = f"⏳ 已排队 #{queue_no}"
        card.final = msg
        push = getattr(card, "_push", None)
        if not callable(push):
            return False
        return bool(push())

    def _record_runtime_shadow(raw, *, receive_id, receive_id_type):
        try:
            from penglai_runtime.flags import shadow_enabled

            if not shadow_enabled():
                return
            from penglai_runtime.shadow import record_delivery_shadow

            record_delivery_shadow(
                "feishu",
                raw,
                receive_id=receive_id,
                receive_id_type=receive_id_type,
                base_dir=getattr(fs, "TEMP_DIR", None),
                production_text=_final_display_text(raw),
            )
        except Exception as e:
            print(f"[penglai runtime shadow] error: {e}", flush=True)


    def _make_penglai_progress_hook(card, task_id):
        def hook(ctx):
            try:
                if getattr(ctx.get("self").parent, "_fs_active_task_id", None) != task_id:
                    return
                if ctx.get("summary"):
                    detail = fs._build_step_detail(ctx.get("response"), ctx.get("tool_calls") or [])
                    card.step(ctx["summary"], detail)
            except Exception as e:
                print(f"[penglai fs hook] error: {e}")
        return hook

    def _runtime_service(app):
        service = getattr(app, "_penglai_runtime_hub_service", None)
        if service is None:
            service = RuntimeHubService(
                owner_user_ids=set(fs.ALLOWED_USERS or []),
                context_log_path=default_context_log_path(),
            )
            app._penglai_runtime_hub_service = service
            # Inject Penglai persona into every system prompt so the model
            # never falls back to its default identity (e.g. MiniMax M3's
            # "ROOT_SYSTEM_POLICY" self-identification).
            try:
                agent = getattr(app, "agent", None)
                if agent is not None and agent.llmclients:
                    persona = (
                        "\n[蓬莱身份] 你是「蓬莱助手」，基于 GenericAgent 的开源个人管家发行版蓬莱。"
                        "用户称呼你为\"主人\"。被问及身份/名字时以此为准，严禁自称底层模型名"
                        "(如 MiniMax/Claude/GPT 等)或 API 提供商名。"
                    )
                    # Prefer the generic extra_sys_prompts slot (upstream c85b59e)
                    # so we do not mutate the backend's extra_sys_prompt attribute.
                    # NOTE: Runtime Hub path (penglai_runtime/port.py) already rides
                    # this slot; the feishu-specific persona injection stays on the
                    # backend attribute fallback until the feishu-app phase rewrites
                    # it, to avoid conflicting with in-flight work in this file.
                    slots = getattr(agent, "extra_sys_prompts", None)
                    if slots is not None:
                        if persona not in slots:
                            slots.append(persona)
                    else:
                        backend = agent.llmclient.backend
                        existing = getattr(backend, "extra_sys_prompt", "") or ""
                        if persona not in existing:
                            backend.extra_sys_prompt = persona + "\n" + existing
            except Exception:
                pass
        return service

    def _cancel_runtime_task(app, task_id):
        item = _get_task(task_id)
        if not item:
            return None
        chat_key = item.get("chat_key") or ""
        for state in list(getattr(app, "user_tasks", {}).values()):
            try:
                state["running"] = False
            except Exception:
                pass
        try:
            app.agent.abort()
        except Exception:
            pass
        _cancel_ask(chat_key)
        service = _runtime_service(app)
        session_id = item.get("session_id") or ""
        if not session_id:
            event = InboundEvent(
                event_id=f"feishu_card_cancel_{uuid.uuid4().hex}",
                channel="feishu",
                user_id=str(item.get("user_id") or item.get("receive_id") or chat_key),
                chat_id=str(chat_key),
                chat_type=str(item.get("chat_type") or "private"),
                text="/stop",
            )
            session_id = service.router.route(event).session_id
        pre_status = service.status(session_id)
        dropped = int((pre_status.get("queue") or {}).get("pending", 0) or 0)
        data = service.cancel_session(session_id, drop_pending=True)
        _cancel_task_card(item.get("card"))
        if chat_key:
            getattr(app, "user_tasks", {}).pop(chat_key, None)
        _pop_task(task_id)
        app._penglai_last_runtime_cancel = {
            "session_id": session_id,
            "next_event_id": data.get("next_event_id") or "",
            "dropped": dropped,
            "source": "feishu_card",
            "task_id": str(task_id),
        }
        print(
            "[penglai feishu runtime] card cancel "
            f"task={task_id} session={session_id} next={data.get('next_event_id') or '-'} dropped={dropped}",
            flush=True,
        )
        return app._penglai_last_runtime_cancel

    async def run_agent(self, chat_id, text, *, receive_id=None, receive_id_type="open_id",
                        images=None, priority=False, user_id=None, chat_type="private", **_):
        rid = receive_id or chat_id
        task_id = f"{chat_id}_{uuid.uuid4().hex}"
        card = fs._TaskCard(rid, receive_id_type)
        card._penglai_task_id = task_id
        card._penglai_cancel_enabled = True
        done_evt = threading.Event()

        def _finish(raw):
            _pop_task(task_id)
            _cancel_ask(chat_id)
            _record_runtime_shadow(raw, receive_id=rid, receive_id_type=receive_id_type)
            final_choice = _extract_final_choice_interaction(_final_display_text(raw))
            if final_choice:
                body_text, event = final_choice
                _remember_ask(chat_id, event, menu_id=task_id, receive_id=rid,
                              receive_id_type=receive_id_type, user_id=user_id or receive_id or chat_id,
                              chat_type=chat_type)
                _finish_ask_card_text(card, body_text, event, task_id)
            else:
                # Use plain send_message for all responses (card layer can be
                # unreliable with 0.3.0's async dispatch from worker threads).
                body = _final_display_text(raw)
                if body:
                    _feishu_delivery_service(fs, rid, receive_id_type).deliver(body, send_body=True)
                # Still try the card update for continuity, but don't rely on it.
                try:
                    _card_done(card, raw)
                except Exception:
                    pass
            _feishu_delivery_service(fs, rid, receive_id_type).deliver(
                raw, base_dir=getattr(fs, "TEMP_DIR", None), send_body=False, send_notice=True
            )

        def _ask(permission):
            _pop_task(task_id)
            event = _permission_to_ask_event(permission)
            _remember_ask(
                chat_id,
                event,
                menu_id=task_id,
                receive_id=rid,
                receive_id_type=receive_id_type,
                user_id=user_id or receive_id or chat_id,
                chat_type=chat_type,
            )
            _finish_ask_card_text(card, "", event, task_id)

        try:
            event = InboundEvent(
                event_id=f"feishu_{task_id}",
                channel="feishu",
                user_id=str(user_id or receive_id or chat_id),
                chat_id=str(chat_id),
                chat_type=str(chat_type or "private"),
                text=str(text or ""),
                images=tuple(images or ()),
                metadata={
                    "receive_id": rid,
                    "receive_id_type": receive_id_type,
                    "task_id": task_id,
                },
            )
            service = _runtime_service(self)
            session_ref = service.router.route(event)
            card._penglai_runtime_session_id = session_ref.session_id
            pre_status = service.status(session_ref.session_id)
            queue_status = pre_status.get("queue") or {}
            session_busy = bool(queue_status.get("active"))
            card_started = False
            _remember_task(
                task_id, chat_id, receive_id=rid, receive_id_type=receive_id_type,
                user_id=user_id or receive_id or chat_id, chat_type=chat_type,
                session_id=session_ref.session_id, card=card,
            )
            if not session_busy:
                self.agent._fs_active_task_id = task_id
                await asyncio.to_thread(card.start)
                card_started = True

            def _prompt_for_incoming(incoming):
                incoming_session = service.router.route(incoming)
                return _compose_agent_prompt(
                    fs.FILE_HINT,
                    incoming.text,
                    session_id=incoming_session.session_id,
                    session_scope=incoming_session.scope,
                )

            port = GenericAgentInstancePort(
                agent=self.agent,
                prompt_builder=_prompt_for_incoming,
                source=self.source,
                timeout=fs.AGENT_TIMEOUT_SEC,
                turn_hook=_make_penglai_progress_hook(card, task_id),
            )

            # ── on_result: hub callback, runs on worker thread ──
            # The hub calls this for EVERY event (first or queued).  Queued
            # events do not start a card while waiting, but when their own
            # result arrives they still complete through their own card.
            def _on_result(run_result):
                done_evt.set()
                is_queued = bool((run_result.event.metadata or {}).get("new_turn"))
                self._penglai_last_runtime_result = run_result
                print(
                    "[penglai feishu runtime] "
                    f"run_id={run_result.task_run.run_id} "
                    f"session={run_result.session.session_id} "
                    f"status={run_result.status} "
                    f"worker={run_result.task_run.worker_id}",
                    flush=True,
                )
                try:
                    if run_result.status == RunStatus.WAITING_PERMISSION and run_result.permission is not None:
                        _ask(run_result.permission)
                    elif run_result.status == RunStatus.SUCCEEDED:
                        raw = run_result.raw_output or run_result.cleaned_output or run_result.task_run.result_text
                        _record_runtime_shadow(raw, receive_id=rid, receive_id_type=receive_id_type)
                        body = _final_display_text(raw)
                        if is_queued:
                            try:
                                _card_done(card, raw)
                            except Exception:
                                if body:
                                    _feishu_delivery_service(fs, rid, receive_id_type).deliver(body, send_body=True)
                        else:
                            try:
                                _card_done(card, raw)
                            except Exception:
                                if body:
                                    _feishu_delivery_service(fs, rid, receive_id_type).deliver(body, send_body=True)
                        _feishu_delivery_service(fs, rid, receive_id_type).deliver(
                            raw, base_dir=getattr(fs, "TEMP_DIR", None), send_body=False, send_notice=True
                        )
                        send_generated = getattr(fs, "_send_generated_files", None)
                        if callable(send_generated):
                            try:
                                send_generated(rid, raw, receive_id_type)
                            except Exception as exc:
                                print(f"[penglai feishu] generated file resend failed: {exc}", flush=True)
                    elif run_result.status == RunStatus.CANCELLED:
                        self.agent.abort()
                        if not is_queued:
                            card._penglai_cancel_enabled = False
                            card.fail("已停止")
                    elif run_result.status == RunStatus.FAILED:
                        if not is_queued:
                            card._penglai_cancel_enabled = False
                            if "timed out" in (run_result.task_run.error or ""):
                                self.agent.abort()
                                card.fail("任务超时")
                            else:
                                card.fail(f"错误: {run_result.task_run.error}")
                        else:
                            card._penglai_cancel_enabled = False
                            try:
                                card.fail(f"错误: {run_result.task_run.error}")
                            except Exception:
                                _feishu_delivery_service(fs, rid, receive_id_type).deliver(
                                    f"❌ 错误: {run_result.task_run.error}", send_body=True
                                )
                except Exception as exc:
                    print(f"[penglai feishu] on_result error: {exc}", flush=True)
                finally:
                    _pop_task(task_id)
                    self.user_tasks.pop(chat_id, None)
                    if getattr(self.agent, "_fs_active_task_id", None) == task_id:
                        try:
                            delattr(self.agent, "_fs_active_task_id")
                        except AttributeError:
                            pass

            # ── owner routing: try control API first for shared GA session ──
            _owner_id = str(user_id or receive_id or chat_id)
            _allowed = set(
                str(x) for x in (getattr(fs, "ALLOWED_USERS", set()) or set())
                if str(x) and str(x) != "*"
            )
            _heartbeat_started = False
            if _owner_id in _allowed:
                if card_started:
                    _start_waiting_card_heartbeat(
                        card,
                        task_id,
                        lambda: getattr(self.agent, "_fs_active_task_id", None),
                        done_evt,
                    )
                    _heartbeat_started = True
                try:
                    ctrl_resp = await asyncio.to_thread(
                        _try_owner_control_api,
                        text=str(text or ""),
                        user_id=_owner_id,
                        chat_id=str(chat_id),
                        chat_type=str(chat_type or "private"),
                        images=list(images or []),
                        timeout=float(getattr(fs, "AGENT_TIMEOUT_SEC", 1200)),
                    )
                except Exception:
                    ctrl_resp = None
                if ctrl_resp is not None:
                    run_result = _control_api_to_run_result(ctrl_resp, event)
                    _on_result(run_result)
                    return
                # Control API unavailable — fall through to local service.submit.

            decision = service.submit(
                event, port=port, on_complete=_on_result,
                base_dir=getattr(fs, "TEMP_DIR", None),
                send_body=False, send_notice=False,
            )
            if not decision.started_now:
                done_evt.set()
                # Queued by the hub.  Clean up the card (a different task owns
                # the chat right now) and send a queued receipt card.  It is a
                # queued-state card, not a thinking card, and on_result will
                # patch the same card when this event is dispatched later.
                _pop_task(task_id)
                self.user_tasks.pop(chat_id, None)
                if getattr(self.agent, "_fs_active_task_id", None) == task_id:
                    try:
                        delattr(self.agent, "_fs_active_task_id")
                    except AttributeError:
                        pass
                msg = f"已收到，当前还有任务在运行；这条已排队 #{decision.queue_no}，当前任务结束后自动处理。发送 /stop 可停止当前任务。"
                queued_card_sent = False
                try:
                    queued_card_sent = await asyncio.to_thread(_card_queued, card, decision.queue_no, msg)
                except Exception as exc:
                    print(f"[penglai feishu] queued card failed: {exc}", flush=True)
                if not queued_card_sent:
                    await self.send_text(chat_id, msg, receive_id=receive_id, receive_id_type=receive_id_type)
                print(
                    f"[penglai feishu] queued message #{decision.queue_no} "
                    f"for chat={_mask_id(chat_id)} chars={len(str(text or ''))}",
                    flush=True,
                )
                return
            if card_started and not _heartbeat_started:
                _start_waiting_card_heartbeat(
                    card,
                    task_id,
                    lambda: getattr(self.agent, "_fs_active_task_id", None),
                    done_evt,
                )
            # Started now: on_result delivers.  We return immediately — no
            # blocking wait.  The hub worker thread calls on_result when GA
            # finishes; the heartbeat only keeps the active card visibly alive.
        except Exception as e:
            done_evt.set()
            traceback.print_exc()
            card._penglai_cancel_enabled = False
            await asyncio.to_thread(card.fail, f"错误: {e}")
            _pop_task(task_id)
            self.user_tasks.pop(chat_id, None)
            if getattr(self.agent, "_fs_active_task_id", None) == task_id:
                try:
                    delattr(self.agent, "_fs_active_task_id")
                except AttributeError:
                    pass

    async def handle_command(self, chat_id, cmd, **ctx):
        s = (cmd or "").strip()
        if s in ("/stop", "/cancel", "/abort"):
            for state in list(getattr(self, "user_tasks", {}).values()):
                try:
                    state["running"] = False
                except Exception:
                    pass
            try:
                self.agent.abort()
            except Exception:
                pass
            _cancel_ask(chat_id)
            service = _runtime_service(self)
            event = InboundEvent(
                event_id=f"feishu_cancel_{uuid.uuid4().hex}",
                channel="feishu",
                user_id=str(ctx.get("user_id") or ctx.get("receive_id") or chat_id),
                chat_id=str(chat_id),
                chat_type=str(ctx.get("chat_type") or "private"),
                text=s,
                metadata=dict(ctx or {}),
            )
            session = service.router.route(event)
            pre_status = service.status(session.session_id)
            dropped = pre_status.get("queue", {}).get("pending", 0)
            data = service.cancel_session(session.session_id, drop_pending=True)
            self._penglai_last_runtime_cancel = {
                "session_id": session.session_id,
                "next_event_id": data.get("next_event_id") or "",
                "dropped": dropped,
            }
            self.user_tasks.pop(chat_id, None)
            await self.send_text(
                chat_id,
                f"⏹️ 已请求停止当前任务（session: {session.session_id}，清理排队 {dropped} 条）",
                **ctx,
            )
            print(
                "[penglai feishu runtime] cancel "
                f"session={session.session_id} next={data.get('next_event_id') or '-'} dropped={dropped}",
                flush=True,
            )
            return
        if s == "/review" or s.startswith("/review ") or s.startswith("/review\t"):
            from frontends import review_cmd

            body = s[len("/review"):].strip()
            out = Q.Queue()
            prompt = review_cmd.handle(self.agent, body, out)
            if prompt is None:
                try:
                    item = out.get_nowait()
                    if "done" in item:
                        await self.send_text(chat_id, item["done"], **ctx)
                except Q.Empty:
                    pass
                return
            await self.run_agent(chat_id, prompt, **ctx)
            return
        if s == "/version":
            await self.send_text(chat_id, format_version_text(), **ctx)
            return
        return await orig_handle_command(self, chat_id, cmd, **ctx)

    def handle_message(data):
        event, message, sender = data.event, data.event.message, data.event.sender
        message_id = getattr(message, "message_id", "") or ""
        if not fs._claim_message_once(message_id):
            print(f"忽略重复飞书消息: {message_id}")
            return
        open_id = sender.sender_id.open_id
        chat_id = message.chat_id
        if not fs.PUBLIC_ACCESS and open_id not in fs.ALLOWED_USERS:
            print(f"未授权用户: {open_id}")
            return
        msg_type = _message_type(message)
        user_input, image_paths = fs._build_user_message(message)
        receive_id = chat_id or open_id
        receive_id_type = "chat_id" if chat_id else "open_id"
        raw_chat_type = str(getattr(message, "chat_type", "") or "").lower()
        runtime_chat_type = "group" if "group" in raw_chat_type else "private"
        chat_key = receive_id
        choice = _pop_choice(chat_key, user_input)
        if choice is not None:
            user_input = choice
        if not user_input:
            if chat_id:
                _feishu_delivery_service(fs, chat_id, "chat_id").deliver(
                    f"⚠️ 暂不支持处理此类飞书消息：{msg_type}", send_body=True
                )
            else:
                _feishu_delivery_service(fs, open_id, "open_id").deliver(
                    f"⚠️ 暂不支持处理此类飞书消息：{msg_type}", send_body=True
                )
            return
        print(
            f"收到消息 [user={_mask_id(open_id)}] "
            f"({msg_type}, {len(image_paths)} images, chars={len(str(user_input or ''))})",
            flush=True,
        )
        if _secret_blocked(user_input):
            print(
                "[penglai feishu] secret-bearing message blocked from LLM context: "
                f"{_redact_log_text(user_input)[:120]}",
                flush=True,
            )
            _feishu_delivery_service(fs, receive_id, receive_id_type).deliver(_SECRET_BLOCK_REPLY, send_body=True)
            return
        if msg_type == "text" and user_input.startswith("/") and choice is None:
            threading.Thread(
                target=fs._run_async,
                args=(fs.get_app().handle_command(chat_key, user_input,
                                                  receive_id=receive_id,
                                                  receive_id_type=receive_id_type,
                                                  user_id=open_id,
                                                  chat_type=runtime_chat_type),),
                daemon=True,
            ).start()
            return
        direct_event = _explicit_interaction_event(user_input) if choice is None else None
        if direct_event:
            menu_id = f"direct_{chat_key}_{uuid.uuid4().hex}"
            _remember_ask(
                chat_key,
                direct_event,
                menu_id=menu_id,
                receive_id=receive_id,
                receive_id_type=receive_id_type,
                user_id=open_id,
                chat_type=runtime_chat_type,
            )
            elements = build_ask_user_elements("", direct_event, menu_id=menu_id, include_buttons=True)
            payload = fs._card_raw(elements)
            ok = fs._send_raw(receive_id, payload, "interactive", receive_id_type)
            print(
                "[penglai feishu] direct interaction card "
                f"menu_id={menu_id} options={len(direct_event.get('candidates') or [])} ok={bool(ok)}",
                flush=True,
            )
            if not ok:
                _feishu_delivery_service(fs, receive_id, receive_id_type).deliver(
                    render_ask_user_text("", direct_event), send_body=True
                )
            return
        threading.Thread(
            target=fs._run_async,
            args=(fs.get_app().run_agent(chat_key, user_input,
                                         receive_id=receive_id,
                                         receive_id_type=receive_id_type,
                                         images=image_paths,
                                         priority=choice is not None,
                                         user_id=open_id,
                                         chat_type=runtime_chat_type),),
            daemon=True,
        ).start()

    def handle_card_action(data):
        try:
            from lark_oapi.event.callback.model.p2_card_action_trigger import (
                P2CardActionTriggerResponse,
            )
        except Exception:
            class P2CardActionTriggerResponse(dict):
                pass

        def resp(kind, content):
            return P2CardActionTriggerResponse({"toast": {"type": kind, "content": content}})

        try:
            event = getattr(data, "event", None)
            action = getattr(event, "action", None)
            operator = getattr(event, "operator", None)
            open_id = getattr(operator, "open_id", "") or ""
            if not fs.PUBLIC_ACCESS and open_id not in fs.ALLOWED_USERS:
                return resp("error", "未授权")
            value = getattr(action, "value", None) or {}
            cancel_task_id = _parse_runtime_cancel_value(value)
            if cancel_task_id:
                cancelled = _cancel_runtime_task(fs.get_app(), cancel_task_id)
                if not cancelled:
                    return resp("warning", "这个任务已结束或已失效。")
                return resp("success", "已请求停止当前任务。")
            parsed = parse_callback_value(value)
            if not parsed:
                return resp("warning", "未知操作")
            picked = _pop_menu_choice(parsed["request_id"], parsed["index"])
            if not picked:
                return resp("warning", "这个选项已失效，请重新发消息。")
            threading.Thread(
                target=fs._run_async,
                args=(fs.get_app().run_agent(
                    picked["chat_key"],
                    picked["choice"],
                    receive_id=picked["receive_id"],
                    receive_id_type=picked["receive_id_type"],
                    user_id=picked.get("user_id"),
                    chat_type=picked.get("chat_type") or "private",
                    priority=True,
                ),),
                daemon=True,
            ).start()
            return resp("success", f"已选择：{picked['choice']}")
        except Exception as e:
            traceback.print_exc()
            return resp("error", f"处理失败: {e}")

    run_agent._penglai_runtime_hub = True
    fs.FeishuApp.run_agent = run_agent
    fs.FeishuApp.handle_command = handle_command
    fs.handle_message = handle_message
    fs.handle_card_action = handle_card_action
    fs._orig_penglai_feishu_run_agent = orig_run_agent
    fs._orig_penglai_feishu_handle_command = orig_handle_command
    fs._orig_penglai_feishu_handle_message = orig_handle_message


def _runtime_check(fs):
    data = {
        "route": "InboundEvent -> RuntimeHubService -> GenericAgentInstancePort -> TaskRun",
        "wrapper_run_agent_patched": bool(getattr(fs.FeishuApp.run_agent, "_penglai_runtime_hub", False)),
        "runtime_service_init": False,
        "owner_scope_count": len(set(getattr(fs, "ALLOWED_USERS", set()) or set())),
        "card_action_supported": False,
    }
    try:
        RuntimeHubService(
            owner_user_ids=set(getattr(fs, "ALLOWED_USERS", set()) or set()),
            context_log_path=default_context_log_path(),
        )
        data["runtime_service_init"] = True
    except Exception as e:
        data["runtime_service_error"] = str(e)
    try:
        builder = fs.lark.EventDispatcherHandler.builder("", "")
        data["card_action_supported"] = hasattr(builder, "register_p2_card_action_trigger")
    except Exception as e:
        data["card_action_error"] = str(e)
    data["ok"] = bool(data["wrapper_run_agent_patched"] and data["runtime_service_init"])
    return data


def _mask_id(value):
    text = str(value or "")
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _single_allowed_open_id(fs):
    allowed = [str(x) for x in (getattr(fs, "ALLOWED_USERS", set()) or set()) if str(x) and str(x) != "*"]
    return allowed[0] if len(allowed) == 1 else ""


def _gray_probe(fs, *, wait_seconds=120, nonce=None, send_prompt=False, target_open_id="", stop_probe=False):
    """Run a real Feishu WSS gray probe.

    This does not synthesize a platform event.  It observes real Feishu WSS
    inbound messages and, when requested explicitly, sends one real prompt to
    the chosen open_id so the owner can reply with the nonce.
    """
    fs.APP_ID, fs.APP_SECRET, fs.ALLOWED_USERS, fs.PUBLIC_ACCESS, fs.CONFIG_PATH = fs._feishu_config()
    nonce = str(nonce or f"penglai030-{uuid.uuid4().hex[:8]}")
    target_open_id = str(target_open_id or _single_allowed_open_id(fs) or "")
    state = {
        "nonce": nonce,
        "inbound_seen": False,
        "taskrun_seen": False,
        "taskrun_status": "",
        "session_id": "",
        "run_id": "",
        "worker_id": "",
        "start_error": "",
        "send_prompt": bool(send_prompt),
        "sent_prompt": False,
        "target_hash": _mask_id(target_open_id),
        "stop_probe": bool(stop_probe),
        "cancel_seen": False,
        "cancel_session_id": "",
    }
    if not fs.APP_ID or not fs.APP_SECRET:
        state["error"] = "missing Feishu app_id/app_secret"
        print("FEISHU_GRAY_RESULT=" + json.dumps(state, ensure_ascii=False), flush=True)
        return 2

    orig_handle_message = fs.handle_message

    def observed_handle_message(data):
        try:
            event = getattr(data, "event", None)
            message = getattr(event, "message", None)
            text, _images = fs._build_user_message(message)
            expected = "/stop" if stop_probe else nonce
            if expected in str(text or ""):
                state["inbound_seen"] = True
                print("FEISHU_GRAY_INBOUND_STOP=1" if stop_probe else "FEISHU_GRAY_INBOUND_NONCE=1", flush=True)
        except Exception as e:
            print(f"FEISHU_GRAY_OBSERVER_ERROR={type(e).__name__}: {e}", flush=True)
        return orig_handle_message(data)

    builder = fs.lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(observed_handle_message)
    if hasattr(builder, "register_p2_card_action_trigger"):
        builder = builder.register_p2_card_action_trigger(fs.handle_card_action)
        _patch_lark_ws_card_dispatch()
    handler = builder.build()
    fs.client = fs.create_client()
    cli = fs.lark.ws.Client(fs.APP_ID, fs.APP_SECRET, event_handler=handler, log_level=fs.lark.LogLevel.INFO)

    def _start_ws():
        try:
            cli.start()
        except Exception as e:
            state["start_error"] = f"{type(e).__name__}: {e}"
            print(f"FEISHU_GRAY_WSS_ERROR={state['start_error']}", flush=True)

    thread = threading.Thread(target=_start_ws, daemon=True, name="feishu-gray-probe-wss")
    thread.start()
    print(
        "FEISHU_GRAY_WAITING="
        + json.dumps({
            "nonce": nonce,
            "wait_seconds": float(wait_seconds),
            "send_prompt": bool(send_prompt),
            "target_hash": state["target_hash"],
            "route": "InboundEvent -> RuntimeHubService -> GenericAgentInstancePort -> TaskRun",
        }, ensure_ascii=False),
        flush=True,
    )
    time.sleep(2.0)
    if send_prompt:
        if not target_open_id:
            state["error"] = "灰度提示需要 --gray-target-open-id，或 mykey.py 中只有一个 fs_allowed_users 条目"
        else:
            if stop_probe:
                prompt = (
                    f"PenglaiAgent {VERSION} 飞书停止命令灰度验证："
                    "请直接回复 /stop，用于确认真实 WSS 入站会取消同一个 Runtime Hub session。"
                )
            else:
                prompt = (
                    f"PenglaiAgent {VERSION} 飞书灰度验证：请直接回复下面这段验证码，"
                    "用于确认真实 WSS 入站会进入 Runtime Hub。\n"
                    f"{nonce}"
                )
            try:
                _gray_deliver = _feishu_delivery_service(fs, target_open_id, "open_id").deliver(
                    prompt, send_body=True
                )
                state["sent_prompt"] = bool(_gray_deliver.sent_body)
                print("FEISHU_GRAY_PROMPT_SENT=" + ("1" if _gray_deliver.sent_body else "0"), flush=True)
            except Exception as e:
                state["error"] = f"发送灰度提示失败：{type(e).__name__}: {e}"
                print(f"FEISHU_GRAY_PROMPT_ERROR={state['error']}", flush=True)

    deadline = time.time() + max(1.0, float(wait_seconds))
    while time.time() < deadline:
        app = getattr(fs, "app", None)
        cancel = getattr(app, "_penglai_last_runtime_cancel", None) if app is not None else None
        if stop_probe and cancel is not None:
            state["cancel_seen"] = True
            state["cancel_session_id"] = cancel.get("session_id") or ""
            break
        result = getattr(app, "_penglai_last_runtime_result", None) if app is not None else None
        if not stop_probe and result is not None and nonce in str(getattr(result.event, "text", "") or ""):
            state["taskrun_seen"] = True
            state["taskrun_status"] = result.status
            state["session_id"] = result.session.session_id
            state["run_id"] = result.task_run.run_id
            state["worker_id"] = result.task_run.worker_id
            break
        if state.get("start_error"):
            break
        time.sleep(0.5)

    state["ok"] = bool(state["inbound_seen"] and (state["cancel_seen"] if stop_probe else state["taskrun_seen"]))
    if not state["ok"] and not state.get("error"):
        if not state["inbound_seen"]:
            state["error"] = "超时前没有收到匹配的真实飞书入站消息"
        elif stop_probe and not state["cancel_seen"]:
            state["error"] = "已收到停止命令，但超时前未观察到 Runtime Hub cancel"
        elif not state["taskrun_seen"]:
            state["error"] = "已收到验证码，但超时前未观察到匹配的 Runtime Hub TaskRun"
    print("FEISHU_GRAY_RESULT=" + json.dumps(state, ensure_ascii=False, sort_keys=True), flush=True)
    return 0 if state["ok"] else 3


def main():
    import frontends.fsapp as fs

    _patch(fs)
    parser = argparse.ArgumentParser(description="蓬莱飞书渠道入口")
    parser.add_argument("--check", action="store_true", help="只检查飞书配置，不启动长连接")
    parser.add_argument("--check-agent", action="store_true", help="检查配置并初始化 Agent/LLM")
    parser.add_argument("--gray-probe", action="store_true", help="真实飞书 WSS 灰度探针：等待 nonce 入站并观察 Runtime Hub TaskRun")
    parser.add_argument("--gray-wait", type=float, default=120, help="灰度探针等待秒数")
    parser.add_argument("--gray-nonce", default="", help="灰度探针验证码；默认自动生成")
    parser.add_argument("--gray-send-prompt", action="store_true", help="向目标 open_id 发送一条真实 Feishu 提示消息")
    parser.add_argument("--gray-target-open-id", default="", help="灰度提示目标 open_id；不填时使用唯一 fs_allowed_users 条目")
    parser.add_argument("--gray-stop-probe", action="store_true", help="真实飞书 WSS 停止命令探针：等待 /stop 入站并观察 Runtime Hub cancel")
    args = parser.parse_args()
    if args.check or args.check_agent:
        data = fs.check_config(init_agent=args.check_agent)
        data["runtime_hub"] = _runtime_check(fs)
        print(json.dumps(data, ensure_ascii=False, indent=2), flush=True)
        return None
    if args.gray_probe:
        return _gray_probe(
            fs,
            wait_seconds=args.gray_wait,
            nonce=args.gray_nonce,
            send_prompt=args.gray_send_prompt,
            target_open_id=args.gray_target_open_id,
            stop_probe=args.gray_stop_probe,
        )
    fs.APP_ID, fs.APP_SECRET, fs.ALLOWED_USERS, fs.PUBLIC_ACCESS, fs.CONFIG_PATH = fs._feishu_config()
    if not fs.APP_ID or not fs.APP_SECRET:
        print(f"错误: 请在 mykey 配置中填写 fs_app_id 和 fs_app_secret\n配置文件: {fs.CONFIG_PATH}", flush=True)
        sys.exit(1)
    builder = fs.lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(fs.handle_message)
    if hasattr(builder, "register_p2_card_action_trigger"):
        builder = builder.register_p2_card_action_trigger(fs.handle_card_action)
        _patch_lark_ws_card_dispatch()
    else:
        print("[WARN] 当前 lark-oapi 不支持 register_p2_card_action_trigger，飞书按钮将只能用文字回复兜底",
              flush=True)
    handler = builder.build()
    retry_delay = 5
    while True:
        try:
            fs.client = fs.create_client()
            lark_log_level = getattr(
                fs.lark.LogLevel,
                "WARNING",
                getattr(fs.lark.LogLevel, "ERROR", fs.lark.LogLevel.INFO),
            )
            cli = fs.lark.ws.Client(fs.APP_ID, fs.APP_SECRET, event_handler=handler,
                                    log_level=lark_log_level)
            print("=" * 50 + "\n飞书入口已启动（长连接模式）\n"
                  + f"版本: {compact_version_line()}\n"
                  + f"App ID: {fs.APP_ID}\n配置: {fs.CONFIG_PATH}\n等待消息...\n"
                  + "中枢链路: InboundEvent -> RuntimeHubService -> GenericAgentInstancePort -> TaskRun\n"
                  + "=" * 50, flush=True)
            cli.start()
            retry_delay = 5
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"[WARN] 飞书长连接断开或启动失败: {e}", flush=True)
            traceback.print_exc()
        print(f"[INFO] {retry_delay}s 后重连飞书长连接...", flush=True)
        time.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, 120)


if __name__ == "__main__":
    raise SystemExit(main() or 0)
