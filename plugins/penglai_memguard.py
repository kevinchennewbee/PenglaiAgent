# -*- coding: utf-8 -*-
"""蓬莱插件：memory_guard 记忆卫生（L0 SOP 条款的确定性执法）。

GA 的记忆 SOP（L0）已明文要求：记忆修改"不允许 overwrite，只能少量 patch"、
"严禁写入密码、API Key"——但那只是对 LLM 的口头约束。记忆文件会注入未来会话的
提示词，被污染 = 持久化越狱，所以必须在写入口用代码设卡（借鉴 Hermes
memory_tool 的威胁扫描理念，见 reference/hermes/tools/memory_tool.py）：

1. 注入扫描：写入 memory/ 的内容过正则——提示注入/角色劫持/隐瞒用户（中英双语）、
   隐形 unicode 伪装、疑似密钥落库。命中即拦。
2. 禁整体覆盖：file_write mode=overwrite 落到 memory/ 下【已存在】的文件 → 拦截，
   引导改用 file_patch 最小修改或 mode=append 追加。新建文件不拦（新增 L3 SOP 合法）。

不拦的（误杀率优先于召回率）：
- curl/wget 带密钥变量等外传模式：L3 SOP 里 `curl -H "Bearer $API_KEY"` 是合法
  教学内容；真外传该在执行层拦，penglai_redline 已管 code_run。

code_run 绕写 memory/（F-006）：do_code_run 跑任意 python/bash，cwd 在 workspace 根，
可直接 open('memory/..','w') 绕过上面的威胁扫描与禁覆盖。早期版本放弃拦它（怕"识别
shell 写记忆"误杀），改用"执行前快照 / 执行后比对还原"在执行层兜底——纯读 memory/
不受影响（只对内容变化与新增动作），改写已存在记忆→还原，新建记忆→过同一套威胁
扫描命中即隔离。GA 内核的记忆结算走 file_read/file_patch（do_start_long_term_update
只产出指令文本，不直接写文件），故不误伤；内核高频重写的 file_access_stats.json 与
会话归档 L4_raw_sessions 排除在快照外。

挂载：包装 do_file_write / do_file_patch / do_code_run（类级 monkeypatch，GA 零改动），
与 penglai_redline 同款样板；拦截事件写入 redline 同一份审计 JSONL。
"""
import os, re

from plugins.penglai_redline import audit
from agent_loop import StepOutcome
from ga import GenericAgentHandler, script_dir

MEM_ROOT = os.path.realpath(os.path.join(script_dir, "memory"))

# 借鉴 Hermes _MEMORY_THREAT_PATTERNS（英文原版）+ 中文等价（蓬莱记忆以中文为主）
THREAT_PATTERNS = [
    (r"ignore\s+((previous|all|above|prior)\s+)+(instructions|rules)", "提示注入"),
    (r"disregard\s+(your|all|any)\s+(instructions|rules|guidelines)", "提示注入"),
    (r"system\s+prompt\s+override", "系统提示覆写"),
    (r"you\s+are\s+now\s+(a\b|an\b|in\s+charge|free|unrestricted)", "角色劫持"),
    (r"do\s+not\s+tell\s+the\s+user", "隐瞒用户"),
    (r"忽略(之前|以上|此前|先前|所有|全部)[^\n]{0,8}(指令|指示|规则|提示词?)", "提示注入"),
    (r"(无视|不要(遵守|遵循|理会))[^\n]{0,8}(系统提示|安全(规则|限制)|红线|指令)", "提示注入"),
    (r"你(从现在起|从此|现在)(就?是|扮演|变成)", "角色劫持"),
    (r"(不要|别|不得|禁止|不能)(告诉|告知|透露给)(用户|主人)", "隐瞒用户"),
    # 密钥落库（L0 SOP：严禁写入密码、API Key；密钥只住 mykey.py）
    (r"sk-[A-Za-z0-9_\-]{16,}", "疑似 API Key 落库"),
    (r"(api[_-]?key|access[_-]?token|secret[_-]?key)['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}",
     "疑似密钥落库"),
]

