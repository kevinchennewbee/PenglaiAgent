import os
import sys
import types
import asyncio
import contextlib
import io
import json
import queue as Q
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ.setdefault(
    "PENGLAI_CONTEXT_EVENTS_LOG",
    os.path.join(tempfile.mkdtemp(), "penglai_context_events.jsonl"),
)
os.environ.setdefault(
    "PENGLAI_RUNTIME_STORE_PATH",
    os.path.join(tempfile.mkdtemp(), "runtime_hub.sqlite3"),
)

from _harness import run_tests
from penglai_runtime.contracts import InboundEvent, PermissionRequest, RunStatus
from penglai_runtime.service import RuntimeHubService
from penglai_feishu_ask import (
    build_ask_user_elements,
    extract_ask_user_event,
    render_ask_user_text,
    resolve_choice,
)
from penglai_feishu_app import (
    _ASK_BY_MENU,
    _ASK_STATE,
    _TASK_BY_ID,
    _get_task,
    _explicit_interaction_event,
    _extract_final_choice_interaction,
    _install_card_markdown_safety,
    _install_task_card_cancel_button,
    _install_display_cleaners,
    _install_text_message_fallback,
    _card_safe_markdown,
    _looks_like_message_type_placeholder,
    _message_type,
    _patch,
    _permission_to_ask_event,
    _pop_choice,
    _pop_menu_choice,
    _remember_ask,
    _remember_task,
    _redact_log_text,
    _gray_probe,
    _runtime_cancel_callback_value,
    _runtime_check,
    _secret_blocked,
    _single_allowed_open_id,
    _start_waiting_card_heartbeat,
    _text_from_message,
    _text_from_message_content,
)


def _ctx(question="下一步？", candidates=None, result="EXITED"):
    return {
        "exit_reason": {
            "result": result,
            "data": {
                "status": "INTERRUPT",
                "intent": "HUMAN_INTERVENTION",
                "data": {
                    "question": question,
                    "candidates": candidates if candidates is not None else ["继续", "停止"],
                },
            },
        }
    }


def test_extract_ask_user_event_keeps_candidates():
    event = extract_ask_user_event(_ctx())
    assert event == {"question": "下一步？", "candidates": ["继续", "停止"]}


def test_extract_ask_user_event_ignores_non_interrupt():
    assert extract_ask_user_event(_ctx(result="CURRENT_TASK_DONE")) is None
    assert extract_ask_user_event({"exit_reason": {"result": "EXITED", "data": {"status": "ok"}}}) is None


def test_render_ask_user_text_preserves_base_text_and_options():
    text = render_ask_user_text("我把发现落盘了。再问您：", extract_ask_user_event(_ctx()))
    assert "我把发现落盘了。再问您：" in text
    assert "**下一步？**" in text
    assert "1. 继续" in text
    assert "2. 停止" in text
    assert "回复序号" in text
    assert "点击按钮" not in text


def test_build_elements_can_include_buttons():
    event = extract_ask_user_event(_ctx(candidates=[
        {"label": "A", "description": "探深", "value": "deep"},
        {"label": "B", "description": "先停", "value": "stop"},
    ]))
    elements = build_ask_user_elements("我把发现落盘了。再问您：", event, menu_id="m1")
    assert elements[0]["tag"] == "markdown"
    assert "点击按钮" in elements[0]["content"]
    buttons = [e for e in elements if e["tag"] == "button"]
    assert [b["text"]["content"] for b in buttons] == ["1. A: 探深", "2. B: 先停"]
    assert buttons[0]["behaviors"] == [{
        "type": "callback",
        "value": {
            "penglai_action": "interaction_choice",
            "request_id": "m1",
            "menu_id": "m1",
            "index": 0,
        },
    }]
    assert "value" not in buttons[0]


def test_card_menu_choice_consumes_pending_state():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = extract_ask_user_event(_ctx(candidates=[
        {"label": "A", "description": "探深", "value": "deep"},
        {"label": "B", "description": "先停", "value": "stop"},
    ]))
    _remember_ask("chat1", event, menu_id="m1", receive_id="chat1", receive_id_type="chat_id")
    picked = _pop_menu_choice("m1", 1)
    assert picked == {
        "chat_key": "chat1",
        "choice": "stop",
        "receive_id": "chat1",
        "receive_id_type": "chat_id",
    }
    assert "chat1" not in _ASK_STATE
    assert "m1" not in _ASK_BY_MENU


