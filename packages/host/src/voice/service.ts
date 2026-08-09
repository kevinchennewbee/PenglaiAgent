/**
 * 语音服务（host 侧，数据不出机）— 统一会话语音 I/O 的引擎层。
 *
 *   - transcribe：SenseVoice（sherpa-onnx）本地转写 + 情绪/语言标签；
 *   - synthesize：本地 TTS（onnxruntime-node）。诚实分层——
 *       ① 契约引擎：模型目录有 config.json（{inputNames, outputName,
 *          sampleRate, vocab} 声明 I/O 契约）即可合成，任何单会话 ONNX
 *          TTS 都可用（移植自旧分支 tools/voice.ts 的诚实 seam）；
 *       ② MOSS 全管线：官方 ONNX prefill/decode + local decoder +
 *          audio codec，多会话真实权重合成本地 48kHz 双声道 PCM。
 *   - install：按需下载模型（assets.ts：固定 revision/hash + 镜像回退 + .part 断点）。
 *
 * 所有引擎/下载都走注入缝；模型缺失、引擎缺失、麦克风缺失一律精确降级，
 * 绝不抛出、绝不 stub 成「假装成功」。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  MOSS_TTS_SPEC,
  SENSEVOICE_SPEC,
  ensureVoiceModel,
  modelDirFor,
  type DownloadDeps,
  type DownloadProgress,
  type ModelInstallResult,
  type VoiceModelSpec,
} from "./assets.js";
import {
  ffmpegBin,
  parseSenseVoiceResult,
  probeVoice,
  tryRequireVoice,
  type OrtNode,
  type OrtTensor,
  type SherpaOnnx,
  type VoiceProbe,
} from "./engine.js";

// ── 类型 ───────────────────────────────────────────────────────

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  emotion?: string;
  language?: string;
  noSpeech?: boolean;
  error?: string;
}

export interface SynthesizeResult {
  ok: boolean;
  wavBase64?: string;
  sampleRate?: number;
  /** 合成走了哪条路径（contract / moss-pipeline）。 */
  engine?: string;
  error?: string;
}

export interface VoiceServiceDeps extends DownloadDeps {
  dataDir: string;
  sherpaFactory?: () => SherpaOnnx | null;
  ortFactory?: () => OrtNode | null;
  ffmpegPath?: string | null;
  /** Test/embedding seam; production omits this and uses the pinned built-in manifests. */
  specs?: Partial<Record<"asr" | "tts", VoiceModelSpec>>;
  mossRuntimeFactory?: (modelDir: string) => {
    synthesize(text: string): Promise<{
      samples: Float32Array;
      sampleRate: number;
      channels: number;
      voice: string;
    }>;
  };
  log?: (line: string) => void;
}

const MAX_AUDIO_BYTES = 32 * 1024 * 1024; // 语音消息体量上限（防 RPC 滥用）

// ── wav 工具 ───────────────────────────────────────────────────

/** Float32 [-1,1] → 16-bit PCM WAV Buffer。 */
export function pcmToWavBuffer(
  samples: Float32Array,
  sampleRate: number,
  channels = 1,
): Buffer {
  if (!Number.isInteger(channels) || channels < 1 || samples.length % channels !== 0) {
    throw new Error("PCM samples must contain complete interleaved channel frames");
  }
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }
  return buffer;
}

// ── 服务 ───────────────────────────────────────────────────────

export class VoiceService {
  private mossRuntime: ReturnType<NonNullable<VoiceServiceDeps["mossRuntimeFactory"]>> | null = null;

  constructor(private readonly deps: VoiceServiceDeps) {}

  private sherpa(): SherpaOnnx | null {
    if (this.deps.sherpaFactory) return this.deps.sherpaFactory();
    // 懒加载：探测失败/未安装一律降级为 null，绝不让语音成为启动硬依赖。
    return tryRequireVoice<SherpaOnnx>("sherpa-onnx");
  }

  private ort(): OrtNode | null {
    if (this.deps.ortFactory) return this.deps.ortFactory();
    return tryRequireVoice<OrtNode>("onnxruntime-node");
  }

  /** 能力探测（doctor / voice.status 共用）。 */
  status(): VoiceProbe {
    return probeVoice(this.deps.dataDir, {
      ...(this.deps.sherpaFactory ? { sherpa: this.deps.sherpaFactory() } : {}),
      ...(this.deps.ortFactory ? { ort: this.deps.ortFactory() } : {}),
      ...(this.deps.ffmpegPath !== undefined ? { ffmpeg: this.deps.ffmpegPath } : {}),
    });
  }