# 隐形 unicode（零宽/方向控制字符，注入伪装常用），同 Hermes
INVISIBLE_CHARS = {"\u200b", "\u200c", "\u200d", "\u2060", "\ufeff",
                   "\u202a", "\u202b", "\u202c", "\u202d", "\u202e"}


def _scan(content):
    """返回命中原因；干净返回 None。"""
    if not content: return None
    for ch in INVISIBLE_CHARS:
        if ch in content:
            return f"隐形 unicode 字符 U+{ord(ch):04X}（疑似注入伪装）"
    for pat, why in THREAT_PATTERNS:
        if re.search(pat, content, re.I):
            return why
    return None


def _is_memory_path(handler, path):
    if not path: return False
    ap = os.path.realpath(handler._get_abs_path(str(path)))
    return ap == MEM_ROOT or ap.startswith(MEM_ROOT + os.sep)


def _effective_content(args, response):
    """与 do_file_write 同口径取实际写入内容（args.content 优先，否则从回复体提取）。"""
    c = args.get("content")
    if c: return c
    text = getattr(response, "content", "") or ""
    tags = re.findall(r"<file_content[^>]*>(.*?)</file_content>", text, re.DOTALL)
    if tags: return tags[-1].strip()
    blocks = re.findall(r"```[^\n]*\n([\s\S]*?)```", text)
    if blocks: return blocks[-1].strip()
    return ""


def _block(self, args, reason):
    msg = (f"⛔ 蓬莱记忆卫生拦截：{reason}。记忆会注入未来会话的提示词，"
           f"该写入被确定性卫生策略禁止。若确属用户明确要求，请用 ask_user 向用户说明并确认。")
    return StepOutcome(msg, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))


_orig_file_write = GenericAgentHandler.do_file_write


def _guarded_file_write(self, args, response):
    path = str(args.get("path", ""))
    if _is_memory_path(self, path):
        ap = os.path.realpath(self._get_abs_path(path))
        if args.get("mode", "overwrite") == "overwrite" and os.path.exists(ap):
            audit("file_write", {"path": path, "mode": "overwrite"},
                  blocked=True, reason="记忆卫生:禁整体覆盖")
            yield "⛔ 记忆卫生拦截: 禁止 overwrite 整体覆盖已有记忆文件\n"
            return _block(self, args, f"记忆文件 {os.path.basename(ap)} 已存在，禁止整体覆盖"
                          f"（L0 SOP：只能少量 patch）。请先 file_read 现有内容，"
                          f"用 file_patch 最小化修改，或确属追加时用 mode=append")
        why = _scan(_effective_content(args, response))
        if why:
            audit("file_write", {"path": path}, blocked=True, reason=f"记忆卫生:{why}")
            yield f"⛔ 记忆卫生拦截: {why}\n"
            return _block(self, args, f"写入内容命中威胁模式（{why}）")
    return (yield from _orig_file_write(self, args, response))


GenericAgentHandler.do_file_write = _guarded_file_write

_orig_file_patch = GenericAgentHandler.do_file_patch


def _guarded_file_patch(self, args, response):
    path = str(args.get("path", ""))
    if _is_memory_path(self, path):
        why = _scan(str(args.get("new_content", "")))
        if why:
            audit("file_patch", {"path": path}, blocked=True, reason=f"记忆卫生:{why}")
            yield f"⛔ 记忆卫生拦截: {why}\n"
            return _block(self, args, f"补丁新内容命中威胁模式（{why}）")
    return (yield from _orig_file_patch(self, args, response))


GenericAgentHandler.do_file_patch = _guarded_file_patch