def test_permission_request_uses_shared_payload_for_feishu_buttons():
    request = PermissionRequest(
        action="confirm_tool",
        prompt="允许执行这个操作吗？",
        options=("允许", "取消"),
        metadata={
            "option_labels": ("允许执行", "取消"),
            "option_values": ("allow", "deny"),
        },
    )
    event = _permission_to_ask_event(request)

    assert event["question"] == "允许执行这个操作吗？"
    assert event["_penglai_runtime_permission"] is True
    assert event["_penglai_permission_payload"] == {
        "request_id": request.request_id,
        "action": "confirm_tool",
        "prompt": "允许执行这个操作吗？",
        "options": [
            {"index": 1, "label": "允许执行", "value": "allow"},
            {"index": 2, "label": "取消", "value": "deny"},
        ],
        "allow_free_text": False,
    }
    assert event["candidates"] == [
        {"label": "允许执行", "value": "allow", "description": ""},
        {"label": "取消", "value": "deny", "description": ""},
    ]

    elements = build_ask_user_elements("", event, menu_id="perm1", include_buttons=True)
    buttons = [e for e in elements if e["tag"] == "button"]
    assert [b["text"]["content"] for b in buttons] == ["1. 允许执行", "2. 取消"]
    assert buttons[0]["behaviors"][0]["value"] == {
        "penglai_action": "interaction_choice",
        "request_id": "perm1",
        "menu_id": "perm1",
        "index": 0,
    }


def test_permission_request_feishu_choice_returns_runtime_value():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    request = PermissionRequest(
        action="confirm_tool",
        prompt="允许执行这个操作吗？",
        options=("允许", "取消"),
        metadata={"option_values": ("allow", "deny")},
    )
    event = _permission_to_ask_event(request)

    _remember_ask("chat1", event, menu_id="perm1", receive_id="chat1", receive_id_type="chat_id")
    assert _pop_menu_choice("perm1", 0)["choice"] == "allow"

    _remember_ask("chat1", event, menu_id="perm2", receive_id="chat1", receive_id_type="chat_id")
    assert _pop_choice("chat1", "取消") == "deny"


def test_invalid_card_menu_choice_keeps_pending_state():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    _remember_ask("chat1", event, menu_id="m1", receive_id="chat1", receive_id_type="chat_id")
    assert _pop_menu_choice("m1", 99) is None
    assert "chat1" in _ASK_STATE
    assert "m1" in _ASK_BY_MENU


def test_direct_card_menu_choice_preserves_question_context_for_agent():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = _explicit_interaction_event("问我一个三选一问题，主题关于今晚安排，用飞书选项卡让我选择 A、B、C。")
    _remember_ask("chat1", event, menu_id="m-direct", receive_id="chat1", receive_id_type="chat_id")
    picked = _pop_menu_choice("m-direct", 1)

    assert picked["choice"] == "用户对「今晚安排，请选择一个选项：」的选择/回答：B"
    assert "chat1" not in _ASK_STATE
    assert "m-direct" not in _ASK_BY_MENU


def test_direct_free_text_reply_preserves_question_context_for_agent():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = _explicit_interaction_event("我现在缺一个城市信息，你先问我缺哪个城市，不要给候选项。")
    _remember_ask("chat1", event, menu_id="m-free", receive_id="chat1", receive_id_type="chat_id")

    assert _pop_choice("chat1", "北京") == "用户对「缺哪个城市：」的选择/回答：北京"
    assert "chat1" not in _ASK_STATE
    assert "m-free" not in _ASK_BY_MENU


def test_final_text_choice_prompt_can_be_promoted_to_card_event():
    text = "\n".join([
        "✅ 已完成",
        "",
        "这里是前面的完整结果。",
        "",
        "如果您想要一张赛程表图片存下来，要做哪种？",
        "- A. 生成一张今天的赛程海报图（PNG），存在本地发给您",
        "- B. 下载一张现成的官方海报/壁纸",
        "- C. 文字赛程就够了，不用图",
    ])

    body, event = _extract_final_choice_interaction(text)

    assert body == "✅ 已完成\n\n这里是前面的完整结果。"
    assert event["question"] == "如果您想要一张赛程表图片存下来，要做哪种？"
    assert event["candidates"][0] == {
        "label": "A",
        "value": "生成一张今天的赛程海报图（PNG），存在本地发给您",
        "description": "生成一张今天的赛程海报图（PNG），存在本地发给您",
    }
    assert event["_penglai_direct"] is True


def test_final_text_choice_prompt_ignores_non_question_lists():
    text = "\n".join([
        "赛事分组：",
        "A. 第一组",
        "B. 第二组",
        "C. 第三组",
    ])

    assert _extract_final_choice_interaction(text) is None


def test_normal_text_without_pending_choice_is_not_consumed():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()

    assert _pop_choice("chat1", "/new") is None
    assert _pop_choice("chat1", "你好") is None


