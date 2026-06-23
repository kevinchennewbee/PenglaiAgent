# -*- coding: utf-8 -*-
"""Local Runtime Hub CLI entrypoint for the 0.3.0 branch."""

import argparse
import contextlib
import io
import json
import os
import urllib.error
import urllib.request
import uuid

from .contracts import InboundEvent
from .context_events import default_context_log_path
from .permissions import render_permission_text, resolve_permission_choice
from .port import GenericAgentPort
from .service import RuntimeHubService


DEFAULT_CONTROL_PORT = 8765

STATUS_LABELS = {
    "queued": "排队中",
    "running": "运行中",
    "waiting_permission": "等待授权",
    "succeeded": "已完成",
    "failed": "失败",
    "cancelled": "已停止",
}

SCOPE_LABELS = {
    "owner_private": "主人私聊",
    "user_private": "用户私聊",
    "group": "群聊",
    "desktop": "桌面",
}


def _status_label(value):
    value = str(value or "")
    return STATUS_LABELS.get(value, value or "-")


def _scope_label(value):
    value = str(value or "")
    return SCOPE_LABELS.get(value, value or "-")


def _event(text, *, channel="tui", user_id="owner", chat_id="local-runtime", chat_type="private"):
    return InboundEvent(
        event_id=f"runtime_{uuid.uuid4().hex}",
        channel=channel,
        user_id=user_id,
        chat_id=chat_id,
        chat_type=chat_type,
        text=text,
    )


def _result_dict(result):
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
                "request_id": result.permission.request_id,
                "action": result.permission.action,
                "prompt": result.permission.prompt,
                "options": list(result.permission.options),
            }
            if result.permission else {}
        ),
        "artifacts": list(result.task_run.artifacts or ()),
    }


def run_runtime_message(
    text,
    *,
    channel="tui",
    user_id="owner",
    chat_id="local-runtime",
    chat_type="private",
    timeout=1200,
):
    """Run a real local message through Runtime Hub and GenericAgent."""
    event = _event(text, channel=channel, user_id=user_id, chat_id=chat_id, chat_type=chat_type)
    service = RuntimeHubService(
        owner_user_ids={user_id},
        port_factory=lambda _session, evt: GenericAgentPort(source=evt.channel, timeout=timeout),
        context_log_path=default_context_log_path(),
    )
    result = service.receive_blocking(event, send_body=False, send_notice=False)
    return _result_dict(result)


class RuntimeChatSession:
    """Small real CLI/TUI session backed by Runtime Hub and one GA port.

    This is intentionally not a demo adapter.  The default port factory creates
    a real GenericAgentPort and the RuntimeHubService reuses it for the resolved
    session, so repeated terminal turns keep the same runtime session semantics
    as desktop/IM entries.
    """

    def __init__(
        self,
        *,
        channel="tui",
        user_id="owner",
        chat_id="local-runtime",
        chat_type="private",
        timeout=1200,
        service=None,
    ):
        self.channel = str(channel or "tui")
        self.user_id = str(user_id or "owner")
        self.chat_id = str(chat_id or "local-runtime")
        self.chat_type = str(chat_type or "private")
        self.timeout = float(timeout)
        self.service = service or RuntimeHubService(
            owner_user_ids={self.user_id},
            port_factory=lambda _session, evt: GenericAgentPort(source=evt.channel, timeout=self.timeout),
            context_log_path=default_context_log_path(),
        )
        self.pending_permission = None
        self.last_session_id = ""
        self.turn_no = 0

    def event(self, text):
        self.turn_no += 1
        return _event(
            text,
            channel=self.channel,
            user_id=self.user_id,
            chat_id=self.chat_id,
            chat_type=self.chat_type,
        )

    def send(self, text):
        text = str(text or "").strip()
        if self.pending_permission is not None:
            chosen = resolve_permission_choice(text, self.pending_permission)
            if chosen is None:
                return {
                    "ok": False,
                    "status": "waiting_permission",
                    "session_id": self.last_session_id or "",
                    "output": render_permission_text(self.pending_permission),
                    "permission": {
                        "request_id": self.pending_permission.request_id,
                        "action": self.pending_permission.action,
                        "prompt": self.pending_permission.prompt,
                        "options": list(self.pending_permission.options),
                    },
                }
            self.pending_permission = None
            text = chosen
        result = self.service.receive_blocking(
            self.event(text),
            send_body=False,
            send_notice=False,
        )
        self.last_session_id = result.session.session_id
        data = _result_dict(result)
        if result.permission is not None:
            self.pending_permission = result.permission
            data["output"] = render_permission_text(result.permission)
        return data

    def status(self):
        session_id = self.last_session_id or "owner:default"
        return {
            "session": self.service.status(session_id),
            "recent": self.service.recent_runs(session_id=session_id, limit=5),
            "pending_permission": bool(self.pending_permission),
        }

    def cancel(self, *, drop_pending=False):
        session_id = self.last_session_id or "owner:default"
        return self.service.cancel_session(session_id, drop_pending=drop_pending)


