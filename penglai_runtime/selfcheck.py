# -*- coding: utf-8 -*-
"""Self-check CLI for the Penglai runtime."""

import argparse
import json
import os
import tempfile

from . import VERSION
from .contracts import InboundEvent
from .delivery import DeliveryService
from .flags import runtime_enabled, shadow_enabled
from .hub import PenglaiRuntimeHub
from .interaction import InteractionRequest, InteractionOption, render_interaction_text, resolve_interaction_choice
from .memory_governor import MemoryGovernor
from .shadow import build_delivery_shadow_event


def _check(name, ok, detail=""):
    return {"name": name, "ok": bool(ok), "detail": str(detail or "")}


def run_end_to_end_check():
    """Run a side-effect-free runtime contract scenario.

    The check uses temporary files and an in-memory delivery adapter.  It does
    not call Feishu, WeChat, GA, or any network API.
    """
    tmp = tempfile.mkdtemp(prefix="penglai-runtime-")
    md = os.path.join(tmp, "report.md")
    pdf = os.path.join(tmp, "report.pdf")
    py = os.path.join(tmp, "should_block.py")
    os.makedirs(tmp, exist_ok=True)
    with open(md, "w", encoding="utf-8") as f:
        f.write("# Penglai runtime selfcheck\n")
    with open(pdf, "wb") as f:
        f.write(b"%PDF-1.4\n% Penglai runtime selfcheck\n")
    with open(py, "w", encoding="utf-8") as f:
        f.write("print('no leak')\n")

    sent_texts = []
    sent_files = []
    audits = []
    hub = PenglaiRuntimeHub(
        owner_user_ids={"owner"},
        runner=None,
    )
    hub.runner.delivery = DeliveryService(
        send_text=lambda text: sent_texts.append(text) or True,
        send_file=lambda path: sent_files.append(path) or True,
        audit=lambda event, payload, **kw: audits.append((event, payload, kw)),
    )

    owner_event = InboundEvent("e-owner-1", "feishu", "owner", "发给我", chat_id="owner-chat")
    first = hub.receive(
        owner_event,
        lambda _event: (
            "LLM Running (Turn 1) ...\n"
            "<summary>internal tool trace</summary>\n"
            "已生成\n"
            f"[FILE:{md}]\n"
            f"[FILE:{pdf}]\n"
            f"[FILE:{py}]"
        ),
        base_dir=tmp,
    )

    queued = hub.receive(
        InboundEvent("e-owner-2", "desktop", "owner", "第二条", chat_id="owner-chat"),
        lambda _event: "不应在忙碌时执行",
        base_dir=tmp,
    )
    promoted = hub.complete(first.session.session_id)
    hub.complete(first.session.session_id)

    group = hub.receive(
        InboundEvent("e-group", "feishu", "owner", "群里问", chat_id="group-1", chat_type="group"),
        lambda _event: "群会话独立",
        base_dir=tmp,
    )

    sent_files_before_receipt = list(sent_files)
    receipt = hub.receive(
        InboundEvent("e-receipt", "feishu", "owner", "发PDF", chat_id="owner-chat-2"),
        lambda _event: (
            "PDF 已通过飞书 API 发送成功\n"
            "file_key:file_v3_SELF_CHECK_000000000000\n"
            "message_id:om_SELF_CHECK_000000000000(code=0)\n"
            f"[FILE:{pdf}]"
        ),
        base_dir=tmp,
    )

    request = InteractionRequest(
        "今晚怎么安排？",
        (
            InteractionOption("A", "eat_out", "点外卖"),
            InteractionOption("B", "cook", "自己做饭"),
            InteractionOption("C", "later", "稍后再说"),
        ),
        request_id="selfcheck-card",
        title="选择测试",
    )
    rendered = render_interaction_text(request, include_click_hint=True)
    memory = MemoryGovernor()
    noisy_memory = memory.classify("LLM Running (Turn 1) ... <summary>工具流水</summary>")
    rule_memory = memory.classify("下次不要给我的飞书机器人发送升级指令，除非我本轮明确授权。")
    shadow = build_delivery_shadow_event(
        "feishu",
        f"token=abc123\n完成\n[FILE:{pdf}]\n[FILE:{py}]",
        receive_id="ou_real_user",
        receive_id_type="open_id",
        base_dir=tmp,
        production_text="Bearer live-token",
    )

    checks = [
        _check("owner_session_shared", first.session.session_id == "owner:default", first.session.session_id),
        _check("busy_owner_event_queued", queued.queued and queued.decision.queue_no == 1, queued.decision),
        _check("finish_promotes_fifo", promoted == queued.event, promoted),
        _check("group_session_isolated", group.session.session_id == "feishu:group:group-1", group.session.session_id),
        _check("output_cleaned", first.cleaned_output == f"已生成\n[FILE:{md}]\n[FILE:{pdf}]\n[FILE:{py}]", "runtime noise stripped; file markers preserved"),
        _check("safe_files_sent", set(sent_files_before_receipt) == {os.path.realpath(md), os.path.realpath(pdf)}, f"{len(sent_files_before_receipt)} safe files"),
        _check("sensitive_suffix_blocked", bool(first.delivery and first.delivery.plan.blocked), "sensitive suffix blocked"),
        _check("external_receipt_skips_duplicate", receipt.delivery.sent_paths == () and receipt.delivery.skipped_paths == (os.path.realpath(pdf),), "external receipt skipped duplicate auto-send"),
        _check("interaction_renders_buttons", "3. C: 稍后再说" in rendered and resolve_interaction_choice("B", request) == "cook", rendered),
        _check("memory_noise_not_written", noisy_memory.should_write is False, noisy_memory),
        _check("memory_rule_candidate", rule_memory.should_write and rule_memory.level in {"user_pref", "global_rule"}, rule_memory),
        _check("shadow_redacts_and_hashes", shadow["receive_id_hash"] != "ou_real_user" and "token=***" in shadow["text_preview"], "receive id hashed; token redacted"),
    ]
    return {
        "ok": all(item["ok"] for item in checks),
        "checks": checks,
        "temp_root": os.path.basename(tmp),
        "sent_text_count": len(sent_texts),
        "sent_file_count": len(sent_files),
        "audit_count": len(audits),
    }


