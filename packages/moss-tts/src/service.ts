import { createHash } from "node:crypto";
import {
  PENGLAI_RESOURCE_JOB_BUDGETS,
  PenglaiError,
  type ErrorClass,
} from "@penglai/contracts";
import {
  MAX_TTS_TEXT_BYTES,
  MossWorkerEngine,
  type TtsChunk,
  type TtsEngine,
} from "./engine.js";
import {
  MOSS_TTS_MANIFEST,
  TtsModelManager,
  type ResolvedMossTtsModel,
  type TtsModelManifest,
  type TtsModelState,
} from "./models.js";
import {
  TtsOutputRegistry,
  type TtsAudioHandle,
} from "./output-registry.js";
import { encodeWav } from "./synth.js";

export interface BuiltinVoice {
  id: string;
  upstreamId: string;
  displayName: string;
  locale: "zh" | "en" | "ja";
}

export const BUILTIN_VOICES: readonly BuiltinVoice[] = Object.freeze([
  { id: "moss-zh-default", upstreamId: "Junhao", displayName: "CN 欢迎关注模思智能", locale: "zh" },
  { id: "moss-zh-zhiming", upstreamId: "Zhiming", displayName: "CN 京味胡同闲聊", locale: "zh" },
  { id: "moss-zh-weiguo", upstreamId: "Weiguo", displayName: "CN 说书", locale: "zh" },
  { id: "moss-zh-xiaoyu", upstreamId: "Xiaoyu", displayName: "CN 明星", locale: "zh" },
  { id: "moss-zh-yuewen", upstreamId: "Yuewen", displayName: "CN 机车", locale: "zh" },
  { id: "moss-zh-lingyu", upstreamId: "Lingyu", displayName: "CN 深夜电台", locale: "zh" },
  { id: "moss-en-trump", upstreamId: "Trump", displayName: "EN Trump", locale: "en" },
  { id: "moss-en-default", upstreamId: "Ava", displayName: "EN The Bitter Lesson", locale: "en" },
  { id: "moss-en-bella", upstreamId: "Bella", displayName: "EN A Gentle Reminder", locale: "en" },
  { id: "moss-en-adam", upstreamId: "Adam", displayName: "EN English News", locale: "en" },
  { id: "moss-en-nathan", upstreamId: "Nathan", displayName: "EN The Quiet Motion of the World", locale: "en" },
  { id: "moss-ja-soyo", upstreamId: "Soyo", displayName: "JP Soyo", locale: "ja" },
  { id: "moss-ja-saki", upstreamId: "Saki", displayName: "JP Saki", locale: "ja" },
  { id: "moss-ja-mortis", upstreamId: "Mortis", displayName: "JP Mortis", locale: "ja" },
  { id: "moss-ja-umiri", upstreamId: "Umiri", displayName: "JP Umiri", locale: "ja" },
  { id: "moss-ja-mei", upstreamId: "Mei", displayName: "JP Togawa", locale: "ja" },
  { id: "moss-ja-anon", upstreamId: "Anon", displayName: "JP Anon", locale: "ja" },
  { id: "moss-ja-arisa", upstreamId: "Arisa", displayName: "JP Arisa", locale: "ja" },
]);

export interface SynthesizeInput {
  model: TtsModelState;
  finalText: string;
  finalDigest: string;
  voiceId: string;
  cancelled?: boolean;
}

export interface TtsSynthesisRequest {
  operationId: string;
  sourceFinalId: string;
  finalText: string;
  finalDigest: string;
  voiceId: string;
  locale: "zh" | "en" | "ja";
  deadlineMs?: number;
  ttlMs?: number;
  onChunk?: (chunk: TtsChunk) => Promise<void> | void;
}

export type TtsSynthesisState =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface TtsSynthesisOperation {
  operationId: string;
  sourceFinalId: string;
  finalDigest: string;
  voiceId: string;
  locale: "zh" | "en" | "ja";
  modelRevision: string;
  state: TtsSynthesisState;
  createdAt: string;
  updatedAt: string;
  firstChunkLatencyMs?: number;
  elapsedMs?: number;
  durationMs?: number;
  outputDigest?: string;
  outputBytes?: number;
  textChunks?: number;
  errorClass?: ErrorClass;
}

interface QueueItem {
  request: TtsSynthesisRequest;
  operation: TtsSynthesisOperation;
  controller: AbortController;
  deadlineAt: number;
  queueTimer: NodeJS.Timeout;
  resolve: (value: { handle: TtsAudioHandle; operation: TtsSynthesisOperation }) => void;
  reject: (error: Error) => void;
}