def test_pending_queue_is_fifo_and_numbered():
    service = RuntimeHubService(owner_user_ids={"owner"})
    first = InboundEvent("e1", "feishu", "owner", "first")
    second = InboundEvent("e2", "feishu", "owner", "second")
    third = InboundEvent("e3", "feishu", "owner", "third")

    assert service.runner.queue.submit("owner:default", first).started_now is True
    second_decision = service.runner.queue.submit("owner:default", second)
    third_decision = service.runner.queue.submit("owner:default", third)

    assert second_decision.started_now is False
    assert second_decision.queue_no == 1
    assert third_decision.started_now is False
    assert third_decision.queue_no == 2
    assert service.runner.queue.finish("owner:default").text == "second"
    assert service.runner.queue.finish("owner:default").text == "third"
    assert service.runner.queue.finish("owner:default") is None


def test_redact_log_text_masks_common_secrets():
    text = _redact_log_text("API Key: abc123 token=secret Bearer live-token sk-testsecret")
    assert "abc123" not in text
    assert "token=secret" not in text
    assert "Bearer live-token" not in text
    assert "sk-testsecret" not in text
    assert "API Key: ***" in text
    assert "token=***" in text
    assert "Bearer ***" in text
    assert "sk-***" in text


def test_secret_blocked_detects_credentials_before_agent_context():
    assert _secret_blocked("请配置 client_secret=abc12345")
    assert _secret_blocked("sk-testsecret123456")
    assert not _secret_blocked("普通问题：今天做什么？")


def test_install_display_cleaners_keeps_feishu_runtime_in_wrapper_layer():
    fs = types.SimpleNamespace(_TRUNC_TAIL=20)

    _install_display_cleaners(fs)

    assert "currently active" in fs.FILE_HINT
    assert fs._clean("LLM Running (Turn 1) ...\n<summary>hidden</summary>\n完成") == "完成"
    assert fs._extract_files("[FILE:/tmp/report.pdf\n") == ["/tmp/report.pdf"]
    assert fs._strip_files("完成\n[FILE:/tmp/report.pdf]") == "完成"
    assert fs._display_text("<summary>hidden</summary>\n完成\n[FILE:/tmp/report.pdf]") == "完成"
    assert fs._display_text("<summary>hidden") == ""
    assert fs._display_text("") == "⚠️ 模型输出被截断或为空"


def test_feishu_card_markdown_safety_converts_tables_for_platform_limits():
    raw = "\n".join([
        "北京天气：",
        "",
        "| 时段 | 气温 | 天气 |",
        "|---|---|---|",
        "| 11:00 | 30.1°C | 阴 |",
        "| 14:00 | 30.2°C | 阴 |",
        "",
        "未来一周：",
        "",
        "| 日期 | 天气 | 高/低 |",
        "|---|---|---|",
        "| 06/24 周三 | 雷阵雨 | 30/21°C |",
    ])

    safe = _card_safe_markdown(raw)

    assert safe.count("```text") == 2
    assert "|---|---|---|" not in safe
    assert "11:00 | 30.1°C | 阴" in safe
    assert "06/24 周三 | 雷阵雨 | 30/21°C" in safe

    captured = {}

    def card_raw(elements):
        captured["elements"] = elements
        return json.dumps({"body": {"elements": elements}}, ensure_ascii=False)

    fs = types.SimpleNamespace(_card_raw=card_raw)
    assert _install_card_markdown_safety(fs) is True

    payload = json.loads(fs._card_raw([{"tag": "markdown", "content": raw}]))
    content = payload["body"]["elements"][0]["content"]
    assert content.count("```text") == 2
    assert "|---|---|---|" not in content
    assert captured["elements"][0]["content"] == content


def test_text_message_content_fallback_supports_sdk_shapes():
    assert _text_from_message_content({"text": "/new"}) == "/new"
    assert _text_from_message_content('{"text": "/status"}') == "/status"
    assert _text_from_message_content("{'text': '/help'}") == "/help"
    assert _text_from_message_content("/help") == "/help"
    assert _text_from_message_content(types.SimpleNamespace(text="/review")) == "/review"
    assert _text_from_message_content(types.SimpleNamespace(data={"text": "你好"})) == "你好"
    assert _text_from_message_content({"event": {"message": {"content": {"text": "测试"}}}}) == "测试"


def test_text_message_fallback_extracts_nested_message_content():
    message = types.SimpleNamespace(
        message_type="text",
        content=types.SimpleNamespace(content={"text": "/new"}),
    )

    assert _text_from_message(message) == "/new"


def test_text_message_fallback_wraps_empty_upstream_parse_for_all_commands():
    calls = []

    def upstream(message):
        calls.append(message.message_type)
        return "", []

    fs = types.SimpleNamespace(_build_user_message=upstream)
    assert _install_text_message_fallback(fs) is True

    message = types.SimpleNamespace(message_type="text", content={"text": "/new"})
    assert fs._build_user_message(message) == ("/new", [])
    assert calls == ["text"]


def test_message_type_normalizes_sdk_value_objects():
    message_type = types.SimpleNamespace(value="text")
    assert _message_type(types.SimpleNamespace(message_type=message_type)) == "text"
    assert _message_type(types.SimpleNamespace(message_type="MessageType.TEXT")) == "text"


