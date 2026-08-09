/**
 * 语音引擎探测（懒加载 + 能力探测）— 0.3.x capabilities.py 范式的 TS 移植。
 *
 * 铁律：sherpa-onnx / onnxruntime-node 都是原生依赖，**绝不允许成为 host
 * 启动的硬依赖**。全部经 createRequire 惰性探测：装没装、模型齐不齐、
 * ffmpeg 在不在，逐项 components → ready/partial/disabled + missing 清单 +
 * 中文 detail（「装一半如实说缺什么」）。doctor 与 voice.status RPC 共用
 * 这份探测。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  MOSS_TTS_SPEC,
  SENSEVOICE_SPEC,
  modelDirFor,
  modelPresent,
} from "./assets.js";

const requireFromHere = createRequire(import.meta.url);

/** 惰性探测可选原生依赖；任何加载错误都降级为「未安装」，绝不抛出。 */
export function tryRequireVoice<T>(mod: string): T | null {
  try {
    return requireFromHere(mod) as T;
  } catch {
    return null;
  }
}

// sherpa-onnx 的最小形状（无官方 .d.ts；与 tools/voice.ts 同章法）
export interface SherpaAudio {
  samples: Float32Array;
  sampleRate: number;
}
export interface SherpaOfflineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}
export interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decode(stream: SherpaOfflineStream): void;
  getResult(stream: SherpaOfflineStream): { text?: string };
  free(): void;
}
export interface SherpaOnnx {
  createOfflineRecognizer(config: unknown): SherpaOfflineRecognizer;
  readWave(filename: string): SherpaAudio;
}

