# -*- coding: utf-8 -*-
"""V5 runtime contracts stay side-effect free until explicitly integrated."""

import os
import json
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests

from penglai_runtime.contracts import InboundEvent
from penglai_runtime.delivery import DeliveryService, plan_delivery
from penglai_runtime.in_memory_im import InMemoryIMAdapter
from penglai_runtime.interaction import (
    InteractionRequest,
    callback_value,
    normalize_options,
    parse_callback_value,
    render_interaction_text,
    resolve_interaction_choice,
)
from penglai_runtime.output_cleaner import clean_final_text, has_internal_markup
from penglai_runtime.queueing import SessionQueue
from penglai_runtime.shadow import build_delivery_shadow_event, record_delivery_shadow, redact_text
from penglai_runtime.session import SessionRouter


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


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