def test_message_type_placeholder_detects_sdk_enum_strings():
    message_type = types.SimpleNamespace(value="text")
    message = types.SimpleNamespace(message_type=message_type)

    assert _looks_like_message_type_placeholder("[MessageType.TEXT]", "text", message)
    assert _looks_like_message_type_placeholder("[namespace(value='text')]", "text", message)
    assert not _looks_like_message_type_placeholder("/new", "text", message)


def test_text_message_fallback_overrides_nonempty_sdk_type_placeholder():
    def upstream(message):
        return f"[{message.message_type}]", []

    fs = types.SimpleNamespace(_build_user_message=upstream)
    assert _install_text_message_fallback(fs) is True

    class MsgType:
        value = "text"

        def __str__(self):
            return "MessageType.TEXT"

    message = types.SimpleNamespace(message_type=MsgType(), content={"text": "/new"})
    assert fs._build_user_message(message) == ("/new", [])


def test_text_message_fallback_survives_upstream_parse_error():
    def upstream(message):
        raise TypeError("bad sdk shape")

    fs = types.SimpleNamespace(_build_user_message=upstream)
    assert _install_text_message_fallback(fs) is True

    message = types.SimpleNamespace(
        message_type=types.SimpleNamespace(value="text"),
        content=types.SimpleNamespace(content={"text": "/status"}),
    )
    assert fs._build_user_message(message) == ("/status", [])


def test_media_message_fallback_keeps_image_from_becoming_unsupported():
    def upstream(message):
        return "", []

    fs = types.SimpleNamespace(
        _build_user_message=upstream,
        _download_and_save_media=lambda *args, **kwargs: (None, None),
        _describe_media=lambda msg_type, path, name: f"[{msg_type}: {name}]",
    )
    assert _install_text_message_fallback(fs) is True

    message = types.SimpleNamespace(message_type="image", message_id="m1", content={})
    assert fs._build_user_message(message) == ("[image]", [])


def test_explicit_feishu_choice_request_becomes_real_interaction_event():
    event = _explicit_interaction_event("问我一个三选一问题，主题关于今晚安排，用飞书选项卡让我选择 A、B、C。")

    assert event == {
        "question": "今晚安排，请选择一个选项：",
        "candidates": ["A", "B", "C"],
        "_penglai_direct": True,
    }


def test_explicit_free_text_question_becomes_interaction_event_without_buttons():
    event = _explicit_interaction_event("我现在缺一个城市信息，你先问我缺哪个城市，不要给候选项。")

    assert event == {
        "question": "缺哪个城市：",
        "candidates": [],
        "_penglai_direct": True,
    }


def test_normal_file_request_is_not_taken_over_by_interaction_fallback():
    assert _explicit_interaction_event("生成一个 PDF 测试文件并发给我") is None


def test_resolve_choice_by_number_or_exact_text():
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    assert resolve_choice("1", event) == "探深"
    assert resolve_choice("2", event) == "先停"
    assert resolve_choice("先停", event) == "先停"
    assert resolve_choice("3", event) is None
    assert resolve_choice("随便聊聊", event) is None


def test_feishu_wrapper_run_agent_enters_runtime_hub_service():
    sent_files = []
    card_events = []

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}
            self.prompts = []
            self.aborted = False

        def put_task(self, prompt, source="feishu", images=None):
            self.prompts.append((prompt, source, tuple(images or ())))
            q = Q.Queue()
            q.put({"done": "完成"})
            return q

        def abort(self):
            self.aborted = True

    class FakeCard:
        def __init__(self, rid, rtype):
            self.rid = rid
            self.rtype = rtype
            self.steps = [("internal", "detail")]

        def start(self):
            card_events.append(("start", self.rid, self.rtype))

        def done(self, text):
            card_events.append(("done", text, list(self.steps)))

        def fail(self, text):
            card_events.append(("fail", text))

        def step(self, summary, detail):
            card_events.append(("step", summary, detail))

    class FakeFeishuApp:
        source = "feishu"

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}

        async def send_text(self, chat_id, content, **ctx):
            card_events.append(("text", chat_id, content, ctx))

        async def handle_command(self, chat_id, cmd, **ctx):
            return None

        async def run_agent(self, chat_id, text, **ctx):
            raise AssertionError("patched run_agent should replace this method")

    fs = types.SimpleNamespace(
        _PENGLAI_FEISHU_PATCHED=False,
        _TRUNC_TAIL=80,
        FILE_HINT="file hint",
        FeishuApp=FakeFeishuApp,
        handle_message=lambda data: None,
        PUBLIC_ACCESS=True,
        ALLOWED_USERS=["owner"],
        AGENT_TIMEOUT_SEC=5,
        TEMP_DIR=tempfile.mkdtemp(),
        _TaskCard=FakeCard,
        _display_text=lambda raw: raw,
        _extract_files=lambda raw: [],
        _send_generated_files=lambda rid, raw, receive_id_type="open_id": sent_files.append((rid, raw, receive_id_type)),
        _build_step_detail=lambda response, tool_calls: "detail",
        _build_user_message=lambda message: ("", []),
        _claim_message_once=lambda message_id: True,
        _card_raw=lambda elements: {"elements": elements},
        _patch_card=lambda msg_id, rendered: False,
        _send_raw=lambda *args, **kwargs: False,
        send_message=lambda *args, **kwargs: None,
        _run_async=lambda coro: asyncio.run(coro),
    )
    _patch(fs)
    app = fs.FeishuApp()
    fs.get_app = lambda: app

    asyncio.run(app.run_agent(
        "chat-1",
        "你好",
        receive_id="chat-1",
        receive_id_type="chat_id",
        user_id="owner",
        chat_type="private",
    ))
    for _ in range(50):
        if ("done", "完成", []) in card_events:
            break
        time.sleep(0.05)

    runs = app._penglai_runtime_hub_service.recent_runs(session_id="owner:default", limit=5)
    assert app.agent.prompts[-1][0].endswith("\n\n你好")
    assert runs and runs[0]["status"] == "succeeded"
    assert ("done", "完成", []) in card_events
    assert sent_files == [("chat-1", "完成", "chat_id")]


