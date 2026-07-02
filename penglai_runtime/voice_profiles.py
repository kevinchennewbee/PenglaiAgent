# -*- coding: utf-8 -*-
"""Voice profile registry for Penglai companion TTS.

0.3.5 Phase 2：声音注册表、按语言/性别/persona 解析默认 voice、校验 voice 是否
可公开使用、隐藏 impersonation 风险声音。

不进入默认公开选项：
- Trump 等可能造成名人模仿风险的声音
- prompt-audio voice cloning
"""

from __future__ import annotations

import re
from typing import Optional


# ── 公开声音注册表 ──────────────────────────────────────────────────────
# 结构：voice_id -> {lang, gender, label, persona_hints}
# 这些是 MOSS-TTS-Nano 支持且可公开使用的声音。
VOICE_PROFILES: dict[str, dict] = {
    # 中文男声
    "Junhao": {"lang": "zh", "gender": "male", "label": "俊昊", "persona_hints": ["butler", "steady_male"]},
    "Zhiming": {"lang": "zh", "gender": "male", "label": "志明", "persona_hints": ["steady_male"]},
    "Weiguo": {"lang": "zh", "gender": "male", "label": "卫国", "persona_hints": ["steady_male"]},
    # 中文女声
    "Xiaoyu": {"lang": "zh", "gender": "female", "label": "小语", "persona_hints": ["warm_female"]},
    "Yuewen": {"lang": "zh", "gender": "female", "label": "悦文", "persona_hints": ["warm_female"]},
    "Lingyu": {"lang": "zh", "gender": "female", "label": "灵语", "persona_hints": ["warm_female"]},
    # 英文男声
    "Adam": {"lang": "en", "gender": "male", "label": "Adam", "persona_hints": ["butler", "steady_male"]},
    "Nathan": {"lang": "en", "gender": "male", "label": "Nathan", "persona_hints": ["steady_male"]},
    # 英文女声
    "Ava": {"lang": "en", "gender": "female", "label": "Ava", "persona_hints": ["warm_female"]},
    "Bella": {"lang": "en", "gender": "female", "label": "Bella", "persona_hints": ["warm_female"]},
}

# 默认声音映射（按语言+性别）
DEFAULT_VOICE = {
    ("zh", "male"): "Junhao",
    ("zh", "female"): "Xiaoyu",
    ("en", "male"): "Adam",
    ("en", "female"): "Ava",
}

# persona -> 默认性别倾向
PERSONA_GENDER = {
    "butler": "male",
    "steady_male": "male",
    "warm_female": "female",
    "custom": None,  # 由用户配置决定
}

# 不允许公开使用的声音（名人模仿/克隆风险）
BLOCKED_VOICES = {
    "Trump",
    "Clinton",
    "Obama",
    "Biden",
    "Musk",
    "Clone",  # 任何 clone 类声音不公开
}


def list_voice_profiles(public_only: bool = True) -> list[dict]:
    """列出可用声音。

    public_only=True 时排除 BLOCKED_VOICES 和任何 clone/impersonation 类声音。
    返回列表按语言、性别、名字排序。
    """
    items = []
    for voice_id, meta in VOICE_PROFILES.items():
        if public_only and voice_id in BLOCKED_VOICES:
            continue
        if public_only and any(bad in voice_id.lower() for bad in ("clone", "impersonate", "celebrity")):
            continue
        items.append({
            "voice_id": voice_id,
            "lang": meta["lang"],
            "gender": meta["gender"],
            "label": meta["label"],
            "persona_hints": list(meta.get("persona_hints", [])),
        })
    items.sort(key=lambda x: (x["lang"], x["gender"], x["voice_id"]))
    return items


def validate_voice(voice: str) -> bool:
    """校验 voice 是否在公开注册表中且未被屏蔽。"""
    voice = str(voice or "").strip()
    if not voice:
        return False
    if voice in BLOCKED_VOICES:
        return False
    if any(bad in voice.lower() for bad in ("clone", "impersonate")):
        return False
    return voice in VOICE_PROFILES


def _detect_lang(text: str) -> str:
    """简单语种检测：含 CJK 字符判中文，否则英文。"""
    raw = str(text or "")
    if any("\u3400" <= ch <= "\u9fff" for ch in raw):
        return "zh"
    return "en"


def _normalize_gender(gender: str | None) -> str:
    value = str(gender or "auto").strip().lower()
    if value in ("m", "man", "boy"):
        return "male"
    if value in ("f", "woman", "girl"):
        return "female"
    return value  # auto | male | female


def resolve_voice(
    text: str,
    gender: str = "auto",
    persona: str = "butler",
    explicit_voice: str = "",
) -> str:
    """解析最终使用的 voice_id。

    优先级：
    1. explicit_voice（用户显式指定）—— 必须通过 validate_voice，否则回退。
    2. gender + 检测到的语言 -> DEFAULT_VOICE 映射。
    3. gender=auto 时按 persona 推断性别。
    4. 兜底：中文 Junhao / 英文 Ava。

    任何被 BLOCKED 的声音都不会返回。
    """
    # 1. 显式指定
    explicit = str(explicit_voice or "").strip()
    if explicit and validate_voice(explicit):
        return explicit

    # 2. 语言 + 性别
    lang = _detect_lang(text)
    gender = _normalize_gender(gender)

    # 3. auto 时按 persona 推断
    if gender == "auto":
        persona = str(persona or "butler").strip().lower()
        inferred = PERSONA_GENDER.get(persona)
        if inferred:
            gender = inferred
        else:
            # 默认男声（butler 风格）
            gender = "male"

    voice = DEFAULT_VOICE.get((lang, gender))
    if voice and validate_voice(voice):
        return voice

    # 4. 兜底
    if lang == "zh":
        return "Junhao"
    return "Ava"
