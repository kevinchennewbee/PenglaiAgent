# -*- coding: utf-8 -*-
"""Low-side-effect source install checks for Penglai 0.3.0."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass

from . import VERSION
from .version import collect_version_metadata


ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


REQUIRED_SOURCE_FILES = (
    "penglai",
    "agentmain.py",
    "agent_loop.py",
    "install.sh",
    "installer/pyproject.toml",
    "penglai_runtime/capabilities.py",
    "penglai_runtime/contracts.py",
    "penglai_runtime/service.py",
    "penglai_runtime/control_api.py",
    "penglai_runtime/privacy_audit.py",
)


@dataclass(frozen=True)
class InstallCheck:
    name: str
    ok: bool
    detail: str = ""

    def to_dict(self):
        return asdict(self)


def _check(name, ok, detail=""):
    return InstallCheck(name=name, ok=bool(ok), detail=str(detail or "")).to_dict()


def _run(cmd, *, root=ROOT, timeout=30):
    try:
        return subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
    except Exception as exc:
        return subprocess.CompletedProcess(cmd, 1, "", str(exc))


def _service_python(root):
    candidates = (
        os.path.join(root, ".venv", "bin", "python"),
        os.path.join(root, ".venv", "Scripts", "python.exe"),
        sys.executable,
    )
    for path in candidates:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return sys.executable


def _python_check(root):
    python = _service_python(root)
    r = _run(
        [python, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"],
        root=root,
        timeout=20,
    )
    version = (r.stdout or "").strip() or "?"
    try:
        ok = tuple(int(x) for x in version.split(".")[:2]) >= (3, 10)
    except Exception:
        ok = False
    rel = os.path.relpath(python, root) if python.startswith(root + os.sep) else python
    return _check("python_310_plus", r.returncode == 0 and ok, f"{version} ({rel})")


def _required_files(root):
    missing = [rel for rel in REQUIRED_SOURCE_FILES if not os.path.exists(os.path.join(root, rel))]
    return _check("source_files_present", not missing, ", ".join(missing) if missing else "必需源码文件齐全")


def _version_check(root):
    meta = collect_version_metadata(root=root)
    ok = meta.version == VERSION == "0.3.0"
    return _check(
        "version_is_030",
        ok,
        f"installer={meta.version} runtime={VERSION} branch={meta.branch} commit={meta.commit} source={meta.source}",
    )


def _cli_version_check(root):
    cli = os.path.join(root, "penglai")
    r = _run([_service_python(root), cli, "version"], root=root, timeout=20)
    text = ((r.stdout or "") + (r.stderr or "")).strip()
    return _check("cli_version_runs", r.returncode == 0 and "Penglai 0.3.0" in text, text.splitlines()[0] if text else f"rc={r.returncode}")


def _runtime_contract_check():
    try:
        from .selfcheck import run_end_to_end_check

        result = run_end_to_end_check()
        names = {item["name"]: item["ok"] for item in result.get("checks", [])}
        needed = (
            "owner_session_shared",
            "permission_request_waits",
            "failure_status_recorded",
            "cancel_status_and_fifo_promote",
            "control_ops_catalog",
            "privacy_audit_contract",
        )
        missing = [name for name in needed if not names.get(name)]
        return _check("runtime_contracts_pass", bool(result.get("ok")) and not missing, ", ".join(missing) if missing else "Runtime Hub 契约通过")
    except Exception as exc:
        return _check("runtime_contracts_pass", False, str(exc))


def _privacy_check(root):
    try:
        from .privacy_audit import audit as privacy_audit

        result = privacy_audit(root=root, include_ignored=True, scan_ignored=False, strict_release=False)
        return _check(
            "privacy_audit_passes",
            bool(result.get("privacy_ok")),
            f"隐私阻断项={result.get('privacy_blocker_count')} 发布就绪={result.get('release_ready')}",
        )
    except Exception as exc:
        return _check("privacy_audit_passes", False, str(exc))


def _runtime_audit_check(root):
    try:
        from .deprecations import audit as runtime_audit

        result = runtime_audit(root=root, include_runtime=False)
        return _check(
            "runtime_audit_inventory_ready",
            bool(result.get("ok")) and result.get("item_count", 0) >= 5,
            f"条目={result.get('item_count')} 活跃阻断项={result.get('active_blocker_count')}",
        )
    except Exception as exc:
        return _check("runtime_audit_inventory_ready", False, str(exc))


def _optional_voice_check():
    try:
        from .capabilities import voice_runtime_status

        result = voice_runtime_status()
        return _check("optional_voice_runtime_status", True, f"{result.get('status')}: {result.get('detail')}")
    except Exception as exc:
        return _check("optional_voice_runtime_status", False, str(exc))


def _optional_tts_check():
    try:
        from .capabilities import tts_runtime_status

        result = tts_runtime_status()
        return _check("optional_tts_runtime_status", True, f"{result.get('status')}: {result.get('detail')}")
    except Exception as exc:
        return _check("optional_tts_runtime_status", False, str(exc))


def _optional_vision_check(root):
    try:
        from .capabilities import vision_runtime_status

        result = vision_runtime_status(root=root)
        return _check("optional_vision_runtime_status", True, f"{result.get('status')}: {result.get('detail')}")
    except Exception as exc:
        return _check("optional_vision_runtime_status", False, str(exc))


def _optional_critic_check(root):
    try:
        from .capabilities import critic_runtime_status

        result = critic_runtime_status(root=root)
        return _check("optional_critic_runtime_status", True, f"{result.get('status')}: {result.get('detail')}")
    except Exception as exc:
        return _check("optional_critic_runtime_status", False, str(exc))


def _service_unit_check(root):
    try:
        from .service_unit import launchd_plist, systemd_unit

        unit = systemd_unit(root=root, python=sys.executable, user="penglai", home="/home/penglai", port=18765)
        plist = launchd_plist(root=root, python=sys.executable, home="/Users/penglai", port=18766)
        ok = (
            "runtime-serve --host 127.0.0.1 --port 18765" in unit
            and "Restart=always" in unit
            and "Docker" not in unit
            and "docker" not in unit
            and plist["ProgramArguments"][-4:] == ["--host", "127.0.0.1", "--port", "18766"]
            and plist["KeepAlive"] is True
        )
        return _check("service_units_localhost_only", ok, "systemd/launchd 中枢服务只监听本机")
    except Exception as exc:
        return _check("service_units_localhost_only", False, str(exc))


def _install_script_check(root):
    path = os.path.join(root, "install.sh")
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError as exc:
        return _check("install_script_branch_test_mode", False, str(exc))
    required = (
        "PENGLAI_SOURCE_DIR",
        "PENGLAI_SKIP_SETUP",
        "PENGLAI_INSTALL_VERIFY",
        "requests",
        "beautifulsoup4",
        "bottle",
        "aiohttp",
        "lark-oapi",
        "qrcode",
        "pillow",
        "pyyaml",
        ".venv/bin/python",
    )
    missing = [token for token in required if token not in text]
    private_excludes = all(token in text for token in ("--exclude=.git", "--exclude=mykey.py", "--exclude=_internal"))
    return _check(
        "install_script_branch_test_mode",
        not missing and private_excludes,
        "分支源码安装模式就绪" if not missing and private_excludes else f"缺失={missing} 私有排除={private_excludes}",
    )


def _real_agent_check():
    try:
        from .selfcheck import check_real_agent_port_available

        item = check_real_agent_port_available()
        return _check("real_agent_available", bool(item.get("ok")), item.get("detail", ""))
    except Exception as exc:
        return _check("real_agent_available", False, str(exc))


def audit(*, root=ROOT, require_real_agent=False):
    root = os.path.realpath(root)
    checks = [
        _python_check(root),
        _required_files(root),
        _version_check(root),
        _cli_version_check(root),
        _runtime_contract_check(),
        _privacy_check(root),
        _runtime_audit_check(root),
        _optional_voice_check(),
        _optional_tts_check(),
        _optional_vision_check(root),
        _optional_critic_check(root),
        _service_unit_check(root),
        _install_script_check(root),
    ]
    if require_real_agent:
        checks.append(_real_agent_check())
    failed = [item for item in checks if not item.get("ok")]
    return {
        "ok": not failed,
        "root": root,
        "version": VERSION,
        "require_real_agent": bool(require_real_agent),
        "failed_count": len(failed),
        "checks": checks,
    }


def _print_text(data):
    print(f"安装预检：{'通过' if data['ok'] else '失败'}")
    print(f"项目目录：{data['root']}")
    for item in data["checks"]:
        mark = "✅" if item["ok"] else "❌"
        print(f"{mark} {item['name']}: {item.get('detail', '')}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="检查蓬莱 0.3.0 源码安装")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--root", default=ROOT, help="项目目录")
    parser.add_argument("--require-real-agent", action="store_true", help="同时要求真实 GA/LLM 配置可初始化")
    args = parser.parse_args(argv)
    data = audit(root=args.root, require_real_agent=args.require_real_agent)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        _print_text(data)
    return 0 if data["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