def test_feishu_stop_command_cancels_runtime_session_and_pending_queue():
    sent = []

    class FakeAgent:
        def __init__(self):
            self.aborted = False

        def abort(self):
            self.aborted = True

    class FakeFeishuApp:
        source = "feishu"

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {"chat-1": {"running": True}}

        async def send_text(self, chat_id, content, **ctx):
            sent.append((chat_id, content, ctx))

        async def handle_command(self, chat_id, cmd, **ctx):
            raise AssertionError("patched handle_command should replace this method")

        async def run_agent(self, chat_id, text, **ctx):
            raise AssertionError("not used")

    fs = types.SimpleNamespace(
        _PENGLAI_FEISHU_PATCHED=False,
        _TRUNC_TAIL=80,
        FILE_HINT="file hint",
        FeishuApp=FakeFeishuApp,
        handle_message=lambda data: None,
        PUBLIC_ACCESS=True,
        ALLOWED_USERS=["owner"],
        AGENT_TIMEOUT_SEC=5,
        TEMP_DIR=tempfile.mkdtemp(),
        _TaskCard=lambda rid, rtype: None,
        _display_text=lambda raw: raw,
        _extract_files=lambda raw: [],
        _send_generated_files=lambda *args, **kwargs: None,
        _build_step_detail=lambda response, tool_calls: "detail",
        _build_user_message=lambda message: ("", []),
        _claim_message_once=lambda message_id: True,
        _card_raw=lambda elements: {"elements": elements},
        _patch_card=lambda msg_id, rendered: False,
        _send_raw=lambda *args, **kwargs: False,
        send_message=lambda *args, **kwargs: None,
        _run_async=lambda coro: asyncio.run(coro),
    )
    _patch(fs)
    app = fs.FeishuApp()
    service = RuntimeHubService(owner_user_ids={"owner"})
    service.runner.queue.submit("owner:default", InboundEvent("active", "feishu", "owner", "active"))
    service.runner.queue.submit("owner:default", InboundEvent("queued", "feishu", "owner", "queued"))
    app._penglai_runtime_hub_service = service

    asyncio.run(app.handle_command(
        "chat-1",
        "/stop",
        receive_id="chat-1",
        receive_id_type="chat_id",
        user_id="owner",
        chat_type="private",
    ))

    assert app.agent.aborted is True
    assert app.user_tasks == {}
    assert sent and "已请求停止当前任务" in sent[-1][1]
    assert "owner:default" in sent[-1][1]
    assert "清理排队 1 条" in sent[-1][1]
    assert service.status("owner:default")["queue"]["pending"] == 0