export interface MossTtsServiceOptions {
  modelsDir: string;
  tempDir: string;
  manifest?: TtsModelManifest;
  fetchImpl?: typeof fetch;
  resolveCapability?: (capabilityRef: string) => Promise<string>;
  engineFactory?: (model: ResolvedMossTtsModel) => TtsEngine | Promise<TtsEngine>;
  now?: () => number;
}

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SOURCE_FINAL_ID = /^[A-Za-z0-9:_-]{8,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_QUEUE =
  PENGLAI_RESOURCE_JOB_BUDGETS["@penglai/moss-tts"].totalJobs;
const DEFAULT_DEADLINE_MS = 10 * 60_000;
const MAX_DEADLINE_MS = 15 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function stableErrorClass(error: unknown): ErrorClass {
  return error instanceof PenglaiError ? error.errorClass : "DSH_UNAVAILABLE";
}

function resolveVoice(id: string): BuiltinVoice {
  const voice = BUILTIN_VOICES.find((candidate) => candidate.id === id);
  if (!voice) throw new PenglaiError("INVALID_INPUT", "unknown MOSS built-in voice");
  return voice;
}

export function digestFinal(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function refuseSystemTtsFallback(): never {
  throw new PenglaiError("SECURITY_POLICY", "system/fake TTS fallback forbidden");
}

export class PenglaiMossTtsService {
  readonly manager: TtsModelManager;
  readonly outputs: TtsOutputRegistry;
  readonly ready: Promise<void>;
  private readonly operations = new Map<string, TtsSynthesisOperation>();
  private readonly queue: QueueItem[] = [];
  private active: QueueItem | undefined;
  private activeTask: Promise<void> | undefined;
  private engine: TtsEngine | undefined;
  private engineRevision: string | undefined;
  private disposed = false;

  constructor(private readonly options: MossTtsServiceOptions) {
    this.manager = new TtsModelManager(
      options.modelsDir,
      options.manifest ?? MOSS_TTS_MANIFEST,
      {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.resolveCapability ? { resolveCapability: options.resolveCapability } : {}),
      },
    );
    this.outputs = new TtsOutputRegistry(options.tempDir, options.now);
    this.ready = Promise.all([this.manager.initialize(), this.outputs.initialize()]).then(() => undefined);
  }

  describeCapability() {
    return {
      ...this.manager.describeCapability(),
      queueDepth: this.queue.length,
      activeSyntheses: this.active ? 1 : 0,
      outputHandles: this.outputs.describe().active,
    };
  }

  resourceSnapshot() {
    const capability = this.describeCapability();
    return {
      workers: capability.queueDepth + capability.activeSyntheses,
      sockets: 0,
      timers: capability.queueDepth,
      remotes: 0,
      db: 0,
      modelSessions: this.engine ? 1 : 0,
      audioHandles: capability.outputHandles,
      activeJobs: capability.activeSyntheses,
      queuedJobs: capability.queueDepth,
    };
  }

  describeModels() {
    return this.manager.describeModels();
  }

  listVoices(): BuiltinVoice[] {
    return BUILTIN_VOICES.map((voice) => ({ ...voice }));
  }

  prepareModel(operationId: string) {
    return this.manager.prepareModel(operationId);
  }

  pauseDownload(operationId: string) {
    return this.manager.pauseDownload(operationId);
  }

  resumeDownload(operationId: string) {
    return this.manager.resumeDownload(operationId);
  }

  cancelDownload(operationId: string) {
    return this.manager.cancelDownload(operationId);
  }

  importVerifiedModel(operationId: string, capabilityRef: string) {
    return this.manager.importVerifiedModel(operationId, capabilityRef);
  }

  async synthesize(
    request: TtsSynthesisRequest,
  ): Promise<{ handle: TtsAudioHandle; operation: TtsSynthesisOperation }> {
    await this.ready;
    this.assertUsable();
    this.assertRequest(request);
    if (this.operations.has(request.operationId) || this.manager.getOperation(request.operationId)) {
      throw new PenglaiError("INVALID_INPUT", "TTS operation id already used");
    }
    if (this.queue.length + (this.active ? 1 : 0) >= MAX_QUEUE) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "TTS synthesis backpressure");
    }
    const deadline = request.deadlineMs ?? DEFAULT_DEADLINE_MS;
    if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > MAX_DEADLINE_MS) {
      throw new PenglaiError("INVALID_INPUT", "TTS deadline rejected");
    }
    const at = nowIso();
    const operation: TtsSynthesisOperation = {
      operationId: request.operationId,
      sourceFinalId: request.sourceFinalId,
      finalDigest: request.finalDigest,
      voiceId: request.voiceId,
      locale: request.locale,
      modelRevision: this.manager.manifest.revision,
      state: "queued",
      createdAt: at,
      updatedAt: at,
    };
    this.pruneOperations();
    this.operations.set(request.operationId, operation);
    return new Promise((resolvePromise, rejectPromise) => {
      const item = {
        request,
        operation,
        controller: new AbortController(),
        deadlineAt: Date.now() + deadline,
        queueTimer: setTimeout(() => undefined, deadline),
        resolve: resolvePromise,
        reject: rejectPromise,
      } satisfies QueueItem;
      clearTimeout(item.queueTimer);
      item.queueTimer = setTimeout(() => this.expireQueued(item), deadline);
      this.queue.push(item);
      this.pump();
    });
  }

  getOperation(operationId: string) {
    this.assertOperationId(operationId);
    const synthesis = this.operations.get(operationId);
    if (synthesis) return { category: "synthesis" as const, ...synthesis };
    const model = this.manager.getOperation(operationId);
    return model ? { category: "model" as const, ...model } : undefined;
  }

  async cancelSynthesis(operationId: string): Promise<TtsSynthesisOperation> {
    this.assertOperationId(operationId);
    const operation = this.operations.get(operationId);
    if (!operation) throw new PenglaiError("INVALID_INPUT", "TTS operation not found");
    if (operation.state !== "queued" && operation.state !== "running") {
      throw new PenglaiError("INVALID_INPUT", "TTS operation cannot be cancelled");
    }
    operation.state = "cancelled";
    operation.updatedAt = nowIso();
    const index = this.queue.findIndex((item) => item.operation.operationId === operationId);
    if (index >= 0) {
      const [item] = this.queue.splice(index, 1);
      if (item) {
        clearTimeout(item.queueTimer);
        item.controller.abort("cancelled");
        item.reject(new PenglaiError("DELIVERY_TRANSIENT", "TTS synthesis cancelled"));
      }
    }
    if (this.active?.operation.operationId === operationId) {
      this.active.controller.abort("cancelled");
      await this.activeTask?.catch(() => undefined);
    }
    return { ...operation };
  }

  async readOutput(handle: TtsAudioHandle, ownerOperation: string): Promise<Buffer> {
    this.assertOperationId(ownerOperation);
    return this.outputs.resolve(handle, ownerOperation);
  }

  async releaseOutput(handleId: string): Promise<void> {
    return this.outputs.release(handleId);
  }

  async deleteModel(
    revision: string,
    confirmation: { revision: string; acknowledged: true },
  ) {
    if (this.active || this.queue.length) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "TTS synthesis is busy");
    }
    await this.releaseEngine();
    return this.manager.deleteModel(revision, confirmation);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.controller.abort("disposed");
    const queued = this.queue.splice(0);
    for (const item of queued) {
      clearTimeout(item.queueTimer);
      item.controller.abort("disposed");
      item.operation.state = "cancelled";
      item.operation.updatedAt = nowIso();
      item.reject(new PenglaiError("DSH_UNAVAILABLE", "TTS service disposed"));
    }
    await this.activeTask?.catch(() => undefined);
    const results = await Promise.allSettled([
      this.releaseEngine(),
      this.outputs.dispose(),
      this.manager.dispose(),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
  }

  private pump(): void {
    if (this.active || this.disposed) return;
    const item = this.queue.shift();
    if (!item) return;
    clearTimeout(item.queueTimer);
    if (item.controller.signal.aborted || item.operation.state === "cancelled") {
      item.reject(new PenglaiError("DELIVERY_TRANSIENT", "TTS synthesis cancelled"));
      this.pump();
      return;
    }
    this.active = item;
    item.operation.state = "running";
    item.operation.updatedAt = nowIso();
    const task = this.runSynthesis(item).finally(() => {
      if (this.active === item) this.active = undefined;
      if (this.activeTask === task) this.activeTask = undefined;
      this.pump();
    });
    this.activeTask = task;
  }

  private async runSynthesis(item: QueueItem): Promise<void> {
    const started = Date.now();
    const remaining = item.deadlineAt - started;
    if (remaining <= 0) item.controller.abort("deadline");
    const timeout = setTimeout(
      () => item.controller.abort("deadline"),
      Math.max(1, remaining),
    );
    let firstChunkAt = 0;
    try {
      const engine = await this.requireEngine();
      const voice = resolveVoice(item.request.voiceId);
      const result = await engine.synthesize(
        item.request.finalText,
        voice.upstreamId,
        item.controller.signal,
        async (chunk) => {
          if (!firstChunkAt) firstChunkAt = Date.now();
          await item.request.onChunk?.(chunk);
        },
      );
      if (item.controller.signal.aborted) {
        throw new PenglaiError("DELIVERY_TRANSIENT", "TTS synthesis cancelled");
      }
      const wav = encodeWav(result.pcm, result.sampleRate, result.channels);
      const durationMs = Math.round((result.pcm.length / result.channels / result.sampleRate) * 1000);
      const handle = await this.outputs.stage(wav, {
        durationMs,
        voiceId: item.request.voiceId,
        sourceFinalDigest: item.request.finalDigest,
        ownerOperation: item.request.operationId,
        ...(item.request.ttlMs === undefined ? {} : { ttlMs: item.request.ttlMs }),
      });
      item.operation.state = "completed";
      item.operation.updatedAt = nowIso();
      item.operation.firstChunkLatencyMs = firstChunkAt ? firstChunkAt - started : Date.now() - started;
      item.operation.elapsedMs = Date.now() - started;
      item.operation.durationMs = durationMs;
      item.operation.outputDigest = handle.digest;
      item.operation.outputBytes = handle.bytes;
      item.operation.textChunks = result.textChunks;
      item.resolve({ handle, operation: { ...item.operation } });
    } catch (error) {
      item.operation.state = item.controller.signal.aborted ? "cancelled" : "failed";
      item.operation.updatedAt = nowIso();
      item.operation.errorClass = item.controller.signal.aborted
        ? "DELIVERY_TRANSIENT"
        : stableErrorClass(error);
      item.reject(
        error instanceof Error
          ? error
          : new PenglaiError("DSH_UNAVAILABLE", "TTS synthesis failed"),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requireEngine(): Promise<TtsEngine> {
    const model = await this.manager.requireReady();
    if (this.engine && this.engineRevision === model.revision) return this.engine;
    await this.releaseEngine();
    this.engine = this.options.engineFactory
      ? await this.options.engineFactory(model)
      : new MossWorkerEngine(model);
    this.engineRevision = model.revision;
    return this.engine;
  }

  private async releaseEngine(): Promise<void> {
    const engine = this.engine;
    this.engine = undefined;
    this.engineRevision = undefined;
    await engine?.dispose?.();
  }

  private expireQueued(item: QueueItem): void {
    const index = this.queue.indexOf(item);
    if (index < 0) return;
    this.queue.splice(index, 1);
    item.controller.abort("deadline");
    item.operation.state = "cancelled";
    item.operation.updatedAt = nowIso();
    item.operation.errorClass = "DELIVERY_TRANSIENT";
    item.reject(new PenglaiError("DELIVERY_TRANSIENT", "TTS deadline exceeded"));
    this.pump();
  }

  private pruneOperations(): void {
    if (this.operations.size < 256) return;
    for (const [id, operation] of this.operations) {
      if (operation.state === "queued" || operation.state === "running") continue;
      this.operations.delete(id);
      if (this.operations.size < 192) break;
    }
    if (this.operations.size >= 256) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "TTS operation history backpressure");
    }
  }

  private assertRequest(request: TtsSynthesisRequest): void {
    this.assertOperationId(request.operationId);
    if (!SOURCE_FINAL_ID.test(request.sourceFinalId)) {
      throw new PenglaiError("INVALID_INPUT", "TTS source final id rejected");
    }
    if (
      !request.finalText.trim() ||
      Buffer.byteLength(request.finalText, "utf8") > MAX_TTS_TEXT_BYTES ||
      !SHA256.test(request.finalDigest) ||
      digestFinal(request.finalText) !== request.finalDigest
    ) {
      throw new PenglaiError("SECURITY_POLICY", "TTS requires the exact durable final");
    }
    const voice = resolveVoice(request.voiceId);
    if (voice.locale !== request.locale) {
      throw new PenglaiError("INVALID_INPUT", "TTS voice locale mismatch");
    }
  }

  private assertOperationId(operationId: string): void {
    if (!OPERATION_ID.test(operationId)) {
      throw new PenglaiError("INVALID_INPUT", "invalid TTS operation id");
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new PenglaiError("DSH_UNAVAILABLE", "TTS service disposed");
  }
}

export function createMossTtsService(
  options: MossTtsServiceOptions,
): PenglaiMossTtsService {
  return new PenglaiMossTtsService(options);
}
