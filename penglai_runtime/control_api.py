# -*- coding: utf-8 -*-
"""Localhost-only Runtime Hub control API for desktop and headless use."""

import argparse
import ipaddress
import json
import os
import secrets
import shutil
import stat
import sys
import time
import urllib.parse
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .contracts import InboundEvent
from .context_events import default_context_log_path
from .port import GenericAgentPort
from .redaction import redact_text
from .service import RuntimeHubService
from .store import default_store_path
from .version import collect_version_metadata


def default_token_path(root=None):
    base = root or os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    path = os.path.join(base, "temp", "runtime_hub.token")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


READ_ONLY_OP_COMMANDS = {
    "version": ("version",),
    "doctor": ("doctor",),
    "selfcheck": ("selfcheck", "--json"),
    "runtime-audit": ("runtime-audit", "--json"),
    "privacy-audit": ("privacy-audit", "--json"),
    "runtime-service-status": ("runtime-service", "status", "--json"),
    "status": ("status",),
    "channels": ("channels",),
    "abilities": ("abilities",),
    "update-check": ("update", "--check"),
}

STATE_OP_COMMANDS = {
    "runtime-service-install": ("runtime-service", "install", "--json", "--wait-seconds", "30"),
    "runtime-service-uninstall": ("runtime-service", "uninstall", "--json"),
}

LOG_SERVICE_MAP = {
    "feishu": "penglai-feishu",
    "wechat": "penglai-wechat",
    "runtime": "penglai-runtime-hub",
    "scheduler": "penglai-scheduler",
    "companion": "penglai-companion",
}


def _venv_python(root):
    path = os.path.join(os.path.realpath(root), ".venv", "bin", "python")
    return path if os.path.exists(path) else sys.executable


def _truncate(text, limit=20000):
    value = str(text or "")
    if len(value) <= limit:
        return value
    return value[-limit:]


def command_catalog():
    return {
        "read_only": sorted(READ_ONLY_OP_COMMANDS),
        "state_changing": sorted(STATE_OP_COMMANDS),
        "logs": sorted(LOG_SERVICE_MAP),
        "not_exposed": ["setup", "update-apply", "start", "stop", "restart"],
        "notes": (
            "setup、update-apply 和旧 start/stop/restart 不暴露给 0.3.0 preview 控制 API。"
            "桌面端服务控制只管理 Runtime Hub 中枢服务，不直接管理飞书/微信渠道适配器。"
        ),
    }


def run_ops_command(name, *, root=None, allow_state=False, timeout=None):
    root = os.path.realpath(root or repo_root())
    name = str(name or "").strip()
    if name in READ_ONLY_OP_COMMANDS:
        args = READ_ONLY_OP_COMMANDS[name]
    elif name in STATE_OP_COMMANDS:
        if not allow_state:
            raise ValueError(f"{name} 需要通过 POST 执行")
        args = STATE_OP_COMMANDS[name]
    else:
        raise ValueError(f"不支持的运维命令：{name}")

    if timeout is None:
        timeout = 120 if name == "runtime-service-install" else (90 if name in {"doctor", "selfcheck", "update-check"} else 45)
    started = time.time()
    cmd = [_venv_python(root), os.path.join(root, "penglai"), *args]
    try:
        proc = subprocess.run(
            cmd,
            cwd=root,
            capture_output=True,
            text=True,
            timeout=float(timeout),
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        return {
            "ok": proc.returncode == 0,
            "command": name,
            "argv": ["penglai", *args],
            "returncode": proc.returncode,
            "duration_seconds": round(time.time() - started, 3),
            "stdout": _truncate(redact_text(proc.stdout)),
            "stderr": _truncate(redact_text(proc.stderr)),
        }
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout or b"").decode("utf-8", "replace")
        err = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr or b"").decode("utf-8", "replace")
        return {
            "ok": False,
            "command": name,
            "argv": ["penglai", *args],
            "returncode": 124,
            "duration_seconds": round(time.time() - started, 3),
            "stdout": _truncate(redact_text(out)),
            "stderr": _truncate(redact_text(err or f"{timeout} 秒后超时")),
        }


