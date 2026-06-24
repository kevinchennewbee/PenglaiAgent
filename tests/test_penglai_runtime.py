# -*- coding: utf-8 -*-
"""Penglai runtime contracts stay side-effect free until explicitly integrated."""

import os
import asyncio
import importlib
import json
import queue as Q
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests

os.environ.setdefault(
    "PENGLAI_CONTEXT_EVENTS_LOG",
    os.path.join(tempfile.mkdtemp(), "penglai_context_events.jsonl"),
)
os.environ.setdefault(
    "PENGLAI_RUNTIME_STORE_PATH",
    os.path.join(tempfile.mkdtemp(), "runtime_hub.sqlite3"),
)

from penglai_runtime.contracts import InboundEvent, PermissionRequest, RunStatus
from penglai_runtime.channel_runtime import ChannelRuntimeBridge, install_channel_runtime_adapter
from penglai_runtime import capabilities, control_api, deprecations, feishu_service, install_check, privacy_audit, runtime_cli
from penglai_runtime.delivery import DeliveryService, plan_delivery
from penglai_runtime.context_events import append_context_event, recent_context_prompt
from penglai_runtime.hub import PenglaiRuntimeHub
from penglai_runtime.in_memory_im import InMemoryIMAdapter
from penglai_runtime.interaction import (
    InteractionRequest,
    callback_value,
    extract_interaction_event,
    interaction_request_from_turn,
    normalize_options,
    parse_callback_value,
    render_interaction_text,
    request_from_ask_user_event,
    resolve_interaction_choice,
)
from penglai_runtime.memory_governor import MemoryGovernor
from penglai_runtime.output_cleaner import clean_final_text, has_internal_markup
from penglai_runtime.permissions import render_permission_text, resolve_permission_choice
from penglai_runtime.port import CallableAgentPort, GenericAgentInstancePort, GenericAgentPort
from penglai_runtime.queueing import SessionQueue
from penglai_runtime.redaction import contains_secret, redact_json, redact_text as runtime_redact_text
from penglai_runtime.runner import AgentRunner
from penglai_runtime.service import RuntimeHubService
from penglai_runtime.store import RuntimeStateStore
from penglai_runtime import service_unit
from penglai_runtime.shadow import build_delivery_shadow_event, record_delivery_shadow, redact_text
from penglai_runtime.session import SessionRouter
from penglai_runtime.selfcheck import run_end_to_end_check, status
from penglai_runtime.version import collect_version_metadata, compact_version_line
from penglai_runtime import VERSION
from penglai_runtime.text_interaction import install_text_interaction_adapter

VERSION_ENV_KEYS = (
    "PENGLAI_INSTALL_SOURCE",
    "PENGLAI_BUILD_BRANCH",
    "PENGLAI_BUILD_COMMIT",
    "PENGLAI_BUILD_TIME",
    "PENGLAI_IMAGE_TAG",
)


def test_session_router_shares_owner_private_but_isolates_group():
    router = SessionRouter(owner_user_ids={"owner"})
    owner = InboundEvent("e1", "feishu", "owner", "hi")
    desktop = InboundEvent("e2", "desktop", "owner", "hi")
    group = InboundEvent("e3", "feishu", "owner", "hi", chat_id="chat-1", chat_type="group")
    other = InboundEvent("e4", "feishu", "other", "hi")

    assert router.route(owner).session_id == "owner:default"
    assert router.route(desktop).session_id == "owner:default"
    assert router.route(group).session_id == "feishu:group:chat-1"
    assert router.route(other).session_id == "feishu:user:other"


def test_output_cleaner_strips_runtime_noise_without_removing_file_markers():
    raw = "LLM Running (Turn 1) ...\n<summary>internal</summary>\n完成\n[FILE:/tmp/a.md]"
    assert clean_final_text(raw) == "完成\n[FILE:/tmp/a.md]"
    assert clean_final_text(raw, strip_file_markers=True) == "完成"


def test_output_cleaner_strips_malformed_internal_markup():
    assert clean_final_text('<summary>只应进内部记忆,不要给用户看。') == ""
    assert has_internal_markup('<summary>只应进内部记忆,不要给用户看。') is True
    raw = "<think>hidden</think>\n<summary>hidden</summary>\n用户可见正文"
    assert clean_final_text(raw) == "用户可见正文"


def test_interaction_request_supports_any_button_count_and_text_fallback():
    options = normalize_options([
        {"label": "A", "description": "先整理文档", "value": "doc"},
        {"label": "B", "description": "继续测试飞书", "value": "feishu"},
        {"label": "C", "description": "稍后再说", "value": "later"},
    ])
    req = InteractionRequest("下一步做什么？", options, request_id="r1", title="工作确认")
    text = render_interaction_text(req, include_click_hint=True)

    assert "**工作确认**" in text
    assert "下一步做什么？" in text
    assert "1. A: 先整理文档" in text
    assert "3. C: 稍后再说" in text
    assert resolve_interaction_choice("2", req) == "feishu"
    assert resolve_interaction_choice("C: 稍后再说", req) == "later"
    assert parse_callback_value(callback_value("r1", 2)) == {
        "request_id": "r1",
        "index": 2,
        "action": "interaction_choice",
    }
    assert parse_callback_value("B_cook") is None


def test_interaction_request_supports_free_text_question():
    event = {"question": "还缺哪个城市？", "candidates": []}
    req = request_from_ask_user_event(event, request_id="r-free")
    text = render_interaction_text(req)

    assert req.allow_free_text is True
    assert "请直接回复：" in text
    assert resolve_interaction_choice("吉隆坡", req) == "吉隆坡"


def test_extract_interaction_event_from_ga_turn():
    ctx = {
        "exit_reason": {
            "result": "EXITED",
            "data": {
                "status": "INTERRUPT",
                "intent": "HUMAN_INTERVENTION",
                "data": {
                    "question": "要继续吗？",
                    "candidates": [{"label": "A", "value": "continue"}],
                },
            },
        }
    }

    event = extract_interaction_event(ctx)
    req = interaction_request_from_turn(ctx, request_id="r-turn")

    assert event["question"] == "要继续吗？"
    assert event["candidates"][0]["value"] == "continue"
    assert req.request_id == "r-turn"
    assert resolve_interaction_choice("1", req) == "continue"


def test_text_interaction_adapter_round_trips_choice_into_agent():
    class Resp:
        content = "raw"

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}
            self.is_running = False
            self.prompts = []

        def put_task(self, prompt, source="chat"):
            self.prompts.append((prompt, source))
            q = Q.Queue()
            if "needs_choice" in prompt:
                ctx = {
                    "exit_reason": {
                        "result": "EXITED",
                        "data": {
                            "status": "INTERRUPT",
                            "intent": "HUMAN_INTERVENTION",
                            "data": {
                                "question": "下一步？",
                                "candidates": [
                                    {"label": "A", "value": "first"},
                                    {"label": "B", "value": "second"},
                                ],
                            },
                        },
                    },
                    "response": Resp(),
                }
                for hook in list(self._turn_end_hooks.values()):
                    hook(ctx)
            else:
                q.put({"done": "DONE"})
            return q

    class FakeApp:
        label = "Fake"
        source = "fake"
        ping_interval = 999

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}
            self.sent = []

        async def send_text(self, chat_id, content, **ctx):
            self.sent.append((chat_id, content, ctx))

        async def send_done(self, chat_id, raw_text, **ctx):
            self.sent.append((chat_id, f"final:{raw_text}", ctx))

    async def scenario():
        app = FakeApp()
        assert install_text_interaction_adapter(app) is True
        await app.run_agent("chat-1", "needs_choice", msg_id="m1")
        assert "下一步？" in app.sent[-1][1]
        assert "2. B" in app.sent[-1][1]
        await app.run_agent("chat-1", "2", msg_id="m2")
        assert app.agent.prompts[-1][0].endswith("\n\nsecond")
        assert app.sent[-1][1] == "final:DONE"

    asyncio.run(scenario())


def test_channel_runtime_adapter_records_session_memory_shadow_and_interaction():
    class Resp:
        content = "raw"

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}
            self.is_running = False
            self.prompts = []

        def put_task(self, prompt, source="chat"):
            self.prompts.append((prompt, source))
            q = Q.Queue()
            if prompt.endswith("\n\nask"):
                ctx = {
                    "exit_reason": {
                        "result": "EXITED",
                        "data": {
                            "status": "INTERRUPT",
                            "intent": "HUMAN_INTERVENTION",
                            "data": {"question": "选一个", "candidates": ["A", "B"]},
                        },
                    },
                    "response": Resp(),
                }
                for hook in list(self._turn_end_hooks.values()):
                    hook(ctx)
            else:
                q.put({"done": "完成"})
            return q

    class FakeApp:
        label = "Fake"
        source = "fake"
        ping_interval = 999

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}
            self.sent = []

        async def send_text(self, chat_id, content, **ctx):
            self.sent.append(("text", chat_id, content, ctx))

        async def send_done(self, chat_id, raw_text, **ctx):
            self.sent.append(("done", chat_id, raw_text, ctx))

    async def scenario():
        td = tempfile.mkdtemp()
        old_context_log = os.environ.get("PENGLAI_CONTEXT_EVENTS_LOG")
        os.environ["PENGLAI_CONTEXT_EVENTS_LOG"] = os.path.join(td, "context.jsonl")
        app = FakeApp()
        try:
            assert install_channel_runtime_adapter(app, channel="fake", owner_user_ids={"owner"}) is True
            await app.run_agent("owner", "ask", msg_id="m1")
            assert "选一个" in app.sent[-1][2]
            assert app._penglai_runtime_bridge.last_sessions["owner"].session_id == "owner:default"
            await app.run_agent("owner", "2", msg_id="m2")
            prompt, source = app.agent.prompts[-1]
            assert source == "fake"
            assert prompt.endswith("\n\nB")
            assert "Recent Penglai proactive/context events" in prompt
            assert "ask" in prompt
            assert app.sent[-1] == ("done", "owner", "完成", {"msg_id": "m2"})
            assert app._penglai_runtime_bridge.memory_decisions
            runs = app._penglai_runtime_hub_service.recent_runs(session_id="owner:default", limit=5)
            assert {row["status"] for row in runs} >= {RunStatus.WAITING_PERMISSION, RunStatus.SUCCEEDED}
        finally:
            if old_context_log is None:
                os.environ.pop("PENGLAI_CONTEXT_EVENTS_LOG", None)
            else:
                os.environ["PENGLAI_CONTEXT_EVENTS_LOG"] = old_context_log

    asyncio.run(scenario())


def test_channel_runtime_bridge_shares_owner_session_across_entries():
    bridge = ChannelRuntimeBridge(channel="desktop", owner_user_ids={"owner"})
    _event, first = bridge.event(user_id="owner", chat_id="owner", text="hi")
    bridge.channel = "voice"
    _event, second = bridge.event(user_id="owner", chat_id="owner", text="hi by voice", voice=("v.wav",))

    assert first.session_id == "owner:default"
    assert second.session_id == "owner:default"


def test_local_runtime_bridge_defaults_to_owner_user_for_client_continuity():
    bridge = ChannelRuntimeBridge(channel="desktop", owner_user_ids={"owner-b", "owner-a"})
    event, session = bridge.event(user_id=bridge.default_user_id(), chat_id="desktop", text="hi")

    assert event.user_id == "owner-a"
    assert session.session_id == "owner:default"


def test_channel_runtime_adapter_queues_busy_session_messages():
    class FakeAgent:
        is_running = True

        def __init__(self):
            self._turn_end_hooks = {}

        def put_task(self, prompt, source="chat"):
            return Q.Queue()

    class FakeApp:
        source = "fake"
        ping_interval = 999

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}
            self.sent = []

        async def send_text(self, chat_id, content, **ctx):
            self.sent.append((chat_id, content))

        async def send_done(self, chat_id, raw_text, **ctx):
            self.sent.append((chat_id, raw_text))

    async def scenario():
        app = FakeApp()
        assert install_channel_runtime_adapter(app, channel="fake", owner_user_ids={"owner"}) is True
        # Provide a中枢 service with the session already busy so submit queues.
        bridge = app._penglai_runtime_bridge
        td = tempfile.mkdtemp()
        svc = RuntimeHubService(
            owner_user_ids={"owner"},
            store_path=os.path.join(td, "runtime.sqlite3"),
            port_factory=lambda s, e: CallableAgentPort(lambda incoming: "ok", worker_id="t"),
        )
        bridge.runtime_service = svc
        # Block the session so the next submit returns started_now=False.
        release = threading.Event()

        class SlowPort:
            worker_id = "slow"
            def run(self, event):
                release.wait(timeout=5)
                return "slow-done"

        # Occupy the session with a slow in-flight task.
        svc.runner.queue._active.add("owner:default")
        svc.runner._active_run_ids["owner:default"] = "fake-active"
        await app.run_agent("owner", "second")
        # The second message should have been queued by the中枢, not run.
        assert svc.runner.queue.pending_count("owner:default") == 1
        assert "已排队" in app.sent[-1][1]
        release.set()

    asyncio.run(scenario())


def test_channel_runtime_adapter_stop_cancels_runtime_session_and_pending_queue():
    class FakeAgent:
        def __init__(self):
            self.aborted = False

        def abort(self):
            self.aborted = True

    class FakeApp:
        source = "fake"

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {"owner:default": {"running": True, "session_id": "owner:default"}}
            self.sent = []

        async def send_text(self, chat_id, content, **ctx):
            self.sent.append((chat_id, content, ctx))

        async def send_done(self, chat_id, raw_text, **ctx):
            self.sent.append((chat_id, raw_text, ctx))

    async def scenario():
        app = FakeApp()
        assert install_channel_runtime_adapter(app, channel="fake", owner_user_ids={"owner"}) is True
        # Queue a message in the中枢 SessionQueue (not the deleted adapter queue).
        bridge = app._penglai_runtime_bridge
        from penglai_runtime.port import CallableAgentPort as _CAP
        td2 = tempfile.mkdtemp()
        svc = RuntimeHubService(
            owner_user_ids={"owner"},
            store_path=os.path.join(td2, "runtime.sqlite3"),
            port_factory=lambda s, e: _CAP(lambda incoming: "ok", worker_id="t"),
        )
        bridge.runtime_service = svc
        # Mark the session busy so a second submit queues rather than starts.
        svc.runner.queue._active.add("owner:default")
        queued = InboundEvent("q1", "fake", "owner", "queued")
        svc.runner.queue._pending["owner:default"].append(queued)
        assert svc.runner.queue.pending_count("owner:default") == 1
        await app.run_agent("owner", "/stop")
        assert app.agent.aborted is True
        assert app.user_tasks == {}
        assert svc.runner.queue.pending_count("owner:default") == 0
        assert "已请求停止" in app.sent[-1][1]

    asyncio.run(scenario())


