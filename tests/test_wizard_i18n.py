# -*- coding: utf-8 -*-
"""向导 i18n 回归：目录占位符一致性 + 三级回落 + 渠道多选解析。"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import fresh_import, run_tests

_PH = re.compile(r"\{(\w+)\}")


def test_placeholders_match():
    i18n = fresh_import("penglai_i18n")
    bad = []
    for zh, en in i18n.EN.items():
        if set(_PH.findall(zh)) != set(_PH.findall(en)):
            bad.append(zh)
    assert not bad, f"EN 词条占位符与中文 key 不一致: {bad}"


def test_fallback_chain():
    i18n = fresh_import("penglai_i18n")
    i18n.set_lang("en")
    assert i18n.T("环境自检") == "Environment check"
    assert i18n.T("这条词目录里没有") == "这条词目录里没有", "缺词必须回落中文"
    assert i18n.T("（回车={d}）", d="x").strip() == "(Enter = x)"
    # format 参数缺失不抛错，回落原串
    assert "{v}" in i18n.T("需要 Python 3.10+，当前 {v}", wrong="x")
    i18n.set_lang("zh")
    assert i18n.T("环境自检") == "环境自检"


def test_channel_multiselect_parse():
    os.environ["NO_COLOR"] = "1"
    ps = fresh_import("penglai_setup")
    feed = iter(["1,2,3"])
    ps.ask = lambda p, d="": next(feed, d) or d
    assert ps.step_channels() == ["feishu", "wechat", "dingtalk"]
    # 全角逗号、重复、越界 → 重新询问
    feed = iter(["7，7,99", "4"])
    ps.ask = lambda p, d="": next(feed, d) or d
    assert ps.step_channels() == ["qq"]


def test_mykey_writes_lang_and_optional_feishu():
    import tempfile
    ps = fresh_import("penglai_setup")
    ps.ROOT = tempfile.mkdtemp()
    llm = {"name": "x", "apikey": "k", "apibase": "https://e", "model": "m"}
    ps.step_write(llm, None, None, {"companion_enabled": True})
    ns = {}
    exec(open(os.path.join(ps.ROOT, "mykey.py"), encoding="utf-8").read(), ns)
    assert ns["penglai_lang"] in ("zh", "en")
    assert ns["fs_app_id"] == "" and ns["fs_allowed_users"] == []
    assert ns["companion_enabled"] is True


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
