# -*- coding: utf-8 -*-
"""Service unit management for the Penglai Runtime Hub control API."""

import argparse
import json
import os
import plistlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


SERVICE_NAME = "penglai-runtime-hub"
LAUNCHD_LABEL = "com.penglai.runtimehub"
DEFAULT_PORT = 8765


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def venv_python(root=None):
    base = root or repo_root()
    if os.name == "nt":
        candidates = [
            os.path.join(base, ".venv", "Scripts", "python.exe"),
            os.path.join(base, ".venv", "bin", "python"),
        ]
    else:
        candidates = [
            os.path.join(base, ".venv", "bin", "python"),
            os.path.join(base, ".venv", "Scripts", "python.exe"),
        ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return sys.executable


def has_systemd():
    return shutil.which("systemctl") is not None


def systemd_unit(*, root=None, python=None, user=None, home=None, port=DEFAULT_PORT):
    root = os.path.realpath(root or repo_root())
    python = python or venv_python(root)
    user = user or os.environ.get("USER") or "root"
    home = home or os.path.expanduser("~")
    work = os.path.join(home, "penglai-work")
    env_sh = os.path.join(root, "env.sh")
    return (
        "[Unit]\n"
        "Description=Penglai Runtime Hub 0.3.0 Control API\n"
        "After=network-online.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"User={user}\n"
        f"WorkingDirectory={root}\n"
        f"Environment=HOME={home}\n"
        f"Environment=GA_WORKSPACE_ROOT={work}\n"
        "Environment=PYTHONUNBUFFERED=1\n"
        f"ExecStartPre=/bin/bash -lc 'source {env_sh} 2>/dev/null || true; {python} {root}/penglai selfcheck --no-e2e'\n"
        f"ExecStart=/bin/bash -lc 'source {env_sh} 2>/dev/null || true; exec {python} {root}/penglai runtime-serve --host 127.0.0.1 --port {int(port)}'\n"
        "Restart=always\n"
        "RestartSec=10\n\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )


def launchd_plist(*, root=None, python=None, home=None, port=DEFAULT_PORT, label=LAUNCHD_LABEL):
    root = os.path.realpath(root or repo_root())
    python = python or venv_python(root)
    home = home or os.path.expanduser("~")
    temp = os.path.join(root, "temp")
    path_parts = [
        os.path.join(root, ".venv", "bin"),
        os.path.expanduser("~/.local/bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ]
    return {
        "Label": label,
        "ProgramArguments": [
            python,
            os.path.join(root, "penglai"),
            "runtime-serve",
            "--host",
            "127.0.0.1",
            "--port",
            str(int(port)),
        ],
        "WorkingDirectory": root,
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": os.path.join(temp, "runtime_hub.log"),
        "StandardErrorPath": os.path.join(temp, "runtime_hub.log"),
        "EnvironmentVariables": {
            "HOME": home,
            "GA_WORKSPACE_ROOT": os.path.join(home, "penglai-work"),
            "PATH": os.pathsep.join(path_parts),
            "PYTHONUNBUFFERED": "1",
        },
    }


def launchd_plist_text(**kwargs):
    return plistlib.dumps(launchd_plist(**kwargs), sort_keys=False).decode("utf-8")


def windows_startup_dir():
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")


def windows_startup_cmd_path(*, startup_dir=None):
    base = startup_dir or windows_startup_dir()
    return os.path.join(base, "Penglai Runtime Hub.cmd")


def windows_startup_command(*, root=None, python=None, port=DEFAULT_PORT):
    root = os.path.realpath(root or repo_root())
    python = python or venv_python(root)
    log_path = os.path.join(root, "temp", "runtime_hub.log")
    return (
        "@echo off\r\n"
        "setlocal\r\n"
        f"set \"PENGLAI_ROOT={root}\"\r\n"
        "set \"PYTHONUNBUFFERED=1\"\r\n"
        f"if not exist \"{os.path.join(root, 'temp')}\" mkdir \"{os.path.join(root, 'temp')}\"\r\n"
        "cd /d \"%PENGLAI_ROOT%\"\r\n"
        f"\"{python}\" \"{os.path.join(root, 'penglai')}\" runtime-serve --host 127.0.0.1 --port {int(port)} >> \"{log_path}\" 2>&1\r\n"
    )


def _token_path(root):
    return os.path.join(os.path.realpath(root or repo_root()), "temp", "runtime_hub.token")


def wait_ready(*, root=None, port=DEFAULT_PORT, timeout=20):
    root = os.path.realpath(root or repo_root())
    token_path = _token_path(root)
    deadline = time.time() + max(0, float(timeout))
    last_error = "中枢服务未就绪"
    while time.time() <= deadline:
        try:
            with open(token_path, encoding="utf-8") as f:
                token = f.read().strip()
            if not token:
                raise RuntimeError("empty runtime token")
            req = urllib.request.Request(
                f"http://127.0.0.1:{int(port)}/health",
                headers={"X-Penglai-Token": token},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                body = resp.read().decode("utf-8")
            data = json.loads(body)
            if data.get("ok"):
                return {"ready": True, "port": int(port), "token_file": token_path}
            last_error = body[:200]
        except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
            last_error = str(exc)
        time.sleep(0.5)
    return {"ready": False, "port": int(port), "token_file": token_path, "error": last_error}


def install_systemd(*, root=None, port=DEFAULT_PORT, dry_run=False, wait_seconds=20):
    root = os.path.realpath(root or repo_root())
    unit = systemd_unit(root=root, port=port)
    if dry_run:
        return {"ok": True, "kind": "systemd", "path": f"/etc/systemd/system/{SERVICE_NAME}.service", "content": unit}
    subprocess.run(
        ["sudo", "tee", f"/etc/systemd/system/{SERVICE_NAME}.service"],
        input=unit,
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
    subprocess.run(["sudo", "systemctl", "enable", "--now", SERVICE_NAME], check=True)
    ready = wait_ready(root=root, port=port, timeout=wait_seconds)
    return {"ok": bool(ready.get("ready")), "kind": "systemd", "service": SERVICE_NAME, **ready}


def install_launchd(*, root=None, port=DEFAULT_PORT, dry_run=False, wait_seconds=20):
    root = os.path.realpath(root or repo_root())
    plist_dir = os.path.expanduser("~/Library/LaunchAgents")
    plist_path = os.path.join(plist_dir, LAUNCHD_LABEL + ".plist")
    content = launchd_plist_text(root=root, port=port)
    if dry_run:
        return {"ok": True, "kind": "launchd", "path": plist_path, "content": content}
    os.makedirs(plist_dir, exist_ok=True)
    os.makedirs(os.path.join(root, "temp"), exist_ok=True)
    with open(plist_path, "w", encoding="utf-8") as f:
        f.write(content)
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", plist_path], check=True)
    subprocess.run(["launchctl", "enable", f"gui/{uid}/{LAUNCHD_LABEL}"], check=False)
    ready = wait_ready(root=root, port=port, timeout=wait_seconds)
    return {"ok": bool(ready.get("ready")), "kind": "launchd", "label": LAUNCHD_LABEL, "path": plist_path, **ready}


def install_windows_startup(*, root=None, port=DEFAULT_PORT, dry_run=False, wait_seconds=20, startup_dir=None):
    root = os.path.realpath(root or repo_root())
    cmd_path = windows_startup_cmd_path(startup_dir=startup_dir)
    content = windows_startup_command(root=root, port=port)
    if dry_run:
        return {"ok": True, "kind": "windows-startup", "path": cmd_path, "content": content}
    os.makedirs(os.path.dirname(cmd_path), exist_ok=True)
    os.makedirs(os.path.join(root, "temp"), exist_ok=True)
    with open(cmd_path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    proc = subprocess.Popen(
        ["cmd.exe", "/c", cmd_path],
        cwd=root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    ready = wait_ready(root=root, port=port, timeout=wait_seconds)
    return {
        "ok": bool(ready.get("ready")),
        "kind": "windows-startup",
        "path": cmd_path,
        "pid": proc.pid,
        **ready,
    }


def install(*, root=None, port=DEFAULT_PORT, dry_run=False, wait_seconds=20):
    if has_systemd():
        return install_systemd(root=root, port=port, dry_run=dry_run, wait_seconds=wait_seconds)
    if sys.platform == "darwin":
        return install_launchd(root=root, port=port, dry_run=dry_run, wait_seconds=wait_seconds)
    if sys.platform == "win32":
        return install_windows_startup(root=root, port=port, dry_run=dry_run, wait_seconds=wait_seconds)
    return {
        "ok": False,
        "kind": "unsupported",
        "error": "中枢服务安装需要 systemd、macOS launchd 或 Windows 当前用户启动项；也可以手动运行 `penglai runtime-serve`",
    }


def uninstall():
    if has_systemd():
        subprocess.run(["sudo", "systemctl", "disable", "--now", SERVICE_NAME], check=False)
        subprocess.run(["sudo", "rm", "-f", f"/etc/systemd/system/{SERVICE_NAME}.service"], check=True)
        subprocess.run(["sudo", "systemctl", "daemon-reload"], check=False)
        return {"ok": True, "kind": "systemd", "service": SERVICE_NAME}
    if sys.platform == "darwin":
        plist_path = os.path.expanduser(f"~/Library/LaunchAgents/{LAUNCHD_LABEL}.plist")
        uid = os.getuid()
        subprocess.run(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"], check=False)
        try:
            os.remove(plist_path)
        except FileNotFoundError:
            pass
        return {"ok": True, "kind": "launchd", "label": LAUNCHD_LABEL}
    if sys.platform == "win32":
        cmd_path = windows_startup_cmd_path()
        try:
            os.remove(cmd_path)
            removed = True
        except FileNotFoundError:
            removed = False
        return {"ok": True, "kind": "windows-startup", "path": cmd_path, "removed": removed}
    return {"ok": False, "kind": "unsupported", "error": "没有可卸载的 systemd/launchd/Windows 启动项中枢服务"}


def status():
    if has_systemd():
        active = subprocess.run(["systemctl", "is-active", SERVICE_NAME], capture_output=True, text=True).stdout.strip()
        enabled = subprocess.run(["systemctl", "is-enabled", SERVICE_NAME], capture_output=True, text=True).stdout.strip()
        return {"kind": "systemd", "service": SERVICE_NAME, "active": active, "enabled": enabled}
    if sys.platform == "darwin":
        loaded = subprocess.run(["launchctl", "list", LAUNCHD_LABEL], capture_output=True, text=True).returncode == 0
        return {"kind": "launchd", "label": LAUNCHD_LABEL, "loaded": loaded}
    if sys.platform == "win32":
        cmd_path = windows_startup_cmd_path()
        return {
            "kind": "windows-startup",
            "path": cmd_path,
            "installed": os.path.exists(cmd_path),
        }
    return {"kind": "unsupported", "active": ""}


def main(argv=None):
    parser = argparse.ArgumentParser(description="安装或查看蓬莱 Runtime Hub 中枢服务")
    parser.add_argument("action", choices=("install", "uninstall", "status", "print-unit"), help="操作")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="监听端口")
    parser.add_argument("--wait-seconds", type=float, default=20, help="等待就绪秒数")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)
    if args.action == "install":
        data = install(port=args.port, wait_seconds=args.wait_seconds)
    elif args.action == "uninstall":
        data = uninstall()
    elif args.action == "status":
        data = status()
    else:
        data = install(port=args.port, dry_run=True)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    elif args.action == "print-unit":
        print(data.get("content", ""))
    else:
        print(json.dumps(data, ensure_ascii=False))
    return 0 if data.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
