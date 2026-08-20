import { createHash } from "node:crypto";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { PenglaiError, type ErrorClass } from "@penglai/contracts";
import { createAsrSettingsApi, PenglaiAsrRemote } from "./remote.js";
import {
  AudioHandleRegistry,
  type AudioHandle,
  type AudioSource,
} from "./audio-registry.js";
import {
  decodeWavPcm16,
  detectMagic,
  SherpaSenseVoiceEngine,
  type TranscribeEngine,
} from "./engine.js";
import {
  AsrModelManager,
  SENSEVOICE_MANIFEST,
  type ModelManifest,
  type ResolvedSenseVoiceModel,
} from "./models.js";
import {
  ASR_MAX_BYTES,
  gateAudio,
  type TranscriptDraft,
} from "./service.js";

export const name = "@penglai/asr";
export const inject: string[] = [];
export const version = "0.5.0";

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_TRANSCRIPTION_QUEUE = 8;
const DEFAULT_DEADLINE_MS = 120_000;
const MAX_DEADLINE_MS = 180_000;

export type TranscriptionOperationState =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface TranscriptionOperation {
  operationId: string;
  state: TranscriptionOperationState;
  audioDigest: string;
  bytes: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  language?: string;
  emotion?: string;
  noSpeech?: boolean;
  draftDigest?: string;
  transcriptAccepted?: boolean;
  errorClass?: ErrorClass;
}

export interface TranscriptionOptions {
  authorized: boolean;
  claimed: boolean;
  privateChat: boolean;
  deadlineMs?: number;
}

interface QueueItem {
  handle: AudioHandle;
  options: TranscriptionOptions;
  operation: TranscriptionOperation;
  controller: AbortController;
  deadlineAt: number;
  queueTimer: NodeJS.Timeout;
  resolve: (value: {
    handle: AudioHandle;
    draft: TranscriptDraft;
    draftDigest: string;
  }) => void;
  reject: (error: Error) => void;
}

export interface AsrServiceOptions {
  modelsDir: string;
  tempDir: string;
  manifest?: ModelManifest;
  fetchImpl?: typeof fetch;
  resolveCapability?: (capabilityRef: string) => Promise<string>;
  engineFactory?: (
    model: ResolvedSenseVoiceModel,
  ) => TranscribeEngine | Promise<TranscribeEngine>;
  now?: () => number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableErrorClass(error: unknown): ErrorClass {
  return error instanceof PenglaiError ? error.errorClass : "DSH_UNAVAILABLE";
}

export class PenglaiAsrService {
  readonly manager: AsrModelManager;
  readonly audio: AudioHandleRegistry;
  readonly ready: Promise<void>;
  private readonly operations = new Map<string, TranscriptionOperation>();
  private readonly queue: QueueItem[] = [];
  private active: QueueItem | undefined;
  private activeTask: Promise<void> | undefined;
  private engine: TranscribeEngine | undefined;
  private engineRevision: string | undefined;
  private disposed = false;

  constructor(private readonly options: AsrServiceOptions) {
    this.manager = new AsrModelManager(
      options.modelsDir,
      options.manifest ?? SENSEVOICE_MANIFEST,
      {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.resolveCapability
          ? { resolveCapability: options.resolveCapability }
          : {}),
      },
    );
    this.audio = new AudioHandleRegistry(options.tempDir, options.now);
    this.ready = Promise.all([
      this.manager.initialize(),
      this.audio.initialize(),
    ]).then(() => undefined);
  }

  describeCapability(): ReturnType<AsrModelManager["describeCapability"]> & {
    queueDepth: number;
    activeTranscriptions: number;
    audioHandles: number;
  } {
    return {
      ...this.manager.describeCapability(),
      queueDepth: this.queue.length,
      activeTranscriptions: this.active ? 1 : 0,
      audioHandles: this.audio.describe().active,
    };
  }

  resourceSnapshot() {
    const capability = this.describeCapability();
    return {
      workers: capability.queueDepth + capability.activeTranscriptions,
      sockets: 0,
      timers: capability.queueDepth,
      remotes: 0,
      db: 0,
      modelSessions: this.engine ? 1 : 0,
      audioHandles: capability.audioHandles,
    };
  }