  /** 按需下载模型（asr / tts / all）；进度经 onProgress 回调逐块上报。 */
  async install(which: "asr" | "tts" | "all"): Promise<ModelInstallResult[]> {
    const asrSpec = this.deps.specs?.asr ?? SENSEVOICE_SPEC;
    const ttsSpec = this.deps.specs?.tts ?? MOSS_TTS_SPEC;
    const specs = which === "all" ? [asrSpec, ttsSpec] : [which === "asr" ? asrSpec : ttsSpec];
    const results: ModelInstallResult[] = [];
    for (const spec of specs) {
      const result = await ensureVoiceModel(spec, this.deps.dataDir, {
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
        ...(this.deps.onProgress
          ? { onProgress: (event: DownloadProgress) => this.deps.onProgress?.(event) }
          : {}),
      });
      this.deps.log?.(`voice install ${spec.id}: ${result.detail}`);
      results.push(result);
    }
    return results;
  }

  /** SenseVoice 本地转写（wav 直读；其他格式经 ffmpeg 转 16k 单声道）。 */
  async transcribe(input: { audioBase64: string; format?: string }): Promise<TranscribeResult> {
    const bytes = Buffer.from(input.audioBase64, "base64");
    if (bytes.length === 0) return { ok: false, error: "音频为空" };
    if (bytes.length > MAX_AUDIO_BYTES) {
      return { ok: false, error: `音频超过 ${MAX_AUDIO_BYTES / 1024 / 1024}MB 上限` };
    }
    const probe = this.status().asr;
    if (!probe.ready) {
      return {
        ok: false,
        error: `${probe.detail}（缺 ${probe.missing.join("/") || "unknown"}；penglai voice setup 可补装）`,
      };
    }
    const sherpa = this.sherpa();
    if (!sherpa) return { ok: false, error: "sherpa-onnx 引擎不可用" };

    // Whitelist the container format: the extension is concatenated into a
    // tmp path, so anything not `[a-z0-9]{1,8}` is rejected outright (a
    // hostile `format` value must never escape the tmp dir).
    const rawExt = (input.format ?? "wav").toLowerCase().replace(/^\./, "");
    const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : "wav";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-voice-in-"));
    let wavPath = path.join(tmpDir, `input.${ext}`);
    fs.writeFileSync(wavPath, bytes);
    try {
      if (ext !== "wav" && ext !== "wave") {
        const ffmpeg = this.deps.ffmpegPath ?? ffmpegBin();
        if (!ffmpeg) return { ok: false, error: `解码 .${ext} 需要 ffmpeg（brew install ffmpeg）` };
        const converted = path.join(tmpDir, "converted.wav");
        const { spawnSync } = await import("node:child_process");
        const r = spawnSync(
          ffmpeg,
          ["-y", "-i", wavPath, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", "-f", "wav", converted],
          { stdio: "ignore" },
        );
        if (r.error || r.status !== 0 || !fs.existsSync(converted)) {
          return { ok: false, error: `ffmpeg 转码 .${ext} 失败（可改发 wav）` };
        }
        wavPath = converted;
      }
      const modelDir = probe.modelDir;
      const model = ["model.int8.onnx", "model.onnx"]
        .map((name) => path.join(modelDir, name))
        .find((p) => fs.existsSync(p));
      const tokens = path.join(modelDir, "tokens.txt");
      if (!model || !fs.existsSync(tokens)) {
        return { ok: false, error: `SenseVoice 模型文件缺失（${modelDir}）` };
      }
      // sherpa-onnx 1.13.x expects feature/model configuration to be nested
      // under `modelConfig`.  A flattened object happens to satisfy our tiny
      // test seam, but the native wrapper then dereferences an undefined
      // modelConfig before it can load SenseVoice.
      const recognizer = sherpa.createOfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          modelType: "sense_voice",
          senseVoice: { model, language: "auto", useInverseTextNormalization: 1 },
          tokens,
          numThreads: 1,
          provider: "cpu",
          debug: false,
        },
      });
      try {
        const audio = sherpa.readWave(wavPath);
        const stream = recognizer.createStream();
        try {
          stream.acceptWaveform(audio.sampleRate, audio.samples);
          recognizer.decode(stream);
          const parsed = parseSenseVoiceResult(String(recognizer.getResult(stream)?.text ?? ""));
          if (parsed.noSpeech) return { ok: true, noSpeech: true, text: "", emotion: "NOSPEECH" };
          if (!parsed.text) return { ok: false, error: "未能识别出语音内容（可重说一次或改打字）" };
          return {
            ok: true,
            text: parsed.text,
            emotion: parsed.emotion,
            language: parsed.language,
            noSpeech: false,
          };
        } finally {
          try {
            stream.free();
          } catch {
            /* native handle released */
          }
        }
      } finally {
        try {
          recognizer.free();
        } catch {
          /* native handle released */
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: `语音识别失败：${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** 本地 TTS（兼容契约引擎 → MOSS-TTS-Nano ONNX CPU 全管线）。 */
  async synthesize(input: { text: string }): Promise<SynthesizeResult> {
    const text = input.text.trim();
    if (!text) return { ok: false, error: "合成文本为空" };
    const ort = this.ort();
    const dir = modelDirFor(MOSS_TTS_SPEC, this.deps.dataDir);
    const contractPath = path.join(dir, "config.json");

    if (!ort) {
      return {
        ok: false,
        error: "onnxruntime-node 未安装（可选依赖；npm i onnxruntime-node 后重试）",
      };
    }

    // ① 契约引擎：config.json 声明 I/O 契约的单会话 ONNX TTS。
    if (fs.existsSync(contractPath)) {
      return this.synthesizeContract(ort, dir, contractPath, text);
    }

    // ② MOSS 全管线：prefill/decode + local decoder + audio codec。
    const probe = this.status().tts;
    if (probe.ready) {
      try {
        if (!this.mossRuntime) {
          if (this.deps.mossRuntimeFactory) {
            this.mossRuntime = this.deps.mossRuntimeFactory(dir);
          } else {
            const { MossTtsRuntime } = await import("./moss-runtime.js");
            this.mossRuntime = new MossTtsRuntime({
              modelDir: dir,
              log: (line) => this.deps.log?.(`moss-tts: ${line}`),
            });
          }
        }
        const audio = await this.mossRuntime.synthesize(text);
        const wav = pcmToWavBuffer(audio.samples, audio.sampleRate, audio.channels);
        return {
          ok: true,
          wavBase64: wav.toString("base64"),
          sampleRate: audio.sampleRate,
          engine: `moss-onnx:${audio.voice}`,
        };
      } catch (error) {
        return {
          ok: false,
          error: `MOSS-TTS 推理失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    if (probe.components.model) {
      const sessions = this.diagnoseMossSessions(ort, dir);
      return {
        ok: false,
        error:
          `MOSS-TTS 模型不完整（缺 ${probe.missing.join("/") || "unknown"}；penglai voice setup --tts 可补装）。` +
          (sessions ? `\n会话 I/O 诊断：${sessions}` : ""),
      };
    }
    return {
      ok: false,
      error: `语音合成模型未安装（${dir}；penglai voice setup --tts 下载，约 728MB）`,
    };
  }

  /** 契约引擎合成（移植自旧分支 tools/voice.ts speak 的 config.json 路径）。 */
  private async synthesizeContract(
    ort: OrtNode,
    dir: string,
    contractPath: string,
    text: string,
  ): Promise<SynthesizeResult> {
    let cfg: {
      inputNames: string[];
      outputName: string;
      sampleRate: number;
      vocab?: Record<string, number>;
      model?: string;
    };
    try {
      cfg = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    } catch {
      return { ok: false, error: `TTS 契约文件损坏：${contractPath}` };
    }
    if (!Array.isArray(cfg.inputNames) || typeof cfg.outputName !== "string" || typeof cfg.sampleRate !== "number") {
      return { ok: false, error: `TTS 契约缺 inputNames/outputName/sampleRate：${contractPath}` };
    }
    if (!cfg.vocab) return { ok: false, error: "TTS 契约缺 vocab 映射，无法分词" };
    const model = ["model.onnx", "moss-tts-nano.onnx", "model_quantized.onnx", cfg.model ?? ""]
      .filter(Boolean)
      .map((name) => path.join(dir, name as string))
      .find((p) => fs.existsSync(p));
    if (!model) return { ok: false, error: `TTS 模型权重缺失（${dir}）` };

    try {
      const session = new ort.InferenceSession(model);
      const unk = cfg.vocab["<unk>"] ?? cfg.vocab["<pad>"] ?? 0;
      const ids = Array.from(text).map((ch) => cfg.vocab![ch] ?? unk);
      const inputs: Record<string, OrtTensor> = {};
      for (const name of cfg.inputNames) {
        const isMask = /mask|attent/i.test(name);
        inputs[name] = new ort.Tensor(
          "int32",
          isMask ? new Int32Array(ids.length).fill(1) : Int32Array.from(ids),
          [1, ids.length],
        );
      }
      const outputs = await session.run(inputs);
      const out = outputs[cfg.outputName];
      if (!out) {
        return {
          ok: false,
          error: `合成输出 ${cfg.outputName} 缺失（实际：${Object.keys(outputs).join(",")}）`,
        };
      }
      const raw = out.data;
      const samples =
        raw instanceof Float32Array
          ? raw
          : raw instanceof Int16Array
            ? Float32Array.from(raw, (v) => v / 32768)
            : new Float32Array(raw as ArrayLike<number>);
      const wav = pcmToWavBuffer(samples, cfg.sampleRate);
      return {
        ok: true,
        wavBase64: wav.toString("base64"),
        sampleRate: cfg.sampleRate,
        engine: "contract",
      };
    } catch (error) {
      return {
        ok: false,
        error: `TTS 推理失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /** MOSS 会话 I/O 诊断（联调辅助；读取失败返回空串）。 */
  private diagnoseMossSessions(ort: OrtNode, dir: string): string {
    try {
      const ttsDir = path.join(dir, "MOSS-TTS-Nano-100M-ONNX");
      const prefill = path.join(ttsDir, "moss_tts_prefill.onnx");
      if (!fs.existsSync(prefill)) return "";
      const session = new ort.InferenceSession(prefill);
      return `prefill in=${JSON.stringify(session.inputNames)} out=${JSON.stringify(session.outputNames)}`;
    } catch {
      return "";
    }
  }
}