def _print_runtime_result(data):
    print(f"[{_status_label(data.get('status'))}] 会话={data.get('session_id') or '-'} 任务={data.get('run_id') or '-'}")
    if data.get("output"):
        print(data["output"])
    if data.get("error"):
        print(f"错误：{data['error']}")


def _read_token(path):
    if not path or not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def control_api_post(path, data, *, host="127.0.0.1", port=DEFAULT_CONTROL_PORT, token_file=None, timeout=2.0):
    from .control_api import default_token_path

    token_path = token_file or default_token_path()
    token = _read_token(token_path)
    if not token:
        raise FileNotFoundError(f"未找到中枢控制令牌：{token_path}")
    url = f"http://{host}:{int(port)}{path}"
    raw = json.dumps(data or {}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Penglai-Token": token,
        },
    )
    with urllib.request.urlopen(req, timeout=float(timeout)) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cancel_via_control_api(
    session_id,
    *,
    drop_pending=False,
    host="127.0.0.1",
    port=DEFAULT_CONTROL_PORT,
    token_file=None,
    timeout=2.0,
):
    data = control_api_post(
        "/cancel",
        {
            "session_id": str(session_id or "owner:default"),
            "drop_pending": bool(drop_pending),
        },
        host=host,
        port=port,
        token_file=token_file,
        timeout=timeout,
    )
    data["via"] = "control_api"
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description="通过蓬莱 0.3.0 中枢发送一条本地消息")
    parser.add_argument("text", nargs="*", help="消息内容")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--channel", default="tui", help="中枢渠道")
    parser.add_argument("--user-id", default="owner", help="用户 ID")
    parser.add_argument("--chat-id", default="local-runtime", help="会话入口 ID")
    parser.add_argument("--chat-type", default="private", choices=("private", "group", "room"), help="会话类型")
    parser.add_argument("--timeout", type=float, default=1200, help="GA 超时时间（秒）")
    args = parser.parse_args(argv)
    text = " ".join(args.text).strip() or "hello runtime hub"
    captured = ""
    if args.json:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            data = run_runtime_message(
                text,
                channel=args.channel,
                user_id=args.user_id,
                chat_id=args.chat_id,
                chat_type=args.chat_type,
                timeout=args.timeout,
            )
        captured = buf.getvalue().strip()
    else:
        data = run_runtime_message(
            text,
            channel=args.channel,
            user_id=args.user_id,
            chat_id=args.chat_id,
            chat_type=args.chat_type,
            timeout=args.timeout,
        )
    if args.json:
        if captured:
            data["logs"] = captured
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"蓬莱中枢 0.3.0：{'通过' if data['ok'] else '失败'}")
        print(f"会话：{data['session_id']}（{_scope_label(data['scope'])}）")
        print(f"任务：{data['run_id']} {_status_label(data['status'])}，执行器：{data['worker_id']}")
        if data["output"]:
            print(data["output"])
        if data["error"]:
            print(f"错误：{data['error']}")
    return 0 if data["ok"] else 1