# ── code_run 记忆绕写防护（F-006）：执行前快照 → 执行后比对还原 ──────────────
# 项目记忆（project_mode 上游插件）也纳入保护：temp/projects/*/project_memory.md
_PROJ_MEM_ROOT = os.path.realpath(os.path.join(script_dir, "temp", "projects"))
_SNAPSHOT_SKIP_DIRS = {"L4_raw_sessions", "__pycache__", ".git"}   # 不注入提示词的归档/缓存
_SNAPSHOT_EXCLUDE_NAMES = {"file_access_stats.json"}              # 内核每次读记忆都重写


def _protected_files():
    """枚举受保护的记忆文件实路径：注入提示词的 L1/L2 + 技能 + 项目记忆。
    排除会话归档与访问统计（内核高频写、且不进提示词，纳入会误还原）。"""
    if os.path.isdir(MEM_ROOT):
        for dp, dirs, files in os.walk(MEM_ROOT):
            dirs[:] = [d for d in dirs if d not in _SNAPSHOT_SKIP_DIRS]
            for fn in files:
                if fn not in _SNAPSHOT_EXCLUDE_NAMES:
                    yield os.path.realpath(os.path.join(dp, fn))
    if os.path.isdir(_PROJ_MEM_ROOT):
        for dp, dirs, files in os.walk(_PROJ_MEM_ROOT):
            dirs[:] = [d for d in dirs if d not in _SNAPSHOT_SKIP_DIRS]
            for fn in files:
                if fn == "project_memory.md":
                    yield os.path.realpath(os.path.join(dp, fn))


def _snapshot_memory():
    snap = {}
    for fp in _protected_files():
        try:
            with open(fp, "rb") as f:
                snap[fp] = f.read()
        except Exception:
            pass
    return snap


def _enforce_memory(snap):
    """对比快照：已存在文件被改写/删除→还原；新建文件→威胁扫描，命中→隔离删除。
    返回 [(路径, 原因), ...]。"""
    violations = []
    current = set(_protected_files())
    for fp in current:
        try:
            with open(fp, "rb") as f:
                now = f.read()
        except Exception:
            continue
        if fp in snap:
            if now != snap[fp]:
                try:
                    with open(fp, "wb") as f:
                        f.write(snap[fp])
                    violations.append((fp, "code_run 改写已存在记忆→已还原"))
                except Exception:
                    pass
        else:
            why = _scan(now.decode("utf-8", "replace"))
            if why:
                try:
                    os.remove(fp)
                except Exception:
                    pass
                violations.append((fp, f"code_run 新建记忆命中威胁({why})→已隔离"))
    for fp, data in snap.items():
        if fp not in current and not os.path.exists(fp):
            try:
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                with open(fp, "wb") as f:
                    f.write(data)
                violations.append((fp, "code_run 删除记忆→已还原"))
            except Exception:
                pass
    return violations


_orig_code_run_mem = GenericAgentHandler.do_code_run


def _guarded_code_run_mem(self, args, response):
    snap = _snapshot_memory()
    outcome = yield from _orig_code_run_mem(self, args, response)
    try:
        violations = _enforce_memory(snap)
    except Exception:
        violations = []
    if violations:
        for fp, why in violations:
            audit("code_run", {"path": fp}, blocked=True, reason=f"记忆卫生:{why}")
        note = ("⛔ 蓬莱记忆卫生：code_run 改动了长期记忆，已自动撤销/隔离（"
                + "；".join(f"{os.path.basename(fp)}:{w}" for fp, w in violations)
                + "）。长期记忆只能经 memory_update / file_patch 走威胁扫描写入，"
                "不可用 code_run 绕写。")
        yield note + "\n"
        try:
            data = getattr(outcome, "data", None)
            if isinstance(data, str):
                outcome.data = note + "\n" + data
            elif isinstance(data, dict):
                data["penglai_memguard"] = note
        except Exception:
            pass
    return outcome


# 链顺序：memguard 先 import redline（见顶部），故 redline 先包 do_code_run；此处再包一层，
# 运行时链 = memguard(快照/还原) → redline(红线扫码) → GA 原始。红线拦截时代码不执行，
# memguard 快照无变化，二者互不干扰。
GenericAgentHandler.do_code_run = _guarded_code_run_mem
