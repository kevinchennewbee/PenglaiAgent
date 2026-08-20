import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { PenglaiError } from "@penglai/contracts";
import type { ResolvedMossTtsModel } from "./models.js";

export const TTS_SAMPLE_RATE = 48_000;
export const TTS_CHANNELS = 2;
export const MAX_TTS_TEXT_BYTES = 64 * 1024;
export const MAX_TTS_OUTPUT_FRAMES = TTS_SAMPLE_RATE * 60 * 10;

export interface TtsChunk {
  pcm: Int16Array;
  sampleRate: 48_000;
  channels: 2;
  pause: boolean;
}

export interface TtsEngineResult {
  pcm: Int16Array;
  sampleRate: 48_000;
  channels: 2;
  voiceId: string;
  textChunks: number;
}

export interface TtsEngine {
  synthesize(
    text: string,
    voiceId: string,
    signal?: AbortSignal,
    onChunk?: (chunk: TtsChunk) => Promise<void> | void,
  ): Promise<TtsEngineResult>;
  dispose?(): Promise<void> | void;
}

interface WorkerChunkMessage {
  type: "chunk";
  id: string;
  sampleRate: number;
  channels: number;
  pause: boolean;
  pcm: ArrayBuffer;
}

interface WorkerDoneMessage {
  type: "done";
  id: string;
  ok: boolean;
  voiceId?: string;
  textChunks?: number;
  error?: string;
}

type WorkerMessage = WorkerChunkMessage | WorkerDoneMessage;

interface PendingSynthesis {
  id: string;
  chunks: Int16Array[];
  frames: number;
  onChunk?: (chunk: TtsChunk) => Promise<void> | void;
  chunkChain: Promise<void>;
  abortCleanup?: () => void;
  cancelled?: Error;
  settled: Promise<void>;
  markSettled: () => void;
  resolve: (result: TtsEngineResult) => void;
  reject: (error: Error) => void;
}

const WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
let runtime;
let runtimePromise;
const cancelled = new Set();

function toPcm16(chunk) {
  if (!chunk || chunk.channels !== 2 || chunk.sampleRate !== 48000 || !Array.isArray(chunk.chunkData)) {
    throw new Error('MOSS runtime returned an invalid audio chunk contract');
  }
  const left = chunk.chunkData[0];
  const right = chunk.chunkData[1];
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length) {
    throw new Error('MOSS runtime returned unbalanced stereo audio');
  }
  const pcm = new Int16Array(left.length * 2);
  for (let frame = 0; frame < left.length; frame += 1) {
    const l = Math.max(-1, Math.min(1, Number.isFinite(left[frame]) ? left[frame] : 0));
    const r = Math.max(-1, Math.min(1, Number.isFinite(right[frame]) ? right[frame] : 0));
    pcm[frame * 2] = Math.round(l < 0 ? l * 32768 : l * 32767);
    pcm[frame * 2 + 1] = Math.round(r < 0 ? r * 32768 : r * 32767);
  }
  return pcm;
}

async function prepare() {
  if (runtime) return runtime;
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const mod = await import(workerData.runtimeUrl);
      const next = new mod.BrowserOnnxTtsRuntime({ logger: null });
      await next.configure({ modelPath: workerData.modelRoot, threadCount: workerData.threads });
      await next.ensureManifestLoaded();
      runtime = next;
      return next;
    })();
  }
  return runtimePromise;
}

