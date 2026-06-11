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
- code_run 绕写 memory/：可靠识别"shell 写记忆"误杀风险高，SOP 已禁 + redline 管致命面。

挂载：包装 do_file_write / do_file_patch（类级，GA 零改动），与 penglai_redline
同款样板；拦截事件写入 redline 同一份审计 JSONL。
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
