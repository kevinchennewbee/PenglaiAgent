# -*- coding: utf-8 -*-
"""V5 runtime contracts stay side-effect free until explicitly integrated."""

import os
import json
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests

from penglai_runtime.contracts import InboundEvent
from penglai_runtime.delivery import plan_delivery
from penglai_runtime.fake_im import FakeIMAdapter
from penglai_runtime.output_cleaner import clean_final_text
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


def test_fake_im_adapter_records_delivery_without_real_network():
    td = tempfile.mkdtemp()
    out = os.path.join(td, "deck.pdf")
    open(out, "wb").write(b"%PDF")
    adapter = FakeIMAdapter(owner_user_ids={"owner"})
    event = InboundEvent("e1", "feishu", "owner", "发给我")

    session, decision = adapter.receive(event)
    plan = adapter.deliver(f"好了\n[FILE:{out}]")

    assert session.session_id == "owner:default"
    assert decision.started_now is True
    assert adapter.sent_texts == ["好了"]
    assert adapter.sent_files == [os.path.realpath(out)]
    assert plan.has_work is True


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
