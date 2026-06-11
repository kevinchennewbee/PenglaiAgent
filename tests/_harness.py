# -*- coding: utf-8 -*-
"""蓬莱安全回归测试的轻量桩：用伪 ga / agent_loop 把蓬莱安全插件从 GA 内核里隔离出来
单测，不依赖完整运行时、不碰真实记忆/真实 mykey。

伪 GenericAgentHandler 的 do_code_run 会【真的 exec】传入的 python 代码（cwd=handler.cwd），
以便 memguard 的"执行前快照 / 执行后还原"能在受控临时目录里被真实触发与验证。
"""
import os
import re
import sys
import types
import importlib

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)


class StepOutcome:
    def __init__(self, data, next_prompt=None, should_exit=False):
        self.data = data
        self.next_prompt = next_prompt
        self.should_exit = should_exit


class Resp:
    def __init__(self, content=""):
        self.content = content


def _make_handler():
    class GenericAgentHandler:
        def __init__(self, cwd=None):
            self.cwd = cwd or REPO

        def _get_abs_path(self, path):
            return os.path.abspath(os.path.join(self.cwd, path)) if path else ""

        def _get_anchor_prompt(self, skip=False):
            return "\n"

        def _extract_code_block(self, response, code_type):
            ct = {"python": "python|py", "powershell": "powershell|ps1|pwsh",
                  "bash": "bash|sh|shell"}.get(code_type, re.escape(code_type))
            m = re.findall(rf"```(?:{ct})\n(.*?)\n```", getattr(response, "content", "") or "", re.DOTALL)
            return m[-1].strip() if m else None

        def do_code_run(self, args, response):
            code = args.get("code") or args.get("script") \
                or self._extract_code_block(response, args.get("type", "python"))
            yield "[orig] code_run\n"
            if code and args.get("type", "python") in ("python", "py"):
                old = os.getcwd()
                try:
                    os.chdir(self.cwd)
                    exec(code, {"__name__": "__main__"})
                finally:
                    os.chdir(old)
            return StepOutcome({"status": "success", "ran": bool(code)})

        def do_file_write(self, args, response):
            yield "[orig] file_write\n"
            return StepOutcome({"status": "success"})

        def do_file_patch(self, args, response):
            yield "[orig] file_patch\n"
            return StepOutcome({"status": "success"})

    return GenericAgentHandler


def install_fakes(script_dir=REPO):
    """把伪 ga / agent_loop 装进 sys.modules（每次给出全新的 GenericAgentHandler 类）。"""
    al = types.ModuleType("agent_loop")
    al.StepOutcome = StepOutcome
    al.BaseHandler = object
    al.json_default = lambda o: str(o)
    sys.modules["agent_loop"] = al

    ga = types.ModuleType("ga")
    ga.script_dir = script_dir
    ga.GenericAgentHandler = _make_handler()
    sys.modules["ga"] = ga
    return ga


def fresh_import(modname):
    """强制重新 import（丢掉缓存），让模块级 monkeypatch 作用在当前这套伪 handler 上。"""
    sys.modules.pop(modname, None)
    return importlib.import_module(modname)


def run_gen(gen):
    """驱动生成器到底，返回 (yield 出来的片段列表, return 值)。"""
    outs = []
    try:
        while True:
            outs.append(next(gen))
    except StopIteration as e:
        return outs, e.value


def run_tests(namespace):
    """无 pytest 时的兜底执行器：跑 namespace 里所有 test_*，返回失败数。"""
    import traceback
    failed = 0
    for name in sorted(namespace):
        fn = namespace[name]
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS {name}")
            except Exception:
                failed += 1
                print(f"  FAIL {name}")
                traceback.print_exc()
    return failed
