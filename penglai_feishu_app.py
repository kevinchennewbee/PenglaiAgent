# -*- coding: utf-8 -*-
"""Penglai Feishu launcher.

This wrapper keeps upstream `frontends/fsapp.py` untouched and layers Penglai
runtime behavior on top of it.  It is intentionally small: import upstream,
patch Feishu ask_user rendering, then delegate to upstream main().
"""
import asyncio
import argparse
import ast
import json
import os
import queue as Q
import re
import sys
import threading
import time
import traceback
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
from penglai_runtime.output_cleaner import clean_final_text, has_internal_markup  # noqa: E402
from penglai_runtime.interaction import parse_callback_value, request_from_ask_user_event  # noqa: E402
from plugins.penglai_artifacts import file_markers, strip_file_markers  # noqa: E402


_ASK_STATE = {}
_ASK_BY_MENU = {}
_ASK_LOCK = threading.Lock()
_PENDING_LOCK = threading.Lock()
_PENDING_QUEUE = []
PENGLAI_IM_FILE_HINT = (
    "If you need to show files to user, use [FILE:filepath] in your response. "
    "Do not read channel-specific send-file SOPs or call Feishu/IM upload APIs directly; "
    "Penglai owns outbound delivery for every IM channel. "
    "If you need to ask the user to choose, confirm, authorize, or provide missing information, "
    "use the ask_user tool and let Penglai render the interaction for this IM channel; "
    "do not create Feishu interactive cards by direct API calls. "
    "If this prompt came from an IM channel, that channel is currently active; "
    "do not report the current IM service as stopped unless the user explicitly asks for service diagnostics."
)

_MASK_PATTERNS = [
    re.compile(r"(sk-[A-Za-z0-9_-]{8,})"),
    re.compile(r"(?i)(api\s*key\s*[:：])\s*[^\s,;]+"),
    re.compile(r"(?i)(api[_-]?key|token|secret|password|client_secret|app_secret)\s*[:=]\s*[^\s,;\]\)]+"),
    re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.I),
]
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


def _redact_log_text(text):
    value = str(text or "")
    value = _MASK_PATTERNS[0].sub("sk-***", value)
    value = _MASK_PATTERNS[1].sub(r"\1 ***", value)
    value = _MASK_PATTERNS[2].sub(r"\1=***", value)
    value = _MASK_PATTERNS[3].sub("Bearer ***", value)
    return value


def _message_type(message):
    value = getattr(message, "message_type", "") or ""
    value = getattr(value, "value", value)
    return str(value or "").strip()


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
        text, images = original(message)
        msg_type = _message_type(message)
        if not text and msg_type == "text":
            text = _text_from_message(message)
            if text:
                print("[penglai feishu] text message content fallback used", flush=True)
            else:
                content = getattr(message, "content", None)
                print(
                    "[penglai feishu] text message empty after fallback "
                    f"content_type={type(content).__name__}",
                    flush=True,
                )
        elif not text and msg_type in _RESOURCE_KEYS:
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


def _enqueue_pending(item):
    with _PENDING_LOCK:
        item["queue_no"] = len(_PENDING_QUEUE) + 1
        _PENDING_QUEUE.append(item)
        return item["queue_no"]


def _pop_pending():
    with _PENDING_LOCK:
        if not _PENDING_QUEUE:
            return None
        return _PENDING_QUEUE.pop(0)


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


def _remember_ask(chat_key, event, *, menu_id=None, receive_id=None, receive_id_type="open_id"):
    with _ASK_LOCK:
        _ASK_STATE[chat_key] = event
        if menu_id:
            _ASK_BY_MENU[menu_id] = {
                "chat_key": chat_key,
                "event": event,
                "receive_id": receive_id or chat_key,
                "receive_id_type": receive_id_type,
            }


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
        return {
            "chat_key": chat_key,
            "choice": choice,
            "receive_id": item.get("receive_id") or chat_key,
            "receive_id_type": item.get("receive_id_type") or "open_id",
        }


def _cancel_ask(chat_key):
    with _ASK_LOCK:
        _ASK_STATE.pop(chat_key, None)
        for menu_id, item in list(_ASK_BY_MENU.items()):
            if item.get("chat_key") == chat_key:
                _ASK_BY_MENU.pop(menu_id, None)


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


