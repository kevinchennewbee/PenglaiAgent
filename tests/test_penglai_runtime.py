# -*- coding: utf-8 -*-
"""Penglai runtime contracts stay side-effect free until explicitly integrated."""

import os
import asyncio
import importlib
import json
import queue as Q
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests

from penglai_runtime.contracts import InboundEvent
from penglai_runtime.channel_runtime import ChannelRuntimeBridge, install_channel_runtime_adapter
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
from penglai_runtime.queueing import SessionQueue
from penglai_runtime.redaction import contains_secret, redact_json, redact_text as runtime_redact_text
from penglai_runtime.runner import AgentRunner
from penglai_runtime.shadow import build_delivery_shadow_event, record_delivery_shadow, redact_text
from penglai_runtime.session import SessionRouter
from penglai_runtime.selfcheck import run_end_to_end_check, status
from penglai_runtime.version import collect_version_metadata, compact_version_line
from penglai_runtime import VERSION
from penglai_runtime.text_interaction import install_text_interaction_adapter


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
        app = FakeApp()
        assert install_channel_runtime_adapter(app, channel="fake", owner_user_ids={"owner"}) is True
        await app.run_agent("owner", "ask", msg_id="m1")
        assert "选一个" in app.sent[-1][2]
        assert app._penglai_runtime_bridge.last_sessions["owner"].session_id == "owner:default"
        await app.run_agent("owner", "2", msg_id="m2")
        assert app.agent.prompts[-1] == (app._penglai_runtime_bridge.prompt("B"), "fake")
        assert app.sent[-1] == ("done", "owner", "完成", {"msg_id": "m2"})
        assert app._penglai_runtime_bridge.memory_decisions

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
            self.user_tasks = {"owner:default": {"running": True}}
            self.sent = []

        async def send_text(self, chat_id, content, **ctx):
            self.sent.append((chat_id, content))

        async def send_done(self, chat_id, raw_text, **ctx):
            self.sent.append((chat_id, raw_text))

        async def run_agent(self, chat_id, text, **ctx):
            raise AssertionError("busy session should queue, not run immediately")

    async def scenario():
        app = FakeApp()
        assert install_channel_runtime_adapter(app, channel="fake", owner_user_ids={"owner"}) is True
        await app.run_agent("owner", "second")
        assert app._penglai_runtime_bridge.pending_messages["owner:default"][0][1] == "second"
        assert "已收到" in app.sent[-1][1]

    asyncio.run(scenario())


def test_launch_paths_do_not_bypass_runtime_wrappers():
    import penglai_channels

    for channel in ("wechat", "dingtalk", "qq", "wecom"):
        argv = penglai_channels._launch_argv(channel)
        assert os.path.basename(argv[1]) == "penglai_im_launch.py"
        assert argv[-1] == channel
        assert penglai_channels._proc_pattern(channel) == f"penglai_im_launch.py {channel}"

    assert os.path.basename(penglai_channels._launch_argv("feishu")[1]) == "penglai_feishu_app.py"

    launch_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "launch.pyw")
    with open(launch_path, encoding="utf-8") as f:
        launch_text = f.read()
    assert "wechatapp.py" not in launch_text
    assert "fsapp.py" not in launch_text
    assert launch_text.count("penglai_im_launch.py") >= 4
    assert "penglai_feishu_app.py" in launch_text


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
        log_path=log_path,
    )

    prompt = recent_context_prompt(log_path=log_path)

    assert "companion_sent" in prompt
    assert "token=***" in prompt
    assert "abc12345" not in prompt
    assert "ou_real" not in prompt


def test_version_metadata_uses_installer_version_and_git_identity():
    meta = collect_version_metadata()
    line = compact_version_line(meta)

    assert meta.version == VERSION
    assert f"Penglai {VERSION}" in line
    assert meta.commit


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


def test_selfcheck_exercises_runtime_contracts():
    result = run_end_to_end_check()
    names = {item["name"]: item["ok"] for item in result["checks"]}

    assert result["ok"] is True
    assert names["owner_session_shared"] is True
    assert names["safe_files_sent"] is True
    assert names["sensitive_suffix_blocked"] is True
    assert names["external_receipt_skips_duplicate"] is True
    assert names["memory_rule_candidate"] is True
    assert status(include_checks=False)["contracts"]


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