def service_snapshot(*, root=None):
    root = os.path.realpath(root or repo_root())
    rows = []
    if shutil.which("systemctl"):
        for service in ("penglai-runtime-hub", "penglai-feishu", "penglai-wechat", "penglai-scheduler", "penglai-companion"):
            active = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True, timeout=5)
            enabled = subprocess.run(["systemctl", "is-enabled", service], capture_output=True, text=True, timeout=5)
            rows.append({
                "name": service,
                "manager": "systemd",
                "active": (active.stdout or active.stderr or "").strip(),
                "enabled": (enabled.stdout or enabled.stderr or "").strip(),
                "installed": enabled.returncode == 0 or active.returncode == 0,
            })
        return rows
    for service, pattern in (
        ("penglai-feishu", "penglai_feishu_app.py"),
        ("penglai-wechat", "penglai_im_launch.py wechat"),
        ("penglai-runtime-hub", "runtime-serve"),
    ):
        pgrep = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True, timeout=5)
        pids = [x for x in (pgrep.stdout or "").split() if x.isdigit()]
        rows.append({
            "name": service,
            "manager": "process",
            "active": "active" if pids else "inactive",
            "enabled": "",
            "installed": bool(pids),
            "pids": pids[:5],
        })
    return rows


def ops_checks(*, root=None):
    root = os.path.realpath(root or repo_root())
    from . import deprecations, privacy_audit, selfcheck

    version = collect_version_metadata(root=root).to_dict()
    legacy = deprecations.audit(root=root, include_runtime=True)
    privacy = privacy_audit.audit(root=root, include_ignored=True, scan_ignored=False)
    static_selfcheck = selfcheck.status(include_checks=False)
    return {
        "ok": bool(legacy.get("ok")) and bool(privacy.get("privacy_ok")),
        "version": version,
        "selfcheck": static_selfcheck,
        "runtime_audit": {
            "ok": legacy.get("ok"),
            "active_blocker_count": legacy.get("active_blocker_count"),
            "item_count": legacy.get("item_count"),
        },
        "privacy_audit": {
            "ok": privacy.get("ok"),
            "privacy_ok": privacy.get("privacy_ok"),
            "release_ready": privacy.get("release_ready"),
            "privacy_blocker_count": privacy.get("privacy_blocker_count"),
            "release_blocker_count": privacy.get("release_blocker_count"),
            "finding_count": privacy.get("finding_count"),
        },
        "services": service_snapshot(root=root),
        "commands": command_catalog(),
    }