def test_feishu_queued_runtime_message_does_not_start_or_steal_task_card():
    card_events = []
    sent = []

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}
            self._fs_active_task_id = "active-task"

        def put_task(self, *args, **kwargs):
            raise AssertionError("queued message should not run immediately")

    class FakeCard:
        def __init__(self, rid, rtype):
            self.rid = rid
            self.rtype = rtype
            self.status = ""
            self.final = None
            self.steps = []
            self._penglai_cancel_enabled = False

        def start(self):
            card_events.append(("start", self.rid, self.rtype))

        def _push(self):
            card_events.append(("push", self.status, self.final, self._penglai_cancel_enabled))
            return True

        def fail(self, text):
            card_events.append(("fail", text))

        def done(self, text):
            card_events.append(("done", text))

        def step(self, summary, detail):
            card_events.append(("step", summary, detail))

    class FakeFeishuApp:
        source = "feishu"

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}

        async def send_text(self, chat_id, content, **ctx):
            sent.append((chat_id, content, ctx))

        async def handle_command(self, chat_id, cmd, **ctx):
            return None

        async def run_agent(self, chat_id, text, **ctx):
            raise AssertionError("patched run_agent should replace this method")

    fs = types.SimpleNamespace(
        _PENGLAI_FEISHU_PATCHED=False,
        _TRUNC_TAIL=80,
        FILE_HINT="file hint",
        FeishuApp=FakeFeishuApp,
        handle_message=lambda data: None,
        PUBLIC_ACCESS=True,
        ALLOWED_USERS=["owner"],
        AGENT_TIMEOUT_SEC=5,
        TEMP_DIR=tempfile.mkdtemp(),
        _TaskCard=FakeCard,
        _display_text=lambda raw: raw,
        _extract_files=lambda raw: [],
        _send_generated_files=lambda *args, **kwargs: None,
        _build_step_detail=lambda response, tool_calls: "detail",
        _build_user_message=lambda message: ("", []),
        _claim_message_once=lambda message_id: True,
        _card_raw=lambda elements: {"elements": elements},
        _patch_card=lambda msg_id, rendered: False,
        _send_raw=lambda *args, **kwargs: False,
        send_message=lambda *args, **kwargs: None,
        _run_async=lambda coro: asyncio.run(coro),
    )
    _patch(fs)
    app = fs.FeishuApp()
    service = RuntimeHubService(owner_user_ids={"owner"})
    service.runner.queue.submit("owner:default", InboundEvent("active", "feishu", "owner", "active"))
    app._penglai_runtime_hub_service = service

    asyncio.run(app.run_agent(
        "chat-1",
        "排队消息",
        receive_id="chat-1",
        receive_id_type="chat_id",
        user_id="owner",
        chat_type="private",
    ))

    assert not [event for event in card_events if event[0] == "start"]
    assert card_events[-1][0] == "push"
    assert card_events[-1][1] == "⏳ 已排队 #1"
    assert card_events[-1][3] is False
    assert app.agent._fs_active_task_id == "active-task"
    assert sent == []
    assert service.status("owner:default")["queue"]["pending"] == 1


def test_feishu_queued_runtime_result_uses_own_completion_card():
    sent, card_events = [], []

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}
            self._fs_active_task_id = "active-task"

        def put_task(self, *args, **kwargs):
            raise AssertionError("queued message should not run immediately")

    class FakeCard:
        def __init__(self, rid, rtype):
            self.rid = rid
            self.rtype = rtype
            self._penglai_cancel_enabled = False
            self.status = ""
            self.final = None
            self.steps = []

        def start(self):
            card_events.append(("start", self.rid, self.rtype))

        def _push(self):
            card_events.append(("push", self.status, self.final, self._penglai_cancel_enabled))
            return True

        def fail(self, text):
            card_events.append(("fail", text))

        def done(self, text):
            card_events.append(("done", text))

        def step(self, summary, detail):
            card_events.append(("step", summary, detail))

    class FakeRouter:
        def route(self, event):
            return types.SimpleNamespace(session_id="owner:default")

    class FakeService:
        def __init__(self):
            self.router = FakeRouter()
            self.on_complete = None

        def status(self, session_id):
            return {"queue": {"active": True, "pending": 0}}

        def submit(self, event, *, port=None, on_complete=None, **kwargs):
            self.on_complete = on_complete
            return types.SimpleNamespace(started_now=False, queue_no=1)

    class FakeFeishuApp:
        source = "feishu"

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}
            self._penglai_runtime_hub_service = FakeService()

        async def send_text(self, chat_id, content, **ctx):
            sent.append((chat_id, content, ctx))

        async def handle_command(self, chat_id, cmd, **ctx):
            return None

        async def run_agent(self, chat_id, text, **ctx):
            raise AssertionError("patched run_agent should replace this method")

    fs = types.SimpleNamespace(
        _PENGLAI_FEISHU_PATCHED=False,
        _TRUNC_TAIL=80,
        FILE_HINT="file hint",
        FeishuApp=FakeFeishuApp,
        handle_message=lambda data: None,
        PUBLIC_ACCESS=True,
        ALLOWED_USERS=["owner"],
        AGENT_TIMEOUT_SEC=5,
        TEMP_DIR=tempfile.mkdtemp(),
        _TaskCard=FakeCard,
        _display_text=lambda raw: raw,
        _extract_files=lambda raw: [],
        _send_generated_files=lambda *args, **kwargs: None,
        _build_step_detail=lambda response, tool_calls: "detail",
        _build_user_message=lambda message: ("", []),
        _claim_message_once=lambda message_id: True,
        _card_raw=lambda elements: {"elements": elements},
        _patch_card=lambda msg_id, rendered: False,
        _send_raw=lambda *args, **kwargs: False,
        send_message=lambda *args, **kwargs: sent.append(("send_message", args, kwargs)),
        _run_async=lambda coro: asyncio.run(coro),
    )
    _patch(fs)
    app = fs.FeishuApp()

    asyncio.run(app.run_agent(
        "chat-1",
        "排队消息",
        receive_id="chat-1",
        receive_id_type="chat_id",
        user_id="owner",
        chat_type="private",
    ))
    assert not [event for event in card_events if event[0] == "start"]
    assert card_events[-1][0] == "push"
    assert card_events[-1][1] == "⏳ 已排队 #1"
    assert sent == []

    queued_event = InboundEvent(
        "queued",
        "feishu",
        "owner",
        "排队消息",
        chat_id="chat-1",
        metadata={"new_turn": True},
    )
    result = types.SimpleNamespace(
        event=queued_event,
        session=types.SimpleNamespace(session_id="owner:default"),
        status=RunStatus.SUCCEEDED,
        raw_output="排队完成",
        cleaned_output="排队完成",
        task_run=types.SimpleNamespace(
            run_id="run-queued",
            worker_id="generic-agent",
            result_text="排队完成",
        ),
        permission=None,
    )
    app._penglai_runtime_hub_service.on_complete(result)

    assert ("done", "排队完成") in card_events
    assert app.agent._fs_active_task_id == "active-task"


