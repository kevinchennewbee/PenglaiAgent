import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { PenglaiError } from "@penglai/contracts";
import type { AudioHandle, AudioSource } from "./audio-registry.js";
import type { ResolvedSenseVoiceModel } from "./models.js";
import {
  confirmBeforeTurn,
  gateAudio,
  type AudioGateInput,
  type TranscriptDraft,
} from "./service.js";

export type { AudioHandle } from "./audio-registry.js";

export interface TranscribeEngine {
  transcribe(
    pcmMono: Int16Array,
    sampleRate: number,
    signal?: AbortSignal,
  ): Promise<TranscriptDraft>;
  dispose?(): Promise<void> | void;
}

export interface ParsedSenseVoiceResult {
  text: string;
  language: string;
  emotion: string;
  noSpeech: boolean;
}

interface WorkerResult {
  type: "result";
  id: string;
  ok: boolean;
  text?: string;
  lang?: string;
  emotion?: string;
  event?: string;
}

interface RuntimeMetadata {
  packageVersion: string;
  gitSha1: string;
  onnxruntimeVersion: string;
}

const SENSEVOICE_EMOTIONS = new Set([
  "HAPPY",
  "SAD",
  "ANGRY",
  "NEUTRAL",
  "FEARFUL",
  "DISGUSTED",
  "SURPRISED",
]);
const SENSEVOICE_LANGUAGES = new Set(["ZH", "EN", "JA", "KO", "YUE", "AUTO"]);
const MAX_CHANNELS = 2;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MAX_DECODED_SAMPLES = 16_000 * 180;

export function createAudioHandle(
  buf: Buffer,
  opts: {
    mediaType: string;
    durationMs: number;
    source: AudioSource;
    ownerOperation?: string;
    ttlMs?: number;
  },
): AudioHandle {
  return {
    id: randomUUID(),
    digest: createHash("sha256").update(buf).digest("hex"),
    mediaType: opts.mediaType,
    bytes: buf.length,
    durationMs: opts.durationMs,
    source: opts.source,
    ownerOperation: opts.ownerOperation ?? "legacy-helper",
    expiresAt: Date.now() + (opts.ttlMs ?? 15 * 60_000),
  };
}

export function detectMagic(buf: Buffer): string {
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF") {
    return "RIFF";
  }
  if (buf.length >= 3 && buf.subarray(0, 3).toString("ascii") === "ID3") {
    return "ID3";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "OggS") {
    return "OggS";
  }
  if (buf.length >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    return "ftyp";
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "#!SILK") {
    return "#!SILK";
  }
  return "";
}

export function decodeWavPcm16(buf: Buffer): {
  pcm: Int16Array;
  sampleRate: number;
  durationMs: number;
} {
  if (
    buf.length < 44 ||
    buf.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buf.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    throw new PenglaiError("INVALID_INPUT", "ASR WAV header rejected");
  }
  const riffBytes = buf.readUInt32LE(4) + 8;
  if (riffBytes > buf.length || riffBytes < 44) {
    throw new PenglaiError("INVALID_INPUT", "ASR WAV RIFF size rejected");
  }
  let offset = 12;
  let audioFormat = 0;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let blockAlign = 0;
  let data: Buffer | undefined;
  while (offset + 8 <= riffBytes) {
    const id = buf.subarray(offset, offset + 4).toString("ascii");
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > riffBytes) {
      throw new PenglaiError("INVALID_INPUT", "ASR WAV chunk exceeds container");
    }
    if (id === "fmt ") {
      if (size < 16) throw new PenglaiError("INVALID_INPUT", "ASR WAV fmt truncated");
      audioFormat = buf.readUInt16LE(start);
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      blockAlign = buf.readUInt16LE(start + 12);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === "data") {
      data = buf.subarray(start, end);
      break;
    }
    offset = end + (size % 2);
  }
  if (!data) throw new PenglaiError("INVALID_INPUT", "ASR WAV data missing");
  if (
    audioFormat !== 1 ||
    bits !== 16 ||
    channels < 1 ||
    channels > MAX_CHANNELS ||
    sampleRate < MIN_SAMPLE_RATE ||
    sampleRate > MAX_SAMPLE_RATE ||
    blockAlign !== channels * 2 ||
    data.length % blockAlign !== 0
  ) {
    throw new PenglaiError("INVALID_INPUT", "ASR WAV must be bounded PCM16 mono/stereo");
  }
  const samples = new Int16Array(
    data.buffer,
    data.byteOffset,
    Math.floor(data.length / 2),
  );
  const mono = channels === 1 ? new Int16Array(samples) : downmix(samples, channels);
  const durationMs = Math.round((mono.length / sampleRate) * 1000);
  if (mono.length > (MAX_DECODED_SAMPLES * sampleRate) / 16_000) {
    throw new PenglaiError("INVALID_INPUT", "ASR WAV decoded duration exceeds budget");
  }
  return { pcm: mono, sampleRate, durationMs };
}

