# -*- coding: utf-8 -*-
"""Headless process supervision for the Penglai Feishu channel wrapper.

The Feishu wrapper remains a channel adapter into Runtime Hub. systemd is only
one Linux/headless way to keep that adapter process running and to run a real
gray probe under the same daemon shape.
"""

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import time

from . import VERSION


SERVICE_NAME = "penglai-feishu"
GRAY_SERVICE_NAME = "penglai-feishu-030-gray"


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def venv_python(root=None):
    base = root or repo_root()
    path = os.path.join(base, ".venv", "bin", "python")
    return path if os.path.exists(path) else sys.executable


def has_systemd():
    return shutil.which("systemctl") is not None


def _quote(value):
    return shlex.quote(str(value))


def _run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def _unit_path(service_name):
    return f"/etc/systemd/system/{service_name}.service"


def systemd_unit(
    *,
    root=None,
    python=None,
    user=None,
    home=None,
    service_name=SERVICE_NAME,
    gray_probe=False,
    gray_wait=120,
    gray_send_prompt=False,
    gray_nonce="",
    gray_target_open_id="",
):
    root = os.path.realpath(root or repo_root())
    python = python or venv_python(root)
    user = user or os.environ.get("USER") or "root"
    home = home or os.path.expanduser("~")
    work = os.path.join(home, "penglai-work")
    env_sh = os.path.join(root, "env.sh")
    args = []
    restart = "always"
    restart_sec = "20"
    if gray_probe:
        args.extend(["--gray-probe", "--gray-wait", str(float(gray_wait))])
        if gray_send_prompt:
            args.append("--gray-send-prompt")
        if gray_nonce:
            args.extend(["--gray-nonce", str(gray_nonce)])
        if gray_target_open_id:
            args.extend(["--gray-target-open-id", str(gray_target_open_id)])
        restart = "no"
        restart_sec = "1"
    arg_text = " ".join(_quote(x) for x in args)
    exec_cmd = f"{_quote(python)} {_quote(os.path.join(root, 'penglai_feishu_app.py'))}"
    if arg_text:
        exec_cmd += " " + arg_text
    return (
        "[Unit]\n"
        f"Description=Penglai Feishu Channel Adapter {VERSION} ({service_name})\n"
        "After=network-online.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"User={user}\n"
        f"WorkingDirectory={root}\n"
        f"Environment=HOME={home}\n"
        f"Environment=GA_WORKSPACE_ROOT={work}\n"
        "Environment=PYTHONUNBUFFERED=1\n"
        f"ExecStartPre=/bin/bash -lc 'source {_quote(env_sh)} 2>/dev/null || true; {_quote(python)} {_quote(os.path.join(root, 'penglai'))} _guardcheck'\n"
        f"ExecStart=/bin/bash -lc 'source {_quote(env_sh)} 2>/dev/null || true; exec {exec_cmd}'\n"
        f"Restart={restart}\n"
        f"RestartSec={restart_sec}\n\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )


def install_systemd(
    *,
    root=None,
    service_name=SERVICE_NAME,
    gray_probe=False,
    gray_wait=120,
    gray_send_prompt=False,
    gray_nonce="",
    gray_target_open_id="",
    dry_run=False,
):
    root = os.path.realpath(root or repo_root())
    unit = systemd_unit(
        root=root,
        service_name=service_name,
        gray_probe=gray_probe,
        gray_wait=gray_wait,
        gray_send_prompt=gray_send_prompt,
        gray_nonce=gray_nonce,
        gray_target_open_id=gray_target_open_id,
    )
    path = _unit_path(service_name)
    if dry_run:
        return {"ok": True, "kind": "systemd", "service": service_name, "path": path, "content": unit}
    subprocess.run(["sudo", "tee", path], input=unit, text=True, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
    if gray_probe:
        subprocess.run(["sudo", "systemctl", "reset-failed", service_name], check=False)
        subprocess.run(["sudo", "systemctl", "start", service_name], check=True)
    else:
        subprocess.run(["sudo", "systemctl", "enable", "--now", service_name], check=True)
    return {"ok": True, "kind": "systemd", "service": service_name, "gray_probe": bool(gray_probe)}


def uninstall_systemd(*, service_name=SERVICE_NAME):
    subprocess.run(["sudo", "systemctl", "disable", "--now", service_name], check=False)
    subprocess.run(["sudo", "rm", "-f", _unit_path(service_name)], check=True)
    subprocess.run(["sudo", "systemctl", "daemon-reload"], check=False)
    return {"ok": True, "kind": "systemd", "service": service_name}


def status_systemd(*, service_name=SERVICE_NAME):
    active = _run(["systemctl", "is-active", service_name]).stdout.strip()
    enabled = _run(["systemctl", "is-enabled", service_name]).stdout.strip()
    result = _run(["systemctl", "show", "-p", "Result", "--value", service_name]).stdout.strip()
    exit_status = _run(["systemctl", "show", "-p", "ExecMainStatus", "--value", service_name]).stdout.strip()
    return {
        "kind": "systemd",
        "service": service_name,
        "active": active,
        "enabled": enabled,
        "result": result,
        "exec_main_status": exit_status,
    }


def wait_finished(*, service_name, timeout=180):
    deadline = time.time() + max(1, float(timeout))
    while time.time() < deadline:
        data = status_systemd(service_name=service_name)
        if data.get("active") not in {"active", "activating"}:
            return data
        time.sleep(1)
    data = status_systemd(service_name=service_name)
    data["timeout"] = True
    return data


def install(**kwargs):
    if not has_systemd():
        return {
            "ok": False,
            "kind": "unsupported",
            "error": "飞书渠道守护当前只支持无头 Linux 的 systemd；其他主机请直接运行 penglai_feishu_app.py",
        }
    return install_systemd(**kwargs)


def uninstall(*, service_name=SERVICE_NAME):
    if not has_systemd():
        return {"ok": False, "kind": "unsupported", "error": "没有可卸载的 systemd 飞书服务"}
    return uninstall_systemd(service_name=service_name)


def status(*, service_name=SERVICE_NAME):
    if not has_systemd():
        return {"kind": "unsupported", "service": service_name, "active": ""}
    return status_systemd(service_name=service_name)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="安装或查看无头飞书渠道适配器进程"
    )
    parser.add_argument("action", choices=("install", "uninstall", "status", "print-unit", "run-gray"), help="操作")
    parser.add_argument("--service-name", default="", help="服务名")
    parser.add_argument("--gray-wait", type=float, default=120, help="灰度探针等待秒数")
    parser.add_argument("--gray-send-prompt", action="store_true", help="灰度探针发送真实飞书提示")
    parser.add_argument("--gray-nonce", default="", help="灰度探针验证码")
    parser.add_argument("--gray-target-open-id", default="", help="灰度提示目标 open_id")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)
    service_name = args.service_name or (GRAY_SERVICE_NAME if args.action == "run-gray" else SERVICE_NAME)
    if args.action == "install":
        data = install(service_name=service_name)
    elif args.action == "uninstall":
        data = uninstall(service_name=service_name)
    elif args.action == "status":
        data = status(service_name=service_name)
    elif args.action == "print-unit":
        data = install_systemd(
            service_name=service_name,
            gray_probe=False,
            dry_run=True,
        )
    else:
        if not has_systemd():
            data = {
                "ok": False,
                "kind": "unsupported",
                "error": "run-gray 只用 systemd 验证无头守护进程形态",
            }
        else:
            install_systemd(
                service_name=service_name,
                gray_probe=True,
                gray_wait=args.gray_wait,
                gray_send_prompt=args.gray_send_prompt,
                gray_nonce=args.gray_nonce,
                gray_target_open_id=args.gray_target_open_id,
            )
            data = wait_finished(service_name=service_name, timeout=args.gray_wait + 60)
            data["ok"] = data.get("result") == "success" and str(data.get("exec_main_status")) == "0"
            data["gray_probe"] = True
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    elif args.action == "print-unit":
        print(data.get("content", ""))
    else:
        print(json.dumps(data, ensure_ascii=False))
    return 0 if data.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
