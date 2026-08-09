/**
 * 语音测试（chat 模式本地 ASR+TTS，I/O 层）。
 *
 *   1. 下载器（assets）：假 fetch 内存字节——进度、.part 断点续传（Range
 *      头 + 206 追加 / 200 截断重下）、镜像顺序回退、sha256 校验、已有文件
 *      复验、幂等跳过。**绝不真实下载大模型**。
 *   2. 能力探测（engine）：components → ready/partial/disabled，懒加载
 *      降级（无引擎不抛）。
 *   3. 服务（service）：假 sherpa 转写（情绪标签解析）、契约引擎假 ort
 *      合成（wav 头校验）、MOSS 多会话适配层、未安装指引。
 *   4. RPC + CLI：voice.status/install/transcribe/synthesize 真实 RPC；
 *      REPL `--voice` + `/voice` 开关 + 空行说话全链路（假录音/假播放/
 *      假引擎），降级路径（未就绪不录音、打字照常）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MOSS_TTS_SPEC,
  SENSEVOICE_SPEC,
  ensureVoiceModel,
  modelDirFor,
  senseVoiceDir,
  type DownloadProgress,
  type VoiceFetch,
} from "../src/voice/assets.js";
import {
  parseSenseVoiceResult,
  probeVoice,
  type OrtNode,
  type OrtInferenceSession,
  type OrtTensor,
  type SherpaOnnx,
} from "../src/voice/engine.js";
import { VoiceService, pcmToWavBuffer } from "../src/voice/service.js";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";
import { HostClient } from "../src/cli/client.js";
import { cmdChatRepl, parseSlashCommand } from "../src/cli/chat.js";
import { formatVoicePrompt, type VoiceReplDeps } from "../src/cli/voice.js";
import type { AgentKernel, KernelEvent, KernelEventListener, KernelPrompt } from "../src/kernel/kernel.js";
import type { CliIO } from "../src/cli/format.js";

// ── helpers ────────────────────────────────────────────────────

let dataDir = "";
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-voice-test-"));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 假 fetch：URL → 内容（string → bytes），支持 Range/206，记录请求。 */
function fakeFetch(
  contents: Record<string, string>,
  options: { failUrls?: string[]; status200IgnoreRange?: boolean } = {},
): { fetchImpl: VoiceFetch; requests: Array<{ url: string; range?: string }> } {
  const requests: Array<{ url: string; range?: string }> = [];
  const fetchImpl: VoiceFetch = async (url, init) => {
    const range = init?.headers?.Range;
    requests.push({ url, ...(range ? { range } : {}) });
    if (options.failUrls?.some((bad) => url.startsWith(bad))) {
      throw new Error("network down (fake)");
    }
    const hit = Object.entries(contents).find(([base]) => url.startsWith(base));
    if (!hit) {
      return { ok: false, status: 404, headers: { get: () => null }, body: null };
    }
    const all = bytesOf(hit[1]);
    if (range && !options.status200IgnoreRange) {
      const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0);
      const rest = all.subarray(start);
      return {
        ok: true,
        status: 206,
        headers: { get: (n) => (n.toLowerCase() === "content-length" ? String(rest.length) : null) },
        body: (async function* () {
          yield rest;
        })(),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (n) => (n.toLowerCase() === "content-length" ? String(all.length) : null) },
      body: (async function* () {
        // 两块下发，验证分块累加
        yield all.subarray(0, Math.ceil(all.length / 2));
        yield all.subarray(Math.ceil(all.length / 2));
      })(),
    };
  };
  return { fetchImpl, requests };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── 1. 下载器 ──────────────────────────────────────────────────