def test_feishu_task_card_adds_runtime_cancel_button():
    class FakeTaskCard:
        def __init__(self, rid="chat1", rtype="chat_id"):
            self.rid = rid
            self.rtype = rtype

        def _build(self):
            return json.dumps({
                "schema": "2.0",
                "body": {"elements": [{"tag": "markdown", "content": "**运行中**"}]},
            }, ensure_ascii=False)

    fs = types.SimpleNamespace(_TaskCard=FakeTaskCard)

    assert _install_task_card_cancel_button(fs) is True
    card = FakeTaskCard()
    card._penglai_task_id = "task-1"
    card._penglai_cancel_enabled = True
    payload = json.loads(card._build())
    buttons = [e for e in payload["body"]["elements"] if e.get("tag") == "button"]

    assert [b["text"]["content"] for b in buttons] == ["停止任务"]
    assert buttons[0]["behaviors"][0]["value"] == {
        "penglai_action": "runtime_cancel",
        "task_id": "task-1",
    }

    card._penglai_cancel_enabled = False
    payload = json.loads(card._build())
    assert not [e for e in payload["body"]["elements"] if e.get("tag") == "button"]


def test_feishu_waiting_card_heartbeat_updates_active_task_only():
    pushes = []

    class FakeCard:
        def __init__(self):
            self.status = "🤔 思考中..."
            self._penglai_cancel_enabled = True

        def _push(self):
            pushes.append(self.status)
            return True

    active = {"task_id": "task-1"}
    stop_evt = threading.Event()
    thread = _start_waiting_card_heartbeat(
        FakeCard(),
        "task-1",
        lambda: active["task_id"],
        stop_evt,
        first_delay=0.01,
        repeat_delay=0.01,
        max_updates=1,
    )
    deadline = time.time() + 1.0
    while not pushes and time.time() < deadline:
        time.sleep(0.01)
    stop_evt.set()
    if thread is not None:
        thread.join(0.5)

    assert pushes == ["⏳ 仍在等待模型响应"]


def test_feishu_waiting_card_heartbeat_stops_after_task_done():
    pushes = []

    class FakeCard:
        def __init__(self):
            self.status = "🤔 思考中..."
            self._penglai_cancel_enabled = True

        def _push(self):
            pushes.append(self.status)
            return True

    stop_evt = threading.Event()
    stop_evt.set()
    thread = _start_waiting_card_heartbeat(
        FakeCard(),
        "task-1",
        lambda: "task-1",
        stop_evt,
        first_delay=0.01,
        repeat_delay=0.01,
        max_updates=1,
    )
    if thread is not None:
        thread.join(0.5)

    assert pushes == []


