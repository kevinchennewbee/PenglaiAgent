# -*- coding: utf-8 -*-
"""Low-side-effect audit of 0.3.0 legacy runtime paths."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
from dataclasses import asdict, dataclass


ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


@dataclass(frozen=True)
class LegacyPath:
    item_id: str
    priority: str
    surface: str
    legacy: str
    replacement: str
    status: str
    reason: str

    def to_dict(self):
        return asdict(self)


STATIC_PATHS = (
    LegacyPath(
        "feishu_legacy_entry",
        "P0",
        "feishu",
        "frontends/fsapp.py",
        "penglai_feishu_app.py -> RuntimeHubService",
        "deprecated_runtime_entry",
        "飞书在 0.3.0 必须从 wrapper 层进入，让 Runtime Hub 统一拥有 session、queue、permission 和 TaskRun 状态。",
    ),
    LegacyPath(
        "wechat_legacy_entry",
        "P0",
        "wechat",
        "frontends/wechatapp.py",
        "penglai_im_launch.py wechat -> RuntimeHubService",
        "deprecated_runtime_entry",
        "微信在 0.3.0 灰度验证后不能保留一条并行直连 GA 路径。",
    ),
    LegacyPath(
        "shared_im_direct_put_task",
        "P0",
        "im-shared",
        "frontends/chatapp_common.py direct agent.put_task",
        "ChannelRuntimeBridge / RuntimeHubService",
        "deprecated_pattern",
        "共享 IM helper 可为上游兼容保留，但新的蓬莱平台路径不能在这里再建第二套 session queue。",
    ),
    LegacyPath(
        "desktop_bridge_direct_ga",
        "P1",
        "desktop",
        "frontends/desktop_bridge.py pre-0.3 direct GA calls",
        "frontends/desktop_bridge.py -> RuntimeHubService -> GenericAgentInstancePort",
        "runtime_wrapped_adapter",
        "桌面 bridge 的 prompt 执行已进入 Runtime Hub；保留该审计项防止桌面直连 GA runtime 回流。",
    ),
    LegacyPath(
        "upstream_reference_tui",
        "observe",
        "tui",
        "frontends/tuiapp_v2.py / frontends/tui_v3.py direct GA paths",
        "Penglai TUI adapter through RuntimeHubService",
        "reference_console",
        "GA 原生 TUI 可作为参考控制台保留，但不要扩展成蓬莱产品 runtime。",
    ),
    LegacyPath(
        "companion_reflect_runtime_event",
        "P0",
        "proactive-companion",
        "agentmain.py --reflect reflect/penglai_companion.py legacy on_done generation",
        "reflect/penglai_companion.py run_runtime_task -> RuntimeHubService -> TaskRun -> DeliveryService",
        "runtime_wrapped_service_event",
        "主动陪伴已保留 opt-in/门禁，但生成、终态、投递结果和上下文账本必须作为 Runtime Hub 服务事件审计。",
    ),
    LegacyPath(
        "scheduler_reflect_legacy_task",
        "P1",
        "scheduler",
        "agentmain.py --reflect reflect/scheduler.py -> agent.put_task(source='reflect')",
        "scheduled service event -> RuntimeHubService -> TaskRun -> report/delivery outcome",
        "pending_runtime_service_migration",
        "提醒/日程仍是 reflect 旧执行链；当前不作为本轮 P0 修复，但必须在下一步收敛成可审计 TaskRun。",
    ),
)


DOCKER_SURFACES = (
    "Dockerfile",
    "docker-compose.yml",
    "docker-entrypoint.sh",
    "docker-install.sh",
    ".github/workflows/docker-image.yml",
    "README.md",
    "README_EN.md",
)


def _run(cmd, *, root=ROOT):
    try:
        return subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=5)
    except Exception as exc:
        return subprocess.CompletedProcess(cmd, 1, "", str(exc))


def _systemd_exec(service):
    if not shutil.which("systemctl"):
        return ""
    r = _run(["systemctl", "show", "-p", "ExecStart", "--value", service])
    return (r.stdout or "").strip() if r.returncode == 0 else ""


def _argv_has_script(command, script_rel):
    script_rel = script_rel.replace("\\", "/")
    try:
        argv = shlex.split(command)
    except ValueError:
        argv = command.split()
    for arg in argv[1:]:
        if arg in {"-c", "-m"}:
            return False
        if arg.startswith("-"):
            continue
        normalized = arg.replace("\\", "/")
        if normalized == script_rel or normalized.endswith("/" + script_rel):
            return True
        return False
    return False


def _python_script_processes(script_rel):
    r = _run(["ps", "-axo", "pid=,comm=,command="])
    if r.returncode != 0:
        return []
    matches = []
    for line in (r.stdout or "").splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid, comm, command = parts
        exe = os.path.basename(comm).lower()
        if not (exe == "python" or exe.startswith("python")):
            continue
        if _argv_has_script(command, script_rel):
            matches.append(f"{pid} {command}")
    return matches


def _docker_public_claims(root=ROOT):
    claims = []
    positive_patterns = (
        "docker-install",
        "docker compose",
        "docker-compose",
        "docker deployment",
        "docker 部署",
        "docker 容器",
        "| docker |",
        "docker:",
        "docker：",
        "production-grade docker",
        "正式产品",
    )
    for rel in ("README.md", "README_EN.md"):
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        lowered = text.lower()
        if any(pattern in lowered for pattern in positive_patterns):
            claims.append(rel)
    return claims


def audit(*, root=ROOT, include_runtime=True):
    items = [item.to_dict() for item in STATIC_PATHS]

    if include_runtime:
        feishu_exec = _systemd_exec("penglai-feishu")
        if "frontends/fsapp.py" in feishu_exec:
            items.append({
                "item_id": "feishu_active_legacy_systemd",
                "priority": "P0",
                "surface": "feishu",
                "legacy": feishu_exec,
                "replacement": "penglai_feishu_app.py",
                "status": "active_legacy_path",
                "reason": "当前飞书 systemd unit 仍指向旧入口。",
            })
        if _python_script_processes("frontends/fsapp.py"):
            items.append({
                "item_id": "feishu_active_legacy_process",
                "priority": "P0",
                "surface": "feishu",
                "legacy": "frontends/fsapp.py process",
                "replacement": "penglai_feishu_app.py",
                "status": "active_legacy_path",
                "reason": "运行中的飞书旧进程会绕过 wrapper 迁移。",
            })
        wechat_exec = _systemd_exec("penglai-wechat")
        if "frontends/wechatapp.py" in wechat_exec:
            items.append({
                "item_id": "wechat_active_legacy_systemd",
                "priority": "P0",
                "surface": "wechat",
                "legacy": wechat_exec,
                "replacement": "penglai_im_launch.py wechat",
                "status": "active_legacy_path",
                "reason": "当前微信 systemd unit 仍指向旧入口。",
            })
        if _python_script_processes("frontends/wechatapp.py"):
            items.append({
                "item_id": "wechat_active_legacy_process",
                "priority": "P0",
                "surface": "wechat",
                "legacy": "frontends/wechatapp.py process",
                "replacement": "penglai_im_launch.py wechat",
                "status": "active_legacy_path",
                "reason": "运行中的微信旧进程会绕过 wrapper 迁移。",
            })

    docker_files = [rel for rel in DOCKER_SURFACES if os.path.exists(os.path.join(root, rel))]
    docker_claims = _docker_public_claims(root)
    if docker_claims:
        items.append({
            "item_id": "docker_legacy_surface",
            "priority": "P1",
            "surface": "install-release",
            "legacy": ", ".join(docker_files),
            "replacement": "0.3.0 不以 Docker 作为安装、发布或验证目标",
            "status": "release_blocker_before_public_docs",
            "reason": (
                "Docker 文件视为 0.2.x 遗留面。任何 0.3.0 发布前都必须清理公开 README/发布文案。"
                f" 当前公开 Docker 表述：{', '.join(docker_claims)}。"
            ),
        })
    elif docker_files:
        items.append({
            "item_id": "docker_legacy_surface",
            "priority": "observe",
            "surface": "install-release",
            "legacy": ", ".join(docker_files),
            "replacement": "0.3.0 不以 Docker 作为安装、发布或验证目标",
            "status": "legacy_surface_observed",
            "reason": "Docker 文件仍作为 0.2.x 遗留面存在，但公开 README 未把它写成 0.3.0 安装或验证路径。",
        })

    active_blockers = [item for item in items if item.get("status") == "active_legacy_path"]
    return {
        "ok": not active_blockers,
        "active_blocker_count": len(active_blockers),
        "item_count": len(items),
        "items": items,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="审计蓬莱 0.3.0 旧 Runtime 入口")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--no-runtime", action="store_true", help="跳过进程/systemd 探测")
    args = parser.parse_args(argv)
    data = audit(include_runtime=not args.no_runtime)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"旧 Runtime 入口审计：{'通过' if data['ok'] else '阻断'}")
        for item in data["items"]:
            print(f"- {item['priority']} {item['item_id']}: {item['status']}")
            print(f"  旧入口：{item['legacy']}")
            print(f"  替代路径：{item['replacement']}")
    return 0 if data["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
