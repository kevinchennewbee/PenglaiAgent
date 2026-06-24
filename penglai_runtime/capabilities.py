# -*- coding: utf-8 -*-
"""Low-side-effect capability readiness checks for optional Penglai services."""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
import sys


VOICE_MODEL_SUBDIR = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
VOICE_MODEL_FILE = "model.int8.onnx"
VOICE_TOKEN_FILE = "tokens.txt"
MOSS_TTS_SUBDIR = os.path.join("modelscope_cache", "OpenMOSS", "MOSS-TTS-Nano")
MOSS_AUDIO_TOKENIZER_SUBDIR = os.path.join("modelscope_cache", "OpenMOSS", "MOSS-Audio-Tokenizer-Nano")
MOSS_TTS_MODEL_FILES = ("config.json", "pytorch_model.bin", "tokenizer.model")
MOSS_AUDIO_TOKENIZER_FILES = ("config.json",)
MOSS_AUDIO_TOKENIZER_WEIGHT_FILES = (
    "model.safetensors.index.json",
    "model-00001-of-00001.safetensors",
    "pytorch_model.bin",
)
MOSS_TTS_REPO_SUBDIR = os.path.join("repos", "MOSS-TTS-Nano")
MOSS_TTS_ONNX_MODEL_SUBDIR = os.path.join(MOSS_TTS_REPO_SUBDIR, "models")
MOSS_TTS_ONNX_TTS_SUBDIR = "MOSS-TTS-Nano-100M-ONNX"
MOSS_TTS_ONNX_CODEC_SUBDIR = "MOSS-Audio-Tokenizer-Nano-ONNX"
MOSS_TTS_ONNX_TTS_FILES = (
    "browser_poc_manifest.json",
    "tts_browser_onnx_meta.json",
    "tokenizer.model",
)
MOSS_TTS_ONNX_CODEC_FILES = ("codec_browser_onnx_meta.json",)


def voice_model_dir(*, root=None):
    base = os.environ.get("PENGLAI_MODEL_DIR", os.path.expanduser("~/penglai-models"))
    return os.path.join(base, VOICE_MODEL_SUBDIR)


def model_base_dir():
    return os.environ.get("PENGLAI_MODEL_DIR", os.path.expanduser("~/penglai-models"))


def moss_tts_model_dir(*, base_dir=None):
    return os.path.join(base_dir or model_base_dir(), MOSS_TTS_SUBDIR)


def moss_audio_tokenizer_dir(*, base_dir=None):
    return os.path.join(base_dir or model_base_dir(), MOSS_AUDIO_TOKENIZER_SUBDIR)


def moss_tts_repo_dir(*, base_dir=None):
    return os.environ.get(
        "PENGLAI_MOSS_TTS_REPO_DIR",
        os.path.join(base_dir or model_base_dir(), MOSS_TTS_REPO_SUBDIR),
    )


def moss_tts_onnx_model_dir(*, base_dir=None):
    return os.environ.get(
        "PENGLAI_MOSS_TTS_ONNX_MODEL_DIR",
        os.path.join(base_dir or model_base_dir(), MOSS_TTS_ONNX_MODEL_SUBDIR),
    )


def moss_tts_onnx_tts_dir(*, base_dir=None):
    return os.path.join(moss_tts_onnx_model_dir(base_dir=base_dir), MOSS_TTS_ONNX_TTS_SUBDIR)


def moss_tts_onnx_codec_dir(*, base_dir=None):
    return os.path.join(moss_tts_onnx_model_dir(base_dir=base_dir), MOSS_TTS_ONNX_CODEC_SUBDIR)


def ffmpeg_bin():
    found = shutil.which("ffmpeg")
    if found:
        return found
    for cand in (
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/opt/local/bin/ffmpeg",
    ):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def service_python():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    py = os.path.join(root, ".venv", "bin", "python")
    return py if os.path.exists(py) else sys.executable