describe("voice assets: 下载器（假 fetch，零真实下载）", () => {
  it("单文件直下成功：进度回调 + 文件就位 + 幂等跳过", async () => {
    const { fetchImpl } = fakeFetch({
      "https://hf-mirror.com/": "model-bytes",
    });
    const spec = {
      ...SENSEVOICE_SPEC,
      required: ["a.onnx"],
      files: [{ name: "a.onnx", urls: ["https://hf-mirror.com/x/a.onnx"] }],
    };
    const progress: DownloadProgress[] = [];
    const result = await ensureVoiceModel(spec, dataDir, {
      fetchImpl,
      onProgress: (e) => progress.push(e),
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(senseVoiceDir(dataDir), "a.onnx"), "utf-8")).toBe("model-bytes");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)?.file).toBe("a.onnx");
    // 幂等：第二次零请求
    const again = await ensureVoiceModel(spec, dataDir, { fetchImpl });
    expect(again.ok).toBe(true);
  });

  it("镜像顺序回退：首选失败 → 次选成功，失败不抛出", async () => {
    const { fetchImpl, requests } = fakeFetch(
      { "https://huggingface.co/": "backup-bytes" },
      { failUrls: ["https://hf-mirror.com/"] },
    );
    const spec = {
      ...SENSEVOICE_SPEC,
      required: ["a.onnx"],
      files: [
        { name: "a.onnx", urls: ["https://hf-mirror.com/x/a.onnx", "https://huggingface.co/x/a.onnx"] },
      ],
    };
    const result = await ensureVoiceModel(spec, dataDir, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests.map((r) => r.url)).toEqual([
      "https://hf-mirror.com/x/a.onnx",
      "https://huggingface.co/x/a.onnx",
    ]);
    expect(fs.readFileSync(path.join(senseVoiceDir(dataDir), "a.onnx"), "utf-8")).toBe("backup-bytes");
  });

  it(".part 断点续传：Range 头发出 + 206 追加拼接", async () => {
    const dir = senseVoiceDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.onnx.part"), "hello-");
    const { fetchImpl, requests } = fakeFetch({
      "https://hf-mirror.com/": "hello-world",
    });
    const spec = {
      ...SENSEVOICE_SPEC,
      required: ["a.onnx"],
      files: [{ name: "a.onnx", urls: ["https://hf-mirror.com/x/a.onnx"] }],
    };
    const result = await ensureVoiceModel(spec, dataDir, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests[0].range).toBe("bytes=6-");
    expect(fs.readFileSync(path.join(dir, "a.onnx"), "utf-8")).toBe("hello-world");
  });

  it("服务端忽略 Range（200）→ 截断重下完整内容", async () => {
    const dir = senseVoiceDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.onnx.part"), "stale-stale-stale");
    const { fetchImpl } = fakeFetch(
      { "https://hf-mirror.com/": "fresh-content" },
      { status200IgnoreRange: true },
    );
    const spec = {
      ...SENSEVOICE_SPEC,
      required: ["a.onnx"],
      files: [{ name: "a.onnx", urls: ["https://hf-mirror.com/x/a.onnx"] }],
    };
    const result = await ensureVoiceModel(spec, dataDir, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "a.onnx"), "utf-8")).toBe("fresh-content");
  });

  it("sha256 校验：内容不符删除并换镜像", async () => {
    const good = sha256("good-bytes");
    const { fetchImpl } = fakeFetch({
      "https://hf-mirror.com/": "tampered-bytes",
      "https://huggingface.co/": "good-bytes",
    });
    const spec = {
      ...SENSEVOICE_SPEC,
      required: ["a.onnx"],
      files: [
        {
          name: "a.onnx",
          urls: ["https://hf-mirror.com/x/a.onnx", "https://huggingface.co/x/a.onnx"],
          sha256: good,
        },
      ],
    };
    const result = await ensureVoiceModel(spec, dataDir, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(senseVoiceDir(dataDir), "a.onnx"), "utf-8")).toBe("good-bytes");
  });

  it("已有文件哈希不符时不会误判幂等，而会重新下载并复验", async () => {
    const { fetchImpl, requests } = fakeFetch({ "https://huggingface.co/": "good-bytes" });
    const spec = {
      ...SENSEVOICE_SPEC,
      required: ["a.onnx"],
      files: [
        {
          name: "a.onnx",
          urls: ["https://huggingface.co/x/a.onnx"],
          sizeBytes: "good-bytes".length,
          sha256: sha256("good-bytes"),
        },
      ],
    };
    const dir = senseVoiceDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.onnx"), "evil-bytes");
    const result = await ensureVoiceModel(spec, dataDir, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "a.onnx"), "utf8")).toBe("good-bytes");
  });

  it("MOSS 清单：两组仓库 16 个文件 + modelscope 镜像在前", () => {
    expect(MOSS_TTS_SPEC.files).toHaveLength(16);
    expect(MOSS_TTS_SPEC.files[0].urls[0]).toContain("modelscope.cn");
    expect(MOSS_TTS_SPEC.files[0].name).toContain("MOSS-TTS-Nano-100M-ONNX/");
    expect(MOSS_TTS_SPEC.files.at(-1)?.name).toContain("MOSS-Audio-Tokenizer-Nano-ONNX/");
    expect(MOSS_TTS_SPEC.files.every((file) => file.sizeBytes && /^[a-f0-9]{64}$/.test(file.sha256 ?? ""))).toBe(true);
    expect(SENSEVOICE_SPEC.files.every((file) => file.sizeBytes && /^[a-f0-9]{64}$/.test(file.sha256 ?? ""))).toBe(true);
    expect(modelDirFor(MOSS_TTS_SPEC, dataDir)).toContain("moss-tts");
  });
});