def test_wechat_runtime_cancel_helper_aborts_and_clears_permission():
    from penglai_im_launch import _cancel_wechat_runtime_session

    class Agent:
        def __init__(self):
            self.aborted = False

        def abort(self):
            self.aborted = True

    td = tempfile.mkdtemp()
    runtime = ChannelRuntimeBridge(channel="wechat", owner_user_ids=set())
    service = RuntimeHubService(owner_user_ids=set(), store_path=os.path.join(td, "runtime.sqlite3"))
    agent = Agent()
    pending = {"wx-u": PermissionRequest(action="confirm", prompt="继续？")}
    task_aborted = {}

    session_id, data = _cancel_wechat_runtime_session(
        "wx-u",
        runtime,
        service,
        agent,
        pending_permissions=pending,
        task_aborted=task_aborted,
    )

    assert session_id == "wechat:user:wx-u"
    assert data["session_id"] == session_id
    assert agent.aborted is True
    assert pending == {}
    assert task_aborted["wx-u"] is True


def test_launch_paths_do_not_bypass_runtime_wrappers():
    import penglai_channels

    for channel in ("wechat", "dingtalk", "qq", "wecom"):
        argv = penglai_channels._launch_argv(channel)
        assert os.path.basename(argv[1]) == "penglai_im_launch.py"
        assert argv[-1] == channel
        assert penglai_channels._proc_pattern(channel) == f"penglai_im_launch.py {channel}"

    assert os.path.basename(penglai_channels._launch_argv("feishu")[1]) == "penglai_feishu_app.py"
    assert penglai_channels._runtime_route_label("feishu") == "Hub"
    for channel in ("wechat", "dingtalk", "qq", "wecom"):
        assert penglai_channels._runtime_route_label(channel) == "Hub"
        assert penglai_channels._delivery_guard_label(channel) == "统一"
    for channel in ("telegram", "discord"):
        assert penglai_channels._runtime_route_label(channel) == "Hub"
        assert penglai_channels._delivery_guard_label(channel) == "统一"

    launcher_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "penglai_im_launch.py")
    with open(launcher_path, encoding="utf-8") as f:
        launcher_text = f.read()
    assert "install_channel_runtime_adapter(app, channel=channel)" in launcher_text

    tg_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontends", "tgapp.py")
    with open(tg_path, encoding="utf-8") as f:
        tg_text = f.read()
    assert "RuntimeHubService" in tg_text
    assert "GenericAgentInstancePort" in tg_text
    assert "agent.put_task(" not in tg_text

    dc_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontends", "dcapp.py")
    with open(dc_path, encoding="utf-8") as f:
        dc_text = f.read()
    assert "install_channel_runtime_adapter(" in dc_text

    launch_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "launch.pyw")
    with open(launch_path, encoding="utf-8") as f:
        launch_text = f.read()
    assert "wechatapp.py" not in launch_text
    assert "fsapp.py" not in launch_text
    assert launch_text.count("penglai_im_launch.py") >= 4
    assert "penglai_feishu_app.py" in launch_text


def test_channel_matrix_uses_real_binding_and_venv_python_units():
    import penglai_channels

    old_mykey_get = penglai_channels.mykey_get
    old_wechat_bound = penglai_channels._wechat_bound
    try:
        penglai_channels.mykey_get = lambda key: key in {"fs_app_id", "fs_app_secret"}
        penglai_channels._wechat_bound = lambda: False

        assert penglai_channels._credentials_ok("feishu") is True
        assert penglai_channels._credentials_ok("wechat") is False
        assert penglai_channels._tested_label("wechat", False) == "— 待绑定"

        unit = penglai_channels.channel_systemd_unit(
            "wechat",
            root="/opt/penglai",
            python="/opt/penglai/.venv/bin/python",
            user="penglai",
            home="/home/penglai",
        )
        assert "/opt/penglai/.venv/bin/python /opt/penglai/penglai _guardcheck" in unit
        assert "/opt/penglai/.venv/bin/python /opt/penglai/penglai_im_launch.py wechat" in unit
        assert "&& python " not in unit
        assert "exec python " not in unit
    finally:
        penglai_channels.mykey_get = old_mykey_get
        penglai_channels._wechat_bound = old_wechat_bound


def test_channel_runtime_adapter_filters_context_for_legacy_send_signatures():
    class FakeAgent:
        is_running = False

        def __init__(self):
            self._turn_end_hooks = {}

        def put_task(self, prompt, source="chat"):
            q = Q.Queue()
            q.put({"done": "完成"})
            return q

    class FakeApp:
        source = "fake"
        ping_interval = 999

        def __init__(self):
            self.agent = FakeAgent()
            self.user_tasks = {}
            self.sent = []

        async def send_text(self, chat_id, content):
            self.sent.append(("text", chat_id, content))

        async def send_done(self, chat_id, raw_text):
            self.sent.append(("done", chat_id, raw_text))

    async def scenario():
        app = FakeApp()
        assert install_channel_runtime_adapter(app, channel="fake", owner_user_ids={"owner"}) is True
        await app.run_agent("owner", "hello", msg_id="m1", is_group=False)
        assert app.sent[0] == ("text", "owner", "思考中...")
        assert app.sent[-1] == ("done", "owner", "完成")

    asyncio.run(scenario())


def test_delivery_plan_allows_work_outputs_and_blocks_sensitive_suffixes():
    td = tempfile.mkdtemp()
    md = os.path.join(td, "report.md")
    py = os.path.join(td, "secret.py")
    open(md, "w", encoding="utf-8").write("# report")
    open(py, "w", encoding="utf-8").write("print('secret')")

    plan = plan_delivery(
        f"请收文件\n[FILE:{md}]\n[FILE:{py}]\n示例 [FILE:...]",
        base_dir=td,
    )
    assert plan.body == "请收文件\n\n示例"
    assert plan.allowed_paths == (os.path.realpath(md),)
    assert len(plan.blocked) == 1
    assert len(plan.missing) == 0
    assert "敏感后缀" in plan.blocked[0].reason
    assert len(plan.ignored) == 1
    assert "已发送 1 个安全文件" in plan.blocked_notice(sent_count=1)


def test_delivery_plan_detects_external_api_receipt():
    td = tempfile.mkdtemp()
    pdf = os.path.join(td, "report.pdf")
    open(pdf, "wb").write(b"%PDF")

    plan = plan_delivery(
        "PDF 已通过飞书 API 发送成功\n"
        "file_key:file_v3_FAKE_RECEIPT_000000000000\n"
        "message_id:om_FAKE_RECEIPT_000000000000(code=0)\n"
        f"[FILE:{pdf}]",
        base_dir=td,
    )

    assert plan.allowed_paths == (os.path.realpath(pdf),)
    assert plan.external_delivery.delivered is True
    assert plan.external_delivery.reason == "external_api_receipt"
    assert plan.external_delivery.message_ids == ("om_FAKE_RECEIPT_000000000000",)
    assert plan.external_delivery.file_keys == ("file_v3_FAKE_RECEIPT_000000000000",)


def test_delivery_plan_detects_external_receipt_without_file_key_when_success_is_strong():
    td = tempfile.mkdtemp()
    pdf = os.path.join(td, "report.pdf")
    open(pdf, "wb").write(b"%PDF")

    plan = plan_delivery(
        "PDF 已发到飞书 ✅\n"
        "飞书消息已投递，message_id: om_FAKE_RECEIPT_NO_FILE_KEY\n"
        "三步全过：token -> upload -> send\n"
        f"[FILE:{pdf}]",
        base_dir=td,
    )

    assert plan.allowed_paths == (os.path.realpath(pdf),)
    assert plan.external_delivery.delivered is True
    assert plan.external_delivery.message_ids == ("om_FAKE_RECEIPT_NO_FILE_KEY",)
    assert plan.external_delivery.file_keys == ()


def test_delivery_service_executes_shared_text_file_and_notice_policy():
    td = tempfile.mkdtemp()
    pdf = os.path.join(td, "report.pdf")
    secret = os.path.join(td, "secret.py")
    open(pdf, "wb").write(b"%PDF")
    open(secret, "w", encoding="utf-8").write("print('secret')")
    sent_texts = []
    sent_files = []

    result = DeliveryService(
        send_text=lambda text: sent_texts.append(text) or True,
        send_file=lambda path: sent_files.append(path) or True,
    ).deliver(f"好了\n[FILE:{pdf}]\n[FILE:{secret}]", base_dir=td)

    assert sent_texts[0] == "好了"
    assert sent_files == [os.path.realpath(pdf)]
    assert "1 个文件未外发" in sent_texts[1]
    assert "敏感后缀" in sent_texts[1]
    assert result.sent_paths == (os.path.realpath(pdf),)
    assert result.plan.blocked[0].path == secret


def test_delivery_service_prefers_audio_callback_for_audio_artifacts():
    td = tempfile.mkdtemp()
    wav = os.path.join(td, "reply.wav")
    pdf = os.path.join(td, "report.pdf")
    open(wav, "wb").write(b"RIFF")
    open(pdf, "wb").write(b"%PDF")
    sent_audio = []
    sent_files = []

    result = DeliveryService(
        send_audio=lambda path: sent_audio.append(path) or True,
        send_file=lambda path: sent_files.append(path) or True,
    ).deliver(f"[FILE:{wav}]\n[FILE:{pdf}]", base_dir=td, send_body=False)

    assert sent_audio == [os.path.realpath(wav)]
    assert sent_files == [os.path.realpath(pdf)]
    assert result.sent_paths == (os.path.realpath(wav), os.path.realpath(pdf))


def test_delivery_service_falls_back_to_file_when_audio_callback_fails():
    td = tempfile.mkdtemp()
    ogg = os.path.join(td, "reply.ogg")
    open(ogg, "wb").write(b"OggS")
    sent_files = []

    result = DeliveryService(
        send_audio=lambda _path: False,
        send_file=lambda path: sent_files.append(path) or True,
    ).deliver(f"[FILE:{ogg}]", base_dir=td, send_body=False)

    assert sent_files == [os.path.realpath(ogg)]
    assert result.sent_paths == (os.path.realpath(ogg),)


def test_delivery_service_skips_duplicate_file_when_external_receipt_exists():
    td = tempfile.mkdtemp()
    pdf = os.path.join(td, "report.pdf")
    open(pdf, "wb").write(b"%PDF")
    sent_files = []
    audits = []

    result = DeliveryService(
        send_file=lambda path: sent_files.append(path) or True,
        audit=lambda event, payload, **kw: audits.append((event, payload, kw)),
    ).deliver(
        "PDF 已通过飞书 API 发送成功\n"
        "file_key:file_v3_FAKE_RECEIPT_000000000000\n"
        "message_id:om_FAKE_RECEIPT_000000000000(code=0)\n"
        f"[FILE:{pdf}]",
        base_dir=td,
        send_body=False,
    )

    assert sent_files == []
    assert result.skipped_paths == (os.path.realpath(pdf),)
    assert result.sent_count == 1
    assert audits[0][1]["reason"] == "external_api_receipt"


def test_delivery_plan_resolves_temp_workspace_and_repo_relative_paths():
    td = tempfile.mkdtemp()
    temp_dir = os.path.join(td, "temp")
    workspace = os.path.join(td, "workspace")
    os.makedirs(temp_dir)
    os.makedirs(workspace)
    temp_file = os.path.join(temp_dir, "report.pdf")
    workspace_file = os.path.join(workspace, "deck.md")
    open(temp_file, "wb").write(b"%PDF")
    open(workspace_file, "w", encoding="utf-8").write("# deck")
    old_env = os.environ.get("GA_WORKSPACE_ROOT")
    old_cwd = os.getcwd()
    try:
        os.environ["GA_WORKSPACE_ROOT"] = workspace
        os.chdir(td)
        plan = plan_delivery("A [FILE:temp/report.pdf]\nB [FILE:deck.md]", base_dir=temp_dir)
    finally:
        os.chdir(old_cwd)
        if old_env is None:
            os.environ.pop("GA_WORKSPACE_ROOT", None)
        else:
            os.environ["GA_WORKSPACE_ROOT"] = old_env

    assert set(plan.allowed_paths) == {os.path.realpath(temp_file), os.path.realpath(workspace_file)}
    assert plan.missing == ()


def test_session_queue_preserves_fifo_for_busy_session():
    queue = SessionQueue()
    first = InboundEvent("e1", "feishu", "u", "one")
    second = InboundEvent("e2", "feishu", "u", "two")
    third = InboundEvent("e3", "feishu", "u", "three")

    assert queue.submit("s", first).started_now is True
    assert queue.submit("s", second).queue_no == 1
    assert queue.submit("s", third).queue_no == 2
    assert queue.finish("s") == second
    assert queue.finish("s") == third
    assert queue.finish("s") is None
    assert queue.is_active("s") is False


def test_session_queue_cancel_can_promote_or_drop_pending():
    queue = SessionQueue()
    first = InboundEvent("e1", "feishu", "u", "one")
    second = InboundEvent("e2", "feishu", "u", "two")
    third = InboundEvent("e3", "feishu", "u", "three")

    queue.submit("s", first)
    queue.submit("s", second)
    assert queue.cancel("s") == second
    assert queue.is_active("s") is True

    queue.submit("s", third)
    assert queue.cancel("s", drop_pending=True) is None
    assert queue.status("s") == {"session_id": "s", "active": False, "pending": 0}


def test_in_memory_im_adapter_records_delivery_without_real_network():
    td = tempfile.mkdtemp()
    out = os.path.join(td, "deck.pdf")
    open(out, "wb").write(b"%PDF")
    adapter = InMemoryIMAdapter(owner_user_ids={"owner"})
    event = InboundEvent("e1", "feishu", "owner", "发给我")

    session, decision = adapter.receive(event)
    result = adapter.deliver(f"好了\n[FILE:{out}]")

    assert session.session_id == "owner:default"
    assert decision.started_now is True
    assert adapter.sent_texts == ["好了"]
    assert adapter.sent_files == [os.path.realpath(out)]
    assert result.plan.has_work is True


def test_in_memory_im_adapter_routes_audio_artifacts_separately():
    td = tempfile.mkdtemp()
    wav = os.path.join(td, "reply.wav")
    open(wav, "wb").write(b"RIFF")
    adapter = InMemoryIMAdapter(owner_user_ids={"owner"})

    result = adapter.deliver(f"[FILE:{wav}]", base_dir=td)

    assert adapter.sent_audio == [os.path.realpath(wav)]
    assert adapter.sent_files == []
    assert result.sent_paths == (os.path.realpath(wav),)