// onnxruntime-node 的最小形状
export interface OrtTensor {
  data: unknown;
  dims: number[];
  type: string;
}
export interface OrtInferenceSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(inputs: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export interface OrtNode {
  InferenceSession: new (model: string | Buffer) => OrtInferenceSession;
  Tensor: new (type: string, data: unknown, dims: number[]) => OrtTensor;
}

/** ffmpeg 探测（0.3.x：PATH + 常见安装路径候选）。 */
export function ffmpegBin(): string | null {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
    if (!r.error && r.status === 0) return "ffmpeg";
  } catch {
    /* fall through to candidate paths */
  }
  for (const candidate of [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
  ]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

// ── 能力探测（capabilities.py 范式） ───────────────────────────

export interface VoiceCapability {
  name: "asr" | "tts";
  status: "ready" | "partial" | "disabled";
  ready: boolean;
  components: Record<string, boolean>;
  missing: string[];
  /** 模型目录（面板/指引用）。 */
  modelDir: string;
  detail: string;
}

export interface VoiceProbe {
  asr: VoiceCapability;
  tts: VoiceCapability;
}

export interface ProbeDeps {
  /** 测试缝：注入原生模块（缺省 = 惰性 createRequire 探测）。 */
  sherpa?: SherpaOnnx | null;
  ort?: OrtNode | null;
  ffmpeg?: string | null;
}

export function probeAsr(dataDir: string, deps: ProbeDeps = {}): VoiceCapability {
  const dir = modelDirFor(SENSEVOICE_SPEC, dataDir);
  const sherpa = deps.sherpa !== undefined ? deps.sherpa : tryRequireVoice<SherpaOnnx>("sherpa-onnx");
  const ffmpeg = deps.ffmpeg !== undefined ? deps.ffmpeg : ffmpegBin();
  const components = {
    engine: sherpa !== null && typeof sherpa.createOfflineRecognizer === "function",
    model: modelPresent(SENSEVOICE_SPEC, dataDir),
    ffmpeg: ffmpeg !== null,
  };
  const missing = Object.entries(components)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const ready = missing.length === 0;
  const enabled = components.engine || components.model;
  return {
    name: "asr",
    status: ready ? "ready" : enabled ? "partial" : "disabled",
    ready,
    components,
    missing,
    modelDir: dir,
    detail: ready
      ? "语音识别：就绪（SenseVoice 本地，含情绪标签）"
      : enabled
        ? `语音识别：装了一半，缺 ${missing.join("/")}——penglai voice setup 补装`
        : "语音识别：未启用（可选本地能力，penglai voice setup 启用）",
  };
}

export function probeTts(dataDir: string, deps: ProbeDeps = {}): VoiceCapability {
  const dir = modelDirFor(MOSS_TTS_SPEC, dataDir);
  const ort = deps.ort !== undefined ? deps.ort : tryRequireVoice<OrtNode>("onnxruntime-node");
  const ttsDir = path.join(dir, "MOSS-TTS-Nano-100M-ONNX");
  const codecDir = path.join(dir, "MOSS-Audio-Tokenizer-Nano-ONNX");
  const hasOnnxAndData = (d: string): boolean => {
    try {
      const names = fs.readdirSync(d);
      return names.some((n) => n.endsWith(".onnx")) && names.some((n) => n.endsWith(".data"));
    } catch {
      return false;
    }
  };
  const components = {
    engine: ort !== null && typeof ort.InferenceSession === "function",
    model: modelPresent(MOSS_TTS_SPEC, dataDir),
    ttsWeights: hasOnnxAndData(ttsDir),
    codecWeights: hasOnnxAndData(codecDir),
  };
  const missing = Object.entries(components)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const ready = missing.length === 0;
  const enabled = Object.values(components).some(Boolean);
  return {
    name: "tts",
    status: ready ? "ready" : enabled ? "partial" : "disabled",
    ready,
    components,
    missing,
    modelDir: dir,
    detail: ready
      ? "语音合成：就绪（MOSS-TTS-Nano ONNX CPU 本地）"
      : enabled
        ? `语音合成：装了一半，缺 ${missing.join("/")}——penglai voice setup --tts 补装`
        : "语音合成：未启用（可选本地能力，penglai voice setup --tts 启用）",
  };
}

/** 全量探测（doctor / voice.status 共用；绝不抛）。 */
export function probeVoice(dataDir: string, deps: ProbeDeps = {}): VoiceProbe {
  try {
    return { asr: probeAsr(dataDir, deps), tts: probeTts(dataDir, deps) };
  } catch (error) {
    const detail = `语音探测失败：${error instanceof Error ? error.message : String(error)}`;
    const fallback: VoiceCapability = {
      name: "asr",
      status: "disabled",
      ready: false,
      components: {},
      missing: [],
      modelDir: "",
      detail,
    };
    return { asr: fallback, tts: { ...fallback, name: "tts" } };
  }
}

// ── SenseVoice 输出解析（情绪/语言标签） ───────────────────────

const SENSEVOICE_EMOTIONS = [
  "HAPPY",
  "SAD",
  "ANGRY",
  "NEUTRAL",
  "FEARFUL",
  "DISGUSTED",
  "SURPRISED",
] as const;
const SENSEVOICE_LANGS = ["ZH", "EN", "JA", "KO", "YUE", "AUTO"] as const;

export interface ParsedSenseVoice {
  text: string;
  emotion: string;
  language: string;
  noSpeech: boolean;
}

/**
 * 解析 SenseVoice 富标签输出（`<|HAPPY|><|Speech|><|zh|>正文`）→
 * 干净文本 + 情绪 + 语言。与旧分支 tools/voice.ts 同一契约。
 */
export function parseSenseVoiceResult(raw: string): ParsedSenseVoice {
  const tags: string[] = [];
  const re = /<\|([^|]+)\|>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    tags.push(m[1].trim().toUpperCase());
  }
  const noSpeech = tags.includes("NOSPEECH");
  const emotion =
    tags.find((t) => (SENSEVOICE_EMOTIONS as readonly string[]).includes(t)) ?? "NEUTRAL";
  const language =
    tags.find((t) => (SENSEVOICE_LANGS as readonly string[]).includes(t))?.toLowerCase() ??
    "auto";
  const text = raw.replace(re, "").trim();
  return { text, emotion: noSpeech ? "NOSPEECH" : emotion, language, noSpeech };
}
