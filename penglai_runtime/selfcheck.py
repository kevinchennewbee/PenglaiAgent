# -*- coding: utf-8 -*-
"""Self-check CLI for the Penglai runtime."""

import argparse
import json
import os
import tempfile

from . import VERSION
from .capabilities import voice_runtime_status
from .contracts import InboundEvent, PermissionRequest, RunStatus
from .delivery import DeliveryService
from .flags import runtime_enabled, shadow_enabled
from .hub import PenglaiRuntimeHub
from .interaction import InteractionRequest, InteractionOption, render_interaction_text, resolve_interaction_choice
from .memory_governor import MemoryGovernor
from .port import CallableAgentPort, GenericAgentPort
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
    hub.complete(receipt.session.session_id)

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
    permission = hub.receive(
        InboundEvent("e-permission", "desktop", "owner", "确认外发", chat_id="owner-chat-3"),
        CallableAgentPort(
            lambda _event: PermissionRequest(
                action="send_file",
                prompt="允许发送 report.pdf 吗？",
                options=("allow", "deny"),
            ),
            worker_id="contract-worker",
        ),
        base_dir=tmp,
    )
    hub.complete(permission.session.session_id)

    failed = hub.receive(
        InboundEvent("e-failed", "desktop", "owner", "制造失败", chat_id="owner-chat-4"),
        CallableAgentPort(
            lambda _event: (_ for _ in ()).throw(RuntimeError("selfcheck failure path")),
            worker_id="contract-worker",
        ),
        base_dir=tmp,
    )
    hub.complete(failed.session.session_id)

    cancellable = hub.receive(
        InboundEvent("e-cancel-1", "desktop", "owner", "先占用", chat_id="owner-chat-5"),
        CallableAgentPort(lambda _event: "会被取消状态覆盖", worker_id="contract-worker"),
        base_dir=tmp,
    )
    queued_for_cancel = hub.receive(
        InboundEvent("e-cancel-2", "desktop", "owner", "排队项", chat_id="owner-chat-5"),
        CallableAgentPort(lambda _event: "不应立即运行", worker_id="contract-worker"),
        base_dir=tmp,
    )
    promoted_after_cancel = hub.cancel(cancellable.session.session_id)
    hub.cancel(cancellable.session.session_id, drop_pending=True)

    from . import control_api

    token_dir = tempfile.mkdtemp(prefix="penglai-runtime-control-")
    token_path = os.path.join(token_dir, "token")
    token, written_token_path = control_api.ensure_token(token_path)
    control_bind_ok = (
        bool(token)
        and control_api._is_loopback_host("127.0.0.1")
        and control_api._is_loopback_host("localhost")
    )
    non_loopback_rejected = not control_api._is_loopback_host("0.0.0.0")
    from . import service_unit
    from . import deprecations
    from . import privacy_audit
    ops_log_dir = os.path.join(tmp, "temp")
    os.makedirs(ops_log_dir, exist_ok=True)
    with open(os.path.join(ops_log_dir, "fsapp.log"), "w", encoding="utf-8") as f:
        f.write("connected\nAuthorization: Bearer live-token\napi_key='sk-" + ("z" * 32) + "'\n")
    ops_catalog = control_api.command_catalog()
    ops_log = control_api.read_ops_logs("feishu", root=tmp, lines=5)
    ops_static = control_api.ops_checks(root=tmp)

    unit = service_unit.systemd_unit(
        root=os.path.dirname(os.path.dirname(os.path.realpath(__file__))),
        python="python",
        user="penglai",
        home="/home/penglai",
        port=18765,
    )
    plist = service_unit.launchd_plist(
        root=os.path.dirname(os.path.dirname(os.path.realpath(__file__))),
        python="python",
        home="/Users/penglai",
        port=18766,
    )
    service_units_local_only = (
        "runtime-serve --host 127.0.0.1 --port 18765" in unit
        and "Restart=always" in unit
        and plist["ProgramArguments"][-4:] == ["--host", "127.0.0.1", "--port", "18766"]
        and plist["KeepAlive"] is True
    )
    legacy_audit = deprecations.audit(include_runtime=False)
    secret_sample = os.path.join(tmp, "secret_sample.py")
    with open(secret_sample, "w", encoding="utf-8") as f:
        f.write("api_key = 'sk-' + 'x' * 32\n")
    secret_text = "api_key = '" + "sk-" + ("x" * 32) + "'\n"
    secret_hits = privacy_audit.scan_text_for_secrets(secret_text)
    private_kind = privacy_audit.classify_private_path("_internal/030root.md")

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
        _check("taskrun_success_status", first.task_run.status == RunStatus.SUCCEEDED, first.task_run.status),
        _check("agent_port_worker_recorded", permission.task_run.worker_id == "contract-worker", permission.task_run.worker_id),
        _check("permission_request_waits", permission.task_run.status == RunStatus.WAITING_PERMISSION and permission.task_run.permission.action == "send_file", permission.task_run),
        _check("failure_status_recorded", failed.task_run.status == RunStatus.FAILED and "selfcheck failure path" in failed.task_run.error, failed.task_run),
        _check("cancel_status_and_fifo_promote", cancellable.task_run.status == RunStatus.CANCELLED and promoted_after_cancel == queued_for_cancel.event, cancellable.task_run),
        _check("control_api_token_file", bool(token) and written_token_path == token_path and os.path.exists(token_path), written_token_path),
        _check("control_api_loopback_only", control_bind_ok and non_loopback_rejected, "loopback policy verified without socket bind"),
        _check(
            "control_ops_catalog",
            "doctor" in ops_catalog["read_only"]
            and "runtime-service-status" in ops_catalog["read_only"]
            and "runtime-service-install" in ops_catalog["state_changing"]
            and "runtime-service-uninstall" in ops_catalog["state_changing"]
            and "setup" in ops_catalog["not_exposed"]
            and "restart" in ops_catalog["not_exposed"],
            ops_catalog,
        ),
        _check("control_ops_logs_redacted", ops_log["ok"] and "Bearer live-token" not in ops_log["text"] and "sk-" + ("z" * 32) not in ops_log["text"], "desktop ops logs are local and redacted"),
        _check("control_ops_static_checks", "privacy_audit" in ops_static and "runtime_audit" in ops_static and "RuntimeControlAPI" in ops_static["selfcheck"]["contracts"], "desktop ops dashboard checks are structured"),
        _check("runtime_service_units_local_only", service_units_local_only, "systemd/launchd runtime-serve units bind 127.0.0.1"),
        _check("legacy_deprecation_inventory_present", legacy_audit["item_count"] >= 5, f"{legacy_audit['item_count']} legacy/deprecation items"),
        _check("privacy_audit_contract", bool(private_kind) and bool(secret_hits), "private paths and secret-like values are detected without printing values"),
    ]
    return {
        "ok": all(item["ok"] for item in checks),
        "checks": checks,
        "temp_root": os.path.basename(tmp),
        "sent_text_count": len(sent_texts),
        "sent_file_count": len(sent_files),
        "audit_count": len(audits),
    }