def test_shadow_event_redacts_and_records_plan_without_paths():
    td = tempfile.mkdtemp()
    out = os.path.join(td, "video.mp4")
    secret = os.path.join(td, "mykey.py")
    open(out, "wb").write(b"mp4")
    open(secret, "w", encoding="utf-8").write("sk-secret")

    event = build_delivery_shadow_event(
        "feishu",
        f"token=abc123\n好了\n[FILE:{out}]\n[FILE:{secret}]",
        receive_id="ou_secret",
        receive_id_type="open_id",
        base_dir=td,
        production_text="Bearer live-token",
    )

    assert event["receive_id_hash"] and event["receive_id_hash"] != "ou_secret"
    assert "token=***" in event["text_preview"]
    assert "Bearer ***" in event["production_preview"]
    assert event["allowed_count"] == 1
    assert event["blocked_count"] == 1
    assert event["artifacts"][0]["name"] == "video.mp4"
    assert event["artifacts"][0]["path_hash"]
    assert td not in json.dumps(event, ensure_ascii=False)


def test_record_delivery_shadow_is_noop_until_enabled():
    td = tempfile.mkdtemp()
    log_path = os.path.join(td, "shadow.jsonl")
    assert record_delivery_shadow("feishu", "done", log_path=log_path, enabled=False) is None
    assert not os.path.exists(log_path)

    event = record_delivery_shadow("feishu", "done", log_path=log_path, enabled=True)
    assert event["type"] == "delivery_plan"
    with open(log_path, encoding="utf-8") as f:
        line = json.loads(f.readline())
    assert line["channel"] == "feishu"


def test_redact_text_masks_common_secret_shapes():
    redacted = redact_text("API Key: abc token=secret Bearer live-token sk-testsecret")
    assert "abc" not in redacted
    assert "secret" not in redacted
    assert "live-token" not in redacted
    assert "sk-testsecret" not in redacted


def test_runtime_redaction_detects_and_redacts_structured_secrets():
    raw = {"api_key": "sk-testsecret123456", "nested": ["Bearer live-token-123456"]}
    redacted = redact_json(raw)
    assert contains_secret("client_secret=abc12345")
    assert "sk-testsecret" not in redacted
    assert "live-token" not in redacted
    assert runtime_redact_text("token=abc12345") == "token=***"


def test_logguard_redacts_llm_logs_without_core_patch():
    import llmcore

    td = tempfile.mkdtemp()
    raw_log = os.path.join(td, "raw.log")
    guarded_log = os.path.join(td, "guarded.log")
    original = getattr(llmcore._write_llm_log, "_penglai_orig", llmcore._write_llm_log)

    llmcore._write_llm_log = original
    llmcore._write_llm_log("Prompt", "token=abc12345", log_path=raw_log)
    with open(raw_log, encoding="utf-8") as f:
        assert "abc12345" in f.read()

    import plugins.penglai_logguard as logguard
    importlib.reload(logguard)
    assert getattr(llmcore._write_llm_log, "_penglai_logguard", False)

    llmcore._write_llm_log("Prompt", "token=abc12345", log_path=guarded_log)
    with open(guarded_log, encoding="utf-8") as f:
        guarded = f.read()
    assert "token=***" in guarded
    assert "abc12345" not in guarded


def test_context_events_are_recent_redacted_prompt_context():
    td = tempfile.mkdtemp()
    log_path = os.path.join(td, "context.jsonl")
    append_context_event(
        "companion_sent",
        "提醒一下 token=abc12345 今天 20:00 收尾",
        channel="feishu",
        actor="ou_real",
        metadata={"secret": "sk-testsecret123456"},
        session_id="owner:default",
        session_scope="owner",
        chat_id="oc_real",
        log_path=log_path,
    )

    assert recent_context_prompt(log_path=log_path) == ""

    prompt = recent_context_prompt(session_id="owner:default", log_path=log_path)

    assert "companion_sent" in prompt
    assert "token=***" in prompt
    assert "abc12345" not in prompt
    assert "ou_real" not in prompt
    assert recent_context_prompt(session_id="feishu:user:someone-else", log_path=log_path) == ""


def test_agentmain_system_prompt_does_not_read_context_events_directly():
    td = tempfile.mkdtemp()
    log_path = os.path.join(td, "context.jsonl")
    old_env = os.environ.get("PENGLAI_CONTEXT_EVENTS_LOG")
    try:
        os.environ["PENGLAI_CONTEXT_EVENTS_LOG"] = log_path
        append_context_event(
            "companion_sent",
            "今晚 20:00 记得收尾 token=abc12345",
            channel="feishu",
            actor="ou_real",
            metadata={"trigger": "evening"},
            session_id="owner:default",
            session_scope="owner",
        )
        import agentmain

        prompt = agentmain.get_system_prompt()
    finally:
        if old_env is None:
            os.environ.pop("PENGLAI_CONTEXT_EVENTS_LOG", None)
        else:
            os.environ["PENGLAI_CONTEXT_EVENTS_LOG"] = old_env

    assert "Recent Penglai proactive/context events" not in prompt
    assert "companion_sent" not in prompt
    assert "20:00" not in prompt
    assert "abc12345" not in prompt
    assert "ou_real" not in prompt


def test_runtime_service_records_owner_and_desktop_turns_as_context_events():
    td = tempfile.mkdtemp()
    log_path = os.path.join(td, "context.jsonl")

    def port_factory(_session, _event):
        return CallableAgentPort(
            lambda incoming: f"已处理 {incoming.text} token=abc12345",
            worker_id="context-worker",
        )

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
        context_log_path=log_path,
    )
    service.receive_blocking(InboundEvent("ctx-owner", "feishu", "owner", "今天心情低落 token=abc12345"))
    service.receive_blocking(
        InboundEvent("ctx-group", "feishu", "owner", "群聊内容不要进陪伴", chat_id="g1", chat_type="group")
    )
    service.receive_blocking(InboundEvent("ctx-desktop", "desktop", "sess-1", "桌面继续处理", chat_id="sess-1"))

    with open(log_path, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    owner_prompt = recent_context_prompt(session_id="owner:default", limit=10, log_path=log_path)
    desktop_prompt = recent_context_prompt(session_id="desktop:user:sess-1", limit=10, log_path=log_path)
    group_prompt = recent_context_prompt(session_id="feishu:group:g1", limit=10, log_path=log_path)

    assert [item["kind"] for item in lines] == [
        "user_message",
        "assistant_result",
        "user_message",
        "assistant_result",
    ]
    assert lines[0]["session_id"] == "owner:default"
    assert lines[0]["session_scope"] == "owner"
    assert lines[2]["session_id"] == "desktop:user:sess-1"
    assert lines[2]["session_scope"] == "private"
    assert "今天心情低落" in owner_prompt
    assert "桌面继续处理" not in owner_prompt
    assert "群聊内容不要进陪伴" not in owner_prompt
    assert "桌面继续处理" in desktop_prompt
    assert "今天心情低落" not in desktop_prompt
    assert "群聊内容不要进陪伴" not in desktop_prompt
    assert "群聊内容不要进陪伴" not in group_prompt
    assert recent_context_prompt(limit=10, log_path=log_path) == ""
    assert "token=***" in owner_prompt
    assert "abc12345" not in owner_prompt


def test_scheduler_reflect_task_enters_runtime_hub_service():
    td = tempfile.mkdtemp()
    tasks_dir = os.path.join(td, "tasks")
    done_dir = os.path.join(tasks_dir, "done")
    log_path = os.path.join(td, "scheduler.log")
    context_log = os.path.join(td, "context.jsonl")
    store_path = os.path.join(td, "runtime.sqlite3")
    old_env = {k: os.environ.get(k) for k in (
        "PENGLAI_SCHEDULER_TASKS_DIR",
        "PENGLAI_SCHEDULER_DONE_DIR",
        "PENGLAI_SCHEDULER_LOG",
        "PENGLAI_SCHEDULER_SKIP_LOCK",
    )}
    try:
        os.environ["PENGLAI_SCHEDULER_TASKS_DIR"] = tasks_dir
        os.environ["PENGLAI_SCHEDULER_DONE_DIR"] = done_dir
        os.environ["PENGLAI_SCHEDULER_LOG"] = log_path
        os.environ["PENGLAI_SCHEDULER_SKIP_LOCK"] = "1"
        sys.modules.pop("reflect.scheduler", None)
        scheduler = importlib.import_module("reflect.scheduler")
        scheduler._l4_t = time.time()
        os.makedirs(tasks_dir, exist_ok=True)
        with open(os.path.join(tasks_dir, "daily.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "enabled": True,
                    "repeat": "daily",
                    "schedule": "00:00",
                    "max_delay_hours": 24,
                    "prompt": "生成今日提醒报告",
                },
                f,
                ensure_ascii=False,
            )

        prompt = scheduler.check()
        assert "[定时任务] daily" in prompt
        report_path = scheduler._PENDING_TASK["report_path"]
        service = RuntimeHubService(
            owner_user_ids={"owner"},
            store_path=store_path,
            context_log_path=context_log,
        )

        def run_scheduled(incoming):
            assert incoming.channel == "scheduler"
            assert incoming.user_id == "owner"
            assert incoming.metadata["service"] == "scheduler"
            assert incoming.metadata["task_id"] == "daily"
            os.makedirs(os.path.dirname(report_path), exist_ok=True)
            with open(report_path, "w", encoding="utf-8") as f:
                f.write("报告已写入\n")
            return f"报告已写入 {report_path}"

        output = scheduler.run_runtime_task(
            prompt,
            service=service,
            port=CallableAgentPort(run_scheduled, worker_id="scheduler-test"),
        )

        assert "报告已写入" in output
        recent = service.recent_runs(session_id="owner:default", limit=1)
        assert len(recent) == 1
        run = service.get_run(recent[0]["run_id"])
        assert run["status"] == RunStatus.SUCCEEDED
        assert run["metadata"]["channel"] == "scheduler"
        assert run["metadata"]["scheduler"]["task_id"] == "daily"
        assert run["metadata"]["scheduler"]["report_path"] == report_path
        assert run["metadata"]["scheduler"]["report_exists"] is True

        with open(context_log, encoding="utf-8") as f:
            events = [json.loads(line) for line in f if line.strip()]
        assert [event["kind"] for event in events] == ["user_message", "assistant_result"]
        assert {event["channel"] for event in events} == {"scheduler"}
        assert events[0]["session_id"] == "owner:default"
        assert events[1]["metadata"]["run_id"] == run["run_id"]
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        sys.modules.pop("reflect.scheduler", None)


def test_version_metadata_uses_installer_version_and_git_identity():
    meta = collect_version_metadata()
    line = compact_version_line(meta)

    assert meta.version == VERSION
    assert f"Penglai {VERSION}" in line
    assert meta.commit


def test_version_metadata_reads_source_copy_build_info_without_git():
    td = tempfile.mkdtemp()
    os.makedirs(os.path.join(td, "installer"), exist_ok=True)
    with open(os.path.join(td, "installer", "pyproject.toml"), "w", encoding="utf-8") as f:
        f.write('[project]\nversion = "0.3.0"\n')
    with open(os.path.join(td, ".penglai-build.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "schema": 1,
                "source": "source",
                "branch": "codex/test-version",
                "commit": "abc123def456",
                "dirty": False,
                "remote": "origin",
                "remote_url": "https://example.invalid/PenglaiAgent.git",
                "build_time": "2026-06-23T00:00:00Z",
            },
            f,
        )

    old_env = {key: os.environ.get(key) for key in VERSION_ENV_KEYS}
    try:
        os.environ["PENGLAI_INSTALL_SOURCE"] = "stale-env"
        os.environ["PENGLAI_BUILD_BRANCH"] = "stale-branch"
        os.environ["PENGLAI_BUILD_COMMIT"] = "stale-commit"
        os.environ["PENGLAI_BUILD_TIME"] = "1999-01-01T00:00:00Z"
        meta = collect_version_metadata(root=td)
        line = compact_version_line(meta)
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert meta.version == VERSION
    assert meta.source == "source"
    assert meta.branch == "codex/test-version"
    assert meta.commit == "abc123def456"
    assert meta.remote == "origin"
    assert meta.remote_url == "https://example.invalid/PenglaiAgent.git"
    assert meta.build_time == "2026-06-23T00:00:00Z"
    assert "codex/test-version@abc123def456" in line


def test_memory_governor_rejects_runtime_noise_and_keeps_real_rules():
    governor = MemoryGovernor()

    noise = governor.classify("LLM Running (Turn 1) ... <summary>调用工具 code_run</summary>")
    rule = governor.classify("下次不要给我的飞书机器人发送升级指令，除非我本轮明确授权。")
    secret = governor.classify("token=abc123 should never be stored")

    assert noise.should_write is False
    assert noise.reason == "runtime_or_tool_noise"
    assert rule.should_write is True
    assert rule.level in {"user_pref", "global_rule"}
    assert "飞书机器人" in rule.text
    assert secret.should_write is False
    assert "abc123" not in secret.text


def test_agent_runner_coordinates_queue_delivery_memory_and_duplicates():
    td = tempfile.mkdtemp()
    md = os.path.join(td, "note.md")
    py = os.path.join(td, "secret.py")
    open(md, "w", encoding="utf-8").write("ok")
    open(py, "w", encoding="utf-8").write("print('no leak')")
    sent_texts = []
    sent_files = []

    runner = AgentRunner(
        owner_user_ids={"owner"},
        delivery=DeliveryService(
            send_text=lambda text: sent_texts.append(text) or True,
            send_file=lambda path: sent_files.append(path) or True,
        ),
    )
    hub = PenglaiRuntimeHub(runner=runner)
    first = hub.receive(
        InboundEvent("e1", "feishu", "owner", "first"),
        lambda _event: f"LLM Running (Turn 1) ...\n完成\n[FILE:{md}]\n[FILE:{py}]",
        base_dir=td,
    )
    second = hub.receive(
        InboundEvent("e2", "desktop", "owner", "second"),
        lambda _event: "must not run while queued",
        base_dir=td,
    )

    assert first.session.session_id == "owner:default"
    assert first.delivery.sent_paths == (os.path.realpath(md),)
    assert first.delivery.plan.blocked[0].path == py
    assert first.memory.reason == "runtime_or_tool_noise"
    assert second.queued is True
    assert hub.complete(first.session.session_id) == second.event
    assert sent_files == [os.path.realpath(md)]

    hub.complete(first.session.session_id)
    receipt = hub.receive(
        InboundEvent("e3", "feishu", "owner", "receipt"),
        lambda _event: (
            "PDF 已通过飞书 API 发送成功\n"
            "file_key:file_v3_TEST_DUPLICATE_000000\n"
            "message_id:om_TEST_DUPLICATE_000000(code=0)\n"
            f"[FILE:{md}]"
        ),
        base_dir=td,
    )
    assert receipt.delivery.sent_paths == ()
    assert receipt.delivery.skipped_paths == (os.path.realpath(md),)
    assert sent_files == [os.path.realpath(md)]


def test_agent_runner_records_taskrun_permission_failure_and_cancel():
    runner = AgentRunner(owner_user_ids={"owner"})
    first = runner.submit(
        InboundEvent("run-ok", "desktop", "owner", "hello"),
        CallableAgentPort(lambda event: f"done {event.text}", worker_id="contract-worker"),
    )

    assert first.status == RunStatus.SUCCEEDED
    assert first.task_run.worker_id == "contract-worker"
    assert first.task_run.result_text == "done hello"
    assert runner.status(first.session.session_id)["active_status"] == RunStatus.SUCCEEDED
    runner.complete(first.session.session_id)

    permission = runner.submit(
        InboundEvent("run-perm", "desktop", "owner", "send?"),
        CallableAgentPort(
            lambda _event: PermissionRequest(
                action="send_file",
                prompt="Allow sending?",
                options=("allow", "deny"),
            ),
            worker_id="contract-worker",
        ),
    )
    assert permission.status == RunStatus.WAITING_PERMISSION
    assert permission.task_run.permission.action == "send_file"
    runner.complete(permission.session.session_id)

    failed = runner.submit(
        InboundEvent("run-fail", "desktop", "owner", "boom"),
        CallableAgentPort(
            lambda _event: (_ for _ in ()).throw(RuntimeError("boom")),
            worker_id="contract-worker",
        ),
    )
    assert failed.status == RunStatus.FAILED
    assert "boom" in failed.task_run.error
    runner.complete(failed.session.session_id)

    active = runner.submit(
        InboundEvent("run-cancel-1", "desktop", "owner", "first"),
        CallableAgentPort(lambda _event: "first", worker_id="contract-worker"),
    )
    queued = runner.submit(
        InboundEvent("run-cancel-2", "desktop", "owner", "second"),
        CallableAgentPort(lambda _event: "second", worker_id="contract-worker"),
    )
    promoted = runner.cancel(active.session.session_id)

    assert active.task_run.status == RunStatus.SUCCEEDED
    assert active.task_run.metadata["blocked_terminal_transitions"][-1]["to"] == RunStatus.CANCELLED
    assert queued.status == RunStatus.PENDING
    assert promoted == queued.event
    runner.cancel(active.session.session_id, drop_pending=True)


def test_taskrun_terminal_status_cannot_be_overwritten_by_late_cancel_or_success():
    runner = AgentRunner(owner_user_ids={"owner"})

    def cancel_during_port(_event):
        runner.cancel("owner:default")
        return "late success"

    result = runner.submit(
        InboundEvent("run-late-cancel", "desktop", "owner", "first"),
        CallableAgentPort(cancel_during_port, worker_id="contract-worker"),
        send_body=False,
        send_notice=False,
    )

    assert result.status == RunStatus.CANCELLED
    assert result.task_run.result_text == ""
    assert result.cleaned_output == ""

    result.task_run.succeed("should not overwrite")
    result.task_run.fail("should not overwrite")
    assert result.status == RunStatus.CANCELLED
    assert result.task_run.result_text == ""
    assert [item["to"] for item in result.task_run.metadata["blocked_terminal_transitions"][-2:]] == [
        RunStatus.SUCCEEDED,
        RunStatus.FAILED,
    ]


def test_agent_runner_treats_empty_final_output_as_failure():
    runner = AgentRunner(owner_user_ids={"owner"})
    result = runner.submit(
        InboundEvent("run-empty", "desktop", "owner", "hello"),
        CallableAgentPort(lambda _event: "  \n", worker_id="contract-worker"),
    )

    assert result.status == RunStatus.FAILED
    assert result.cleaned_output == ""
    assert "没有返回可见结果" in result.task_run.error
    assert "没有返回可见结果" in result.task_run.log_excerpt


def test_agent_runner_treats_internal_only_output_as_failure():
    runner = AgentRunner(owner_user_ids={"owner"})
    result = runner.submit(
        InboundEvent("run-internal-only", "desktop", "owner", "hello"),
        CallableAgentPort(lambda _event: "<summary>只给内部看的摘要</summary>", worker_id="contract-worker"),
    )

    assert result.status == RunStatus.FAILED
    assert result.cleaned_output == ""
    assert "没有返回可见结果" in result.task_run.error
    assert "只给内部看的摘要" in result.task_run.log_excerpt


def test_generic_agent_port_calls_put_task_and_returns_done():
    class FakeAgent:
        def __init__(self):
            self.prompts = []
            self.llmclients = [object()]
            self.llmclient = self.llmclients[0]

        def run(self):
            return None

        def put_task(self, prompt, source="user", images=None):
            self.prompts.append((prompt, source, tuple(images or ())))
            q = Q.Queue()
            q.put({"next": "partial"})
            q.put({"done": "real done"})
            return q

    stub = FakeAgent()
    port = GenericAgentPort(
        agent_factory=lambda: stub,
        prompt_builder=lambda event: f"PROMPT:{event.text}",
        source="runtime-hub-test",
        timeout=1,
    )
    event = InboundEvent("real-port", "tui", "owner", "ping", images=("img.png",))

    assert port.run(event) == "real done"
    assert stub.prompts == [("PROMPT:ping", "runtime-hub-test", ("img.png",))]


def test_generic_agent_port_waits_for_final_turn_hook():
    class Resp:
        def __init__(self, content):
            self.content = content

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}

        def put_task(self, prompt, source="user", images=None):
            q = Q.Queue()

            def drive_hooks():
                for hook in list(self._turn_end_hooks.values()):
                    hook(
                        {
                            "response": Resp("intermediate: checking weather"),
                            "tool_calls": [{"tool_name": "web_search", "args": {}}],
                            "tool_results": [],
                            "turn": 1,
                            "next_prompt": "continue",
                            "exit_reason": {},
                        }
                    )
                threading.Event().wait(0.05)
                for hook in list(self._turn_end_hooks.values()):
                    hook(
                        {
                            "response": Resp("final weather answer"),
                            "tool_calls": [{"tool_name": "no_tool", "args": {}}],
                            "tool_results": [],
                            "turn": 2,
                            "next_prompt": "",
                            "exit_reason": {"result": "CURRENT_TASK_DONE", "data": Resp("final weather answer")},
                        }
                    )

            threading.Thread(target=drive_hooks, daemon=True).start()
            return q

    port = GenericAgentInstancePort(
        agent=FakeAgent(),
        prompt_builder=lambda incoming: incoming.text,
        source="runtime-hub-test",
        timeout=1,
    )

    assert port.run(InboundEvent("final-hook", "feishu", "owner", "weather")) == "final weather answer"