def read_ops_logs(channel="", *, root=None, lines=80):
    root = os.path.realpath(root or repo_root())
    channel = str(channel or "feishu").strip().lower()
    lines = max(1, min(int(lines or 80), 500))
    if channel not in LOG_SERVICE_MAP:
        raise ValueError(f"不支持的日志通道：{channel}")
    candidates = {
        "feishu": os.path.join(root, "temp", "fsapp.log"),
        "runtime": os.path.join(root, "temp", "runtime.log"),
        "wechat": os.path.join(root, "temp", "wechat.log"),
        "scheduler": os.path.join(root, "temp", "scheduler.log"),
        "companion": os.path.join(root, "temp", "companion.log"),
    }
    path = candidates[channel]
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            tail = "\n".join(f.read().splitlines()[-lines:])
        return {"ok": True, "channel": channel, "source": path, "returncode": 0, "text": _truncate(redact_text(tail))}
    if shutil.which("journalctl"):
        service = LOG_SERVICE_MAP[channel]
        proc = subprocess.run(
            ["journalctl", "-u", service, "-n", str(lines), "--no-pager"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {
            "ok": proc.returncode == 0,
            "channel": channel,
            "source": f"journalctl:{service}",
            "returncode": proc.returncode,
            "text": _truncate(redact_text(proc.stdout or proc.stderr)),
        }
    return {"ok": False, "channel": channel, "source": path, "returncode": 1, "text": "未找到日志文件"}


def ensure_token(path=None):
    token_path = path or default_token_path()
    os.makedirs(os.path.dirname(os.path.realpath(token_path)), exist_ok=True)
    if os.path.exists(token_path):
        with open(token_path, encoding="utf-8") as f:
            token = f.read().strip()
        if token:
            return token, token_path
    token = secrets.token_urlsafe(32)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(token_path, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(token + "\n")
    finally:
        try:
            os.chmod(token_path, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
    return token, token_path


def _is_loopback_host(host):
    value = str(host or "").strip().lower()
    if value in {"localhost"}:
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def _result_dict(result):
    permission = result.permission
    return {
        "ok": result.status == "succeeded",
        "event_id": result.event.event_id,
        "channel": result.event.channel,
        "session_id": result.session.session_id,
        "scope": result.session.scope,
        "run_id": result.task_run.run_id,
        "status": result.status,
        "worker_id": result.task_run.worker_id,
        "queued": result.queued,
        "output": result.cleaned_output,
        "error": result.task_run.error,
        "permission": (
            {
                "request_id": permission.request_id,
                "action": permission.action,
                "prompt": permission.prompt,
                "options": list(permission.options),
                "metadata": permission.metadata or {},
            }
            if permission else {}
        ),
        "artifacts": list(result.task_run.artifacts or ()),
    }


class RuntimeControlHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        server_address,
        handler_cls,
        *,
        token,
        token_path,
        service=None,
        message_port_factory=None,
        ops_runner=None,
        root=None,
    ):
        super().__init__(server_address, handler_cls)
        self.token = str(token)
        self.token_path = token_path
        self.root = os.path.realpath(root or repo_root())
        self.service = service or RuntimeHubService(
            owner_user_ids={"owner"},
            context_log_path=default_context_log_path(),
        )
        self.message_port_factory = message_port_factory
        self.ops_runner = ops_runner
        self.started_at = time.time()


class RuntimeControlHandler(BaseHTTPRequestHandler):
    server_version = "PenglaiRuntimeControl/0.3.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[runtime-control] " + (fmt % args) + "\n")

    def do_GET(self):
        if not self._authorized():
            return self._error(401, "未授权")
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/health":
                return self._json(200, {
                    "ok": True,
                    "bind": f"{self.server.server_address[0]}:{self.server.server_address[1]}",
                    "uptime_seconds": round(time.time() - self.server.started_at, 3),
                })
            if path == "/version":
                return self._json(200, {"version": collect_version_metadata(root=self.server.root).to_dict()})
            if path == "/selfcheck":
                from . import selfcheck

                include = params.get("include_checks", ["0"])[0] in {"1", "true", "yes"}
                return self._json(200, selfcheck.status(include_checks=include))
            if path == "/ops/commands":
                return self._json(200, command_catalog())
            if path == "/ops/checks":
                return self._json(200, ops_checks(root=self.server.root))
            if path == "/ops/logs":
                channel = params.get("channel", ["feishu"])[0]
                lines = int(params.get("lines", ["80"])[0])
                return self._json(200, read_ops_logs(channel, root=self.server.root, lines=lines))
            if path == "/ops/command":
                name = params.get("name", [""])[0]
                data = self._run_ops(name, allow_state=False)
                return self._json(200, data)
            if path == "/status":
                session_id = params.get("session_id", ["owner:default"])[0]
                return self._json(200, {
                    "session": self.server.service.status(session_id),
                    "recent": self.server.service.recent_runs(session_id=session_id, limit=5),
                })
            if path == "/runs":
                session_id = params.get("session_id", [""])[0] or None
                limit = int(params.get("limit", ["20"])[0])
                return self._json(200, {
                    "runs": self.server.service.recent_runs(session_id=session_id, limit=limit),
                })
            if path.startswith("/runs/"):
                run = self.server.service.get_run(path.split("/", 2)[2])
                if not run:
                    return self._error(404, "未找到任务记录")
                return self._json(200, {"run": run})
            return self._error(404, "未找到接口")
        except ValueError as exc:
            return self._error(400, str(exc))
        except Exception as exc:
            return self._error(500, str(exc))

    def do_POST(self):
        if not self._authorized():
            return self._error(401, "未授权")
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            body = self._read_json()
            if path == "/message":
                text = str(body.get("text") or "")
                if not text.strip():
                    return self._error(400, "消息内容不能为空")
                event = InboundEvent(
                    event_id=str(body.get("event_id") or f"control_{secrets.token_hex(16)}"),
                    channel=str(body.get("channel") or "desktop"),
                    user_id=str(body.get("user_id") or "owner"),
                    chat_id=str(body.get("chat_id") or "local-control"),
                    chat_type=str(body.get("chat_type") or "private"),
                    text=text,
                    images=tuple(body.get("images") or ()),
                    files=tuple(body.get("files") or ()),
                    voice=tuple(body.get("voice") or ()),
                    metadata=dict(body.get("metadata") or {}),
                )
                timeout = float(body.get("timeout") or 1200)
                if callable(self.server.message_port_factory):
                    port = self.server.message_port_factory(event, body)
                else:
                    port = GenericAgentPort(source=event.channel, timeout=timeout)
                result = self.server.service.receive_blocking(
                    event,
                    port=port,
                    send_body=False,
                    send_notice=False,
                )
                return self._json(200 if result.status == "succeeded" else 202, _result_dict(result))
            if path == "/cancel":
                session_id = str(body.get("session_id") or "owner:default")
                data = self.server.service.cancel_session(
                    session_id,
                    drop_pending=bool(body.get("drop_pending")),
                )
                return self._json(200, data)
            if path == "/ops/command":
                name = str(body.get("command") or "")
                timeout = body.get("timeout")
                data = self._run_ops(name, allow_state=True, timeout=timeout)
                return self._json(200, data)
            return self._error(404, "未找到接口")
        except ValueError as exc:
            return self._error(400, str(exc))
        except Exception as exc:
            return self._error(500, str(exc))

    def _run_ops(self, name, *, allow_state=False, timeout=None):
        name = str(name or "").strip()
        if name in STATE_OP_COMMANDS and not allow_state:
            raise ValueError(f"{name} 需要通过 POST 执行")
        if name not in READ_ONLY_OP_COMMANDS and name not in STATE_OP_COMMANDS:
            raise ValueError(f"不支持的运维命令：{name}")
        if callable(self.server.ops_runner):
            return self.server.ops_runner(
                name,
                root=self.server.root,
                allow_state=allow_state,
                timeout=timeout,
            )
        return run_ops_command(
            name,
            root=self.server.root,
            allow_state=allow_state,
            timeout=timeout,
        )

    def _authorized(self):
        token = self.headers.get("X-Penglai-Token", "")
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
        return secrets.compare_digest(str(token), self.server.token) and self._origin_allowed()

    def _origin_allowed(self):
        origin = self.headers.get("Origin", "")
        if not origin:
            return True
        parsed = urllib.parse.urlparse(origin)
        return _is_loopback_host(parsed.hostname or "")

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("JSON 请求体必须是对象")
        return data

    def _json(self, code, data):
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _error(self, code, message):
        return self._json(code, {"ok": False, "error": str(message)})


def make_server(
    *,
    host="127.0.0.1",
    port=8765,
    token_path=None,
    service=None,
    message_port_factory=None,
    ops_runner=None,
    root=None,
):
    if not _is_loopback_host(host):
        raise ValueError("中枢控制 API 只能绑定到 localhost/loopback 地址")
    token, path = ensure_token(token_path)
    return RuntimeControlHTTPServer(
        (host, int(port)),
        RuntimeControlHandler,
        token=token,
        token_path=path,
        root=root,
        service=service,
        message_port_factory=message_port_factory,
        ops_runner=ops_runner,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="启动本机蓬莱中枢控制 API")
    parser.add_argument("--host", default="127.0.0.1", help="loopback 绑定地址")
    parser.add_argument("--port", type=int, default=8765, help="绑定端口")
    parser.add_argument("--token-file", default=default_token_path(), help="本机令牌文件")
    args = parser.parse_args(argv)
    try:
        server = make_server(host=args.host, port=args.port, token_path=args.token_file)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps({
        "ok": True,
        "bind": f"{args.host}:{server.server_address[1]}",
        "token_file": server.token_path,
        "store": default_store_path(),
    }, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
