# -*- coding: utf-8 -*-
"""Phase 2 测试：声音档案注册表。

验证：
1. list_voice_profiles 返回公开声音，排除名人模仿/克隆风险声音。
2. validate_voice 拒绝屏蔽声音。
3. resolve_voice 优先级：显式指定 > 性别+语言 > persona 推断 > 兜底。
4. choose_default_voice 向后兼容。
5. list_voices() 在 tts_service 可用。
"""
import pytest

from penglai_runtime import voice_profiles as vp

# tts_service 可能依赖较重的能力模块（capabilities 等），在无头/精简环境可能不可导入。
# voice_profiles 本身无外部依赖，是 0.3.5 的核心测试目标。
try:
    from penglai_runtime import tts_service
    _HAS_TTS_SERVICE = True
except Exception:
    tts_service = None
    _HAS_TTS_SERVICE = False


def test_list_voice_profiles_returns_public_voices():
    voices = vp.list_voice_profiles(public_only=True)
    assert isinstance(voices, list)
    assert len(voices) > 0
    # 应包含中文男声 Junhao 和英文女声 Ava
    ids = [v["voice_id"] for v in voices]
    assert "Junhao" in ids
    assert "Xiaoyu" in ids
    assert "Adam" in ids
    assert "Ava" in ids


def test_list_voice_profiles_excludes_blocked():
    voices = vp.list_voice_profiles(public_only=True)
    ids = [v["voice_id"] for v in voices]
    # 名人模仿/克隆声音不公开
    assert "Trump" not in ids
    for vid in ids:
        assert "clone" not in vid.lower()
        assert "impersonate" not in vid.lower()


def test_list_voice_profiles_has_required_fields():
    voices = vp.list_voice_profiles(public_only=True)
    for v in voices:
        assert "voice_id" in v
        assert "lang" in v
        assert "gender" in v
        assert "label" in v
        assert "persona_hints" in v
        assert v["lang"] in ("zh", "en")
        assert v["gender"] in ("male", "female")


def test_validate_voice_accepts_known():
    assert vp.validate_voice("Junhao") is True
    assert vp.validate_voice("Xiaoyu") is True
    assert vp.validate_voice("Adam") is True
    assert vp.validate_voice("Ava") is True


def test_validate_voice_rejects_blocked():
    assert vp.validate_voice("Trump") is False
    assert vp.validate_voice("") is False
    assert vp.validate_voice("UnknownVoice") is False


def test_resolve_voice_explicit_overrides():
    # 显式指定优先，但必须通过 validate
    assert vp.resolve_voice("你好", gender="female", explicit_voice="Junhao") == "Junhao"
    # 显式指定被屏蔽声音则回退
    result = vp.resolve_voice("你好", gender="male", explicit_voice="Trump")
    assert result != "Trump"
    assert vp.validate_voice(result) is True


def test_resolve_voice_by_gender_and_lang():
    assert vp.resolve_voice("你好", gender="male") == "Junhao"
    assert vp.resolve_voice("你好", gender="female") == "Xiaoyu"
    assert vp.resolve_voice("hello world", gender="male") == "Adam"
    assert vp.resolve_voice("hello world", gender="female") == "Ava"


def test_resolve_voice_auto_uses_persona():
    # auto + butler persona -> male
    assert vp.resolve_voice("你好", gender="auto", persona="butler") == "Junhao"
    # auto + warm_female persona -> female
    assert vp.resolve_voice("你好", gender="auto", persona="warm_female") == "Xiaoyu"


def test_resolve_voice_fallback():
    # 空 text + auto + 未知 persona -> 兜底男声（英文）
    result = vp.resolve_voice("", gender="auto", persona="unknown")
    assert result in ("Junhao", "Adam", "Ava")
    assert vp.validate_voice(result) is True


def test_choose_default_voice_backward_compat():
    # 向后兼容：单参数，返回合法 voice
    if not _HAS_TTS_SERVICE:
        pytest.skip("tts_service not importable in this environment")
    assert vp.validate_voice(tts_service.choose_default_voice("你好")) is True
    assert vp.validate_voice(tts_service.choose_default_voice("hello")) is True


def test_tts_service_list_voices_available():
    if not _HAS_TTS_SERVICE:
        pytest.skip("tts_service not importable in this environment")
    voices = tts_service.list_voices(public_only=True)
    assert isinstance(voices, list)
    assert len(voices) > 0
    assert any(v["voice_id"] == "Junhao" for v in voices)


def test_voice_profiles_cover_both_languages_and_genders():
    voices = vp.list_voice_profiles(public_only=True)
    langs = {v["lang"] for v in voices}
    genders = {v["gender"] for v in voices}
    assert "zh" in langs
    assert "en" in langs
    assert "male" in genders
    assert "female" in genders