def chat_main(argv=None):
    parser = argparse.ArgumentParser(description="启动蓬莱 0.3.0 中枢命令行对话")
    parser.add_argument("--json", action="store_true", help="单次发送时输出 JSON")
    parser.add_argument("--once", nargs="*", help="只发送一条消息后退出")
    parser.add_argument("--channel", default="tui", help="中枢渠道")
    parser.add_argument("--user-id", default="owner", help="用户 ID")
    parser.add_argument("--chat-id", default="local-runtime", help="会话入口 ID")
    parser.add_argument("--chat-type", default="private", choices=("private", "group", "room"), help="会话类型")
    parser.add_argument("--timeout", type=float, default=1200, help="GA 超时时间（秒）")
    args = parser.parse_args(argv)
    session = RuntimeChatSession(
        channel=args.channel,
        user_id=args.user_id,
        chat_id=args.chat_id,
        chat_type=args.chat_type,
        timeout=args.timeout,
    )
    if args.once is not None:
        text = " ".join(args.once).strip() or "hello runtime hub"
        data = session.send(text)
        if args.json:
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            _print_runtime_result(data)
        return 0 if data.get("ok") else 1

    print("蓬莱 0.3.0 中枢命令行")
    print("输入消息发送；/status 查看状态；/history 查看最近运行；/cancel 停止当前 session；/quit 退出。")
    while True:
        try:
            text = input("> ")
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        text = text.strip()
        if not text:
            continue
        if text in {"/q", "/quit", "quit", "exit"}:
            return 0
        if text == "/status":
            print(json.dumps(session.status(), ensure_ascii=False, indent=2))
            continue
        if text == "/history":
            rows = session.service.recent_runs(session_id=session.last_session_id or None, limit=10)
            if not rows:
                print("没有运行记录")
            for row in rows:
                print(f"{row['created_at']:.0f} {row['session_id']} {row['run_id']} {_status_label(row['status'])} {row['worker_id']}")
            continue
        if text.startswith("/cancel"):
            drop = "--drop-pending" in text.split()
            print(json.dumps(session.cancel(drop_pending=drop), ensure_ascii=False, indent=2))
            continue
        data = session.send(text)
        _print_runtime_result(data)


def history_main(argv=None):
    parser = argparse.ArgumentParser(description="查看蓬莱中枢任务历史")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--session-id", default="", help="按中枢会话 ID 过滤")
    parser.add_argument("--limit", type=int, default=20, help="任务条数")
    args = parser.parse_args(argv)
    service = RuntimeHubService()
    rows = service.recent_runs(session_id=args.session_id or None, limit=args.limit)
    if args.json:
        print(json.dumps({"runs": rows}, ensure_ascii=False, indent=2))
    else:
        if not rows:
            print("没有运行记录")
            return 0
        for row in rows:
            print(f"{row['created_at']:.0f} {row['session_id']} {row['run_id']} {_status_label(row['status'])} {row['worker_id']}")
            if row.get("error"):
                print(f"  错误：{row['error']}")
    return 0


def status_main(argv=None):
    parser = argparse.ArgumentParser(description="查看蓬莱中枢会话状态")
    parser.add_argument("session_id", nargs="?", default="owner:default", help="中枢会话 ID")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)
    service = RuntimeHubService()
    data = {
        "session": service.status(args.session_id),
        "recent": service.recent_runs(session_id=args.session_id, limit=5),
    }
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        session = data["session"]
        print(f"会话：{session['session_id']}")
        print(f"运行中：{session['queue']['active']}；排队：{session['queue']['pending']}")
        print(f"当前任务：{session['active_run_id'] or '-'} {_status_label(session['active_status'])}")
        for row in data["recent"]:
            print(f"{row['run_id']} {_status_label(row['status'])} {row['worker_id']}")
    return 0


def cancel_main(argv=None):
    parser = argparse.ArgumentParser(description="停止一个蓬莱中枢会话")
    parser.add_argument("session_id", nargs="?", default="owner:default", help="中枢会话 ID")
    parser.add_argument("--drop-pending", action="store_true", help="同时丢弃排队消息")
    parser.add_argument("--host", default="127.0.0.1", help="中枢控制 API 地址")
    parser.add_argument("--port", type=int, default=DEFAULT_CONTROL_PORT, help="中枢控制 API 端口")
    parser.add_argument("--token-file", default="", help="中枢控制 API 令牌文件")
    parser.add_argument("--control-timeout", type=float, default=2.0, help="控制 API 超时时间（秒）")
    parser.add_argument("--no-control-api", action="store_true", help="跳过本机 runtime-serve 停止尝试")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)
    control_error = ""
    if not args.no_control_api:
        try:
            data = cancel_via_control_api(
                args.session_id,
                drop_pending=args.drop_pending,
                host=args.host,
                port=args.port,
                token_file=args.token_file or None,
                timeout=args.control_timeout,
            )
        except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            control_error = str(exc)
        else:
            if args.json:
                print(json.dumps(data, ensure_ascii=False, indent=2))
            else:
                print(f"已通过中枢控制 API 请求停止：{args.session_id}")
            return 0
    service = RuntimeHubService()
    data = service.cancel_session(args.session_id, drop_pending=args.drop_pending)
    data["via"] = "local_service"
    if control_error:
        data["control_error"] = control_error
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        suffix = "（中枢控制 API 不可用，仅更新本地状态）" if control_error else ""
        print(f"已请求停止：{args.session_id}{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
