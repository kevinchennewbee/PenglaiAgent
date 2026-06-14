# -*- coding: utf-8 -*-
"""蓬莱：MCP（Model Context Protocol）客户端 —— 让管家消费外部 MCP server 的工具。

GA 现状：内核只有 9 原子工具 + SOP，**不原生支持 MCP**（唯一的 JSON-RPC 是 ACP 桥，且其
`mcpCapabilities` 关着）。本插件补上「MCP 客户端」这一刀——**GA 内核零改动**：

挂载方式（蓬莱插件标准样板，与 plugins/penglai_search.py 同源）：
- `agent_before` 钩子：每条用户 query 前，对每个已配 server 跑（缓存的）tools/list，把工具 schema
  改命名空间后 append 进 tools_schema（幂等）。
- `GenericAgentHandler.__getattr__` 运行时补丁：MCP 工具名是运行时发现的、无法预先挂 do_<name>，
  故用 __getattr__ 把 `do_mcp__<server>__<tool>` 动态合成为 handler 方法（catch-all，dispatch 的
  `hasattr` 会命中它）。这是「类注入 do_*」范式的动态版，**不动 ga.py 一个字符**。

传输：纯标准库 subprocess + json 手写 stdio JSON-RPC（**不引入 mcp pip 依赖**，守"不加依赖"铁律）。
超时：reader 线程把响应行喂进 queue.Queue，_rpc 用 q.get(timeout=) 取——**绝不裸 readline 阻塞**
      （否则 server 卡住会挂死 GA 单线程主循环；照搬 ga.py code_run 的"线程+轮询超时"范式）。
命名空间：`mcp__<server>__<tool>`，与 9 个原生工具名零交集。
安全：MCP server 由用户在 mykey 显式配 command（用户自己信任的本地进程）；调用前再把参数过一道
      memguard 威胁扫描（防模型被注入诱导传恶意参数）。**MCP 工具不经红线/写保护具名包装，请只配受信本地 server。**
opt-in：mykey 不配 mcp_servers 则插件全程 no-op，零影响（守"增强默认关闭"铁律）。

────────────────────────────────────────────────────────────────────
配置（加到你的 mykey.py，本文件是上游模板不动它）：

    mcp_servers = {
        "fs": {                                  # server 名 → 工具前缀 mcp__fs__*
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            "env": {},                           # 可选，叠加到子进程环境
            "timeout": 30,                       # 可选，单次 RPC 秒数，默认 30
        },
        "git": {"command": "uvx", "args": ["mcp-server-git"]},
    }
────────────────────────────────────────────────────────────────────
"""
import os
import sys
import json
import time
import queue
import atexit
import threading
import subprocess

from plugins.hooks import register
from agent_loop import StepOutcome
from ga import GenericAgentHandler

_NS = "mcp__"
_EOF = object()          # reader 线程：stdout 流结束哨兵


def _mcp_servers():
    """从用户 mykey 读 mcp_servers 配置；未配则空（插件 no-op）。"""
    try:
        import mykey
        return getattr(mykey, "mcp_servers", {}) or {}
    except Exception:
        return {}


def _qualify(server, tool):
    return f"{_NS}{server}__{tool}"


def _unqualify(qname):
    """mcp__<server>__<tool> → (server, tool)。server 名约定不含 '__'；tool 名含 '__' 仍正确还原。"""
    body = qname[len(_NS):] if qname.startswith(_NS) else qname
    server, _, tool = body.partition("__")
    return server, tool


def _scan_args(args):
    """best-effort：参数序列化后过 memguard 威胁扫描（注入/外发/角色劫持等）。命中返回原因，干净返回 None。
    扫描器不可用不阻断（MCP server 本就是用户显式信任的本地进程，红线在此是纵深防御非唯一边界）。"""
    try:
        from plugins.penglai_memguard import _scan
    except Exception:
        return None
    try:
        blob = json.dumps(args, ensure_ascii=False)
    except Exception:
        blob = str(args)
    try:
        return _scan(blob)
    except Exception:
        return None


