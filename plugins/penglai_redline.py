# -*- coding: utf-8 -*-
"""蓬莱插件：确定性红线 + 全量审计（依法治国 + CCTV）。

- 红线靠代码正则，不靠 LLM 自觉（OpenClaw 教训）。命中 → 拦截，并告知 agent
  可用 ask_user 向用户请示。误杀率优先于召回率：只拦高置信度的致命操作。
- 审计：每次工具调用一行 JSONL（密钥脱敏），<workspace>/audit/YYYY-MM.jsonl，追加式。
挂载：包装 do_code_run / do_file_write / do_file_patch（类级，GA 零改动）+ tool_before 审计钩子。
"""
import os, re, json, time

from plugins.hooks import register
from agent_loop import StepOutcome
from ga import GenericAgentHandler

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_CMD = r"(^|[;&|`]\s*|\bsudo\s+)"  # 命令起始位置，降低误杀（如 echo "reboot guide" 不拦）
RED_CODE = [
    (r"rm\s+(-[a-zA-Z]+\s+)*(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(/|\$HOME|~)/?(\s*$|\*)", "递归删除根/家目录"),
    (_CMD + r"mkfs\b|\bdd\b[^|\n]*\bof=/dev/|>\s*/dev/(sd|nvme|vd)", "磁盘破坏操作"),
    (_CMD + r"(shutdown|reboot|halt|poweroff)\b", "关机/重启服务器"),
    (r":\(\)\s*\{[^}]*\|[^}]*&[^}]*\}", "fork 炸弹"),
    (r"\b([A-Za-z_]\w*)\s*\(\)\s*\{[^}]*\b\1\b[^}]*\|[^}]*\b\1\b[^}]*&[^}]*\}", "fork 炸弹(命名函数递归)"),
    (r"while\s+(true|1)\s*;\s*do[^\n]{0,80}\|[^\n]{0,80}&[^\n]{0,80}done", "fork 炸弹(while 循环管道)"),
    (r"os\.fork\(\)[\s\S]{0,120}(for|while|range)", "Python fork 炸弹"),
    (r"(pkill|killall)\s+(-9\s+)?(-f\s+)?['\"]?python", "无差别杀 python 进程（会杀掉蓬莱自己）"),
    (_CMD + r"chmod\s+(-R\s+)?777\s+/\s*$", "根目录权限破坏"),
    (r"(mykey\.py|\.ssh/id_)[^\n]{0,120}(curl|wget|\bnc\b|requests\.(post|put)|urlopen)"
     r"|(curl|wget)[^\n]{0,120}(mykey\.py|\.ssh/id_)", "疑似密钥外传"),
]
_IM_FILE_API_RE = re.compile(
    r"(open-apis/)?im/v1/files|open\.feishu\.cn[^\n'\"]*/open-apis/im/v1/files",
    re.I,
)
_IM_FILE_MESSAGE_RE = re.compile(
    r"(open-apis/)?im/v1/messages[^\n]{0,160}"
    r"([\"']msg_type[\"']\s*:\s*[\"'](?:file|media|image|audio)[\"']|"
    r"msg_type\s*=\s*[\"'](?:file|media|image|audio)[\"'])",
    re.I | re.S,
)
PROTECTED_WRITE = [
    (r"mykey(\.py|\.json)$", "密钥配置文件"),
    (r"(^|/)\.ssh(/|$)", "SSH 密钥目录"),
    (r"^/etc(/|$)", "系统配置目录"),
    (r"(^|/)\.env(\.|$)", "环境密钥文件"),
]

def _audit_path():
    explicit = os.environ.get("PENGLAI_AUDIT_DIR")
    if explicit:
        d = os.path.expanduser(explicit)
    else:
        base = os.environ.get("GA_USER_DATA_DIR") or os.environ.get("GA_WORKSPACE_ROOT") or os.path.expanduser("~/penglai-work")
        base = os.path.realpath(os.path.expanduser(base))
        repo = os.path.realpath(_REPO_ROOT)
        if base == repo or base.startswith(repo + os.sep):
            base = os.path.expanduser("~/penglai-work")
        d = os.path.join(base, "audit")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, time.strftime("%Y-%m") + ".jsonl")

_URL_BARE_TOKEN_RE = re.compile(r"(\w+)://([^\s:/@]{8,})@([^\s:/@]+)")
_MASK = re.compile(
    r"((?:sk|tvly|fc|cpk|gsk|glm|xai)[-_][A-Za-z0-9_\-]{8,}"      # 常见 key 值前缀(OpenAI/Tavily/Firecrawl/Agnes/智谱/xAI 等)
    r"|\b\w*(?:api[_-]?key|secret|token|password|_key)\w*\b['\"]?\s*[:=]\s*['\"]?[^'\"\s,}]{6,}"
    r"|(?i:(?:token|api[_-]?key|secret|password)=)[^&\s'\"<>]{6,})")


