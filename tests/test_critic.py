# -*- coding: utf-8 -*-
"""批判脑插件底线测试：本地绊线常开，异厂商复核未配置时不阻断主流程。"""
import os
import sys
import json
import types
import tempfile
import importlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import StepOutcome, Resp, run_gen, run_tests  # noqa: E402


def _load_critic():
    al = types.ModuleType("agent_loop")
    al.StepOutcome = StepOutcome
    sys.modules["agent_loop"] = al

    class GenericAgentHandler:
        def __init__(self):
            self.history_info = []

        def do_start_long_term_update(self, args, response):
            yield "[orig] memory_update\n"
            return StepOutcome({"status": "ok"}, next_prompt="base prompt", should_exit=False)

    ga = types.ModuleType("ga")
    ga.GenericAgentHandler = GenericAgentHandler
    sys.modules["ga"] = ga
    sys.modules.pop("plugins.penglai_critic", None)
    mod = importlib.import_module("plugins.penglai_critic")
    mod._STATE = os.path.join(tempfile.mkdtemp(), "critic_state.json")
    return mod, ga.GenericAgentHandler


def test_critic_tripwire_catches_overconfident_claims():
    mod, _ = _load_critic()

    hits = mod.tripwire("已经验证全部搞定，绝对没问题。")

    assert "过度自信措辞" in hits
    assert "声称已验证/完成（核实是否真有工具执行背书）" in hits


def test_critic_unconfigured_cross_vendor_review_is_silent():
    mod, _ = _load_critic()
    mod._mykeys = lambda: {}

    assert mod.cross_vendor_review("已经验证完成") is None


def test_critic_cross_vendor_review_skips_same_vendor_model():
    mod, _ = _load_critic()
    mod._mykeys = lambda: {
        "native_oai_config": {
            "name": "DeepSeek",
            "apibase": "https://api.deepseek.com",
            "apikey": "sk-main",
            "model": "deepseek-v4-flash",
        },
        "critic_model": {
            "name": "DeepSeek",
            "apibase": "https://api.deepseek.com",
            "apikey": "sk-critic",
            "model": "deepseek-v4-pro",
        },
    }

    assert mod.cross_vendor_review("已经验证完成") is None
    state = json.load(open(mod._STATE, encoding="utf-8"))
    assert state["last_review_skipped"] == "same_vendor_or_missing_main"


def test_critic_detail_line_reports_cross_vendor_review_state():
    import penglai_abilities as pa
    old_root = pa.ROOT
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "temp"), exist_ok=True)
    with open(os.path.join(root, "temp", "critic_state.json"), "w", encoding="utf-8") as f:
        json.dump({
            "last_review_ts": 1000000000,
            "last_review_result": "risk",
            "last_review_model": "deepseek-v4-flash",
            "main_vendor": "minimax",
            "critic_vendor": "deepseek",
        }, f)
    try:
        pa.ROOT = root
        text = pa._critic_detail_line()
    finally:
        pa.ROOT = old_root

    assert "结果：risk" in text
    assert "模型：deepseek-v4-flash" in text
    assert "厂商：minimax→deepseek" in text
    assert "unknown" not in text


def test_critic_detail_line_reports_review_skip_reason():
    import penglai_abilities as pa
    old_root = pa.ROOT
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "temp"), exist_ok=True)
    with open(os.path.join(root, "temp", "critic_state.json"), "w", encoding="utf-8") as f:
        json.dump({"last_review_skipped": "same_vendor_or_missing_main"}, f)
    try:
        pa.ROOT = root
        text = pa._critic_detail_line()
    finally:
        pa.ROOT = old_root

    assert "跳过：same_vendor_or_missing_main" in text


def test_critic_appends_caution_to_memory_update_when_tripwire_hits():
    mod, Handler = _load_critic()
    mod._mykey = lambda name: "smart" if name == "critic_mode" else None
    h = Handler()
    h.history_info = ["已经验证全部搞定"]

    outs, outcome = run_gen(h.do_start_long_term_update({}, Resp("肯定没问题")))

    assert outs == ["[orig] memory_update\n"]
    assert outcome.next_prompt
    assert "蓬莱批判脑" in outcome.next_prompt
    assert "No Execution, No Memory" in outcome.next_prompt


def test_critic_off_mode_leaves_memory_update_unchanged():
    mod, Handler = _load_critic()
    mod._mykey = lambda name: "off" if name == "critic_mode" else None
    h = Handler()
    h.history_info = ["已经验证全部搞定"]

    _outs, outcome = run_gen(h.do_start_long_term_update({}, Resp("肯定没问题")))

    assert outcome.next_prompt == "base prompt"


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