  describeModels() {
    return this.manager.describeModels();
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

  async stageAudio(
    buf: Buffer,
    input: {
      source: AudioSource;
      ownerOperation: string;
      mediaType?: "audio/wav";
      ttlMs?: number;
    },
  ): Promise<AudioHandle> {
    this.assertUsable();
    this.assertOperationId(input.ownerOperation);
    if (buf.length > ASR_MAX_BYTES) {
      throw new PenglaiError("INVALID_INPUT", "ASR audio size rejected");
    }
    const magic = detectMagic(buf);
    if (magic !== "RIFF") {
      throw new PenglaiError(
        "INVALID_INPUT",
        "ASR stage requires PCM16 WAV from a packaged converter",
      );
    }
    const wav = decodeWavPcm16(buf);
    return this.audio.stage(buf, {
      source: input.source,
      ownerOperation: input.ownerOperation,
      mediaType: input.mediaType ?? "audio/wav",
      durationMs: wav.durationMs,
      ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
    });
  }

  async transcribe(
    handle: AudioHandle,
    options: TranscriptionOptions,
    operationId: string,
  ): Promise<{
    handle: AudioHandle;
    draft: TranscriptDraft;
    draftDigest: string;
  }> {
    await this.ready;
    this.assertUsable();
    this.assertOperationId(operationId);
    if (this.operations.has(operationId) || this.manager.getOperation(operationId)) {
      throw new PenglaiError("INVALID_INPUT", "ASR operation id already used");
    }
    if (handle.ownerOperation !== operationId) {
      throw new PenglaiError("UNAUTHORIZED", "ASR audio owner operation mismatch");
    }
    if (this.queue.length + (this.active ? 1 : 0) >= MAX_TRANSCRIPTION_QUEUE) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR transcription backpressure");
    }
    const deadline = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > MAX_DEADLINE_MS) {
      throw new PenglaiError("INVALID_INPUT", "ASR transcription deadline rejected");
    }
    const at = nowIso();
    const operation: TranscriptionOperation = {
      operationId,
      state: "queued",
      audioDigest: handle.digest,
      bytes: handle.bytes,
      durationMs: handle.durationMs,
      createdAt: at,
      updatedAt: at,
    };
    this.pruneOperations();
    this.operations.set(operationId, operation);
    return new Promise((resolvePromise, rejectPromise) => {
      const item = {
        handle,
        options: { ...options, deadlineMs: deadline },
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

  async cancelTranscription(operationId: string): Promise<TranscriptionOperation> {
    this.assertOperationId(operationId);
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new PenglaiError("INVALID_INPUT", "ASR transcription operation not found");
    }
    if (operation.state !== "queued" && operation.state !== "running") {
      throw new PenglaiError("INVALID_INPUT", "ASR transcription cannot be cancelled");
    }
    operation.state = "cancelled";
    operation.updatedAt = nowIso();
    const queuedIndex = this.queue.findIndex(
      (item) => item.operation.operationId === operationId,
    );
    if (queuedIndex >= 0) {
      const [queued] = this.queue.splice(queuedIndex, 1);
      if (queued) {
        clearTimeout(queued.queueTimer);
        queued.controller.abort("cancelled");
        await this.audio.release(queued.handle.id).catch(() => undefined);
        queued.reject(new PenglaiError("DELIVERY_TRANSIENT", "ASR cancelled"));
      }
    }
    if (this.active?.operation.operationId === operationId) {
      this.active.controller.abort("cancelled");
      await this.activeTask?.catch(() => undefined);
    }
    return { ...operation };
  }

  getOperation(operationId: string) {
    this.assertOperationId(operationId);
    const transcription = this.operations.get(operationId);
    if (transcription) return { category: "transcription" as const, ...transcription };
    const model = this.manager.getOperation(operationId);
    return model ? { category: "model" as const, ...model } : undefined;
  }

  async deleteModel(
    revision: string,
    confirmation: { revision: string; acknowledged: true },
  ) {
    if (this.active || this.queue.length) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR transcription is busy");
    }
    await this.releaseEngine();
    return this.manager.deleteModel(revision, confirmation);
  }

  confirmTranscript(
    operationId: string,
    expectedDraftDigest: string,
    editedText: string,
  ): { enterTurn: true; text: string } {
    this.assertOperationId(operationId);
    const operation = this.operations.get(operationId);
    if (
      !operation ||
      operation.state !== "completed" ||
      operation.noSpeech ||
      operation.transcriptAccepted ||
      !operation.draftDigest ||
      operation.draftDigest !== expectedDraftDigest
    ) {
      throw new PenglaiError("INVALID_INPUT", "ASR transcript confirmation mismatch");
    }
    const text = editedText.trim();
    if (!text || Buffer.byteLength(text, "utf8") > 32_768) {
      throw new PenglaiError("INVALID_INPUT", "ASR confirmed transcript text rejected");
    }
    operation.transcriptAccepted = true;
    operation.updatedAt = nowIso();
    delete operation.draftDigest;
    return { enterTurn: true, text };
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
      await this.audio.release(item.handle.id).catch(() => undefined);
      item.reject(new PenglaiError("DSH_UNAVAILABLE", "ASR service disposed"));
    }
    await this.activeTask?.catch(() => undefined);
    const results = await Promise.allSettled([
      this.releaseEngine(),
      this.audio.dispose(),
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
      item.operation.state = "cancelled";
      item.operation.updatedAt = nowIso();
      void this.audio.release(item.handle.id).finally(() => {
        item.reject(new PenglaiError("DELIVERY_TRANSIENT", "ASR cancelled"));
        this.pump();
      });
      return;
    }
    this.active = item;
    item.operation.state = "running";
    item.operation.updatedAt = nowIso();
    const task = this.runTranscription(item).finally(() => {
      if (this.active === item) this.active = undefined;
      if (this.activeTask === task) this.activeTask = undefined;
      this.pump();
    });
    this.activeTask = task;
  }

  private async runTranscription(item: QueueItem): Promise<void> {
    const remaining = item.deadlineAt - Date.now();
    if (remaining <= 0) item.controller.abort("deadline");
    const timeout = setTimeout(
      () => item.controller.abort("deadline"),
      Math.max(1, remaining),
    );
    let result:
      | { handle: AudioHandle; draft: TranscriptDraft; draftDigest: string }
      | undefined;
    let failure: Error | undefined;
    try {
      if (!item.options.authorized || !item.options.privateChat || !item.options.claimed) {
        gateAudio({
          authorized: item.options.authorized,
          claimed: item.options.claimed,
          privateChat: item.options.privateChat,
          magic: "RIFF",
          bytes: item.handle.bytes,
          durationMs: item.handle.durationMs,
        });
      }
      const buf = await this.audio.resolve(
        item.handle,
        item.operation.operationId,
      );
      const magic = detectMagic(buf);
      gateAudio({
        authorized: item.options.authorized,
        claimed: item.options.claimed,
        privateChat: item.options.privateChat,
        magic,
        bytes: buf.length,
        durationMs: item.handle.durationMs,
      });
      if (magic !== "RIFF") {
        throw new PenglaiError("INVALID_INPUT", "ASR normalized audio must be WAV");
      }
      const wav = decodeWavPcm16(buf);
      if (wav.durationMs !== item.handle.durationMs) {
        throw new PenglaiError("SECURITY_POLICY", "ASR audio duration changed after staging");
      }
      const engine = await this.requireEngine();
      const draft = await engine.transcribe(
        wav.pcm,
        wav.sampleRate,
        item.controller.signal,
      );
      if (item.controller.signal.aborted) {
        throw new PenglaiError("DELIVERY_TRANSIENT", "ASR cancelled");
      }
      item.operation.state = "completed";
      item.operation.updatedAt = nowIso();
      if (draft.language) item.operation.language = draft.language;
      else delete item.operation.language;
      if (draft.emotion) item.operation.emotion = draft.emotion;
      else delete item.operation.emotion;
      item.operation.noSpeech = Boolean(draft.noSpeech);
      const draftDigest = createHash("sha256")
        .update(draft.text.trim())
        .digest("hex");
      item.operation.draftDigest = draftDigest;
      result = { handle: item.handle, draft, draftDigest };
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new PenglaiError("DSH_UNAVAILABLE", "ASR transcription failed");
      item.operation.state = item.controller.signal.aborted ? "cancelled" : "failed";
      item.operation.updatedAt = nowIso();
      item.operation.errorClass = item.controller.signal.aborted
        ? "DELIVERY_TRANSIENT"
        : stableErrorClass(error);
    } finally {
      clearTimeout(timeout);
      await this.audio.release(item.handle.id).catch(() => undefined);
    }
    if (result) item.resolve(result);
    else
      item.reject(
        failure ??
          new PenglaiError("DSH_UNAVAILABLE", "ASR transcription failed"),
      );
  }

  private async requireEngine(): Promise<TranscribeEngine> {
    const model = await this.manager.requireReady();
    if (this.engine && this.engineRevision === model.revision) return this.engine;
    await this.releaseEngine();
    this.engine = this.options.engineFactory
      ? await this.options.engineFactory(model)
      : new SherpaSenseVoiceEngine(model);
    this.engineRevision = model.revision;
    return this.engine;
  }

  private expireQueued(item: QueueItem): void {
    const index = this.queue.indexOf(item);
    if (index < 0) return;
    this.queue.splice(index, 1);
    item.controller.abort("deadline");
    item.operation.state = "cancelled";
    item.operation.updatedAt = nowIso();
    item.operation.errorClass = "DELIVERY_TRANSIENT";
    void this.audio.release(item.handle.id).finally(() => {
      item.reject(new PenglaiError("DELIVERY_TRANSIENT", "ASR deadline exceeded"));
      this.pump();
    });
  }

  private pruneOperations(): void {
    if (this.operations.size < 512) return;
    for (const [id, operation] of this.operations) {
      if (operation.state === "queued" || operation.state === "running") continue;
      this.operations.delete(id);
      if (this.operations.size < 384) break;
    }
    if (this.operations.size >= 512) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR operation history backpressure");
    }
  }