def check_real_agent_port_available():
    """Check whether the real GA port can initialize on this machine."""
    try:
        port = GenericAgentPort(timeout=1)
        agent = port._ensure_agent()
        return _check(
            "real_agent_port_available",
            bool(getattr(agent, "llmclients", None)),
            "GenericAgentPort initialized",
        )
    except Exception as e:
        return _check("real_agent_port_available", False, str(e))


def status(*, include_checks=True):
    data = {
        "version": VERSION,
        "runtime_enabled": runtime_enabled(),
        "shadow_enabled": shadow_enabled(),
        "contracts": [
            "InboundEvent",
            "SessionRouter",
            "SessionQueue",
            "PermissionRequest",
            "TaskRun",
            "RunStatus",
            "AgentPort",
            "AgentRunner",
            "PenglaiRuntimeHub",
            "RuntimeHubService",
            "RuntimeStateStore",
            "RuntimeControlAPI",
            "RuntimeOpsControl",
            "RuntimeServiceUnit",
            "RuntimeDeprecationAudit",
            "RuntimePrivacyAudit",
            "RuntimeInstallCheck",
            "RuntimeCapabilities",
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
            "新架构 wrapper/adapter 接入真实渠道；GA 执行核心保持上游优先"
        ),
        "capabilities": {
            "voice": voice_runtime_status(),
        },
    }
    if include_checks:
        data["selfcheck"] = run_end_to_end_check()
        data["real_agent_port"] = check_real_agent_port_available()
        data["ok"] = data["selfcheck"]["ok"] and data["real_agent_port"]["ok"]
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description="蓬莱中枢契约自检")
    parser.add_argument("--json", action="store_true", help="输出机器可读状态")
    parser.add_argument("--no-e2e", action="store_true", help="只输出静态契约状态")
    args = parser.parse_args(argv)
    data = status(include_checks=not args.no_e2e)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"蓬莱中枢自检：{data['version']}")
        print(f"中枢启用：{data['runtime_enabled']}")
        print(f"影子记录启用：{data['shadow_enabled']}")
        print("契约：" + ", ".join(data["contracts"]))
        print(data["default_behavior"])
        if "selfcheck" in data:
            print(f"自检通过：{data['selfcheck']['ok']}")
            for item in data["selfcheck"]["checks"]:
                marker = "通过" if item["ok"] else "失败"
                print(f"- {marker} {item['name']}")
    return 0 if data.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
