# -*- coding: utf-8 -*-
"""F-005：红线必须扫【真正会被执行】的代码（code / script / 正文代码块），
不能只看 script——否则 `code` 字段或正文代码块可绕过。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import install_fakes, fresh_import, run_gen, Resp, run_tests


def _drive(args, response=None):
    ga = install_fakes()
    fresh_import("plugins.penglai_redline")
    H = ga.GenericAgentHandler
    h = H()
    h._ran = False
    outs, outcome = run_gen(H.do_code_run(h, args, response or Resp()))
    blocked = any(str(o).startswith("⛔") for o in outs) and isinstance(outcome.data, str) \
        and "红线" in outcome.data
    ran = isinstance(outcome.data, dict) and outcome.data.get("status") == "success"
    return blocked, ran


def test_script_field_blocked():
    blocked, ran = _drive({"script": "rm -rf /"})
    assert blocked and not ran, "script 里的 rm -rf / 必须被拦"


def test_code_field_blocked():
    # F-005 核心：do_code_run 是 code or script，红线只看 script 时这里曾绕过
    blocked, ran = _drive({"code": "rm -rf /"})
    assert blocked and not ran, "code 字段里的 rm -rf / 必须被拦（曾可绕过）"


def test_body_code_block_blocked():
    # F-005 核心：无 script/code 时 do_code_run 执行正文代码块，红线必须也扫它
    resp = Resp(content="这就删\n```bash\nrm -rf /\n```\n")
    blocked, ran = _drive({"type": "bash"}, resp)
    assert blocked and not ran, "正文 bash 代码块里的 rm -rf / 必须被拦（曾可绕过）"


def test_benign_python_runs():
    blocked, ran = _drive({"script": "print('hello penglai')"})
    assert ran and not blocked, "正常代码不应被拦"


def test_no_false_positive_on_string_mention():
    # reboot 出现在字符串里（非命令起始位）不应误杀，体现"误杀率优先"
    blocked, ran = _drive({"script": "print('remember to reboot the server tomorrow')"})
    assert ran and not blocked, "字符串里提到 reboot 不应误杀"


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