def test_generic_agent_port_prefers_final_hook_over_verbose_queue_done():
    class Resp:
        content = "clean final answer"

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}

        def put_task(self, prompt, source="user", images=None):
            q = Q.Queue()

            def drive():
                for hook in list(self._turn_end_hooks.values()):
                    hook(
                        {
                            "response": Resp(),
                            "tool_calls": [{"tool_name": "no_tool", "args": {}}],
                            "tool_results": [],
                            "turn": 2,
                            "next_prompt": "",
                            "exit_reason": {"result": "CURRENT_TASK_DONE", "data": Resp()},
                        }
                    )
                q.put({"done": "````text\n{\"query\":\"北京今天天气\"}\n````\n[Action] 网页搜索\nclean final answer"})

            threading.Thread(target=drive, daemon=True).start()
            return q

    port = GenericAgentInstancePort(
        agent=FakeAgent(),
        prompt_builder=lambda incoming: incoming.text,
        source="runtime-hub-test",
        timeout=1,
    )

    assert port.run(InboundEvent("hook-over-queue", "feishu", "owner", "weather")) == "clean final answer"


def test_generic_agent_port_uses_final_tool_data_string():
    class Resp:
        content = "<summary>tool stopped</summary>"

    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}

        def put_task(self, prompt, source="user", images=None):
            q = Q.Queue()
            for hook in list(self._turn_end_hooks.values()):
                hook(
                    {
                        "response": Resp(),
                        "tool_calls": [{"tool_name": "transcribe", "args": {}}],
                        "tool_results": [],
                        "turn": 1,
                        "next_prompt": "",
                        "exit_reason": {
                            "result": "CURRENT_TASK_DONE",
                            "data": "voice model is not ready",
                        },
                    }
                )
            return q

    port = GenericAgentInstancePort(
        agent=FakeAgent(),
        prompt_builder=lambda incoming: incoming.text,
        source="runtime-hub-test",
        timeout=1,
    )

    assert port.run(InboundEvent("tool-data", "feishu", "owner", "voice")) == "voice model is not ready"


def test_generic_agent_port_suppresses_verbose_runtime_output():
    class FakeAgent:
        def __init__(self):
            self.verbose = True
            self.verbose_seen = []

        def put_task(self, prompt, source="user", images=None):
            self.verbose_seen.append(self.verbose)
            q = Q.Queue()
            q.put({"done": "quiet done"})
            return q

    agent = FakeAgent()
    port = GenericAgentInstancePort(
        agent=agent,
        prompt_builder=lambda incoming: incoming.text,
        source="runtime-hub-test",
        timeout=1,
    )

    assert port.run(InboundEvent("quiet-port", "feishu", "owner", "ping")) == "quiet done"
    assert agent.verbose_seen == [False]
    assert agent.verbose is True


def test_existing_generic_agent_port_converts_interruption_to_permission():
    class FakeAgent:
        def __init__(self):
            self._turn_end_hooks = {}

        def put_task(self, prompt, source="user", images=None):
            q = Q.Queue()
            ctx = {
                "exit_reason": {
                    "result": "EXITED",
                    "data": {
                        "status": "INTERRUPT",
                        "intent": "HUMAN_INTERVENTION",
                        "data": {
                            "question": "下一步？",
                            "candidates": [
                                {"label": "A", "value": "first"},
                                {"label": "B", "value": "second"},
                            ],
                        },
                    },
                }
            }
            for hook in list(self._turn_end_hooks.values()):
                hook(ctx)
            return q

    event = InboundEvent("perm-port", "tui", "owner", "choose")
    port = GenericAgentInstancePort(
        agent=FakeAgent(),
        prompt_builder=lambda incoming: incoming.text,
        source="runtime-hub-test",
        timeout=1,
    )
    result = AgentRunner(owner_user_ids={"owner"}).submit(event, port)

    assert result.status == RunStatus.WAITING_PERMISSION
    assert result.permission.prompt == "下一步？"
    assert "2. B" in render_permission_text(result.permission)
    assert resolve_permission_choice("2", result.permission) == "second"


def test_runtime_hub_service_reuses_session_port_and_persists_runs():
    td = tempfile.mkdtemp()
    created = []

    def port_factory(session, event):
        created.append((session.session_id, event.event_id))
        return CallableAgentPort(lambda incoming: f"done:{incoming.text}", worker_id="contract-worker")

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
    )
    first = service.receive_blocking(InboundEvent("svc-1", "tui", "owner", "one"))
    second = service.receive_blocking(InboundEvent("svc-2", "desktop", "owner", "two"))
    group = service.receive_blocking(InboundEvent("svc-3", "feishu", "owner", "group", chat_id="g1", chat_type="group"))
    runs = service.recent_runs(limit=10)

    assert first.session.session_id == "owner:default"
    assert second.session.session_id == "owner:default"
    assert group.session.session_id == "feishu:group:g1"
    assert created == [("owner:default", "svc-1"), ("feishu:group:g1", "svc-3")]
    assert {r["run_id"] for r in runs} >= {first.task_run.run_id, second.task_run.run_id, group.task_run.run_id}
    assert all(r["status"] == RunStatus.SUCCEEDED for r in runs)


def test_runtime_chat_session_reuses_runtime_hub_and_resolves_permission():
    td = tempfile.mkdtemp()
    calls = []
    responses = [
        "turn-1",
        PermissionRequest(
            action="confirm",
            prompt="允许继续？",
            options=("允许", "取消"),
            metadata={"option_values": ("allow", "deny")},
        ),
        "after-permission",
    ]

    def port_factory(session, event):
        calls.append((session.session_id, event.text))
        return CallableAgentPort(lambda incoming: responses.pop(0), worker_id="chat-worker")

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
    )
    chat = runtime_cli.RuntimeChatSession(service=service)

    first = chat.send("hello")
    waiting = chat.send("need permission")
    resolved = chat.send("1")

    assert first["status"] == RunStatus.SUCCEEDED
    assert waiting["status"] == RunStatus.WAITING_PERMISSION
    assert "允许继续？" in waiting["output"]
    assert resolved["status"] == RunStatus.SUCCEEDED
    assert resolved["output"] == "after-permission"
    assert chat.last_session_id == "owner:default"
    assert calls == [("owner:default", "hello")]


def _make_submit_service(td, responses=None):
    """Build a RuntimeHubService with a CallableAgentPort that yields canned responses.

    Records (event_text, new_turn_flag) for every port.run call so tests can
    assert whether history was reset.  Returns (service, port_calls).
    """
    port_calls = []
    resp_iter = iter(responses or ["ok"])

    def port_factory(session, event):
        def run(incoming):
            port_calls.append((incoming.text, bool(incoming.metadata.get("new_turn"))))
            return next(resp_iter)

        return CallableAgentPort(run, worker_id="submit-worker")

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
    )
    return service, port_calls


def test_runtime_submit_returns_queue_no_when_busy():
    """submit() is non-blocking: a second event on a busy session returns queue_no, not a result."""
    td = tempfile.mkdtemp()
    service, _ = _make_submit_service(td, responses=["first-done", "second-done"])

    # Block the worker so the first event stays "running" long enough to queue the second.
    started = threading.Event()
    release = threading.Event()

    original_run = service.runner._run_port

    def slow_run(event, port):
        started.set()
        release.wait(timeout=5)
        return original_run(event, port)

    service.runner._run_port = slow_run

    decision1 = service.submit(InboundEvent("e1", "feishu", "owner", "one"))
    assert decision1.started_now is True
    started.wait(timeout=2)

    decision2 = service.submit(InboundEvent("e2", "feishu", "owner", "two"))
    assert decision2.started_now is False
    assert decision2.queue_no == 1

    release.set()
    # Let the dispatcher finish and drain.
    for _ in range(50):
        if service.runner.queue.is_active("owner:default") is False:
            break
        threading.Event().wait(0.05)

    runs = service.recent_runs(limit=10)
    assert {r["event_id"] for r in runs} == {"e1", "e2"}