def test_feishu_card_cancel_callback_cancels_runtime_session_and_pending_queue():
    _TASK_BY_ID.clear()

    class FakeAgent:
        def __init__(self):
            self.aborted = False

        def abort(self):
            self.aborted = True

    class FakeCard:
        def __init__(self, rid="chat-1", rtype="chat_id"):
            self.rid = rid
            self.rtype = rtype
            self.status = "🤔 思考中..."
            self.final = None
            self.pushes = []

        def _build(self):
            return json.dumps({"schema": "2.0", "body": {"elements": []}}, ensure_ascii=False)

        def _push(self):
            self.pushes.append((self.status, self.final, getattr(self, "_penglai_cancel_enabled", None)))
            return True

    class FakeFeishuApp:
        source = "feishu"

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {"chat-1": {"running": True}}

        async def send_text(self, chat_id, content, **ctx):
            raise AssertionError("card cancel should use toast/card patch, not text fallback")

        async def handle_command(self, chat_id, cmd, **ctx):
            raise AssertionError("patched handle_command should replace this method")

        async def run_agent(self, chat_id, text, **ctx):
            raise AssertionError("not used")

    fs = types.SimpleNamespace(
        _PENGLAI_FEISHU_PATCHED=False,
        _TRUNC_TAIL=80,
        FILE_HINT="file hint",
        FeishuApp=FakeFeishuApp,
        handle_message=lambda data: None,
        PUBLIC_ACCESS=False,
        ALLOWED_USERS={"owner"},
        AGENT_TIMEOUT_SEC=5,
        TEMP_DIR=tempfile.mkdtemp(),
        _TaskCard=FakeCard,
        _display_text=lambda raw: raw,
        _extract_files=lambda raw: [],
        _send_generated_files=lambda *args, **kwargs: None,
        _build_step_detail=lambda response, tool_calls: "detail",
        _build_user_message=lambda message: ("", []),
        _claim_message_once=lambda message_id: True,
        _card_raw=lambda elements: {"body": {"elements": elements}},
        _patch_card=lambda msg_id, rendered: False,
        _send_raw=lambda *args, **kwargs: False,
        send_message=lambda *args, **kwargs: None,
        _run_async=lambda coro: asyncio.run(coro),
    )
    _patch(fs)
    app = fs.FeishuApp()
    fs.get_app = lambda: app
    service = RuntimeHubService(owner_user_ids={"owner"})
    service.runner.queue.submit("owner:default", InboundEvent("active", "feishu", "owner", "active"))
    service.runner.queue.submit("owner:default", InboundEvent("queued", "feishu", "owner", "queued"))
    app._penglai_runtime_hub_service = service
    card = FakeCard()
    card._penglai_task_id = "task-cancel"
    card._penglai_cancel_enabled = True
    _remember_task(
        "task-cancel",
        "chat-1",
        receive_id="chat-1",
        receive_id_type="chat_id",
        user_id="owner",
        chat_type="private",
        session_id="owner:default",
        card=card,
    )
    data = types.SimpleNamespace(event=types.SimpleNamespace(
        action=types.SimpleNamespace(value=_runtime_cancel_callback_value("task-cancel")),
        operator=types.SimpleNamespace(open_id="owner"),
    ))

    fs.handle_card_action(data)

    assert app.agent.aborted is True
    assert app.user_tasks == {}
    assert app._penglai_last_runtime_cancel["source"] == "feishu_card"
    assert app._penglai_last_runtime_cancel["session_id"] == "owner:default"
    assert app._penglai_last_runtime_cancel["dropped"] == 1
    assert service.status("owner:default")["queue"]["pending"] == 0
    assert _get_task("task-cancel") is None
    assert card._penglai_cancel_enabled is False
    assert card.status == "⏹️ 已请求停止"
    assert card.pushes[-1] == ("⏹️ 已请求停止", "已请求停止当前任务。", False)


def test_feishu_runtime_check_reports_wrapper_path():
    async def patched_run_agent(self, *args, **kwargs):
        return None

    patched_run_agent._penglai_runtime_hub = True

    class FakeBuilder:
        def register_p2_card_action_trigger(self, *args, **kwargs):
            return self

    fake_lark = types.SimpleNamespace(
        EventDispatcherHandler=types.SimpleNamespace(builder=lambda *a, **k: FakeBuilder())
    )
    fs = types.SimpleNamespace(
        ALLOWED_USERS={"owner"},
        FeishuApp=types.SimpleNamespace(run_agent=patched_run_agent),
        lark=fake_lark,
    )

    data = _runtime_check(fs)

    assert data["ok"] is True
    assert data["wrapper_run_agent_patched"] is True
    assert data["runtime_service_init"] is True
    assert data["card_action_supported"] is True
    assert "RuntimeHubService" in data["route"]


def test_feishu_gray_probe_missing_config_does_not_start_wss():
    fs = types.SimpleNamespace(
        _feishu_config=lambda: ("", "", set(), True, "/tmp/no-mykey.py"),
    )
    out = io.StringIO()

    with contextlib.redirect_stdout(out):
        rc = _gray_probe(fs, wait_seconds=0.1, nonce="penglai030-test")

    text = out.getvalue()
    assert rc == 2
    assert "FEISHU_GRAY_RESULT=" in text
    assert "missing Feishu app_id/app_secret" in text


def test_feishu_gray_probe_uses_single_allowed_open_id():
    fs = types.SimpleNamespace(ALLOWED_USERS={"ou_owner"})

    assert _single_allowed_open_id(fs) == "ou_owner"
    fs.ALLOWED_USERS = {"ou_owner", "ou_other"}
    assert _single_allowed_open_id(fs) == ""


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
