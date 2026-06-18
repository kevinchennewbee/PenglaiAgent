# -*- coding: utf-8 -*-
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests

agentmain = types.ModuleType("agentmain")
agentmain.GeneraticAgent = object
sys.modules["agentmain"] = agentmain

continue_cmd = types.ModuleType("continue_cmd")
continue_cmd.handle_frontend_command = lambda *a, **k: ""
continue_cmd.install = lambda *a, **k: None
continue_cmd.reset_conversation = lambda *a, **k: ""
sys.modules["continue_cmd"] = continue_cmd

btw_cmd = types.ModuleType("btw_cmd")
btw_cmd.handle_frontend_command = lambda *a, **k: ""
btw_cmd.install = lambda *a, **k: None
sys.modules["btw_cmd"] = btw_cmd

review_cmd = types.ModuleType("review_cmd")
review_cmd.install = lambda *a, **k: None
sys.modules["review_cmd"] = review_cmd

from frontends.chatapp_common import clean_reply


def test_clean_reply_removes_internal_summary_markup():
    assert clean_reply("<summary>内部摘要,不要发给用户。</summary>\n\n已完成") == "已完成"
    assert clean_reply("<summary>未闭合内部摘要") == "..."


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