def test_queued_event_runs_with_new_history():
    """A queued event (started_now=False) is marked new_turn so the port resets GA history."""
    td = tempfile.mkdtemp()
    service, port_calls = _make_submit_service(td, responses=["first", "second"])

    # First event runs immediately (new_turn=False, continues history).
    d1 = service.submit(InboundEvent("e1", "feishu", "owner", "query"))
    assert d1.started_now is True
    for _ in range(50):
        if not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    # Second event on the now-idle session still continues (not queued).
    d2 = service.submit(InboundEvent("e2", "feishu", "owner", "followup"))
    assert d2.started_now is True
    for _ in range(50):
        if not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    # Neither was queued, so neither should be new_turn.
    assert port_calls == [("query", False), ("followup", False)]

    # Now force a busy-session queue: block the port on the third event.
    started = threading.Event()
    release = threading.Event()
    original_run = service.runner._run_port

    def slow_run(event, port):
        started.set()
        release.wait(timeout=5)
        return original_run(event, port)

    service.runner._run_port = slow_run
    d3 = service.submit(InboundEvent("e3", "feishu", "owner", "busy"))
    assert d3.started_now is True
    started.wait(timeout=2)

    d4 = service.submit(InboundEvent("e4", "feishu", "owner", "queued"))
    assert d4.started_now is False
    assert d4.queue_no == 1

    release.set()
    for _ in range(80):
        if not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    # The third call was not queued (new_turn=False); the fourth WAS queued (new_turn=True).
    assert port_calls[2] == ("busy", False)
    assert port_calls[3] == ("queued", True)


def test_non_queued_event_continues_history():
    """A non-queued event (started_now=True on idle session) does NOT set new_turn."""
    td = tempfile.mkdtemp()
    service, port_calls = _make_submit_service(td, responses=["r1", "r2"])

    d1 = service.submit(InboundEvent("e1", "feishu", "owner", "first"))
    assert d1.started_now is True
    for _ in range(50):
        if not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    d2 = service.submit(InboundEvent("e2", "feishu", "owner", "second"))
    assert d2.started_now is True
    for _ in range(50):
        if not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    assert all(nt is False for _, nt in port_calls)
    assert [t for t, _ in port_calls] == ["first", "second"]


def test_submit_dispatches_next_after_complete():
    """When the running task finishes, the dispatcher pops and runs the next queued event."""
    td = tempfile.mkdtemp()
    service, port_calls = _make_submit_service(td, responses=["a", "b"])

    started = threading.Event()
    release = threading.Event()
    original_run = service.runner._run_port

    def slow_run(event, port):
        started.set()
        release.wait(timeout=5)
        return original_run(event, port)

    service.runner._run_port = slow_run

    d1 = service.submit(InboundEvent("e1", "feishu", "owner", "first"))
    assert d1.started_now is True
    started.wait(timeout=2)
    started.clear()

    d2 = service.submit(InboundEvent("e2", "feishu", "owner", "second"))
    assert d2.started_now is False

    # Release the first; the dispatcher should auto-run the second.
    release.set()
    for _ in range(80):
        if len(port_calls) >= 2:
            break
        threading.Event().wait(0.05)

    assert [t for t, _ in port_calls] == ["first", "second"]
    # The auto-dispatched second call was a queued event -> new_turn=True.
    assert port_calls[1] == ("second", True)


def test_submit_dispatches_next_after_failed_active_run():
    """A failed active run must still release the session and run queued events."""
    td = tempfile.mkdtemp()
    port_calls = []
    completed = []
    first_reached = threading.Event()
    release_first = threading.Event()

    def port_factory(session, event):
        def run(incoming):
            port_calls.append((incoming.text, bool(incoming.metadata.get("new_turn"))))
            if incoming.text == "voice":
                first_reached.set()
                release_first.wait(timeout=5)
                raise RuntimeError("voice model not ready")
            return f"done:{incoming.text}"

        return CallableAgentPort(run, worker_id="failure-dispatch-worker")

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
    )

    d1 = service.submit(
        InboundEvent("e1", "feishu", "owner", "voice"),
        on_complete=completed.append,
    )
    assert d1.started_now is True
    assert first_reached.wait(timeout=2)

    d2 = service.submit(
        InboundEvent("e2", "feishu", "owner", "text-after-voice"),
        on_complete=completed.append,
    )
    assert d2.started_now is False
    assert d2.queue_no == 1

    release_first.set()
    for _ in range(120):
        if len(port_calls) >= 2 and not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    assert port_calls == [("voice", False), ("text-after-voice", True)]
    assert [r.event.event_id for r in completed] == ["e1", "e2"]
    assert completed[0].status == RunStatus.FAILED
    assert completed[1].status == RunStatus.SUCCEEDED
    assert "voice model not ready" in completed[0].task_run.error
    assert completed[1].task_run.result_text == "done:text-after-voice"


def test_submit_dispatches_queued_event_with_its_own_port():
    td = tempfile.mkdtemp()
    port_calls = []
    completed = []
    first_reached = threading.Event()
    release_first = threading.Event()

    def first_run(incoming):
        assert incoming.text == "first"
        port_calls.append(("first-port", incoming.text, bool(incoming.metadata.get("new_turn"))))
        first_reached.set()
        release_first.wait(timeout=5)
        return "done:first"

    def second_run(incoming):
        assert incoming.text == "second"
        port_calls.append(("second-port", incoming.text, bool(incoming.metadata.get("new_turn"))))
        return "done:second"

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
    )

    d1 = service.submit(
        InboundEvent("own-port-1", "feishu", "owner", "first"),
        port=CallableAgentPort(first_run, worker_id="first-worker"),
        on_complete=completed.append,
    )
    assert d1.started_now is True
    assert first_reached.wait(timeout=2)

    d2 = service.submit(
        InboundEvent("own-port-2", "feishu", "owner", "second"),
        port=CallableAgentPort(second_run, worker_id="second-worker"),
        on_complete=completed.append,
    )
    assert d2.started_now is False
    assert d2.queue_no == 1
    queued_run_ids_before = list(service.runner._session_run_ids.get("owner:default", ()))
    assert len(queued_run_ids_before) == 2
    queued_run = next(service.runner.get_run(run_id) for run_id in queued_run_ids_before
                      if service.runner.get_run(run_id).event_id == "own-port-2")
    assert queued_run.status == RunStatus.PENDING

    release_first.set()
    for _ in range(120):
        if len(completed) >= 2 and not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    assert port_calls == [
        ("first-port", "first", False),
        ("second-port", "second", True),
    ]
    assert [r.event.event_id for r in completed] == ["own-port-1", "own-port-2"]
    assert [r.task_run.worker_id for r in completed] == ["first-worker", "second-worker"]
    assert completed[1].task_run.result_text == "done:second"
    assert list(service.runner._session_run_ids.get("owner:default", ())) == queued_run_ids_before
    assert completed[1].task_run.run_id == queued_run.run_id


def test_cancel_session_drops_pending_queue():
    """cancel_session(drop_pending=True) clears the中枢 queue so queued events never run."""
    td = tempfile.mkdtemp()
    service, port_calls = _make_submit_service(td, responses=["first"])

    started = threading.Event()
    release = threading.Event()
    original_run = service.runner._run_port

    def slow_run(event, port):
        started.set()
        release.wait(timeout=5)
        return original_run(event, port)

    service.runner._run_port = slow_run

    d1 = service.submit(InboundEvent("e1", "feishu", "owner", "keep"))
    assert d1.started_now is True
    started.wait(timeout=2)

    d2 = service.submit(InboundEvent("e2", "feishu", "owner", "drop-me"))
    assert d2.started_now is False

    service.cancel_session("owner:default", drop_pending=True)
    release.set()
    # Let the running "keep" task finish (cancel marks state but cannot
    # interrupt an in-flight port.run — that is GA's abort domain).
    for _ in range(80):
        if len(port_calls) >= 1 and not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    # The queued "drop-me" never reached the port (cancel cleared the queue).
    assert "drop-me" not in [t for t, _ in port_calls]


def test_runtime_store_exposes_cross_process_active_state_and_cancel_request():
    td = tempfile.mkdtemp()
    store_path = os.path.join(td, "runtime.sqlite3")
    started = threading.Event()
    release = threading.Event()
    completed = []

    def slow_run(incoming):
        assert incoming.text == "keep-visible"
        started.set()
        release.wait(timeout=5)
        return "late-success-should-cancel"

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=store_path,
    )
    observer = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=store_path,
    )

    decision = service.submit(
        InboundEvent("cross-proc-1", "feishu", "owner", "keep-visible"),
        port=CallableAgentPort(slow_run, worker_id="slow-worker"),
        on_complete=completed.append,
        send_body=False,
        send_notice=False,
    )
    assert decision.started_now is True
    assert started.wait(timeout=2)

    observed = observer.status("owner:default")
    assert observed["authority"] == "store"
    assert observed["queue"]["active"] is True
    assert observed["active_status"] == RunStatus.RUNNING
    assert observed["active_run_id"]

    cancel_data = observer.cancel_session("owner:default", drop_pending=True)
    assert cancel_data["status"]["cancel_requested"] is True
    assert cancel_data["status"]["cancel_drop_pending"] is True

    release.set()
    for _ in range(120):
        if completed and not service.runner.queue.is_active("owner:default"):
            break
        threading.Event().wait(0.05)

    assert completed
    assert completed[0].status == RunStatus.CANCELLED
    assert "cancel_request" in completed[0].task_run.metadata

    persisted = RuntimeStateStore(store_path)
    run = persisted.get_run(completed[0].task_run.run_id)
    assert run["status"] == RunStatus.CANCELLED
    final_state = persisted.get_session_state("owner:default")
    assert final_state["active"] is False
    assert final_state["pending_count"] == 0
    assert final_state["cancel_requested"] is False


def test_desktop_bridge_prompt_enters_runtime_hub_service_and_permission_flow():
    desktop_bridge = importlib.import_module("frontends.desktop_bridge")
    td = tempfile.mkdtemp()
    port_creations = []
    run_calls = []
    responses = [
        "desktop:hello",
        PermissionRequest(
            action="confirm",
            prompt="允许桌面继续？",
            options=("允许", "取消"),
            metadata={"option_values": ("allow", "deny")},
        ),
        "desktop:allowed",
    ]

    def port_factory(session, event):
        port_creations.append((session.session_id, event.metadata.get("desktop_session_id")))

        def run(incoming):
            run_calls.append((session.session_id, incoming.text, incoming.metadata.get("desktop_session_id")))
            return responses.pop(0)

        return CallableAgentPort(run, worker_id="desktop-worker")

    manager = desktop_bridge.AgentManager()
    manager._runtime_service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
    )
    sess = manager.create_session(cwd=td)
    manager.submit_prompt(sess.id, "hello")
    sess.thread.join(timeout=5)
    assert not sess.thread.is_alive()

    manager.submit_prompt(sess.id, "need permission")
    sess.thread.join(timeout=5)
    assert sess.pending_permission is not None
    assert sess.status == "idle"
    assert "允许桌面继续？" in sess.messages[-1]["content"]
    assert sess.messages[-1]["permission"]["prompt"] == "允许桌面继续？"
    assert sess.messages[-1]["permission"]["options"] == [
        {"index": 1, "label": "允许", "value": "allow"},
        {"index": 2, "label": "取消", "value": "deny"},
    ]

    manager.submit_prompt(sess.id, "1")
    sess.thread.join(timeout=5)
    assert sess.pending_permission is None
    assert sess.messages[-1]["content"] == "desktop:allowed"
    assert sess.runtime_session_id.startswith("desktop:user:sess-")
    assert port_creations == [(sess.runtime_session_id, sess.id)]
    assert run_calls == [
        (sess.runtime_session_id, "hello", sess.id),
        (sess.runtime_session_id, "need permission", sess.id),
        (sess.runtime_session_id, "allow", sess.id),
    ]