def module_available(name):
    try:
        if importlib.util.find_spec(name) is not None:
            return True
    except Exception:
        pass
    py = service_python()
    if os.path.abspath(py) == os.path.abspath(sys.executable):
        return False
    try:
        r = subprocess.run(
            [py, "-c", f"import importlib.util; raise SystemExit(0 if importlib.util.find_spec({name!r}) else 1)"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return r.returncode == 0
    except Exception:
        return False


def _oai_config_key():
    try:
        import mykey
    except Exception:
        return ""
    candidates = []
    for key, cfg in vars(mykey).items():
        if key.startswith("_") or not isinstance(cfg, dict):
            continue
        if not all(cfg.get(name) for name in ("apibase", "apikey", "model")):
            continue
        lower = str(key).lower()
        if lower.startswith("critic") or "critic" in lower:
            continue
        if key == "native_oai_config":
            score = 100
        elif lower.endswith("_native_oai_config"):
            score = 90
        elif lower.endswith("oai_config") or "oai_config" in lower:
            score = 80
        else:
            score = 10
        candidates.append((score, str(key)))
    return max(candidates)[1] if candidates else ""


def vision_runtime_status(*, root=None):
    root = os.path.realpath(root or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if root not in sys.path:
        sys.path.insert(0, root)
    vision_path = os.path.join(root, "memory", "vision_api.py")
    config_key = _oai_config_key()
    components = {
        "vision_api": os.path.isfile(vision_path),
        "pillow": module_available("PIL"),
        "oai_config": bool(config_key),
    }
    ready = all(components.values())
    enabled = components["vision_api"] or components["oai_config"]
    partial = bool(enabled and not ready)
    if ready:
        status = "ready"
        detail = "看图：就绪（vision_api.py → 主力模型）"
    elif partial:
        missing = [name for name, ok in components.items() if not ok]
        status = "partial"
        detail = "看图：装了一半，缺 " + "/".join(missing)
    else:
        status = "disabled"
        detail = "看图：待主力 OAI 兼容模型就绪"
    return {
        "name": "vision",
        "status": status,
        "ready": ready,
        "enabled": bool(enabled),
        "partial": partial,
        "optional": True,
        "components": components,
        "missing": [name for name, ok in components.items() if not ok],
        "vision_path": vision_path,
        "config_key": config_key,
        "detail": detail,
    }


def _normal_vendor(value):
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if not text:
        return ""
    aliases = {
        "minimax": ("minimax", "mini max", "m3"),
        "openai": ("openai", "gpt"),
        "deepseek": ("deepseek",),
        "zhipu": ("zhipu", "glm"),
        "qwen": ("qwen", "dashscope", "aliyun", "tongyi"),
        "claude": ("claude", "anthropic"),
        "gemini": ("gemini", "google"),
        "hunyuan": ("hunyuan", "tencent"),
    }
    for canonical, needles in aliases.items():
        if any(needle in text for needle in needles):
            return canonical
    return text.split()[0]


def critic_runtime_status(*, root=None):
    root = os.path.realpath(root or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        import mykey
    except Exception:
        mykey = None
    mode = str(getattr(mykey, "critic_mode", "smart") if mykey else "smart")
    main_key = _oai_config_key()
    main_cfg = getattr(mykey, main_key, {}) if mykey and main_key else {}
    critic_cfg = getattr(mykey, "critic_model", None) if mykey else None
    critic_configured = isinstance(critic_cfg, dict) and all(critic_cfg.get(name) for name in ("apibase", "apikey", "model"))
    main_vendor = _normal_vendor((main_cfg or {}).get("name") or main_key or (main_cfg or {}).get("model"))
    critic_vendor = _normal_vendor((critic_cfg or {}).get("name") or (critic_cfg or {}).get("model")) if isinstance(critic_cfg, dict) else ""
    different_vendor = bool(critic_configured and main_vendor and critic_vendor and main_vendor != critic_vendor)
    local_tripwire = mode != "off"
    cross_vendor_ready = bool(local_tripwire and critic_configured and different_vendor)
    components = {
        "local_tripwire": local_tripwire,
        "critic_model": bool(critic_configured),
        "different_vendor": bool(different_vendor),
    }
    if mode == "off":
        status = "off"
        detail = "批判脑：已关闭"
    elif cross_vendor_ready:
        status = "ready"
        detail = "批判脑：smart 档（绊线 + 异厂商复核）"
    elif critic_configured and not different_vendor:
        status = "same_vendor"
        detail = "批判脑：复核模型已配但不是异厂商，仅本地绊线生效"
    else:
        status = "local_only"
        detail = "批判脑：仅本地绊线（免费常开）；异厂商复核未配"
    return {
        "name": "critic",
        "status": status,
        "ready": cross_vendor_ready,
        "enabled": local_tripwire,
        "optional": True,
        "components": components,
        "missing": [name for name, ok in components.items() if not ok],
        "main_config_key": main_key,
        "main_vendor": main_vendor,
        "critic_vendor": critic_vendor,
        "critic_model": (critic_cfg or {}).get("model", "") if isinstance(critic_cfg, dict) else "",
        "detail": detail,
    }


def voice_runtime_status(*, model_dir=None):
    model_dir = model_dir or voice_model_dir()
    model_path = os.path.join(model_dir, VOICE_MODEL_FILE)
    token_path = os.path.join(model_dir, VOICE_TOKEN_FILE)
    components = {
        "model": os.path.isfile(model_path),
        "tokens": os.path.isfile(token_path),
        "sherpa_onnx": module_available("sherpa_onnx"),
        "ffmpeg": ffmpeg_bin() is not None,
    }
    ready = all(components.values())
    enabled = components["model"] or components["sherpa_onnx"]
    partial = bool(enabled and not ready)
    if ready:
        status = "ready"
        detail = "语音：就绪（SenseVoice 本地转写）"
    elif partial:
        missing = [name for name, ok in components.items() if not ok]
        status = "partial"
        detail = "语音：装了一半，缺 " + "/".join(missing)
    else:
        status = "disabled"
        detail = "语音：未启用（可选能力）"
    return {
        "name": "voice",
        "status": status,
        "ready": ready,
        "enabled": bool(enabled),
        "partial": partial,
        "optional": True,
        "components": components,
        "missing": [name for name, ok in components.items() if not ok],
        "model_dir": model_dir,
        "model_path": model_path,
        "token_path": token_path,
        "detail": detail,
    }


def _dir_has_files(path, files):
    return bool(path) and all(os.path.isfile(os.path.join(path, name)) for name in files)


def _dir_has_any_file(path, files):
    return bool(path) and any(os.path.isfile(os.path.join(path, name)) for name in files)


def _dir_has_suffix(path, suffix):
    if not path or not os.path.isdir(path):
        return False
    try:
        return any(name.endswith(suffix) for name in os.listdir(path))
    except OSError:
        return False


def tts_runtime_status(*, model_base=None):
    base = model_base or model_base_dir()
    repo_dir = moss_tts_repo_dir(base_dir=base)
    model_dir = moss_tts_onnx_model_dir(base_dir=base)
    tts_dir = moss_tts_onnx_tts_dir(base_dir=base)
    codec_dir = moss_tts_onnx_codec_dir(base_dir=base)
    has_repo = all(os.path.isfile(os.path.join(repo_dir, name)) for name in ("infer_onnx.py", "onnx_tts_runtime.py"))
    has_tts_onnx = (
        _dir_has_files(tts_dir, MOSS_TTS_ONNX_TTS_FILES)
        and _dir_has_suffix(tts_dir, ".onnx")
        and _dir_has_suffix(tts_dir, ".data")
    )
    has_codec_onnx = (
        _dir_has_files(codec_dir, MOSS_TTS_ONNX_CODEC_FILES)
        and _dir_has_suffix(codec_dir, ".onnx")
        and _dir_has_suffix(codec_dir, ".data")
    )
    components = {
        "moss_tts_repo": has_repo,
        "moss_tts_onnx_model": has_tts_onnx,
        "moss_audio_tokenizer_onnx": has_codec_onnx,
        "numpy": module_available("numpy"),
        "sentencepiece": module_available("sentencepiece"),
        "onnxruntime": module_available("onnxruntime"),
        "huggingface_hub": module_available("huggingface_hub"),
        # Current upstream ONNX runtime still imports torch/torchaudio at module
        # load time and uses torchaudio for reference-audio voice cloning.
        "torch": module_available("torch"),
        "torchaudio": module_available("torchaudio"),
        "ffmpeg": ffmpeg_bin() is not None,
    }
    ready = all(components.values())
    enabled = has_repo or has_tts_onnx or has_codec_onnx
    partial = bool(enabled and not ready)
    if ready:
        status = "ready"
        detail = "语音输出：就绪（MOSS-TTS-Nano ONNX CPU 本地）"
    elif partial:
        missing = [name for name, ok in components.items() if not ok]
        status = "partial"
        detail = "语音输出：装了一半，缺 " + "/".join(missing)
    else:
        status = "disabled"
        detail = "语音输出：未启用（MOSS-TTS-Nano 可选本地能力）"
    return {
        "name": "tts",
        "status": status,
        "ready": ready,
        "enabled": bool(enabled),
        "partial": partial,
        "optional": True,
        "provider": "moss-tts-nano",
        "backend": "onnx-cpu",
        "components": components,
        "missing": [name for name, ok in components.items() if not ok],
        "model_base": base,
        "repo_dir": repo_dir,
        "model_dir": model_dir,
        "onnx_tts_dir": tts_dir,
        "onnx_audio_tokenizer_dir": codec_dir,
        "entrypoint": os.path.join(repo_dir, "infer_onnx.py"),
        "detail": detail,
    }
