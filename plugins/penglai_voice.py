# -*- coding: utf-8 -*-
"""蓬莱插件：语音转文字 + 情绪/声学事件感知（SenseVoice-Small via sherpa-onnx，本地 CPU）。

挂载方式（蓬莱插件标准样板，GA 内核零改动）：
  1. 类注入：给 GenericAgentHandler 添加 do_transcribe 方法（do_ 约定自动生效）
  2. schema 注入：agent_before hook 往 tools_schema 列表幂等追加工具定义
模型放仓库外（默认 ~/penglai-models/），缺失时工具返回下载指引，不崩溃。
"""
import os, array, subprocess

from plugins.hooks import register
from agent_loop import StepOutcome
from ga import GenericAgentHandler

MODEL_DIR = os.path.join(os.environ.get("PENGLAI_MODEL_DIR", os.path.expanduser("~/penglai-models")),
                         "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
_DOWNLOAD_HINT = ("SenseVoice 模型未就绪。下载（约230MB）:\n"
                  "mkdir -p ~/penglai-models && cd ~/penglai-models && "
                  "curl -L -o sv.tar.bz2 'https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/"
                  "download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2' "
                  "&& tar xjf sv.tar.bz2 && rm sv.tar.bz2")

EMO = {"HAPPY": "高兴", "SAD": "悲伤", "ANGRY": "生气", "NEUTRAL": "平静",
       "FEARFUL": "害怕", "DISGUSTED": "厌恶", "SURPRISED": "惊讶"}
EVT = {"Laughter": "笑声", "Cry": "哭声", "Applause": "掌声", "Cough": "咳嗽",
       "Sneeze": "喷嚏", "BGM": "背景音乐", "Breath": "呼吸声"}

_recognizer = None

def _get_recognizer():
    global _recognizer
    if _recognizer is None:
        import sherpa_onnx
        _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=os.path.join(MODEL_DIR, "model.int8.onnx"),
            tokens=os.path.join(MODEL_DIR, "tokens.txt"),
            use_itn=True, language="auto", num_threads=2)
    return _recognizer

_SILK_MAGIC = (b"#!SILK_V3", b"\x02#!SILK_V3")  # 标准 / 腾讯变体（前缀 0x02）

def _is_silk(path):
    try:
        with open(path, "rb") as f: return f.read(10).startswith(_SILK_MAGIC)
    except OSError:
        return False

def transcribe_file(path):
    """音频文件 → {text, emotion, event, lang}。ffmpeg 解码（opus/mp3/wav/m4a/amr 等）；
    微信 .silk 先用 pilk 解成 PCM 再走同一管线（ffmpeg 不认 silk）。"""
    if not os.path.isfile(os.path.join(MODEL_DIR, "model.int8.onnx")):
        return {"error": _DOWNLOAD_HINT}
    in_args, pcm_tmp = ["-i", path], None
    if _is_silk(path) or path.endswith(".silk"):
        try:
            import pilk
        except ImportError:
            return {"error": "微信 silk 语音需要 pilk 解码库，请安装: uv pip install pilk"}
        pcm_tmp = path + ".pcm"
        try:
            pilk.decode(path, pcm_tmp, pcm_rate=24000)
        except Exception as e:
            return {"error": f"silk 解码失败: {e}"}
        in_args = ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm_tmp]
    p = subprocess.run(["ffmpeg", "-v", "error"] + in_args + ["-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                       capture_output=True)
    if pcm_tmp and os.path.exists(pcm_tmp):
        try: os.remove(pcm_tmp)
        except OSError: pass
    if p.returncode != 0:
        err = p.stderr.decode(errors="replace")[:200]
        return {"error": f"音频解码失败: {err}"}
    samples = array.array("f")
    samples.frombytes(p.stdout)
    if not samples:
        return {"error": "音频为空"}
    rec = _get_recognizer()
    s = rec.create_stream()
    s.accept_waveform(16000, samples.tolist())
    rec.decode_stream(s)
    r = s.result
    return {"text": (r.text or "").strip(),
            "emotion": EMO.get(getattr(r, "emotion", "").strip("<|>"), getattr(r, "emotion", "")),
            "event": EVT.get(getattr(r, "event", "").strip("<|>"), ""),
            "lang": getattr(r, "lang", "").strip("<|>"),
            "duration_sec": round(len(samples) / 16000, 1)}

def do_transcribe(self, args, response):
    """语音转文字 + 情绪感知。用户消息含 [audio: ...] 时立即调用。"""
    path = self._get_abs_path(args.get("path", ""))
    yield f"\n[Action] Transcribing: {os.path.basename(path)}\n"
    if not os.path.isfile(path):
        return StepOutcome({"error": f"文件不存在: {path}"},
                           next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))
    r = transcribe_file(path)
    if "error" not in r:
        parts = [f"语音转写（{r['duration_sec']}秒）: {r['text']}"]
        if r["emotion"]: parts.append(f"语气情绪: {r['emotion']}")
        if r["event"]:   parts.append(f"声学事件: {r['event']}")
        r = "\n".join(parts) + "\n[提示] 情绪标签来自声学模型，仅供参考；回复时自然体察，不要机械复述标签。"
        yield r + "\n"
    return StepOutcome(r, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))

# ---- 挂载 ----
GenericAgentHandler.do_transcribe = do_transcribe

_SCHEMA = {"type": "function", "function": {
    "name": "transcribe",
    "description": "语音转文字并识别说话语气情绪/声学事件（本地 SenseVoice 模型，中英日韩粤）。"
                   "用户消息中出现 [audio: ...] 或提供音频文件路径时，先调用本工具再回应。",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string", "description": "音频文件路径（opus/mp3/wav/m4a/amr/微信silk 等，silk 自动解码无需预处理）"}},
        "required": ["path"]}}}

@register("agent_before")
def _inject_transcribe_schema(ctx):
    ts = ctx.get("tools_schema")
    if isinstance(ts, list) and not any(
            t.get("function", {}).get("name") == "transcribe" for t in ts if isinstance(t, dict)):
        ts.append(_SCHEMA)