def status(*, include_checks=True):
    data = {
        "version": VERSION,
        "runtime_enabled": runtime_enabled(),
        "shadow_enabled": shadow_enabled(),
        "contracts": [
            "InboundEvent",
            "SessionRouter",
            "SessionQueue",
            "AgentRunner",
            "PenglaiRuntimeHub",
            "ChannelRuntimeBridge",
            "DeliveryService",
            "InteractionRequest",
            "TextInteractionAdapter",
            "OutputCleaner",
            "MemoryGovernor",
            "InMemoryIMAdapter",
            "ShadowRecorder",
        ],
        "default_behavior": (
            "New-architecture wrappers/adapters integrate real channels; "
            "GA execution core stays upstream-first"
        ),
    }
    if include_checks:
        data["selfcheck"] = run_end_to_end_check()
        data["ok"] = data["selfcheck"]["ok"]
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description="Penglai runtime contract self-check")
    parser.add_argument("--json", action="store_true", help="print machine-readable status")
    parser.add_argument("--no-e2e", action="store_true", help="only print static contract status")
    args = parser.parse_args(argv)
    data = status(include_checks=not args.no_e2e)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"Penglai runtime self-check: {data['version']}")
        print(f"runtime enabled: {data['runtime_enabled']}")
        print(f"shadow enabled: {data['shadow_enabled']}")
        print("contracts: " + ", ".join(data["contracts"]))
        print(data["default_behavior"])
        if "selfcheck" in data:
            print(f"selfcheck ok: {data['selfcheck']['ok']}")
            for item in data["selfcheck"]["checks"]:
                marker = "OK" if item["ok"] else "FAIL"
                print(f"- {marker} {item['name']}")
    return 0 if data.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