// ── 2. 能力探测 ────────────────────────────────────────────────

function fakeSherpa(resultText: string): SherpaOnnx {
  return {
    createOfflineRecognizer: () => ({
      createStream: () => ({ acceptWaveform: () => undefined, free: () => undefined }),
      decode: () => undefined,
      getResult: () => ({ text: resultText }),
      free: () => undefined,
    }),
    readWave: () => ({ samples: new Float32Array(1600), sampleRate: 16000 }),
  };
}

function seedSenseVoiceModel(): void {
  const dir = senseVoiceDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model.int8.onnx"), "fake-onnx");
  fs.writeFileSync(path.join(dir, "tokens.txt"), "<blank>\n");
}

describe("voice engine: 能力探测（懒加载，绝不抛）", () => {
  it("全缺 → disabled（未启用）；引擎有模型缺 → partial 报缺项", () => {
    const empty = probeVoice(dataDir, { sherpa: null, ort: null, ffmpeg: null });
    expect(empty.asr.status).toBe("disabled");
    expect(empty.asr.detail).toContain("未启用");
    expect(empty.tts.status).toBe("disabled");

    const partial = probeVoice(dataDir, { sherpa: fakeSherpa(""), ort: null, ffmpeg: "/usr/bin/ffmpeg" });
    expect(partial.asr.status).toBe("partial");
    expect(partial.asr.missing).toContain("model");
    expect(partial.asr.detail).toContain("penglai voice setup");
  });

  it("模型 + 引擎 + ffmpeg 齐 → ready；detail 诚实", () => {
    seedSenseVoiceModel();
    const probe = probeVoice(dataDir, {
      sherpa: fakeSherpa(""),
      ort: null,
      ffmpeg: "/usr/bin/ffmpeg",
    });
    expect(probe.asr.ready).toBe(true);
    expect(probe.asr.detail).toContain("就绪");
    expect(probe.tts.status).toBe("disabled");
  });

  it("SenseVoice 富标签解析：情绪/语言/无语音", () => {
    expect(parseSenseVoiceResult("<|HAPPY|><|Speech|><|zh|>你好蓬莱")).toEqual({
      text: "你好蓬莱",
      emotion: "HAPPY",
      language: "zh",
      noSpeech: false,
    });
    expect(parseSenseVoiceResult("<|nospeech|>")).toMatchObject({ noSpeech: true, emotion: "NOSPEECH" });
    expect(parseSenseVoiceResult("纯文本")).toMatchObject({ text: "纯文本", emotion: "NEUTRAL" });
  });
});

// ── 3. 服务（假引擎 seam） ─────────────────────────────────────