function downmix(samples: Int16Array, channels: number): Int16Array {
  const frames = Math.floor(samples.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let acc = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      acc += samples[i * channels + channel] ?? 0;
    }
    out[i] = Math.max(-32_768, Math.min(32_767, Math.round(acc / channels)));
  }
  return out;
}

export function resamplePcm16Mono(
  input: Int16Array,
  fromRate: number,
  toRate = 16_000,
): Int16Array {
  if (fromRate === toRate) return new Int16Array(input);
  if (
    fromRate < MIN_SAMPLE_RATE ||
    fromRate > MAX_SAMPLE_RATE ||
    toRate < MIN_SAMPLE_RATE ||
    toRate > MAX_SAMPLE_RATE
  ) {
    throw new PenglaiError("INVALID_INPUT", "ASR sample rate rejected");
  }
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  if (length > MAX_DECODED_SAMPLES) {
    throw new PenglaiError("INVALID_INPUT", "ASR resample exceeds decoded budget");
  }
  const output = new Int16Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    const sample = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
    output[index] = Math.max(-32_768, Math.min(32_767, Math.round(sample)));
  }
  return output;
}

export function parseSenseVoiceResult(raw: string): ParsedSenseVoiceResult {
  const tags: string[] = [];
  const tagPattern = /<\|([^|]+)\|>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(raw)) !== null) {
    tags.push((match[1] ?? "").trim().toUpperCase());
  }
  const noSpeech = tags.includes("NOSPEECH") || tags.includes("NO-SPEECH");
  const emotion =
    tags.find((tag) => SENSEVOICE_EMOTIONS.has(tag)) ?? "NEUTRAL";
  const language =
    tags.find((tag) => SENSEVOICE_LANGUAGES.has(tag))?.toLowerCase() ?? "auto";
  const text = raw.replace(tagPattern, "").trim();
  return {
    text: noSpeech ? "" : text,
    language,
    emotion: noSpeech ? "NOSPEECH" : emotion,
    noSpeech: noSpeech || !text,
  };
}

export function buildSenseVoiceConfig(model: ResolvedSenseVoiceModel): object {
  return {
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      modelType: "sense_voice",
      senseVoice: {
        model: model.modelPath,
        language: "auto",
        useInverseTextNormalization: 1,
      },
      tokens: model.tokensPath,
      numThreads: 1,
      provider: "cpu",
      debug: false,
    },
  };
}