def _strip_control_chars(s):
    if not isinstance(s, str):
        return s
    return "".join(c for c in s if c >= " " or c in "\t\n")


def _redact_text(s):
    if not isinstance(s, str):
        return s
    s = _URL_BARE_TOKEN_RE.sub(r"\1://***@\3", s)
    return _strip_control_chars(_MASK.sub("***", s))

def audit(tool, args, blocked=False, reason=""):
    try:
        s = json.dumps({k: v for k, v in (args or {}).items() if not str(k).startswith("_")},
                       ensure_ascii=False, default=str)[:600]
        rec = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "tool": tool, "args": _redact_text(s)}
        if blocked:
            rec["blocked"] = True
            rec["reason"] = reason
        with open(_audit_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass  # 审计失败绝不影响主流程

@register("tool_before")
def _audit_every_call(ctx):
    audit(ctx.get("tool_name", "?"), ctx.get("args") or {})

def _block(self, args, reason):
    msg = (f"⛔ 蓬莱红线拦截：{reason}。该操作被确定性安全策略禁止（不可协商）。"
           f"若确属用户明确要求，请用 ask_user 向用户说明风险并获得确认，再寻找更安全的替代方案。")
    return StepOutcome(msg, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))

_orig_code_run = GenericAgentHandler.do_code_run

def _resolve_code(self, args, response):
    """与 ga.do_code_run 同口径取【真正会被执行】的代码，堵死绕过：
    do_code_run 是 `code = args.get("code") or args.get("script")`，二者皆空时再从
    回复正文代码块提取（_extract_code_block）。只扫 script 会被 `code` 字段或正文
    代码块绕过（schema 本身就鼓励无 script 时用正文代码块）。"""
    code = args.get("code") or args.get("script")
    if not code:
        try:
            code = self._extract_code_block(response, args.get("type", "python"))
        except Exception:
            code = None
    return str(code or "")

def _direct_im_file_send_reason(code):
    """Keep external file transport inside Penglai delivery adapters."""
    if not code:
        return ""
    if _IM_FILE_API_RE.search(code) or _IM_FILE_MESSAGE_RE.search(code):
        return "直接调用 IM 文件发送 API；请生成文件并在最终回复中输出 [FILE:路径]，由蓬莱统一交付层发送"
    return ""

def _scrub(s):
    """code_run 输出里的密钥脱敏后再返回——堵死 agent `cat mykey.py` / 打印 key 把
    MiniMax/DeepSeek/TinyFish/飞书 secret 明文写进 model_responses 日志（真实运行中踩过，
    违 GA 宪法第4条 key 文件 reference-only）。复用审计同款 _MASK；agent 本就不该读 key 原值
    （配置走 mykey_set），脱敏不影响正常用。"""
    return _redact_text(s) if isinstance(s, str) else s


def _guarded_code_run(self, args, response):
    code = _resolve_code(self, args, response)
    why = _direct_im_file_send_reason(code)
    if why:
        audit("code_run", {"code": code[:300]}, blocked=True, reason=why)
        yield f"⛔ 红线拦截: {why}\n"
        return _block(self, args, why)
    for pat, why in RED_CODE:
        if re.search(pat, code, re.I | re.M):
            audit("code_run", {"code": code[:300]}, blocked=True, reason=why)
            yield f"⛔ 红线拦截: {why}\n"
            return _block(self, args, why)
    # 放行；但把执行输出经 _MASK 脱敏，密钥不进上下文 / model_responses 日志
    gen = _orig_code_run(self, args, response)
    outcome = None
    try:
        while True:
            yield _scrub(next(gen))
    except StopIteration as e:
        outcome = e.value
    if outcome is not None and isinstance(getattr(outcome, "data", None), str):
        outcome = StepOutcome(_scrub(outcome.data),
                              next_prompt=outcome.next_prompt, should_exit=outcome.should_exit)
    return outcome

GenericAgentHandler.do_code_run = _guarded_code_run

def _make_write_guard(orig, toolname):
    def _guarded(self, args, response):
        path = str(args.get("path", "")).replace("\\", "/")
        for pat, why in PROTECTED_WRITE:
            if re.search(pat, path, re.I):
                audit(toolname, {"path": path}, blocked=True, reason=f"写保护:{why}")
                yield f"⛔ 红线拦截: 写入受保护路径（{why}）\n"
                return _block(self, args, f"禁止写入受保护路径 {path}（{why}）")
        return (yield from orig(self, args, response))
    return _guarded

GenericAgentHandler.do_file_write = _make_write_guard(GenericAgentHandler.do_file_write, "file_write")
GenericAgentHandler.do_file_patch = _make_write_guard(GenericAgentHandler.do_file_patch, "file_patch")