  private async releaseEngine(): Promise<void> {
    const engine = this.engine;
    this.engine = undefined;
    this.engineRevision = undefined;
    await engine?.dispose?.();
  }

  private assertOperationId(operationId: string): void {
    if (!OPERATION_ID.test(operationId)) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR operation id");
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new PenglaiError("DSH_UNAVAILABLE", "ASR service disposed");
    }
  }
}

export function createAsrService(options: AsrServiceOptions): PenglaiAsrService {
  return new PenglaiAsrService(options);
}

interface FileCapabilityHost {
  resolveReadDirectory(capabilityRef: string): Promise<string>;
}

interface CordisContextLike {
  provide?: (serviceName: string, service: unknown) => unknown;
  effect?: (setup: () => () => Promise<void>) => unknown;
}

function optionalCapabilityResolver(ctx: CordisContextLike): ((ref: string) => Promise<string>) | undefined {
  const host = Object.getOwnPropertyDescriptor(ctx, "penglaiFileCapabilities")?.value as FileCapabilityHost | undefined;
  if (!host || typeof host.resolveReadDirectory !== "function") return undefined;
  return (ref: string) => host.resolveReadDirectory(ref);
}

function requireUserData(): string {
  const userData = process.env.PENGLAI_USER_DATA;
  if (!userData) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "PENGLAI_USER_DATA required for @penglai/asr",
    );
  }
  return userData;
}

export function apply(ctx: CordisContextLike): PenglaiAsrService {
  const userData = requireUserData();
  if (!ctx.provide) {
    throw new PenglaiError("DSH_UNAVAILABLE", "Cordis provide service required for ASR");
  }
  if (!ctx.effect) {
    throw new PenglaiError("DSH_UNAVAILABLE", "Cordis effect lifecycle required for ASR");
  }
  const service = createAsrService({
    modelsDir: join(userData, "voice", "models", "asr"),
    tempDir: join(userData, "voice", "temp", "asr"),
    ...((): { resolveCapability?: (ref: string) => Promise<string> } => {
      const resolveCapability = optionalCapabilityResolver(ctx);
      return resolveCapability ? { resolveCapability } : {};
    })(),
  });
  ctx.provide("penglaiAsr", service);
  ctx.effect(() => () => service.dispose());
  if (ctx instanceof Context) {
    new PenglaiAsrRemote(ctx, createAsrSettingsApi(service));
  }
  return service;
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
export * from "./audio-registry.js";
export * from "./service.js";
export * from "./models.js";
export * from "./engine.js";