const SHERPA_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const sherpa = require(workerData.entry);
let recognizer;
function owner() {
  if (!recognizer) recognizer = sherpa.createOfflineRecognizer(workerData.config);
  return recognizer;
}
parentPort.on('message', (message) => {
  if (message && message.type === 'dispose') {
    try { recognizer?.free(); } catch {}
    recognizer = undefined;
    parentPort.postMessage({ type: 'disposed' });
    parentPort.close();
    return;
  }
  if (!message || message.type !== 'transcribe') return;
  let stream;
  try {
    const runtime = owner();
    const samples = new Float32Array(message.samples);
    stream = runtime.createStream();
    stream.acceptWaveform(16000, samples);
    runtime.decode(stream);
    const result = runtime.getResult(stream);
    parentPort.postMessage({
      type: 'result',
      id: message.id,
      ok: true,
      text: String(result?.text ?? ''),
      lang: String(result?.lang ?? ''),
      emotion: String(result?.emotion ?? ''),
      event: String(result?.event ?? ''),
    });
  } catch {
    parentPort.postMessage({ type: 'result', id: message.id, ok: false });
  } finally {
    try { stream?.free(); } catch {}
  }
});
`;

export class SherpaSenseVoiceEngine implements TranscribeEngine {
  private worker: Worker | undefined;
  private busy = false;
  private disposed = false;
  private pendingReject: ((error: Error) => void) | undefined;
  readonly runtime: RuntimeMetadata;
  private readonly entry: string;

  constructor(private readonly model: ResolvedSenseVoiceModel) {
    const require = createRequire(import.meta.url);
    this.entry = require.resolve("sherpa-onnx");
    const sherpa = require("sherpa-onnx") as {
      version?: unknown;
      gitSha1?: unknown;
      onnxruntimeVersion?: unknown;
    };
    this.runtime = {
      packageVersion: String(sherpa.version ?? "unknown"),
      gitSha1: String(sherpa.gitSha1 ?? "unknown"),
      onnxruntimeVersion: String(sherpa.onnxruntimeVersion ?? "unknown"),
    };
  }

  async transcribe(
    pcmMono: Int16Array,
    sampleRate: number,
    signal?: AbortSignal,
  ): Promise<TranscriptDraft> {
    if (this.disposed) {
      throw new PenglaiError("DSH_UNAVAILABLE", "ASR engine disposed");
    }
    if (this.busy) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR engine concurrency exceeded");
    }
    if (signal?.aborted) throw new PenglaiError("DELIVERY_TRANSIENT", "ASR cancelled");
    const pcm = resamplePcm16Mono(pcmMono, sampleRate);
    if (!pcm.length || rootMeanSquare(pcm) < 30) {
      return { text: "", confirmed: false, noSpeech: true };
    }
    const samples = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index += 1) {
      samples[index] = (pcm[index] ?? 0) / 32_768;
    }
    const worker = this.ensureWorker();
    const id = randomUUID();
    this.busy = true;
    return new Promise<TranscriptDraft>((resolvePromise, rejectPromise) => {
      let settled = false;
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        this.busy = false;
        this.pendingReject = undefined;
        signal?.removeEventListener("abort", abort);
        rejectPromise(error);
      };
      const abort = () => {
        void this.resetWorker(false);
        settleReject(new PenglaiError("DELIVERY_TRANSIENT", "ASR cancelled"));
      };
      const message = (value: unknown) => {
        const result = value as WorkerResult;
        if (result.type !== "result" || result.id !== id) return;
        worker.off("message", message);
        if (settled) return;
        settled = true;
        this.busy = false;
        this.pendingReject = undefined;
        signal?.removeEventListener("abort", abort);
        if (!result.ok) {
          rejectPromise(new PenglaiError("DSH_UNAVAILABLE", "ASR engine inference failed"));
          return;
        }
        const parsed = parseSenseVoiceResult(
          `${result.lang ?? ""}${result.emotion ?? ""}${result.event ?? ""}${result.text ?? ""}`,
        );
        resolvePromise({
          text: parsed.text,
          confirmed: false,
          language: parsed.language,
          emotion: parsed.emotion,
          noSpeech: parsed.noSpeech,
        });
      };
      this.pendingReject = settleReject;
      worker.on("message", message);
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage(
        { type: "transcribe", id, samples: samples.buffer },
        [samples.buffer],
      );
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingReject?.(
      new PenglaiError("DSH_UNAVAILABLE", "ASR engine disposed"),
    );
    await this.resetWorker(true);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(SHERPA_WORKER_SOURCE, {
      eval: true,
      workerData: {
        entry: this.entry,
        config: buildSenseVoiceConfig(this.model),
      },
    });
    worker.on("error", () => {
      this.worker = undefined;
      this.pendingReject?.(
        new PenglaiError("DSH_UNAVAILABLE", "ASR engine worker failed"),
      );
    });
    worker.on("exit", (code) => {
      if (this.worker === worker) this.worker = undefined;
      if (code !== 0 && this.busy) {
        this.pendingReject?.(
          new PenglaiError("DSH_UNAVAILABLE", "ASR engine worker exited"),
        );
      }
    });
    this.worker = worker;
    return worker;
  }

  private async resetWorker(graceful: boolean): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    if (!worker) return;
    if (graceful) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        new Promise<void>((resolvePromise) => {
          const message = (value: unknown) => {
            if ((value as { type?: unknown })?.type !== "disposed") return;
            worker.off("message", message);
            resolvePromise();
          };
          worker.on("message", message);
          worker.once("exit", () => resolvePromise());
          worker.postMessage({ type: "dispose" });
        }),
        new Promise<void>((resolvePromise) => {
          timer = setTimeout(resolvePromise, 500);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }
    if (worker.threadId === -1) return;
    await worker.terminate();
  }
}

function rootMeanSquare(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (const sample of pcm) sum += sample * sample;
  return Math.sqrt(sum / pcm.length);
}

export async function transcribeBuffer(
  buf: Buffer,
  engine: TranscribeEngine,
  gate: AudioGateInput,
  signal?: AbortSignal,
): Promise<{ handle: AudioHandle; draft: TranscriptDraft }> {
  const magic = detectMagic(buf);
  gateAudio({
    ...gate,
    magic,
    bytes: buf.length,
    durationMs: Math.max(1, gate.durationMs),
  });
  if (magic !== "RIFF") {
    throw new PenglaiError(
      "INVALID_INPUT",
      "ASR core accepts PCM16 WAV; packaged converters must normalize other codecs",
    );
  }
  const wav = decodeWavPcm16(buf);
  gateAudio({
    ...gate,
    magic,
    bytes: buf.length,
    durationMs: wav.durationMs,
  });
  const handle = createAudioHandle(buf, {
    mediaType: "audio/wav",
    durationMs: wav.durationMs,
    source: gate.claimed ? "im" : "attachment",
  });
  const draft = await engine.transcribe(wav.pcm, wav.sampleRate, signal);
  return { handle, draft };
}

export function confirmDraft(
  draft: TranscriptDraft,
): { enterTurn: true; text: string } {
  return confirmBeforeTurn(draft);
}
