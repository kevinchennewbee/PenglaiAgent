# -*- coding: utf-8 -*-
"""penglai migrate 纯函数单测（无 IO，秒级）。覆盖规格 §7.4：
parse_entries（§/markdown 双路径）、merge_entries（去重+上限+overflow 统计）、
_match_provider（火山命中 / 未命中兜底）、rebrand_text、map_channels（ALLOW_ALL→['*'] / 逗号串拆分）。
另带 fixtures 端到端 build_plan（PENGLAI_MIGRATE_HOME 覆盖，离线 dry-run）。

跑法：python3 tests/test_penglai_migrate.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests  # 复用既有兜底执行器

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import penglai_migrate as pm

FIXTURE = os.path.join(ROOT, "_internal", "migration-research", "fixtures", ".hermes")


# ---------- parse_entries：§ 路径 ----------
def test_parse_entries_section_delimiter():
    text = "条目一\n§\n条目二\n§\n条目三"
    out = pm.parse_entries(text)
    assert out == ["条目一", "条目二", "条目三"], out


def test_parse_entries_section_drops_empty():
    text = "  \n§\n有内容\n§\n   "
    out = pm.parse_entries(text)
    assert out == ["有内容"], out


# ---------- parse_entries：markdown 回退路径 ----------
def test_parse_entries_markdown_fallback():
    text = "## 标题甲\n正文 A\n## 标题乙\n正文 B"
    out = pm.parse_entries(text)
    assert len(out) == 2, out
    assert out[0].startswith("## 标题甲") and "正文 A" in out[0]
    assert out[1].startswith("## 标题乙") and "正文 B" in out[1]


def test_parse_entries_empty():
    assert pm.parse_entries("") == []
    assert pm.parse_entries(None) == []


# ---------- merge_entries：去重 ----------
def test_merge_entries_dedup():
    existing = ["alpha 事实", "beta 事实"]
    incoming = ["ALPHA   事实", "gamma 事实"]  # alpha 大小写/空白归一后算重复
    merged, st = pm.merge_entries(existing, incoming, limit=10000)
    assert "gamma 事实" in merged
    assert st["added"] == 1, st
    assert st["duplicates"] == 1, st
    assert st["overflowed"] == 0, st
    # 既有条目绝不被删
    assert merged[:2] == existing


# ---------- merge_entries：上限 + overflow 统计 ----------
def test_merge_entries_overflow():
    existing = ["x" * 90]          # 已占 90
    incoming = ["y" * 8, "z" * 8]  # limit=100：第一条放得下(98)，第二条溢出
    merged, st = pm.merge_entries(existing, incoming, limit=100)
    assert st["added"] == 1, st
    assert st["overflowed"] == 1, st
    assert st["duplicates"] == 0, st
    assert len(merged) == 2


# ---------- _match_provider：火山命中 / 未命中兜底 ----------
def test_match_provider_volcengine_hit():
    name = pm._match_provider("https://ark.cn-beijing.volces.com/api/coding/v3", "ark-code-latest")
    # 命中 → 取 provider 的 name/display（实际 yaml 用 display=字节火山 Ark），非模型名兜底
    assert name not in ("ark-code-latest", "migrated-model"), name
    assert "火山" in name or "Ark" in name, name


def test_match_provider_trailing_slash_hit():
    # base_url 带尾斜杠也应命中（rstrip）
    name = pm._match_provider("https://ark.cn-beijing.volces.com/api/coding/v3/", "ark-code-latest")
    assert "火山" in name or "Ark" in name, name


def test_match_provider_miss_fallback():
    name = pm._match_provider("https://no-such-endpoint.example.com/v1", "my-model")
    assert name == "my-model", name


def test_match_provider_empty_base_fallback():
    # 空 base 不应误命中某个 base_url 也为空的 billing
    name = pm._match_provider("", "fallback-model")
    assert name == "fallback-model", name


# ---------- rebrand_text ----------
def test_rebrand_text_brand_and_path():
    text = "Hermes 是个管家，数据在 ~/.hermes 里。OpenClaw 同理。"
    out = pm.rebrand_text(text, "蓬莱助手")
    assert "Hermes" not in out and "OpenClaw" not in out, out
    assert "蓬莱助手" in out
    assert "~/.hermes" not in out
    assert pm.ROOT in out


def test_rebrand_text_default_name():
    out = pm.rebrand_text("Hermes 你好", "")
    assert "Hermes" not in out, out


# ---------- map_channels：ALLOW_ALL → ['*'] ----------
def test_map_channels_allow_all_env():
    env = {"FEISHU_APP_ID": "cli_x", "FEISHU_ALLOW_ALL_USERS": "true"}
    pairs, notes = pm.map_channels(env, {}, "/nonexistent")
    assert pairs["fs_app_id"] == "cli_x"
    assert pairs["fs_allowed_users"] == ["*"], pairs
    # ALLOW_ALL 的红字警告已移到 preview 层（避免重复），map_channels 只置数据 ['*']


def test_map_channels_allow_all_config():
    # config.GATEWAY_ALLOW_ALL_USERS: true 也触发 ['*']
    pairs, _ = pm.map_channels({}, {"GATEWAY_ALLOW_ALL_USERS": True}, "/nonexistent")
    assert pairs.get("fs_allowed_users") == ["*"], pairs


# ---------- map_channels：逗号串拆分（含中文逗号）----------
def test_map_channels_allowed_users_split():
    env = {"FEISHU_ALLOWED_USERS": "ou_a, ou_b，ou_c ,"}  # 半角+全角逗号+尾空项
    pairs, _ = pm.map_channels(env, {}, "/nonexistent")
    assert pairs["fs_allowed_users"] == ["ou_a", "ou_b", "ou_c"], pairs


def test_map_channels_token_map():
    env = {"TELEGRAM_BOT_TOKEN": "123:abc", "DISCORD_BOT_TOKEN": "dtok"}
    pairs, _ = pm.map_channels(env, {}, "/nonexistent")
    assert pairs["tg_bot_token"] == "123:abc"
    assert pairs["discord_bot_token"] == "dtok"


# ---------- redact ----------
def test_redact_long_value():
    assert pm.redact("ark-bee13d2c1234567890abcd14da1").startswith("ark-")
    assert pm.redact("ark-bee13d2c1234567890abcd14da1").endswith("4da1")
    assert "…" in pm.redact("ark-bee13d2c1234567890abcd14da1")


def test_redact_empty():
    assert pm.redact("") == ""
    assert pm.redact(None) == ""


# ---------- fixtures 端到端 build_plan（离线，PENGLAI_MIGRATE_HOME 覆盖 detect）----------
def test_fixture_build_plan():
    if not os.path.isdir(FIXTURE):
        return  # fixture 缺失则跳过（不算失败）
    old = os.environ.get("PENGLAI_MIGRATE_HOME")
    os.environ["PENGLAI_MIGRATE_HOME"] = FIXTURE
    try:
        hits = pm.detect()
        assert hits and hits[0][1] == FIXTURE, hits
        plan = pm.build_plan(hits[0][0], hits[0][1], {"with_secrets": False})
    finally:
        if old is None:
            os.environ.pop("PENGLAI_MIGRATE_HOME", None)
        else:
            os.environ["PENGLAI_MIGRATE_HOME"] = old
    # 主模型命中火山，apikey 带回（落明文与否由 apply 决定）
    nat = plan["model"]["native"]
    assert nat["model"] == "ark-code-latest", nat
    assert "火山" in nat["name"] or "Ark" in nat["name"], nat
    # GATEWAY_ALLOW_ALL_USERS:true → fs_allowed_users ['*']（config 触发，环境 false 时仍命中）
    assert plan["channels"].get("fs_allowed_users") == ["*"], plan["channels"]
    assert plan["channels"]["fs_app_id"] == "cli_FAKEAPPID00001"
    # 记忆两段（长期记忆 3 条 + 用户画像 2 条）
    sects = list(plan["memory"].keys())
    assert any("长期记忆" in s for s in sects), sects
    assert any("用户画像" in s for s in sects), sects
    longterm = [v for k, v in plan["memory"].items() if "长期记忆" in k][0]
    assert len(longterm) == 3, longterm
    # 人设抽到名字 + Owner
    assert plan["persona"]["owner"] == "陈老师", plan["persona"]
    assert "小雅" in plan["persona"]["agent_name"], plan["persona"]


def test_write_section_handles_brackets_in_body():
    # M3 回归：正文含 `## [` 不应被当 section 边界丢尾
    full = pm._write_section("", "A", "line1\n## [Fake Heading]\nline2")
    body = pm._read_section(full, "A")
    assert "line1" in body and "Fake Heading" in body and "line2" in body, repr(body)
    # 再写另一 section，A 不受影响、不丢尾
    full = pm._write_section(full, "B", "bbb")
    assert "line2" in pm._read_section(full, "A")
    assert pm._read_section(full, "B") == "bbb"
    # 幂等：同 section 重写只替换不累积
    full2 = pm._write_section(full, "A", "x\n## [Y]\nz")
    assert pm._read_section(full2, "A").count("z") == 1


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