# ───────────────────────── stdio JSON-RPC 客户端（一 server 一实例）─────────────────────────
class _StdioMCPClient:
    def __init__(self, name, command, args=None, env=None, timeout=30):
        self.name = name
        self.command = command
        self.args = list(args or [])
        self.timeout = int(timeout or 30)
        self.env = {**os.environ, **(env or {})}
        self.proc = None
        self._id = 0
        self._q = queue.Queue()
        self._wlock = threading.Lock()
        self.tools = None                       # tools/list 缓存

    # —— 后台 reader：阻塞 readline 留在 daemon 线程里，绝不卡主循环 ——
    def _reader(self, proc):
        try:
            for line in iter(proc.stdout.readline, ""):
                line = line.strip()
                if not line:
                    continue
                try:
                    self._q.put(json.loads(line))
                except Exception:
                    continue                    # 跳过非 JSON 噪声行（server 误写 stdout 的日志）
        except Exception:
            pass
        finally:
            self._q.put(_EOF)

    def _alive(self):
        return self.proc is not None and self.proc.poll() is None

    def _start(self):
        if self._alive():
            return
        if not self.command:
            raise RuntimeError(f"MCP[{self.name}] 未配置 command")
        self.proc = subprocess.Popen(
            [self.command, *self.args],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=self.env, text=True, bufsize=1,
            creationflags=0x08000000 if os.name == "nt" else 0)   # Win 不弹窗，照 ga.py
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        self._handshake()

    def _send(self, msg):
        line = json.dumps(msg, ensure_ascii=False) + "\n"
        with self._wlock:
            self.proc.stdin.write(line)
            self.proc.stdin.flush()

    def _rpc(self, method, params=None, notify=False):
        if notify:
            m = {"jsonrpc": "2.0", "method": method}
            if params is not None:
                m["params"] = params
            self._send(m)
            return None
        self._id += 1
        rid = self._id
        m = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            m["params"] = params
        self._send(m)
        deadline = time.time() + self.timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                self._kill()
                raise TimeoutError(f"MCP[{self.name}] {method} 超时 {self.timeout}s")
            try:
                resp = self._q.get(timeout=remaining)
            except queue.Empty:
                self._kill()
                raise TimeoutError(f"MCP[{self.name}] {method} 超时 {self.timeout}s")
            if resp is _EOF:
                raise RuntimeError(f"MCP[{self.name}] 连接关闭")
            if isinstance(resp, dict) and resp.get("id") == rid:
                if resp.get("error"):
                    raise RuntimeError(f"MCP[{self.name}] {resp['error']}")
                return resp.get("result")
            # 其它 id / server 主动通知 → 丢弃继续等

    def _handshake(self):
        self._rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "penglai", "version": "0.2.4"}})
        self._rpc("notifications/initialized", notify=True)

    def list_tools(self, refresh=False):
        if self.tools is not None and not refresh:
            return self.tools
        self._start()
        res = self._rpc("tools/list", {})
        self.tools = res.get("tools", []) if isinstance(res, dict) else []
        return self.tools

    def call_tool(self, tool, arguments):
        self._start()
        return self._rpc("tools/call", {"name": tool, "arguments": arguments or {}})

    def _kill(self):
        try:
            if self._alive():
                self.proc.kill()
        except Exception:
            pass

    def close(self):
        try:
            if self._alive():
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except Exception:
                    self.proc.kill()
        except Exception:
            pass


# ───────────────────────── 进程级 server 池 + 生命周期 ─────────────────────────
_CLIENTS = {}


def _client(name):
    c = _CLIENTS.get(name)
    if c is None:
        cfg = _mcp_servers().get(name) or {}
        c = _StdioMCPClient(name, cfg.get("command"), cfg.get("args"),
                            cfg.get("env"), cfg.get("timeout", 30))
        _CLIENTS[name] = c
    return c


@atexit.register
def _shutdown_all():
    for c in list(_CLIENTS.values()):
        c.close()
    _CLIENTS.clear()


# ───────────────────────── (a) agent_before：动态发现 + schema 注入 ─────────────────────────
def _to_ga_schema(server, t):
    return {"type": "function", "function": {
        "name": _qualify(server, t.get("name", "")),
        "description": f"[MCP:{server}·外部工具] " + (t.get("description") or ""),
        "parameters": t.get("inputSchema") or {"type": "object", "properties": {}}}}


@register("agent_before")
def _inject_mcp_schemas(ctx):
    servers = _mcp_servers()
    if not servers:
        return
    ts = ctx.get("tools_schema")
    if not isinstance(ts, list):
        return
    have = {t.get("function", {}).get("name") for t in ts if isinstance(t, dict)}
    for name in servers:
        try:
            for t in _client(name).list_tools():     # 缓存：首轮起进程发现，后续零成本
                q = _qualify(name, t.get("name", ""))
                if q and q not in have:
                    ts.append(_to_ga_schema(name, t))
                    have.add(q)
        except Exception as e:
            sys.stderr.write(f"[penglai_mcp] server '{name}' 工具发现失败（已跳过，不影响主循环）：{e}\n")


# ───────────────────────── (b) __getattr__ 路由：动态名 → MCP 调用 ─────────────────────────
def _render(res):
    if not isinstance(res, dict):
        return str(res)
    parts = []
    for block in res.get("content", []):
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
        else:
            parts.append(json.dumps(block, ensure_ascii=False))
    txt = "\n".join(p for p in parts if p) if parts else json.dumps(res, ensure_ascii=False)
    if res.get("isError"):
        txt = "[MCP returned error]\n" + txt
    return txt


def _make_handler(server, tool):
    def _do(self, args, response):
        clean = {k: v for k, v in args.items() if not k.startswith("_")}
        why = _scan_args(clean)
        if why:
            msg = f"[MCP 安全拦截] {server}.{tool} 参数命中威胁特征（{why}）——已拒绝调用。"
            yield msg + "\n"
            return StepOutcome(msg, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))
        yield f"\n[Action] MCP {server}.{tool}\n"
        try:
            out = _render(_client(server).call_tool(tool, clean))
        except Exception as e:
            out = f"[MCP Error] {server}.{tool}: {e}"
        yield (out[:600] + "\n…[截断]\n") if len(out) > 600 else (out + "\n")
        return StepOutcome(out, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))
    return _do


_orig_getattr = getattr(GenericAgentHandler, "__getattr__", None)   # 兜底链（当前为 None，已 grep 确认）


def _handler_getattr(self, attr):
    # 仅拦 do_mcp__* 这类动态 MCP 工具名；真实属性（do_code_run 等）走 __getattribute__ 先命中，不进这里。
    if attr.startswith("do_" + _NS):
        server, tool = _unqualify(attr[3:])
        if server in _mcp_servers():
            return _make_handler(server, tool).__get__(self, type(self))
    if _orig_getattr is not None:
        return _orig_getattr(self, attr)
    raise AttributeError(attr)


GenericAgentHandler.__getattr__ = _handler_getattr