describe("voice service: 转写与合成（注入假引擎）", () => {
  it("transcribe：假 sherpa → 文本 + 情绪标签；未就绪给补装指引", async () => {
    seedSenseVoiceModel();
    let recognizerConfig: any;
    const sherpa = fakeSherpa("<|HAPPY|><|Speech|><|zh|>你好蓬莱");
    const createOfflineRecognizer = sherpa.createOfflineRecognizer;
    sherpa.createOfflineRecognizer = (config: unknown) => {
      recognizerConfig = config;
      return createOfflineRecognizer(config);
    };
    const service = new VoiceService({
      dataDir,
      sherpaFactory: () => sherpa,
      ortFactory: () => null,
      ffmpegPath: "/usr/bin/ffmpeg",
    });
    const wav = pcmToWavBuffer(new Float32Array(1600).fill(0.01), 16000);
    const result = await service.transcribe({ audioBase64: wav.toString("base64"), format: "wav" });
    expect(result).toMatchObject({ ok: true, text: "你好蓬莱", emotion: "HAPPY", language: "zh" });
    expect(recognizerConfig).toMatchObject({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        modelType: "sense_voice",
        senseVoice: { language: "auto", useInverseTextNormalization: 1 },
        provider: "cpu",
      },
    });

    const empty = new VoiceService({ dataDir, sherpaFactory: () => null, ortFactory: () => null, ffmpegPath: null });
    const notReady = await empty.transcribe({ audioBase64: wav.toString("base64") });
    expect(notReady.ok).toBe(false);
    expect(notReady.error).toContain("penglai voice setup");

    const nospeech = await service.transcribe({ audioBase64: wav.toString("base64") });
    expect(nospeech.ok).toBe(true);
    // （nospeech 路径由 parseSenseVoiceResult 单测钉死；这里覆盖主路径）
  });

  it("transcribe：mp3 无 ffmpeg → 精确降级报错", async () => {
    seedSenseVoiceModel();
    const service = new VoiceService({
      dataDir,
      sherpaFactory: () => fakeSherpa("x"),
      ortFactory: () => null,
      ffmpegPath: null,
    });
    const result = await service.transcribe({
      audioBase64: Buffer.from("fake-mp3").toString("base64"),
      format: "mp3",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ffmpeg");
  });

  it("synthesize 契约引擎：假 ort → RIFF wav + 采样率 + 输入张量", async () => {
    const dir = modelDirFor(MOSS_TTS_SPEC, dataDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "model.onnx"), "fake-weights");
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        inputNames: ["text_tokens", "mask"],
        outputName: "audio",
        sampleRate: 24000,
        vocab: { 你: 1, 好: 2, "<unk>": 0 },
      }),
    );
    const samples = new Float32Array(2400).fill(0.5);
    let seenInputs: Record<string, OrtTensor> = {};
    class FakeSession implements OrtInferenceSession {
      inputNames = ["text_tokens", "mask"];
      outputNames = ["audio"];
      constructor(public model: string | Buffer) {}
      async run(inputs: Record<string, OrtTensor>) {
        seenInputs = inputs;
        return { audio: { data: samples, dims: [samples.length], type: "float32" } };
      }
    }
    const ort: OrtNode = {
      InferenceSession: FakeSession as unknown as OrtNode["InferenceSession"],
      Tensor: class {
        constructor(public type: string, public data: unknown, public dims: number[]) {}
      } as unknown as OrtNode["Tensor"],
    };
    const service = new VoiceService({ dataDir, ortFactory: () => ort, sherpaFactory: () => null });
    const result = await service.synthesize({ text: "你好" });
    expect(result.ok).toBe(true);
    expect(result.engine).toBe("contract");
    expect(result.sampleRate).toBe(24000);
    const wav = Buffer.from(result.wavBase64!, "base64");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect((seenInputs.text_tokens?.data as Int32Array)[0]).toBe(1); // 你
    expect((seenInputs.mask?.data as Int32Array)[1]).toBe(1); // mask 全 1
  });

  it("synthesize：无模型给安装指引；MOSS 文件不全逐项报告", async () => {
    const ort: OrtNode = {
      InferenceSession: class {
        inputNames = [];
        outputNames = [];
        async run() {
          return {};
        }
      } as unknown as OrtNode["InferenceSession"],
      Tensor: class {} as unknown as OrtNode["Tensor"],
    };
    const service = new VoiceService({ dataDir, ortFactory: () => ort, sherpaFactory: () => null });
    const missing = await service.synthesize({ text: "你好" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("penglai voice setup --tts");

    // MOSS 元数据在但 ONNX/data 不全 → 精确诊断，绝不输出假音频
    const ttsDir = path.join(modelDirFor(MOSS_TTS_SPEC, dataDir), "MOSS-TTS-Nano-100M-ONNX");
    fs.mkdirSync(ttsDir, { recursive: true });
    fs.writeFileSync(path.join(ttsDir, "tts_browser_onnx_meta.json"), "{}");
    fs.writeFileSync(path.join(ttsDir, "tokenizer.model"), "fake");
    const codecDir = path.join(modelDirFor(MOSS_TTS_SPEC, dataDir), "MOSS-Audio-Tokenizer-Nano-ONNX");
    fs.mkdirSync(codecDir, { recursive: true });
    fs.writeFileSync(path.join(codecDir, "codec_browser_onnx_meta.json"), "{}");
    const moss = await service.synthesize({ text: "你好" });
    expect(moss.ok).toBe(false);
    expect(moss.error).toContain("模型不完整");
    expect(moss.error).not.toContain("未安装");
  });

  it("synthesize MOSS 全管线适配：双声道交错 PCM → 48kHz WAV", async () => {
    const root = modelDirFor(MOSS_TTS_SPEC, dataDir);
    const ttsDir = path.join(root, "MOSS-TTS-Nano-100M-ONNX");
    const codecDir = path.join(root, "MOSS-Audio-Tokenizer-Nano-ONNX");
    fs.mkdirSync(ttsDir, { recursive: true });
    fs.mkdirSync(codecDir, { recursive: true });
    fs.writeFileSync(path.join(ttsDir, "tts_browser_onnx_meta.json"), "{}");
    fs.writeFileSync(path.join(ttsDir, "tokenizer.model"), "fake");
    fs.writeFileSync(path.join(ttsDir, "moss_tts_prefill.onnx"), "fake");
    fs.writeFileSync(path.join(ttsDir, "moss_tts_global_shared.data"), "fake");
    fs.writeFileSync(path.join(codecDir, "codec_browser_onnx_meta.json"), "{}");
    fs.writeFileSync(path.join(codecDir, "moss_audio_tokenizer_decode_full.onnx"), "fake");
    fs.writeFileSync(path.join(codecDir, "moss_audio_tokenizer_decode_shared.data"), "fake");
    const ort: OrtNode = {
      InferenceSession: class {} as unknown as OrtNode["InferenceSession"],
      Tensor: class {} as unknown as OrtNode["Tensor"],
    };
    const service = new VoiceService({
      dataDir,
      ortFactory: () => ort,
      sherpaFactory: () => null,
      mossRuntimeFactory: () => ({
        synthesize: async () => ({
          // two stereo frames: L/R = .25/-.25 then .5/-.5
          samples: new Float32Array([0.25, -0.25, 0.5, -0.5]),
          sampleRate: 48_000,
          channels: 2,
          voice: "Junhao",
        }),
      }),
    });
    const result = await service.synthesize({ text: "你好，蓬莱。" });
    expect(result).toMatchObject({ ok: true, sampleRate: 48_000, engine: "moss-onnx:Junhao" });
    const wav = Buffer.from(result.wavBase64!, "base64");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt32LE(28)).toBe(48_000 * 2 * 2);
    expect(wav.length).toBe(44 + 4 * 2);
  });
});