def test_desktop_bridge_ops_routes_reuse_runtime_control_contracts():
    desktop_bridge = importlib.import_module("frontends.desktop_bridge")
    from aiohttp.test_utils import TestClient, TestServer

    td = tempfile.mkdtemp()
    calls = []
    old_manager = desktop_bridge.manager
    old_catalog = desktop_bridge.command_catalog
    old_checks = desktop_bridge.ops_checks
    old_logs = desktop_bridge.read_ops_logs
    old_run = desktop_bridge.run_ops_command

    def catalog():
        return {
            "read_only": ["doctor", "selfcheck", "runtime-service-status"],
            "state_changing": ["runtime-service-install", "runtime-service-uninstall"],
            "logs": ["feishu"],
            "not_exposed": ["setup", "update-apply", "start", "stop", "restart"],
        }

    def checks(root=None):
        return {"ok": True, "root": root, "privacy_audit": {"privacy_ok": True}}

    def logs(channel="", root=None, lines=80):
        return {"ok": True, "channel": channel, "source": "test", "returncode": 0, "text": "token=***"}

    def run_command(name, root=None, allow_state=False, timeout=None):
        calls.append((name, allow_state, root, timeout))
        return {"ok": True, "command": name, "returncode": 0, "stdout": "ok", "stderr": ""}

    async def scenario():
        desktop_bridge.manager = desktop_bridge.AgentManager()
        desktop_bridge.manager.ga_root = td
        desktop_bridge.manager._runtime_service = RuntimeHubService(
            owner_user_ids={"owner"},
            store_path=os.path.join(td, "runtime.sqlite3"),
            port_factory=lambda _session, _event: CallableAgentPort(lambda event: f"desktop:{event.text}", worker_id="desktop-test"),
        )
        run = desktop_bridge.manager._runtime_service.receive_blocking(
            InboundEvent("desktop-run-1", "desktop", "owner", "hello"),
            send_body=False,
            send_notice=False,
        )
        desktop_bridge.command_catalog = catalog
        desktop_bridge.ops_checks = checks
        desktop_bridge.read_ops_logs = logs
        desktop_bridge.run_ops_command = run_command
        client = TestClient(TestServer(desktop_bridge.create_app()))
        await client.start_server()
        try:
            origin = str(client.make_url("/")).rstrip("/")
            auth = {desktop_bridge.BRIDGE_TOKEN_HEADER: desktop_bridge.BRIDGE_TOKEN, "Origin": origin}
            index = await client.get("/")
            assert index.status == 200
            assert "window.__PENGLAI_BRIDGE_TOKEN__" in await index.text()
            assert index.headers.get("Access-Control-Allow-Origin") != "*"
            missing_token = await client.get("/status")
            assert missing_token.status == 401
            status_resp = await client.get("/status", headers=auth)
            assert status_resp.status == 200
            assert status_resp.headers.get("Access-Control-Allow-Origin") == origin
            evil = await client.get("/ops/commands", headers={"Origin": "https://evil.example"})
            assert evil.status == 401
            allowed = await client.get("/ops/commands", headers=auth)
            assert allowed.status == 200
            commands = await allowed.json()
            check_resp = await client.get("/ops/checks", headers=auth)
            log_resp = await client.get("/ops/logs?channel=feishu&lines=3", headers=auth)
            doctor_resp = await client.get("/ops/command?name=doctor", headers=auth)
            service_status_resp = await client.get("/ops/command?name=runtime-service-status", headers=auth)
            service_install_get = await client.get("/ops/command?name=runtime-service-install", headers=auth)
            service_install_post = await client.post("/ops/command", headers=auth, json={"command": "runtime-service-install", "timeout": 1})
            legacy_restart_get = await client.get("/ops/command?name=restart", headers=auth)
            runtime_status_resp = await client.get("/runtime/status?session_id=owner:default", headers=auth)
            runtime_runs_resp = await client.get("/runtime/runs?session_id=owner:default&limit=3", headers=auth)
            runtime_evil = await client.get("/runtime/runs", headers={"Origin": "https://evil.example", desktop_bridge.BRIDGE_TOKEN_HEADER: desktop_bridge.BRIDGE_TOKEN})
            path_anywhere = await client.post("/path/open", headers=auth, json={"path": td})

            assert "doctor" in commands["read_only"]
            assert "runtime-service-status" in commands["read_only"]
            assert "runtime-service-install" in commands["state_changing"]
            assert "setup" in commands["not_exposed"]
            assert "restart" in commands["not_exposed"]
            assert (await check_resp.json())["privacy_audit"]["privacy_ok"] is True
            assert (await log_resp.json())["text"] == "token=***"
            assert (await doctor_resp.json())["command"] == "doctor"
            assert (await service_status_resp.json())["command"] == "runtime-service-status"
            assert service_install_get.status == 400
            assert (await service_install_post.json())["command"] == "runtime-service-install"
            assert legacy_restart_get.status == 400
            assert runtime_evil.status == 401
            assert path_anywhere.status == 400
            runtime_status = await runtime_status_resp.json()
            runtime_runs = await runtime_runs_resp.json()
            assert runtime_status["session"]["session_id"] == "owner:default"
            assert runtime_runs["runs"][0]["run_id"] == run.task_run.run_id
            assert runtime_runs["runs"][0]["status"] == RunStatus.SUCCEEDED
            assert calls == [
                ("doctor", False, td, None),
                ("runtime-service-status", False, td, None),
                ("runtime-service-install", True, td, 1),
            ]
        finally:
            await client.close()
            desktop_bridge.manager = old_manager
            desktop_bridge.command_catalog = old_catalog
            desktop_bridge.ops_checks = old_checks
            desktop_bridge.read_ops_logs = old_logs
            desktop_bridge.run_ops_command = old_run

    asyncio.run(scenario())


def test_desktop_bridge_tts_route_generates_local_audio_without_path_escape():
    desktop_bridge = importlib.import_module("frontends.desktop_bridge")
    from aiohttp.test_utils import TestClient, TestServer

    td = tempfile.mkdtemp()
    old_manager = desktop_bridge.manager
    old_tts_service = desktop_bridge.tts_service
    calls = []

    class TTS:
        @staticmethod
        def synthesize(text, **kwargs):
            calls.append((text, kwargs))
            path = kwargs["output_path"]
            with wave.open(path, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(b"\x00\x00" * 1600)
            return {
                "ok": True,
                "audio": {
                    "path": path,
                    "bytes": os.path.getsize(path),
                    "sample_rate": 16000,
                    "channels": 1,
                    "frames": 1600,
                    "seconds": 0.1,
                },
            }

    async def scenario():
        desktop_bridge.manager = desktop_bridge.AgentManager()
        desktop_bridge.manager.ga_root = td
        desktop_bridge.tts_service = TTS
        client = TestClient(TestServer(desktop_bridge.create_app()))
        await client.start_server()
        try:
            origin = str(client.make_url("/")).rstrip("/")
            auth = {desktop_bridge.BRIDGE_TOKEN_HEADER: desktop_bridge.BRIDGE_TOKEN, "Origin": origin}
            evil = await client.post("/tts/say", headers={"Origin": "https://evil.example", desktop_bridge.BRIDGE_TOKEN_HEADER: desktop_bridge.BRIDGE_TOKEN}, json={"text": "hi"})
            assert evil.status == 401
            missing_token = await client.post("/tts/say", json={"text": "hi"})
            assert missing_token.status == 401
            empty = await client.post("/tts/say", headers=auth, json={"text": ""})
            assert empty.status == 400
            resp = await client.post("/tts/say", headers=auth, json={"text": "蓬莱朗读测试"})
            assert resp.status == 200
            data = await resp.json()
            assert data["ok"] is True
            assert data["provider"] == "moss-tts-nano"
            assert data["audio_url"].startswith("/tts/audio/desktop_tts_")
            assert calls[0][0] == "蓬莱朗读测试"
            assert calls[0][1]["allow_download"] is False
            assert calls[0][1]["stream"] is False
            expected_dir = os.path.realpath(os.path.join(td, "temp", "desktop_tts"))
            actual_path = os.path.realpath(calls[0][1]["output_path"])
            assert os.path.commonpath([actual_path, expected_dir]) == expected_dir
            audio_without_token = await client.get(data["audio_url"])
            assert audio_without_token.status == 401
            audio = await client.get(data["audio_url"] + "?token=" + desktop_bridge.BRIDGE_TOKEN)
            assert audio.status == 200
            assert await audio.read()
            escape = await client.get("/tts/audio/../secret.wav?token=" + desktop_bridge.BRIDGE_TOKEN)
            assert escape.status in {400, 404}
        finally:
            await client.close()
            desktop_bridge.manager = old_manager
            desktop_bridge.tts_service = old_tts_service

    asyncio.run(scenario())


def test_runtime_state_store_records_permissions_and_artifacts():
    td = tempfile.mkdtemp()
    artifact = os.path.join(td, "report.md")
    open(artifact, "w", encoding="utf-8").write("# report")

    responses = [
        PermissionRequest(action="confirm", prompt="允许继续？", options=("允许", "取消")),
        f"完成\n[FILE:{artifact}]",
    ]

    def port_factory(_session, _event):
        return CallableAgentPort(lambda _incoming: responses.pop(0), worker_id="contract-worker")

    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
        port_factory=port_factory,
    )
    waiting = service.receive_blocking(InboundEvent("svc-perm", "tui", "owner", "need permission"))
    done = service.receive_blocking(
        InboundEvent("svc-artifact", "tui", "owner", "make artifact"),
        base_dir=td,
        send_body=False,
        send_notice=False,
    )

    waiting_record = service.get_run(waiting.task_run.run_id)
    done_record = service.get_run(done.task_run.run_id)

    assert waiting_record["permission"]["prompt"] == "允许继续？"
    assert done_record["artifacts"] == [os.path.realpath(artifact)]


def _control_request(base, method, path, *, token=None, data=None, extra_headers=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Penglai-Token"] = token
    if extra_headers:
        headers.update(extra_headers)
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_runtime_control_api_requires_token_and_controls_runtime_hub():
    td = tempfile.mkdtemp()
    token_path = os.path.join(td, "token")
    service = RuntimeHubService(
        owner_user_ids={"owner"},
        store_path=os.path.join(td, "runtime.sqlite3"),
    )
    server = control_api.make_server(
        host="127.0.0.1",
        port=0,
        token_path=token_path,
        service=service,
        message_port_factory=lambda _event, _body: CallableAgentPort(
            lambda incoming: f"control:{incoming.text}",
            worker_id="control-worker",
        ),
    )
    token = open(token_path, encoding="utf-8").read().strip()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        try:
            _control_request(base, "GET", "/health")
            raise AssertionError("unauthorized request should fail")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401
        try:
            _control_request(
                base,
                "GET",
                "/health",
                token=token,
                extra_headers={"Origin": "https://evil.example"},
            )
            raise AssertionError("non-loopback origin should fail")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401

        health = _control_request(base, "GET", "/health", token=token)
        result = _control_request(
            base,
            "POST",
            "/message",
            token=token,
            data={
                "text": "hello",
                "channel": "desktop",
                "user_id": "owner",
                "chat_id": "control",
            },
        )
        status_doc = _control_request(base, "GET", "/status?session_id=owner:default", token=token)
        runs_doc = _control_request(base, "GET", "/runs?limit=5", token=token)
        cancel_doc = _control_request(
            base,
            "POST",
            "/cancel",
            token=token,
            data={"session_id": "owner:default", "drop_pending": True},
        )
        cli_cancel_doc = runtime_cli.cancel_via_control_api(
            "owner:default",
            drop_pending=True,
            port=server.server_address[1],
            token_file=token_path,
        )

        assert health["ok"] is True
        assert result["status"] == RunStatus.SUCCEEDED
        assert result["output"] == "control:hello"
        assert status_doc["session"]["session_id"] == "owner:default"
        assert runs_doc["runs"][0]["run_id"] == result["run_id"]
        assert cancel_doc["session_id"] == "owner:default"
        assert cli_cancel_doc["session_id"] == "owner:default"
        assert cli_cancel_doc["via"] == "control_api"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_runtime_control_api_default_service_routes_owner_to_default_session():
    td = tempfile.mkdtemp()
    token_path = os.path.join(td, "token")
    server = control_api.make_server(
        host="127.0.0.1",
        port=0,
        token_path=token_path,
        message_port_factory=lambda _event, _body: CallableAgentPort(
            lambda incoming: f"default:{incoming.text}",
            worker_id="control-worker",
        ),
    )
    token = open(token_path, encoding="utf-8").read().strip()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        result = _control_request(
            base,
            "POST",
            "/message",
            token=token,
            data={
                "text": "hello",
                "channel": "desktop",
                "user_id": "owner",
                "chat_id": "control",
            },
        )

        assert result["status"] == RunStatus.SUCCEEDED
        assert result["session_id"] == "owner:default"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_runtime_control_api_exposes_desktop_ops_checks_logs_and_commands():
    td = tempfile.mkdtemp()
    token_path = os.path.join(td, "token")
    log_dir = os.path.join(td, "temp")
    os.makedirs(log_dir, exist_ok=True)
    with open(os.path.join(log_dir, "fsapp.log"), "w", encoding="utf-8") as f:
        f.write("connected\nAuthorization: Bearer live-token\napi_key='sk-" + ("c" * 32) + "'\n")

    calls = []

    def ops_runner(name, **kwargs):
        calls.append((name, kwargs.get("allow_state")))
        return {
            "ok": True,
            "command": name,
            "argv": ["penglai", name],
            "returncode": 0,
            "stdout": "token=***",
            "stderr": "",
        }

    server = control_api.make_server(
        host="127.0.0.1",
        port=0,
        token_path=token_path,
        root=td,
        ops_runner=ops_runner,
        message_port_factory=lambda _event, _body: CallableAgentPort(lambda incoming: incoming.text),
    )
    token = open(token_path, encoding="utf-8").read().strip()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        commands = _control_request(base, "GET", "/ops/commands", token=token)
        checks = _control_request(base, "GET", "/ops/checks", token=token)
        logs = _control_request(base, "GET", "/ops/logs?channel=feishu&lines=10", token=token)
        command = _control_request(base, "GET", "/ops/command?name=doctor", token=token)
        state_command = _control_request(
            base,
            "POST",
            "/ops/command",
            token=token,
            data={"command": "runtime-service-install", "timeout": 1},
        )
        service_status = _control_request(base, "GET", "/ops/command?name=runtime-service-status", token=token)
        try:
            _control_request(base, "GET", "/ops/command?name=runtime-service-install", token=token)
            raise AssertionError("state-changing command should require POST")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
        try:
            _control_request(base, "GET", "/ops/command?name=restart", token=token)
            raise AssertionError("legacy restart should not be exposed")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400

        assert "doctor" in commands["read_only"]
        assert "runtime-service-status" in commands["read_only"]
        assert "runtime-service-install" in commands["state_changing"]
        assert "runtime-service-uninstall" in commands["state_changing"]
        assert "setup" in commands["not_exposed"]
        assert "restart" in commands["not_exposed"]
        assert checks["privacy_audit"]["privacy_ok"] is True
        assert "RuntimeControlAPI" in checks["selfcheck"]["contracts"]
        assert logs["ok"] is True
        assert "Bearer live-token" not in logs["text"]
        assert "sk-" + ("c" * 32) not in logs["text"]
        assert "Bearer ***" in logs["text"]
        assert "api_key='***'" in logs["text"]
        assert command["command"] == "doctor"
        assert service_status["command"] == "runtime-service-status"
        assert state_command["command"] == "runtime-service-install"
        assert calls == [("doctor", False), ("runtime-service-install", True), ("runtime-service-status", False)]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_runtime_control_api_refuses_non_loopback_bind():
    td = tempfile.mkdtemp()
    try:
        control_api.make_server(host="0.0.0.0", port=0, token_path=os.path.join(td, "token"))
        raise AssertionError("non-loopback bind should be rejected")
    except ValueError as exc:
        assert "loopback" in str(exc)


def test_runtime_service_units_keep_control_api_localhost_only():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    unit = service_unit.systemd_unit(
        root=root,
        python="/opt/penglai/.venv/bin/python",
        user="penglai",
        home="/home/penglai",
        port=18888,
    )
    plist = service_unit.launchd_plist(
        root=root,
        python="/opt/penglai/.venv/bin/python",
        home="/Users/penglai",
        port=18889,
    )

    assert "penglai runtime-serve --host 127.0.0.1 --port 18888" in unit
    assert "User=penglai" in unit
    assert "Restart=always" in unit
    assert "Docker" not in unit and "docker" not in unit
    assert plist["Label"] == "com.penglai.runtimehub"
    assert plist["ProgramArguments"][-4:] == ["--host", "127.0.0.1", "--port", "18889"]
    assert plist["KeepAlive"] is True


def test_feishu_service_units_use_030_wrapper_and_gray_probe():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    unit = feishu_service.systemd_unit(
        root=root,
        python="/opt/penglai/.venv/bin/python",
        user="penglai",
        home="/home/penglai",
        service_name="penglai-feishu",
    )
    gray = feishu_service.systemd_unit(
        root=root,
        python="/opt/penglai/.venv/bin/python",
        user="penglai",
        home="/home/penglai",
        service_name="penglai-feishu-030-gray",
        gray_probe=True,
        gray_wait=90,
        gray_send_prompt=True,
        gray_nonce="penglai030-test",
    )

    assert "penglai_feishu_app.py" in unit
    assert "frontends/fsapp.py" not in unit
    assert "Restart=always" in unit
    assert "Docker" not in unit and "docker" not in unit
    assert "--gray-probe" in gray
    assert "--gray-send-prompt" in gray
    assert "--gray-nonce penglai030-test" in gray
    assert "Restart=no" in gray


def test_reflect_service_units_use_venv_python_not_bare_python():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    import penglai_abilities

    unit = penglai_abilities.reflect_systemd_unit(
        "penglai-companion",
        "reflect/penglai_companion.py",
        "主动陪伴",
        root="/opt/penglai",
        python="/opt/penglai/.venv/bin/python",
        user="penglai",
        home="/home/penglai",
    )
    setup_src = open(os.path.join(root, "penglai_setup.py"), encoding="utf-8").read()

    assert "/opt/penglai/.venv/bin/python /opt/penglai/penglai _guardcheck" in unit
    assert "/opt/penglai/.venv/bin/python /opt/penglai/agentmain.py --reflect /opt/penglai/reflect/penglai_companion.py" in unit
    assert "&& python " not in unit
    assert "exec python " not in unit
    assert 'f"python {ROOT}' not in setup_src


def test_doctor_treats_feishu_as_opt_in_channel_not_runtime_core():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    loader = importlib.machinery.SourceFileLoader(
        "penglai_cli_for_runtime_tests",
        os.path.join(root, "penglai"),
    )
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)

    assert module.SERVICES.index("penglai-feishu") < module.SERVICES.index("penglai-runtime-hub")
    assert module.OPTIN_SERVICES["penglai-feishu"] == "飞书渠道进程"
    assert module.SVC_ENABLE["penglai-feishu"] == "penglai feishu-service install"

    module.has_systemd = lambda: True
    module.sh = lambda *args, **kwargs: type("Result", (), {"stdout": ""})()
    assert module.installed_services() == []