parentPort.on('message', async (message) => {
  if (message && message.type === 'cancel' && typeof message.id === 'string') {
    cancelled.add(message.id);
    return;
  }
  if (!message || message.type !== 'synthesize' || typeof message.id !== 'string') return;
  try {
    const active = await prepare();
    const voices = active.listBuiltinVoices();
    const selected = voices.find((voice) => [voice.voice, voice.id, voice.display_name].includes(message.voiceId));
    const voiceId = selected && (selected.voice || selected.id || selected.display_name);
    if (!voiceId) throw new Error('MOSS built-in voice is not present in the verified manifest');
    const result = await active.synthesizeVoiceClone({
      text: message.text,
      voiceName: voiceId,
      streaming: true,
      sampleMode: 'fixed',
      voiceCloneMaxTextTokens: 75,
      enableNormalizeTtsText: true,
      enableWeTextProcessing: false,
      isCancelled: () => cancelled.has(message.id),
      onAudioChunk: async (chunk) => {
        const pcm = toPcm16(chunk);
        parentPort.postMessage({
          type: 'chunk',
          id: message.id,
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
          pause: Boolean(chunk.isPause),
          pcm: pcm.buffer,
        }, [pcm.buffer]);
      },
    });
    parentPort.postMessage({
      type: 'done',
      id: message.id,
      ok: true,
      voiceId,
      textChunks: Array.isArray(result.textChunks) ? result.textChunks.length : 0,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'done',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'MOSS synthesis failed',
    });
  } finally {
    cancelled.delete(message.id);
  }
});
`;

function combineChunks(chunks: readonly Int16Array[], frames: number): Int16Array {
  if (!Number.isSafeInteger(frames) || frames <= 0 || frames > MAX_TTS_OUTPUT_FRAMES) {
    throw new PenglaiError("DELIVERY_PERMANENT", "MOSS output exceeded the audio budget");
  }
  const output = new Int16Array(frames * TTS_CHANNELS);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== output.length) throw new PenglaiError("STORE_CORRUPT", "MOSS chunk accounting mismatch");
  return output;
}

export class MossWorkerEngine implements TtsEngine {
  private worker: Worker | undefined;
  private pending: PendingSynthesis | undefined;
  private disposed = false;
  private sequence = 0;
  private readonly runtimeUrl: string;

  constructor(
    private readonly model: ResolvedMossTtsModel,
    private readonly threads = 2,
  ) {
    const require = createRequire(import.meta.url);
    const ort = require("onnxruntime-node") as { InferenceSession?: unknown };
    const sentencepiece = require("sentencepiece-js") as { SentencePieceProcessor?: unknown };
    if (!ort.InferenceSession || !sentencepiece.SentencePieceProcessor) {
      throw new PenglaiError("DSH_UNAVAILABLE", "MOSS target runtime closure unavailable");
    }
    this.runtimeUrl = new URL("./third_party/moss_tts/runtime.mjs", import.meta.url).href;
  }

  async synthesize(
    text: string,
    voiceId: string,
    signal?: AbortSignal,
    onChunk?: (chunk: TtsChunk) => Promise<void> | void,
  ): Promise<TtsEngineResult> {
    if (this.disposed) throw new PenglaiError("DSH_UNAVAILABLE", "MOSS engine disposed");
    if (this.pending) throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS engine is busy");
    if (!text.trim() || Buffer.byteLength(text, "utf8") > MAX_TTS_TEXT_BYTES) {
      throw new PenglaiError("INVALID_INPUT", "MOSS text size rejected");
    }
    if (signal?.aborted) throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS synthesis cancelled");
    const worker = this.requireWorker();
    const id = `tts-${Date.now()}-${this.sequence += 1}`;
    return new Promise<TtsEngineResult>((resolve, reject) => {
      let markSettled: () => void = () => {};
      const settled = new Promise<void>((resolveSettled) => {
        markSettled = resolveSettled;
      });
      const pending: PendingSynthesis = {
        id,
        chunks: [],
        frames: 0,
        ...(onChunk ? { onChunk } : {}),
        chunkChain: Promise.resolve(),
        settled,
        markSettled,
        resolve,
        reject,
      };
      if (signal) {
        const onAbort = () => {
          if (this.pending !== pending) return;
          pending.cancelled = new PenglaiError("DELIVERY_TRANSIENT", "MOSS synthesis cancelled");
          worker.postMessage({ type: "cancel", id });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }
      this.pending = pending;
      worker.postMessage({ type: "synthesize", id, text, voiceId });
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.pending;
    if (pending && this.worker) {
      pending.cancelled = new PenglaiError("DSH_UNAVAILABLE", "MOSS engine disposed");
      this.worker.postMessage({ type: "cancel", id: pending.id });
      await pending.settled;
    }
    await this.resetWorker(new PenglaiError("DSH_UNAVAILABLE", "MOSS engine disposed"));
  }

  private requireWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        runtimeUrl: this.runtimeUrl,
        modelRoot: this.model.modelRoot,
        threads: Math.max(1, Math.min(4, Math.floor(this.threads))),
      },
    });
    worker.on("message", (message: WorkerMessage) => this.onMessage(message));
    worker.on("error", () => {
      void this.resetWorker(new PenglaiError("DSH_UNAVAILABLE", "MOSS worker failed"), worker);
    });
    worker.on("exit", (code) => {
      if (this.worker === worker && (code !== 0 || this.pending)) {
        void this.resetWorker(
          new PenglaiError("DSH_UNAVAILABLE", `MOSS worker exited code=${code}`),
          worker,
        );
      }
    });
    this.worker = worker;
    return worker;
  }

  private onMessage(message: WorkerMessage): void {
    const pending = this.pending;
    if (!pending || message.id !== pending.id) return;
    if (message.type === "chunk") {
      if (message.sampleRate !== TTS_SAMPLE_RATE || message.channels !== TTS_CHANNELS) {
        void this.resetWorker(new PenglaiError("DSH_CONTRACT_DRIFT", "MOSS output format drift"));
        return;
      }
      const pcm = new Int16Array(message.pcm);
      if (pcm.length % TTS_CHANNELS !== 0) {
        void this.resetWorker(new PenglaiError("STORE_CORRUPT", "MOSS output alignment invalid"));
        return;
      }
      const frames = pcm.length / TTS_CHANNELS;
      if (pending.frames + frames > MAX_TTS_OUTPUT_FRAMES) {
        void this.resetWorker(new PenglaiError("DELIVERY_PERMANENT", "MOSS output exceeded the audio budget"));
        return;
      }
      pending.frames += frames;
      pending.chunks.push(pcm);
      if (pending.onChunk) {
        pending.chunkChain = pending.chunkChain.then(() => pending.onChunk!({
          pcm: new Int16Array(pcm),
          sampleRate: TTS_SAMPLE_RATE,
          channels: TTS_CHANNELS,
          pause: message.pause,
        }));
      }
      return;
    }
    this.pending = undefined;
    pending.abortCleanup?.();
    void pending.chunkChain.then(() => {
      if (pending.cancelled) {
        pending.reject(pending.cancelled);
        return;
      }
      if (!message.ok || !message.voiceId || !message.textChunks) {
        pending.reject(new PenglaiError("DSH_UNAVAILABLE", message.error || "MOSS synthesis failed"));
        return;
      }
      try {
        pending.resolve({
          pcm: combineChunks(pending.chunks, pending.frames),
          sampleRate: TTS_SAMPLE_RATE,
          channels: TTS_CHANNELS,
          voiceId: message.voiceId,
          textChunks: message.textChunks,
        });
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error("MOSS output failed"));
      }
    }).catch((error: unknown) => {
      pending.reject(error instanceof Error ? error : new Error("MOSS stream consumer failed"));
    }).finally(pending.markSettled);
  }

  private async resetWorker(reason: Error, expected?: Worker): Promise<void> {
    if (expected && this.worker !== expected) return;
    const worker = this.worker;
    this.worker = undefined;
    const pending = this.pending;
    this.pending = undefined;
    pending?.abortCleanup?.();
    pending?.reject(reason);
    pending?.markSettled();
    if (worker) await worker.terminate().catch(() => undefined);
  }
}