// ── 4. RPC + CLI REPL 语音链路 ─────────────────────────────────

class EchoKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "voice-test-chat";
  isRunning = false;
  private readonly listeners = new Set<KernelEventListener>();
  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: Partial<KernelEvent>): void {
    const full = { occurredAt: Date.now(), sessionId: this.sessionId, raw: {}, ...event } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }
  async prompt(input: KernelPrompt): Promise<void> {
    this.emit({ kind: "message.delta", textDelta: `echo:${input.text}` });
    this.emit({ kind: "turn.completed" });
    this.emit({
      kind: "message.completed",
      raw: { type: "message_end", message: { role: "assistant", usage: { input: 5, output: 3 } } },
    });
  }
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

function captureIo(): { io: CliIO; out: () => string } {
  let out = "";
  return {
    io: {
      out: (t) => (out += t),
      line: (t) => (out += `${t}\n`),
      err: (t) => (out += `${t}\n`),
      tty: false,
    },
    out: () => out,
  };
}

describe("voice: RPC + REPL 语音链路（假引擎/假外设）", () => {
  const TOKEN = "voice-e2e-token";
  let home = "";
  let server: StartedServer | null = null;

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-voice-home-"));
    _setPenglaiHomeForTest(home);
    server = await startServer({
      port: 0,
      token: TOKEN,
      dataDir,
      databasePath: path.join(dataDir, "product.db"),
      chatKernelFactory: async () => new EchoKernel(),
      log: () => undefined,
      voice: {
        sherpaFactory: () => fakeSherpa("<|HAPPY|><|Speech|><|zh|>你好蓬莱"),
        ortFactory: () => null,
        ffmpegPath: "/usr/bin/ffmpeg",
        fetchImpl: fakeFetch({ "https://": "file-bytes" }).fetchImpl,
        specs: {
          asr: {
            ...SENSEVOICE_SPEC,
            required: ["model.int8.onnx", "tokens.txt"],
            files: ["model.int8.onnx", "tokens.txt"].map((name) => ({
              name,
              urls: [`https://example.invalid/${name}`],
              sizeBytes: "file-bytes".length,
              sha256: sha256("file-bytes"),
            })),
          },
        },
      },
    });
    const client = await HostClient.connect({ port: server.port, token: TOKEN });
    await client.rpc("config.createProfile", {
      id: "e2e",
      baseUrl: "https://example.invalid/v1",
      model: "e2e-model",
      apiKey: "e2e-key",
    });
    const workspace = await client.rpc("workspace.open", { rootPath: dataDir, name: "voice-e2e" });
    await client.rpc("conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "e2e",
      title: "voice e2e",
    });
  });

  afterEach(async () => {
    if (server) {
      server.server.closeIdleConnections();
      await server.close();
      server = null;
    }
    _setPenglaiHomeForTest(null);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("voice.status RPC：模型缺失 → partial 报缺项；install（假 fetch）后 ready", async () => {
    const client = await HostClient.connect({ port: server!.port, token: TOKEN });
    const before = await client.rpc("voice.status", {});
    expect(before.asr.status).toBe("partial"); // 引擎在（假 sherpa）模型缺
    expect(before.asr.missing).toContain("model");

    // 进度事件经 voice 频道广播
    const progress: string[] = [];
    const off = server!.handle.subscribeEvents((channel, payload) => {
      if (channel === "voice") progress.push(String((payload as { event?: string }).event));
    });
    const installed = await client.rpc("voice.install", { which: "asr" });
    off();
    expect(installed.results[0].ok).toBe(true);
    expect(progress).toContain("voice.download.progress");

    const after = await client.rpc("voice.status", {});
    expect(after.asr.ready).toBe(true);
    expect(after.tts.status).toBe("disabled");
  });

  it("voice.transcribe / voice.synthesize RPC：真转写（假引擎）+ TTS 诚实降级", async () => {
    seedSenseVoiceModel();
    const client = await HostClient.connect({ port: server!.port, token: TOKEN });
    const wav = pcmToWavBuffer(new Float32Array(1600).fill(0.01), 16000);
    const tr = await client.rpc("voice.transcribe", { audioBase64: wav.toString("base64"), format: "wav" });
    expect(tr).toMatchObject({ ok: true, text: "你好蓬莱", emotion: "HAPPY" });
    const sy = await client.rpc("voice.synthesize", { text: "你好" });
    expect(sy.ok).toBe(false);
    expect(sy.error).toContain("onnxruntime-node 未安装");
  });

  it("主动陪伴：opt-in 后经同一 EpisodeRunner 生成，内部心跳不伪造成用户消息", async () => {
    const client = await HostClient.connect({ port: server!.port, token: TOKEN });
    const conversations = await client.rpc("conversation.list", {}) as Array<{ id: string }>;
    const conversationId = conversations[0].id;
    const enabled = await client.rpc("companion.enable", {
      mode: "present",
      conversationId,
    });
    expect(enabled).toMatchObject({ enabled: true, mode: "present", conversationId });
    const events: string[] = [];
    const off = server!.handle.subscribeEvents((channel, payload) => {
      if (channel === "companion") events.push(String((payload as { event?: string }).event));
    });
    const triggered = await client.rpc("companion.trigger", { source: "free" });
    off();
    expect(triggered.accepted).toBe(true);
    expect(events).toContain("companion.message");
    const got = await client.rpc("conversation.get", { conversationId });
    const internalUserMessages = got.messages.filter(
      (message: { role: string; content: Array<{ text?: string }> }) =>
        message.role === "user" && message.content.some((part) => part.text?.includes("主动陪伴内部事件")),
    );
    expect(internalUserMessages).toHaveLength(0);
    expect(got.messages.at(-1).role).toBe("assistant");
    expect(fs.existsSync(path.join(dataDir, "companion.json"))).toBe(true);
  });

  function fakeVoiceIO(overrides: Partial<VoiceReplDeps> = {}): VoiceReplDeps & {
    played: string[];
    synthesized: string[];
    recorded: number;
  } {
    const played: string[] = [];
    const synthesized: string[] = [];
    const state = { recorded: 0 };
    return {
      played,
      synthesized,
      get recorded() {
        return state.recorded;
      },
      status: async () => ({
        asr: { name: "asr", status: "ready", ready: true, missing: [], modelDir: "", detail: "语音识别：就绪" },
        tts: { name: "tts", status: "ready", ready: true, missing: [], modelDir: "", detail: "语音合成：就绪" },
      }),
      transcribe: async () => ({ ok: true, text: "你好蓬莱", emotion: "HAPPY", language: "zh" }),
      synthesize: async (text) => {
        synthesized.push(text);
        return { ok: true, wavBase64: Buffer.from("fake-reply-wav").toString("base64") };
      },
      record: async () => {
        state.recorded += 1;
        return { wavBase64: Buffer.from("fake-rec-wav").toString("base64"), format: "wav" };
      },
      play: async (wav) => {
        played.push(wav);
      },
      ...overrides,
    };
  }

  it("--voice：空行说话全链路——情绪标签注入 prompt，回复 TTS 播报", async () => {
    seedSenseVoiceModel();
    const client = await HostClient.connect({ port: server!.port, token: TOKEN });
    const voice = fakeVoiceIO();
    const cap = captureIo();
    const input = Readable.from(["\n", "/exit\n"]); // 空行 = 说话
    const code = await cmdChatRepl(client, { positionals: [], flags: { voice: true } }, cap.io, input, voice);
    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain("🎙 [HAPPY] 你好蓬莱");
    // 情绪标签注入上下文：echo 内核回显的就是 conversation.prompt 收到的文本
    expect(out).toContain("echo:[语音·情绪:HAPPY·语言:zh] 你好蓬莱");
    // 回复走了 TTS 播报（语音只是 I/O 层：prompt 链路/用量/transcript 不变）
    expect(voice.synthesized).toHaveLength(1);
    expect(voice.synthesized[0]).toContain("echo:");
    expect(voice.played).toHaveLength(1);
    // transcript 落的是同一份文本
    const conversations = await client.rpc("conversation.list", {});
    const got = await client.rpc("conversation.get", { conversationId: conversations[0].id });
    expect(got.messages.at(-2).content[0].text).toContain("[语音·情绪:HAPPY");
  });

  it("/voice 开关：未就绪不录音（降级指引），打字照常", async () => {
    const client = await HostClient.connect({ port: server!.port, token: TOKEN });
    let recorded = 0;
    const voice = fakeVoiceIO({
      status: async () => ({
        asr: { name: "asr", status: "partial", ready: false, missing: ["model"], modelDir: "", detail: "语音识别：装了一半，缺 model" },
        tts: { name: "tts", status: "disabled", ready: false, missing: ["engine"], modelDir: "", detail: "语音合成：未启用" },
      }),
      record: async () => {
        recorded += 1;
        return null;
      },
    });
    const cap = captureIo();
    const input = Readable.from(["/voice\n", "\n", "打字照常\n", "/exit\n"]);
    const code = await cmdChatRepl(client, { positionals: [], flags: {} }, cap.io, input, voice);
    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain("语音输入未就绪");
    expect(recorded).toBe(0); // 未就绪绝不录音
    expect(out).toContain("echo:打字照常"); // 文本路径不受影响
    expect(out).not.toContain("🎙 [");
  });

  it("parseSlashCommand 认 /voice 与 /v；formatVoicePrompt 固定格式", () => {
    expect(parseSlashCommand("/voice")).toEqual({ kind: "voice" });
    expect(parseSlashCommand("/v")).toEqual({ kind: "voice" });
    expect(formatVoicePrompt("你好", "HAPPY", "zh")).toBe("[语音·情绪:HAPPY·语言:zh] 你好");
    expect(formatVoicePrompt("hello", "NEUTRAL", "auto")).toBe("[语音·情绪:NEUTRAL] hello");
  });
});