def test_chatapp_common_supports_package_and_legacy_import_paths():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = os.environ.copy()

    package_env = env.copy()
    package_env["PYTHONPATH"] = root
    package = subprocess.run(
        [sys.executable, "-c", "import frontends.chatapp_common; print('package-ok')"],
        cwd=root,
        env=package_env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert package.returncode == 0, (package.stdout or "") + (package.stderr or "")
    assert "package-ok" in package.stdout

    legacy_env = env.copy()
    legacy_env["PYTHONPATH"] = os.pathsep.join([os.path.join(root, "frontends"), root])
    legacy = subprocess.run(
        [sys.executable, "-c", "import chatapp_common; print('legacy-ok')"],
        cwd=root,
        env=legacy_env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert legacy.returncode == 0, (legacy.stdout or "") + (legacy.stderr or "")
    assert "legacy-ok" in legacy.stdout


def test_runtime_deprecation_audit_lists_030_legacy_surfaces():
    result = deprecations.audit(include_runtime=False)
    items = {item["item_id"]: item for item in result["items"]}

    assert result["item_count"] >= 5
    assert items["feishu_legacy_entry"]["replacement"].startswith("penglai_feishu_app.py")
    assert items["wechat_legacy_entry"]["replacement"].startswith("penglai_im_launch.py")
    assert items["companion_reflect_runtime_event"]["status"] == "runtime_wrapped_service_event"
    assert items["scheduler_reflect_legacy_task"]["status"] == "runtime_wrapped_service_event"
    assert items["docker_legacy_surface"]["status"] == "legacy_surface_observed"


def test_runtime_deprecation_blocks_public_docker_claims_only():
    td = tempfile.mkdtemp()
    os.makedirs(os.path.join(td, ".github", "workflows"), exist_ok=True)
    for rel in (
        "Dockerfile",
        "docker-compose.yml",
        "docker-entrypoint.sh",
        "docker-install.sh",
        os.path.join(".github", "workflows", "docker-image.yml"),
    ):
        with open(os.path.join(td, rel), "w", encoding="utf-8") as f:
            f.write("# legacy\n")
    with open(os.path.join(td, "README.md"), "w", encoding="utf-8") as f:
        f.write("0.3.0 Docker: curl docker-install.sh | sh\n")

    result = deprecations.audit(root=td, include_runtime=False)
    items = {item["item_id"]: item for item in result["items"]}

    assert items["docker_legacy_surface"]["status"] == "release_blocker_before_public_docs"
    assert "README.md" in items["docker_legacy_surface"]["reason"]


def test_runtime_deprecation_process_match_uses_python_script_argv():
    assert deprecations._argv_has_script(
        "/opt/penglai/.venv/bin/python /opt/penglai/frontends/fsapp.py",
        "frontends/fsapp.py",
    )
    assert deprecations._argv_has_script(
        "python -u penglai_im_launch.py wechat",
        "penglai_im_launch.py",
    )
    assert not deprecations._argv_has_script(
        "python -c 'print(\"frontends/fsapp.py\")'",
        "frontends/fsapp.py",
    )
    assert not deprecations._argv_has_script(
        "/Applications/Codex.app/SkyComputerUseClient turn-ended '{\"text\":\"frontends/fsapp.py\"}'",
        "frontends/fsapp.py",
    )


def test_privacy_audit_blocks_tracked_secret_without_printing_value():
    td = tempfile.mkdtemp()
    subprocess.run(["git", "init"], cwd=td, capture_output=True, text=True, check=True)
    secret = "sk-" + ("a" * 32)
    with open(os.path.join(td, "leak.py"), "w", encoding="utf-8") as f:
        f.write(f"api_key = '{secret}'\n")
    subprocess.run(["git", "add", "leak.py"], cwd=td, capture_output=True, text=True, check=True)

    result = privacy_audit.audit(root=td, include_ignored=False)
    blob = json.dumps(result, ensure_ascii=False)

    assert result["privacy_ok"] is False
    assert any(item["item_id"] == "content_secret_match" for item in result["findings"])
    assert secret not in blob


def test_privacy_audit_reports_ignored_private_paths_as_local_only():
    td = tempfile.mkdtemp()
    subprocess.run(["git", "init"], cwd=td, capture_output=True, text=True, check=True)
    with open(os.path.join(td, ".gitignore"), "w", encoding="utf-8") as f:
        f.write("mykey.py\ntemp/\n")
    with open(os.path.join(td, "safe.py"), "w", encoding="utf-8") as f:
        f.write("print('ok')\n")
    subprocess.run(["git", "add", ".gitignore", "safe.py"], cwd=td, capture_output=True, text=True, check=True)
    with open(os.path.join(td, "mykey.py"), "w", encoding="utf-8") as f:
        f.write("api_key = '" + ("sk-" + ("b" * 32)) + "'\n")

    result = privacy_audit.audit(root=td, include_ignored=True, scan_ignored=False)
    findings = result["findings"]

    assert result["privacy_ok"] is True
    assert any(item["path"] == "mykey.py" and item["status"] == "local_ignored_private" for item in findings)
    assert not any(item["status"] == "privacy_blocker" for item in findings)


def test_install_check_validates_030_source_install_contracts():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = install_check.audit(root=root, require_real_agent=False)
    names = {item["name"]: item["ok"] for item in result["checks"]}

    assert result["ok"] is True
    assert names["python_310_plus"] is True
    assert names["source_files_present"] is True
    assert names["version_is_030"] is True
    assert names["runtime_contracts_pass"] is True
    assert names["privacy_audit_passes"] is True
    assert names["runtime_audit_inventory_ready"] is True
    assert names["optional_voice_runtime_status"] is True
    assert names["optional_tts_runtime_status"] is True
    assert names["optional_vision_runtime_status"] is True
    assert names["optional_critic_runtime_status"] is True
    assert names["service_units_localhost_only"] is True
    assert names["install_script_branch_test_mode"] is True


def test_install_check_uses_service_venv_python_for_version_check():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = install_check._python_check(root)

    assert result["ok"] is True
    if os.path.exists(os.path.join(root, ".venv", "bin", "python")):
        assert ".venv/bin/python" in result["detail"]


def _critic_status_with_mykey(source):
    td = tempfile.mkdtemp()
    with open(os.path.join(td, "mykey.py"), "w", encoding="utf-8") as f:
        f.write(source)
    old_path = list(sys.path)
    old_mykey = sys.modules.pop("mykey", None)
    try:
        sys.path.insert(0, td)
        return capabilities.critic_runtime_status(root=td)
    finally:
        sys.path[:] = old_path
        sys.modules.pop("mykey", None)
        if old_mykey is not None:
            sys.modules["mykey"] = old_mykey


def test_critic_capability_requires_different_vendor():
    result = _critic_status_with_mykey(
        "minimax_native_oai_config = {'name':'MiniMax-M3','apibase':'https://api.example.com/v1','apikey':'sk-main','model':'MiniMax-M3'}\n"
        "critic_model = {'name':'DeepSeek','apibase':'https://api.deepseek.com','apikey':'sk-critic','model':'deepseek-v4-flash'}\n"
        "critic_mode = 'smart'\n"
    )

    assert result["ready"] is True
    assert result["status"] == "ready"
    assert result["main_vendor"] == "minimax"
    assert result["critic_vendor"] == "deepseek"


def test_critic_capability_rejects_same_vendor_review_model():
    result = _critic_status_with_mykey(
        "native_oai_config = {'name':'DeepSeek','apibase':'https://api.deepseek.com','apikey':'sk-main','model':'deepseek-v4-flash'}\n"
        "critic_model = {'name':'DeepSeek','apibase':'https://api.deepseek.com','apikey':'sk-critic','model':'deepseek-v4-pro'}\n"
        "critic_mode = 'smart'\n"
    )

    assert result["ready"] is False
    assert result["status"] == "same_vendor"
    assert result["components"]["different_vendor"] is False


def test_optional_voice_capability_status_is_diagnostic_only():
    tmp = tempfile.mkdtemp()
    result = capabilities.voice_runtime_status(model_dir=os.path.join(tmp, "missing-model"))
    blob = json.dumps(result, ensure_ascii=False)

    assert result["name"] == "voice"
    assert result["optional"] is True
    assert result["components"]["model"] is False
    assert "model" in result["missing"]
    assert result["status"] in {"disabled", "partial"}
    assert "curl" not in blob
    assert "tar " not in blob


def test_optional_voice_capability_requires_tokens_with_model():
    tmp = tempfile.mkdtemp()
    model_dir = os.path.join(tmp, "voice-model")
    os.makedirs(model_dir, exist_ok=True)
    open(os.path.join(model_dir, capabilities.VOICE_MODEL_FILE), "w", encoding="utf-8").write("x")

    result = capabilities.voice_runtime_status(model_dir=model_dir)

    assert result["ready"] is False
    assert result["components"]["model"] is True
    assert result["components"]["tokens"] is False
    assert "tokens" in result["missing"]


def test_optional_tts_capability_reports_moss_tts_missing_without_installing():
    tmp = tempfile.mkdtemp()
    result = capabilities.tts_runtime_status(model_base=tmp)
    blob = json.dumps(result, ensure_ascii=False)

    assert result["name"] == "tts"
    assert result["provider"] == "moss-tts-nano"
    assert result["backend"] == "onnx-cpu"
    assert result["optional"] is True
    assert result["components"]["moss_tts_repo"] is False
    assert result["components"]["moss_tts_onnx_model"] is False
    assert result["components"]["moss_audio_tokenizer_onnx"] is False
    assert "moss_tts_repo" in result["missing"]
    assert result["status"] == "disabled"
    assert "curl" not in blob
    assert "pip install" not in blob


def test_optional_tts_capability_detects_local_moss_model_layout():
    tmp = tempfile.mkdtemp()
    repo_dir = capabilities.moss_tts_repo_dir(base_dir=tmp)
    tts_dir = capabilities.moss_tts_onnx_tts_dir(base_dir=tmp)
    tok_dir = capabilities.moss_tts_onnx_codec_dir(base_dir=tmp)
    os.makedirs(repo_dir, exist_ok=True)
    os.makedirs(tts_dir, exist_ok=True)
    os.makedirs(tok_dir, exist_ok=True)
    for name in ("infer_onnx.py", "onnx_tts_runtime.py"):
        open(os.path.join(repo_dir, name), "w", encoding="utf-8").write("x")
    for name in capabilities.MOSS_TTS_ONNX_TTS_FILES:
        open(os.path.join(tts_dir, name), "w", encoding="utf-8").write("x")
    open(os.path.join(tts_dir, "moss_tts_prefill.onnx"), "w", encoding="utf-8").write("x")
    open(os.path.join(tts_dir, "moss_tts_global_shared.data"), "w", encoding="utf-8").write("x")
    for name in capabilities.MOSS_TTS_ONNX_CODEC_FILES:
        open(os.path.join(tok_dir, name), "w", encoding="utf-8").write("x")
    open(os.path.join(tok_dir, "moss_audio_tokenizer_decode_full.onnx"), "w", encoding="utf-8").write("x")
    open(os.path.join(tok_dir, "moss_audio_tokenizer_decode_shared.data"), "w", encoding="utf-8").write("x")

    result = capabilities.tts_runtime_status(model_base=tmp)

    assert result["components"]["moss_tts_repo"] is True
    assert result["components"]["moss_tts_onnx_model"] is True
    assert result["components"]["moss_audio_tokenizer_onnx"] is True
    assert result["enabled"] is True
    assert result["status"] in {"ready", "partial"}


def test_optional_tts_capability_rejects_onnx_model_without_data_file():
    tmp = tempfile.mkdtemp()
    repo_dir = capabilities.moss_tts_repo_dir(base_dir=tmp)
    tts_dir = capabilities.moss_tts_onnx_tts_dir(base_dir=tmp)
    tok_dir = capabilities.moss_tts_onnx_codec_dir(base_dir=tmp)
    os.makedirs(repo_dir, exist_ok=True)
    os.makedirs(tts_dir, exist_ok=True)
    os.makedirs(tok_dir, exist_ok=True)
    for name in ("infer_onnx.py", "onnx_tts_runtime.py"):
        open(os.path.join(repo_dir, name), "w", encoding="utf-8").write("x")
    for name in capabilities.MOSS_TTS_ONNX_TTS_FILES:
        open(os.path.join(tts_dir, name), "w", encoding="utf-8").write("x")
    open(os.path.join(tts_dir, "moss_tts_prefill.onnx"), "w", encoding="utf-8").write("x")
    for name in capabilities.MOSS_TTS_ONNX_CODEC_FILES:
        open(os.path.join(tok_dir, name), "w", encoding="utf-8").write("x")
    open(os.path.join(tok_dir, "moss_audio_tokenizer_decode_full.onnx"), "w", encoding="utf-8").write("x")
    open(os.path.join(tok_dir, "moss_audio_tokenizer_decode_shared.data"), "w", encoding="utf-8").write("x")

    result = capabilities.tts_runtime_status(model_base=tmp)

    assert result["components"]["moss_tts_repo"] is True
    assert result["components"]["moss_tts_onnx_model"] is False
    assert result["components"]["moss_audio_tokenizer_onnx"] is True


def test_tts_service_defaults_voice_by_text_language_and_fails_without_repo():
    from penglai_runtime import tts_service

    tmp = tempfile.mkdtemp()
    assert tts_service.choose_default_voice("蓬莱测试") == "Junhao"
    assert tts_service.choose_default_voice("Penglai test") == "Ava"

    result = tts_service.synthesize(
        "hello",
        output_path=os.path.join(tmp, "out.wav"),
        base_dir=tmp,
        allow_download=False,
    )

    assert result["ok"] is False
    assert "repo missing" in result["error"]


def test_tts_service_download_urls_prioritize_domestic_routes():
    from penglai_runtime import tts_service

    repo = tts_service.MODEL_REPOS[0]

    assert tts_service.MODEL_DOWNLOAD_SOURCES[:2] == ("modelscope", "hf-mirror")
    assert tts_service._model_file_url("modelscope", repo, "browser_poc_manifest.json").startswith(
        "https://modelscope.cn/models/openmoss/MOSS-TTS-Nano-100M-ONNX/resolve/master/"
    )
    assert tts_service._model_file_url("hf-mirror", repo, "browser_poc_manifest.json").startswith(
        "https://hf-mirror.com/OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX/resolve/main/"
    )


def test_install_script_can_install_current_branch_without_setup():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    td = tempfile.mkdtemp()
    target = os.path.join(td, "PenglaiAgent")
    env = os.environ.copy()
    for key in VERSION_ENV_KEYS:
        env.pop(key, None)
    env.update({
        "HOME": td,
        "PENGLAI_SOURCE_DIR": root,
        "PENGLAI_DIR": target,
        "PENGLAI_SKIP_SETUP": "1",
        "PENGLAI_INSTALL_VERIFY": "1",
        "PENGLAI_PIP_TIMEOUT": "240",
    })

    result = subprocess.run(
        ["sh", os.path.join(root, "install.sh")],
        cwd=td,
        env=env,
        capture_output=True,
        text=True,
        timeout=420,
    )
    output = (result.stdout or "") + (result.stderr or "")

    assert result.returncode == 0, output
    assert os.path.exists(os.path.join(target, "penglai"))
    assert os.path.exists(os.path.join(target, "penglai_runtime", "install_check.py"))
    assert not os.path.exists(os.path.join(target, ".git"))
    assert not os.path.exists(os.path.join(target, "_internal"))
    assert not os.path.exists(os.path.join(target, "mykey.py"))
    build_info_path = os.path.join(target, ".penglai-build.json")
    assert os.path.exists(build_info_path)
    with open(build_info_path, encoding="utf-8") as f:
        build_info = json.load(f)
    assert build_info["schema"] == 1
    assert build_info["source"] == "source"
    assert build_info["branch"] and build_info["branch"] != "unknown"
    assert build_info["commit"] and build_info["commit"] != "unknown"
    if os.path.exists(os.path.join(target, ".venv")):
        assert os.path.exists(os.path.join(target, ".venv", "bin", "python"))
    wrapper = os.path.join(td, ".local", "bin", "penglai")
    assert os.path.exists(wrapper)
    wrapper_verify = subprocess.run(
        [wrapper, "install-check", "--json"],
        cwd=target,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert wrapper_verify.returncode == 0, (wrapper_verify.stdout or "") + (wrapper_verify.stderr or "")
    assert "安装预检" in output
    verify = subprocess.run(
        [sys.executable, os.path.join(target, "penglai"), "install-check", "--json"],
        cwd=target,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert verify.returncode == 0, (verify.stdout or "") + (verify.stderr or "")
    data = json.loads(verify.stdout)
    assert data["ok"] is True
    assert data["root"] == os.path.realpath(target)
    version = subprocess.run(
        [sys.executable, os.path.join(target, "penglai"), "version"],
        cwd=target,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    version_output = (version.stdout or "") + (version.stderr or "")
    assert version.returncode == 0, version_output
    assert "branch=unknown" not in version_output
    assert "commit=unknown" not in version_output
    assert f"branch={build_info['branch']}" in version_output
    assert f"commit={build_info['commit']}" in version_output


def test_install_script_inherits_build_info_from_source_copy_without_git():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    td = tempfile.mkdtemp()
    source = os.path.join(td, "source")
    target = os.path.join(td, "target")
    os.makedirs(source, exist_ok=True)
    with open(os.path.join(source, "penglai"), "w", encoding="utf-8") as f:
        f.write("#!/usr/bin/env python3\nprint('minimal penglai')\n")
    with open(os.path.join(source, "agent_loop.py"), "w", encoding="utf-8") as f:
        f.write("# minimal source marker\n")
    with open(os.path.join(source, ".penglai-build.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "schema": 1,
                "source": "source",
                "branch": "codex/no-git-source",
                "commit": "fedcba987654",
                "dirty": False,
                "remote": "release",
                "remote_url": "https://example.invalid/PenglaiAgent.git",
                "build_commit": "fedcba987654",
                "build_time": "2026-06-23T00:00:00Z",
                "image_tag": "",
            },
            f,
        )
    env = os.environ.copy()
    for key in VERSION_ENV_KEYS:
        env.pop(key, None)
    env.update({
        "HOME": td,
        "PATH": os.path.dirname(sys.executable) + os.pathsep + env.get("PATH", ""),
        "PENGLAI_SOURCE_DIR": source,
        "PENGLAI_DIR": target,
        "PENGLAI_SKIP_SETUP": "1",
    })

    result = subprocess.run(
        ["sh", os.path.join(root, "install.sh")],
        cwd=td,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    output = (result.stdout or "") + (result.stderr or "")

    assert result.returncode == 0, output
    with open(os.path.join(target, ".penglai-build.json"), encoding="utf-8") as f:
        build_info = json.load(f)
    assert build_info["branch"] == "codex/no-git-source"
    assert build_info["commit"] == "fedcba987654"
    assert build_info["build_time"] == "2026-06-23T00:00:00Z"


def test_install_script_source_copy_rejects_non_empty_target():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    td = tempfile.mkdtemp()
    source = os.path.join(td, "source")
    target = os.path.join(td, "target")
    os.makedirs(source, exist_ok=True)
    os.makedirs(target, exist_ok=True)
    with open(os.path.join(source, "penglai"), "w", encoding="utf-8") as f:
        f.write("#!/usr/bin/env python3\nprint('minimal penglai')\n")
    with open(os.path.join(source, "agent_loop.py"), "w", encoding="utf-8") as f:
        f.write("# minimal source marker\n")
    with open(os.path.join(target, "penglai"), "w", encoding="utf-8") as f:
        f.write("#!/usr/bin/env python3\nprint('old penglai')\n")
    with open(os.path.join(target, "agent_loop.py"), "w", encoding="utf-8") as f:
        f.write("# old target marker\n")

    env = os.environ.copy()
    env.update({
        "HOME": td,
        "PATH": os.path.dirname(sys.executable) + os.pathsep + env.get("PATH", ""),
        "PENGLAI_SOURCE_DIR": source,
        "PENGLAI_DIR": target,
        "PENGLAI_SKIP_SETUP": "1",
    })

    result = subprocess.run(
        ["sh", os.path.join(root, "install.sh")],
        cwd=td,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    output = (result.stdout or "") + (result.stderr or "")

    assert result.returncode != 0
    assert "非空" in output
    with open(os.path.join(target, "agent_loop.py"), encoding="utf-8") as f:
        assert "old target marker" in f.read()


def test_update_preflight_blocks_active_legacy_runtime_paths():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    loader = importlib.machinery.SourceFileLoader(
        "penglai_cli_for_update_preflight_tests",
        os.path.join(root, "penglai"),
    )
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)

    def fake_sh(cmd, **kwargs):
        text = " ".join(str(part) for part in cmd)
        if "runtime-audit" in text:
            return type("Result", (), {
                "returncode": 0,
                "stdout": json.dumps({
                    "ok": False,
                    "active_blocker_count": 1,
                    "items": [{"item_id": "feishu_active_legacy_systemd", "status": "active_legacy_path"}],
                }),
                "stderr": "",
            })()
        return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    module.sh = fake_sh
    module.venv_python = lambda: sys.executable
    ok, detail = module._preflight()

    assert ok is False
    assert "旧 Runtime" in detail
    assert "feishu_active_legacy_systemd" in detail


def test_desktop_static_ui_uses_chinese_runtime_labels():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    static_dir = os.path.join(root, "frontends", "desktop", "static")
    with open(os.path.join(static_dir, "index.html"), "r", encoding="utf-8") as fh:
        index_html = fh.read()
    with open(os.path.join(static_dir, "app.js"), "r", encoding="utf-8") as fh:
        app_js = fh.read()
    with open(os.path.join(static_dir, "penglai-web.js"), "r", encoding="utf-8") as fh:
        bridge_js = fh.read()
    with open(os.path.join(static_dir, "styles.css"), "r", encoding="utf-8") as fh:
        styles_css = fh.read()

    assert '<html lang="zh-CN">' in index_html
    assert "desktop-tts-1" in index_html
    assert "penglai-web.js" in index_html
    assert "ga-web.js" not in index_html
    for text in ("蓬莱", "输入消息，或 /help", "中枢", "服务状态", "启动中枢服务", "停止中枢服务", "旧入口审计", "隐私审计", "会话状态", "运行记录", "设置", "朗读最近回复"):
        assert text in index_html
    for text in ("新任务", "思考中…", "中枢状态", "中枢桥接已就绪。", "发送此确认选择", "也可以直接在输入框回复。", "只会管理 penglai-runtime-hub", "中枢会话状态", "中枢运行记录", "等待确认", "语音转写", "语音输出", "speakLastAssistant", "synthesizeSpeech"):
        assert text in app_js
    for text in ("window.penglai", "window.__PENGLAI_BRIDGE_TOKEN__", "X-Penglai-Bridge-Token", "getRuntimeStatus", "getRuntimeRuns", "/runtime/status", "/runtime/runs", "/tts/say"):
        assert text in bridge_js
    assert "window.ga" not in bridge_js
    for text in ("permission-actions", "permission-choice-btn"):
        assert text in app_js or text in styles_css


def test_desktop_package_identity_targets_penglai_preview():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    desktop_dir = os.path.join(root, "frontends", "desktop")
    with open(os.path.join(desktop_dir, "package.json"), "r", encoding="utf-8") as fh:
        package_json = json.load(fh)
    with open(os.path.join(desktop_dir, "src-tauri", "tauri.conf.json"), "r", encoding="utf-8") as fh:
        tauri_conf = json.load(fh)
    with open(os.path.join(desktop_dir, "src-tauri", "Cargo.toml"), "r", encoding="utf-8") as fh:
        cargo_toml = fh.read()
    with open(os.path.join(desktop_dir, "src-tauri", "src", "lib.rs"), "r", encoding="utf-8") as fh:
        lib_rs = fh.read()

    assert package_json["name"] == "penglai-desktop"
    assert package_json["version"] == "0.3.0"
    assert tauri_conf["productName"] == "Penglai"
    assert tauri_conf["version"] == "0.3.0"
    assert tauri_conf["identifier"] == "com.penglai.agent"
    assert tauri_conf["app"]["windows"][0]["title"] == "蓬莱"
    assert tauri_conf["bundle"]["macOS"]["dmg"]["background"] == "icons/dmg-background.png"
    assert tauri_conf["bundle"]["macOS"]["dmg"]["appPosition"] == {"x": 180, "y": 230}
    assert tauri_conf["bundle"]["macOS"]["dmg"]["applicationFolderPosition"] == {"x": 480, "y": 230}
    assert os.path.exists(os.path.join(desktop_dir, "src-tauri", "icons", "dmg-background.png"))
    icon_path = os.path.join(desktop_dir, "src-tauri", "icons", "icon.png")
    assert os.path.exists(icon_path)
    try:
        from PIL import Image
        icon = Image.open(icon_path).convert("RGBA")
        pixels = list(icon.getdata())
        visible = [px for px in pixels if px[3] > 200]
        red_seal = [px for px in visible if px[0] > 130 and px[1] < 90 and px[2] < 90]
        dark_ga_base = [px for px in visible if px[0] < 45 and px[1] < 60 and px[2] < 85]
        assert len(red_seal) / float(len(pixels)) > 0.08
        assert len(dark_ga_base) / float(len(pixels)) < 0.01
    except ImportError:
        pass
    assert 'name = "penglai-desktop"' in cargo_toml
    assert 'version = "0.3.0"' in cargo_toml
    assert ".penglai_desktop_settings.json" in lib_rs
    assert "GenericAgent" not in json.dumps(tauri_conf)


def test_selfcheck_exercises_runtime_contracts():
    result = run_end_to_end_check()
    names = {item["name"]: item["ok"] for item in result["checks"]}

    assert result["ok"] is True
    assert names["owner_session_shared"] is True
    assert names["safe_files_sent"] is True
    assert names["sensitive_suffix_blocked"] is True
    assert names["external_receipt_skips_duplicate"] is True
    assert names["memory_rule_candidate"] is True
    assert names["permission_request_waits"] is True
    assert names["failure_status_recorded"] is True
    assert names["terminal_status_locked_and_fifo_promote"] is True
    assert names["control_ops_catalog"] is True
    assert names["control_ops_logs_redacted"] is True
    assert names["control_ops_static_checks"] is True
    assert names["legacy_deprecation_inventory_present"] is True
    assert names["privacy_audit_contract"] is True
    static = status(include_checks=False)
    assert static["contracts"]
    assert "RuntimeCapabilities" in static["contracts"]
    assert "TextToSpeechService" in static["contracts"]
    assert static["capabilities"]["voice"]["optional"] is True
    assert "components" in static["capabilities"]["voice"]
    assert static["capabilities"]["tts"]["provider"] == "moss-tts-nano"
    assert static["capabilities"]["tts"]["backend"] == "onnx-cpu"
    assert "components" in static["capabilities"]["tts"]


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