def _patch(fs):
    if getattr(fs, "_PENGLAI_FEISHU_PATCHED", False):
        return
    fs._PENGLAI_FEISHU_PATCHED = True
    _install_display_cleaners(fs)
    _install_text_message_fallback(fs)

    orig_handle_message = fs.handle_message
    orig_run_agent = fs.FeishuApp.run_agent
    orig_handle_command = fs.FeishuApp.handle_command

    def _finish_ask_card(card, raw, event, menu_id):
        text = fs._display_text(raw)
        if text.startswith("⚠️ 模型输出被截断或为空"):
            text = ""
        elements = build_ask_user_elements(text, event, menu_id=menu_id, include_buttons=True)
        card.status = "🧭 等待选择"
        card.final = None
        rendered = fs._card_raw(elements)
        ok = fs._patch_card(card.msg_id, rendered) if card.msg_id else False
        if not ok:
            fs.send_message(card.rid, render_ask_user_text(text, event), receive_id_type=card.rtype)

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
        text = _final_display_text(raw)
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

    def _record_v5_shadow(raw, *, receive_id, receive_id_type):
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

    def _start_pending_if_any():
        item = _pop_pending()
        if not item:
            return
        try:
            fs.send_message(
                item["receive_id"],
                f"▶️ 开始处理排队消息 #{item['queue_no']}。",
                receive_id_type=item["receive_id_type"],
            )
        except Exception:
            pass
        threading.Thread(
            target=fs._run_async,
            args=(fs.get_app().run_agent(
                item["chat_id"],
                item["text"],
                receive_id=item["receive_id"],
                receive_id_type=item["receive_id_type"],
                images=item.get("images") or None,
            ),),
            daemon=True,
        ).start()

    def _make_penglai_task_hook(card, task_id, on_final, on_ask):
        def hook(ctx):
            try:
                if getattr(ctx.get("self").parent, "_fs_active_task_id", None) != task_id:
                    return
                if ctx.get("exit_reason"):
                    resp = ctx.get("response")
                    raw = resp.content if hasattr(resp, "content") else str(resp)
                    event = extract_ask_user_event(ctx)
                    if event:
                        on_ask(raw, event)
                    else:
                        on_final(raw)
                elif ctx.get("summary"):
                    detail = fs._build_step_detail(ctx.get("response"), ctx.get("tool_calls") or [])
                    card.step(ctx["summary"], detail)
            except Exception as e:
                print(f"[penglai fs hook] error: {e}")
        return hook

    async def run_agent(self, chat_id, text, *, receive_id=None, receive_id_type="open_id",
                        images=None, priority=False, **_):
        if self.user_tasks:
            deadline = time.time() + (5 if priority else 0)
            while priority and self.user_tasks and time.time() < deadline:
                await asyncio.sleep(0.1)
            if self.user_tasks:
                qno = _enqueue_pending({
                    "chat_id": chat_id,
                    "text": text,
                    "receive_id": receive_id or chat_id,
                    "receive_id_type": receive_id_type,
                    "images": images or None,
                })
                msg = f"已收到，当前还有任务在运行；这条已排队 #{qno}，当前任务结束后自动处理。发送 /stop 可停止当前任务。"
                if priority:
                    msg = f"已收到你的选择，当前任务收尾后继续处理（排队 #{qno}）。"
                await self.send_text(chat_id, msg, receive_id=receive_id, receive_id_type=receive_id_type)
                print(f"[penglai feishu] queued message #{qno} for {chat_id}: {_redact_log_text(text)[:120]}")
                return
        state = {"running": True}
        self.user_tasks[chat_id] = state
        rid = receive_id or chat_id
        task_id = f"{chat_id}_{uuid.uuid4().hex}"
        hook_key = f"fs_{task_id}"
        card = fs._TaskCard(rid, receive_id_type)
        result = {"raw": None, "sent": False, "ask": None}
        finish_lock = threading.Lock()

        def _finish(raw):
            with finish_lock:
                if result["sent"]:
                    return
                result["raw"] = raw
                result["sent"] = True
            _cancel_ask(chat_id)
            _record_v5_shadow(raw, receive_id=rid, receive_id_type=receive_id_type)
            _card_done(card, raw)
            fs._send_generated_files(rid, raw, receive_id_type=receive_id_type)

        def _ask(raw, event):
            with finish_lock:
                if result["sent"]:
                    return
                result["raw"] = raw
                result["sent"] = True
                result["ask"] = event
            _remember_ask(chat_id, event, menu_id=task_id, receive_id=rid, receive_id_type=receive_id_type)
            _finish_ask_card(card, raw, event, task_id)

        try:
            await asyncio.to_thread(card.start)
            if not hasattr(self.agent, "_turn_end_hooks"):
                self.agent._turn_end_hooks = {}
            self.agent._turn_end_hooks[hook_key] = _make_penglai_task_hook(card, task_id, _finish, _ask)
            self.agent._fs_active_task_id = task_id
            dq = self.agent.put_task(f"{fs.FILE_HINT}\n\n{text}", source=self.source, images=images or None)
            start = time.time()
            while state["running"] and not result["sent"]:
                try:
                    item = await asyncio.to_thread(dq.get, True, 1)
                except Q.Empty:
                    item = None
                if item and "done" in item:
                    await asyncio.to_thread(_finish, item.get("done", ""))
                    break
                if time.time() - start > fs.AGENT_TIMEOUT_SEC:
                    self.agent.abort()
                    await asyncio.to_thread(card.fail, "任务超时")
                    break
            if not state["running"] and not result["sent"]:
                self.agent.abort()
                await asyncio.to_thread(card.fail, "已停止")
        except Exception as e:
            traceback.print_exc()
            await asyncio.to_thread(card.fail, f"错误: {e}")
        finally:
            if getattr(self.agent, "_fs_active_task_id", None) == task_id:
                try:
                    delattr(self.agent, "_fs_active_task_id")
                except AttributeError:
                    pass
            if hasattr(self.agent, "_turn_end_hooks"):
                self.agent._turn_end_hooks.pop(hook_key, None)
            self.user_tasks.pop(chat_id, None)
            _start_pending_if_any()

    async def handle_command(self, chat_id, cmd, **ctx):
        s = (cmd or "").strip()
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
        user_input, image_paths = fs._build_user_message(message)
        msg_type = _message_type(message)
        receive_id = chat_id or open_id
        receive_id_type = "chat_id" if chat_id else "open_id"
        chat_key = receive_id
        choice = _pop_choice(chat_key, user_input)
        if choice is not None:
            user_input = choice
        if not user_input:
            if chat_id:
                fs.send_message(chat_id, f"⚠️ 暂不支持处理此类飞书消息：{msg_type}",
                                receive_id_type="chat_id")
            else:
                fs.send_message(open_id, f"⚠️ 暂不支持处理此类飞书消息：{msg_type}")
            return
        print(f"收到消息 [{open_id}] ({msg_type}, {len(image_paths)} images): {_redact_log_text(user_input)[:200]}")
        if msg_type == "text" and user_input.startswith("/") and choice is None:
            threading.Thread(
                target=fs._run_async,
                args=(fs.get_app().handle_command(chat_key, user_input,
                                                  receive_id=receive_id,
                                                  receive_id_type=receive_id_type),),
                daemon=True,
            ).start()
            return
        direct_event = _explicit_interaction_event(user_input) if choice is None else None
        if direct_event:
            menu_id = f"direct_{chat_key}_{uuid.uuid4().hex}"
            _remember_ask(chat_key, direct_event, menu_id=menu_id,
                          receive_id=receive_id, receive_id_type=receive_id_type)
            elements = build_ask_user_elements("", direct_event, menu_id=menu_id, include_buttons=True)
            payload = fs._card_raw(elements)
            ok = fs._send_raw(receive_id, payload, "interactive", receive_id_type)
            print(
                "[penglai feishu] direct interaction card "
                f"menu_id={menu_id} options={len(direct_event.get('candidates') or [])} ok={bool(ok)}",
                flush=True,
            )
            if not ok:
                fs.send_message(
                    receive_id,
                    render_ask_user_text("", direct_event),
                    receive_id_type=receive_id_type,
                )
            return
        threading.Thread(
            target=fs._run_async,
            args=(fs.get_app().run_agent(chat_key, user_input,
                                         receive_id=receive_id,
                                         receive_id_type=receive_id_type,
                                         images=image_paths,
                                         priority=choice is not None),),
            daemon=True,
        ).start()

    def handle_card_action(data):
        from lark_oapi.event.callback.model.p2_card_action_trigger import (
            P2CardActionTriggerResponse,
        )

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
                    priority=True,
                ),),
                daemon=True,
            ).start()
            return resp("success", f"已选择：{picked['choice']}")
        except Exception as e:
            traceback.print_exc()
            return resp("error", f"处理失败: {e}")

    fs.FeishuApp.run_agent = run_agent
    fs.FeishuApp.handle_command = handle_command
    fs.handle_message = handle_message
    fs.handle_card_action = handle_card_action
    fs._orig_penglai_feishu_run_agent = orig_run_agent
    fs._orig_penglai_feishu_handle_command = orig_handle_command
    fs._orig_penglai_feishu_handle_message = orig_handle_message


def main():
    import frontends.fsapp as fs

    _patch(fs)
    parser = argparse.ArgumentParser(description="Penglai Feishu frontend")
    parser.add_argument("--check", action="store_true", help="只检查飞书配置，不启动长连接")
    parser.add_argument("--check-agent", action="store_true", help="检查配置并初始化 Agent/LLM")
    args = parser.parse_args()
    if args.check or args.check_agent:
        print(json.dumps(fs.check_config(init_agent=args.check_agent), ensure_ascii=False, indent=2), flush=True)
        return None
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
            cli = fs.lark.ws.Client(fs.APP_ID, fs.APP_SECRET, event_handler=handler,
                                    log_level=fs.lark.LogLevel.INFO)
            print("=" * 50 + "\n飞书 Agent 已启动（长连接模式）\n"
                  + f"App ID: {fs.APP_ID}\n配置: {fs.CONFIG_PATH}\n等待消息...\n"
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
    main()
