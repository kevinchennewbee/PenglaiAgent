import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PenglaiError } from "./errors.js";
export * from "./i18n.js";
export * from "./typert.js";
export * from "./errors.js";
export * from "./bounded-http.js";
export * from "./closed-enum.js";
export * from "./safe-https.js";

export const SCHEMA_VERSION = 12;
export const RELEASE = "0.5.9";

export const CONFIG = Object.freeze({
  pairingTtlMs: 5 * 60_000,
  pairingMaxAttempts: 8,
  pairingBits: 128,
  maxInboundUtf8Bytes: 32_768,
  maxQueueDepthPerRoute: 32,
  maxOutboxPerRoute: 64,
  routeRatePerMinute: 30,
  globalConcurrentModelInputs: 8,
  outboxMaxAttempts: 8,
  outboxBaseBackoffMs: 250,
  textFragmentChars: 1800,
  soakMinInbounds: 1000,
  soakMinRoutes: 100,
  soakMinRounds: 20,
  lockoutMs: 15 * 60_000,
  imBodyRetentionMs: 24 * 60 * 60_000,
});

export interface PenglaiResourceJobBudget {
  activeJobs: number;
  queuedJobs: number;
  totalJobs: number;
}

export type PenglaiResourceBudgetOwner =
  | "@penglai/asr"
  | "@penglai/memory"
  | "@penglai/moss-tts";

export const PENGLAI_RESOURCE_JOB_BUDGETS: Readonly<
  Record<PenglaiResourceBudgetOwner, Readonly<PenglaiResourceJobBudget>>
> = Object.freeze({
  "@penglai/asr": Object.freeze({
    activeJobs: 1,
    queuedJobs: 7,
    totalJobs: 8,
  }),
  "@penglai/memory": Object.freeze({
    activeJobs: 1,
    queuedJobs: 7,
    totalJobs: 8,
  }),
  "@penglai/moss-tts": Object.freeze({
    activeJobs: 1,
    queuedJobs: 3,
    totalJobs: 4,
  }),
});

export const ADAPTER_NAMES = [
  "mock",
  "weixin",
  "feishu",
  "dingtalk",
  "wecom",
  "qq",
  "slack",
  "telegram",
  "discord",
] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

export type PenglaiAsrLanguage = "zh" | "en" | "ja" | "ko" | "yue" | "auto";
export type PenglaiAsrEmotion = "HAPPY" | "SAD" | "ANGRY" | "NEUTRAL" | "FEARFUL" | "DISGUSTED" | "SURPRISED";

export interface PenglaiVoiceMetadata {
  language: PenglaiAsrLanguage;
  emotion: PenglaiAsrEmotion;
  durationMs?: number;
}

export type RouteStatus = "pending" | "active" | "revoked";
export type BindingStatus = "active" | "revoked";
export type InboundState =
  | "received"
  | "rejected"
  | "control_handled"
  | "queued"
  | "claimed"
  | "running"
  | "finished"
  | "cancelled"
  | "no_delivery"
  | "outbox_pending"
  | "delivered"
  | "dead";

export type OutboxState =
  | "pending"
  | "claimed"
  | "sending"
  | "retryable"
  | "uncertain"
  | "delivered"
  | "dead";

export type BodyKind = "text" | "voice" | "control";

export type VoiceInputMode = "text-and-voice" | "text-only";
export type VoiceReplyMode = "text" | "voice" | "text-and-voice" | "mirror-input";

export interface BindingVoicePolicy {
  inputMode: VoiceInputMode;
  replyMode: VoiceReplyMode;
  voiceId: string;
  failureFallback: "text";
  updatedAt: string;
}

export const DEFAULT_BINDING_VOICE_POLICY: Readonly<BindingVoicePolicy> = Object.freeze({
  inputMode: "text-and-voice",
  replyMode: "mirror-input",
  voiceId: "moss-zh-default",
  failureFallback: "text",
  updatedAt: "1970-01-01T00:00:00.000Z",
});

export interface Route {
  routeId: string;
  adapter: AdapterName;
  accountRef: string;
  peerRef: string;
  status: RouteStatus;
}

export interface Binding {
  routeId: string;
  workspaceIdentity: string;
  sessionId: string;
  revision: number;
  status: BindingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Inbound {
  inboundId: string;
  adapterMessageKey: string;
  routeId: string;
  bindingRevision: number;
  bodyKind: BodyKind;
  redactedDigest: string;
  state: InboundState;
  dshMessageId?: string;
  textChars?: number;
  dispatchMode?: "followup" | "steer";
}

export interface TurnCorrelation {
  inboundId: string;
  dshMessageId: string;
  turnId: string;
  sessionId: string;
  routeId: string;
  bindingRevision: number;
}

export interface OutboxItem {
  outboxId: string;
  routeId: string;
  inboundId: string;
  turnId: string;
  sequence: number;
  payloadKind: "text" | "voice" | "text-and-voice";
  payloadRef: string;
  payloadText: string;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  fragmentIndex: number;
  fragmentCount: number;
  workerId?: string;
  leaseUntil?: number;
  vendorIdempotencyKey?: string;
  claimToken?: string;
}

export interface AgentLease {
  sessionId: string;
  handleId: string;
  ownership: "external" | "plugin-cold-resume";
}

export interface PenglaiImSource {
  /**
   * New writes use official DSH `user`; `penglai-im` remains readable only so
   * an interrupted pre-fix queue can be recovered and normalized by the bridge.
   */
  kind: "user" | "penglai-im";
  schema: 1;
  routeId: string;
  inboundId: string;
  adapter: AdapterName;
  voice?: PenglaiVoiceMetadata;
}

export type MediaKind = "image" | "audio" | "office" | "pdf" | "file";

/** Official DSH rc.2 image attachment media types. */
export type OfficialImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** Durable official DSH `ImageAttachmentRef` fields. Never a filesystem path. */
export interface OfficialImageRef {
  attachmentId: string;
  mediaType: OfficialImageMediaType;
  bytes: number;
  width: number;
  height: number;
  name?: string;
}

export interface ImageAdmission {
  saveImage(input: {
    data: Uint8Array;
    mediaType: OfficialImageMediaType;
    name?: string;
  }): Promise<OfficialImageRef>;
}

export interface ObjectBind {
  sessionId: string;
  workspaceId?: string;
  routeId?: string;
}

export interface MediaEnvelope {
  kind: MediaKind;
  source: "weixin" | "feishu";
  sourceMessageId: string;
  sourceResourceId: string;
  mime: string;
  filename?: string;
  size: number;
  sha256: string;
  opaqueHandle: string;
  durationMs?: number;
  officialImage?: OfficialImageRef;
  officeHandle?: string;
  audioHandle?: string;
}

export class MediaStore {
  private readonly blobs = new Map<string, Buffer>();
  constructor(private readonly root?: string) {
    if (root) mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  put(
    bytes: Buffer,
    meta: Omit<MediaEnvelope, "size" | "sha256" | "opaqueHandle"> & { opaqueHandle?: string },
  ): MediaEnvelope {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const opaqueHandle = meta.opaqueHandle ?? `media-${sha256.slice(0, 24)}`;
    this.blobs.set(opaqueHandle, Buffer.from(bytes));
    if (this.root) writeFileSync(join(this.root, `${sha256}.bin`), bytes, { mode: 0o600 });
    return {
      ...meta,
      size: bytes.length,
      sha256,
      opaqueHandle,
    };
  }
  get(handle: string): Buffer {
    const bytes = this.blobs.get(handle);
    if (bytes) return Buffer.from(bytes);
    if (this.root && handle.startsWith("media-")) {
      const prefix = handle.slice("media-".length);
      const hit = readdirSync(this.root).find((name) => name.startsWith(prefix) && name.endsWith(".bin"));
      if (hit && existsSync(join(this.root, hit))) return readFileSync(join(this.root, hit));
    }
    throw new PenglaiError("INVALID_INPUT", "media handle missing");
  }
  drop(handle: string): void {
    this.blobs.delete(handle);
  }
}

export function classifyMedia(input: { filename?: string; mime?: string; bytes: Buffer }): MediaKind {
  const mime = (input.mime ?? "").toLowerCase();
  const name = (input.filename ?? "").toLowerCase();
  const magic = input.bytes.subarray(0, 8).toString("latin1");
  if (magic.startsWith("\x89PNG") || magic.startsWith("\xff\xd8") || mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) {
    return "image";
  }
  if (magic.startsWith("RIFF") || magic.startsWith("OggS") || magic.startsWith("ID3") || magic.startsWith("#!SILK") || mime.startsWith("audio/")) {
    return "audio";
  }
  if (magic.startsWith("%PDF") || mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (magic.startsWith("PK") || name.endsWith(".docx") || name.endsWith(".xlsx") || name.endsWith(".pptx")) {
    return "office";
  }
  return "file";
}

export function mediaCaption(media: MediaEnvelope): string {
  return `[penglai-media kind=${media.kind} mime=${media.mime} sha256=${media.sha256.slice(0, 16)} handle=${media.opaqueHandle}]`;
}

export function isDiagnosticMediaCaption(text: string): boolean {
  return text.startsWith("[penglai-media ");
}

export function imageMediaTypeFromBytes(bytes: Buffer): OfficialImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  const gif = bytes.subarray(0, 6).toString("latin1");
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  return undefined;
}

export function userFacingMediaPrompt(media: MediaEnvelope): string {
  if (media.kind === "image") {
    return media.officialImage
      ? "用户发送了一张图片。"
      : "图片已收到，但未能提交到官方 DSH 附件服务。";
  }
  if (media.kind === "office" || media.kind === "pdf") {
    return "用户发送了一份文档。请使用 penglai_office_inspect_attached 查看当前会话已绑定的附件。";
  }
  if (media.kind === "audio") return "用户发送了一条语音。";
  return "用户发送了一个文件。";
}

function mimeForKind(kind: MediaKind, bytes: Buffer, declared?: string): string {
  if (kind === "image") return imageMediaTypeFromBytes(bytes) ?? "application/octet-stream";
  if (kind === "pdf") return "application/pdf";
  if (kind === "office") return declared && declared !== "application/octet-stream" ? declared : "application/vnd.openxmlformats-officedocument";
  if (kind === "audio") return declared && declared.startsWith("audio/") ? declared : "application/octet-stream";
  return declared ?? "application/octet-stream";
}

/**
 * App-private content-addressed object store for Office/audio handles.
 * Handles are opaque; bytes are never exposed as host paths to the model.
 */
export class ObjectStore {
  private readonly mem = new Map<string, { bytes: Buffer; kind: MediaKind; mime: string; sha256: string; bind?: ObjectBind }>();
  constructor(private readonly root?: string) {
    if (root) mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  private writeMetadata(handle: string, value: Record<string, unknown>): void {
    if (!this.root) return;
    const target = join(this.root, `${handle}.json`);
    const temp = join(this.root, `.${handle}.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    renameSync(temp, target);
  }
  private assertHandle(handle: string): string {
    if (!/^obj-[0-9a-f]{24}$/.test(handle)) {
      throw new PenglaiError("INVALID_INPUT", "object handle rejected");
    }
    return handle;
  }
  put(bytes: Buffer, meta: { kind: MediaKind; mime: string }): { handle: string; sha256: string } {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const handle = `obj-${sha256.slice(0, 24)}`;
    this.mem.set(handle, { bytes: Buffer.from(bytes), kind: meta.kind, mime: meta.mime, sha256 });
    if (this.root) {
      const bin = join(this.root, `${handle}.bin`);
      try {
        writeFileSync(bin, bytes, { mode: 0o600, flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (createHash("sha256").update(readExactRegularFile(bin)).digest("hex") !== sha256) {
          throw new PenglaiError("SECURITY_POLICY", "object store hash collision");
        }
      }
      this.writeMetadata(handle, { handle, sha256, kind: meta.kind, mime: meta.mime, size: bytes.length });
    }
    return { handle, sha256 };
  }
  bind(handle: string, bind: ObjectBind): void {
    const row = this.lookup(this.assertHandle(handle));
    row.bind = { ...bind };
    this.mem.set(handle, row);
    if (this.root) {
      this.writeMetadata(handle, {
        handle,
        sha256: row.sha256,
        kind: row.kind,
        mime: row.mime,
        size: row.bytes.length,
        bind,
      });
    }
  }
  get(handle: string, sessionId: string): Buffer {
    const row = this.lookup(this.assertHandle(handle));
    if (!row.bind || row.bind.sessionId !== sessionId) {
      throw new PenglaiError("UNAUTHORIZED", "office/audio handle is not bound to this Session");
    }
    return Buffer.from(row.bytes);
  }
  peek(handle: string): { kind: MediaKind; mime: string; sha256: string; bind?: ObjectBind } {
    const row = this.lookup(this.assertHandle(handle));
    return { kind: row.kind, mime: row.mime, sha256: row.sha256, ...(row.bind ? { bind: row.bind } : {}) };
  }
  private lookup(handle: string): { bytes: Buffer; kind: MediaKind; mime: string; sha256: string; bind?: ObjectBind } {
    this.assertHandle(handle);
    const hit = this.mem.get(handle);
    if (hit) return hit;
    if (this.root) {
      const bin = join(this.root, `${handle}.bin`);
      const json = join(this.root, `${handle}.json`);
      let bytes: Buffer;
      try {
        bytes = readExactRegularFile(bin);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new PenglaiError("INVALID_INPUT", "object handle missing");
        }
        throw error;
      }
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (`obj-${actualSha256.slice(0, 24)}` !== handle) {
        throw new PenglaiError("STORE_CORRUPT", "object store content identity mismatch");
      }
      let meta: { handle?: string; kind?: MediaKind; mime?: string; sha256?: string; size?: number; bind?: ObjectBind };
      try {
        meta = JSON.parse(readExactRegularFile(json).toString("utf8")) as typeof meta;
      } catch {
        throw new PenglaiError("STORE_CORRUPT", "object store metadata invalid");
      }
      if (
        meta.handle !== handle ||
        meta.sha256 !== actualSha256 ||
        meta.size !== bytes.length ||
        !["image", "audio", "office", "pdf", "file"].includes(String(meta.kind)) ||
        typeof meta.mime !== "string"
      ) {
        throw new PenglaiError("STORE_CORRUPT", "object store metadata mismatch");
      }
      const row = { bytes, kind: meta.kind!, mime: meta.mime, sha256: actualSha256, ...(meta.bind ? { bind: meta.bind } : {}) };
      this.mem.set(handle, row);
      return row;
    }
    throw new PenglaiError("INVALID_INPUT", "object handle missing");
  }
}

export function readExactRegularFile(path: string, maxBytes = Number.POSITIVE_INFINITY): Buffer {
  let fd: number | undefined;
  try {
    try {
      // Open read-only, then bind the descriptor to the current path with
      // lstat/fstat below. This rejects links on Windows too, where O_NOFOLLOW
      // is unavailable, without ever creating or replacing the source file.
      fd = openSync(path, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new PenglaiError("SECURITY_POLICY", "file is a symlink source");
      }
      throw error;
    }
    const before = fstatSync(fd);
    if (!before.isFile()) throw new PenglaiError("STORE_CORRUPT", "file is not a regular file");
    const source = lstatSync(path);
    if (source.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "file is a symlink source");
    }
    if (!source.isFile()) throw new PenglaiError("STORE_CORRUPT", "file is not a regular file");
    if (source.dev !== before.dev || source.ino !== before.ino || source.size !== before.size) {
      throw new PenglaiError("STORE_CORRUPT", "file path identity changed after open");
    }
    if (!Number.isSafeInteger(maxBytes) && maxBytes !== Number.POSITIVE_INFINITY) {
      throw new PenglaiError("INVALID_INPUT", "file byte limit invalid");
    }
    if (maxBytes < 0 || before.size > maxBytes) {
      throw new PenglaiError("SECURITY_POLICY", "file exceeds byte limit");
    }
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== after.size) {
      throw new PenglaiError("STORE_CORRUPT", "file changed while open");
    }
    return bytes;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export async function attachDownloadedMedia(opts: {
  store: MediaStore;
  bytes: Buffer;
  base: Omit<MediaEnvelope, "size" | "sha256" | "opaqueHandle" | "officialImage" | "officeHandle" | "audioHandle">;
  imageAdmission?: ImageAdmission;
  objectStore?: ObjectStore;
}): Promise<MediaEnvelope> {
  const kind = classifyMedia({
    bytes: opts.bytes,
    ...(opts.base.filename ? { filename: opts.base.filename } : {}),
    ...(opts.base.mime ? { mime: opts.base.mime } : {}),
  });
  const mime = mimeForKind(kind, opts.bytes, opts.base.mime);
  const env = opts.store.put(opts.bytes, { ...opts.base, kind, mime });
  if (kind === "image") {
    const mediaType = imageMediaTypeFromBytes(opts.bytes);
    if (!mediaType) throw new PenglaiError("INVALID_INPUT", "image magic rejected");
    if (!opts.imageAdmission) {
      throw new PenglaiError("DSH_UNAVAILABLE", "official DSH attachments.saveImage is required for images");
    }
    env.officialImage = await opts.imageAdmission.saveImage({
      data: opts.bytes,
      mediaType,
      ...(opts.base.filename ? { name: opts.base.filename.replace(/^.*[/\\]/, "").slice(0, 80) } : {}),
    });
  }
  if ((kind === "office" || kind === "pdf") && opts.objectStore) {
    env.officeHandle = opts.objectStore.put(opts.bytes, { kind, mime }).handle;
  }
  if (kind === "audio" && opts.objectStore) {
    env.audioHandle = opts.objectStore.put(opts.bytes, { kind, mime }).handle;
  }
  return env;
}

export interface InboundEnvelope {
  adapter: AdapterName;
  adapterMessageKey: string;
  accountRef: string;
  peerRef: string;
  vendorTarget?: string;
  chatKind: "private" | "group" | "unknown";
  bodyKind: "text" | "voice" | "media" | "other";
  text?: string;
  receivedAt: number;
  media?: MediaEnvelope;
}

export interface ModelInput {
  sessionId: string;
  inboundId: string;
  routeId: string;
  text: string;
  source: PenglaiImSource;
  mode: "followup" | "steer";
  recovery?: true;
  images?: OfficialImageRef[];
  officeHandle?: string;
  audioHandle?: string;
}

export interface ClaimedFact {
  dshMessageId: string;
  turnId: string;
  sessionId: string;
  source: PenglaiImSource | { kind: string };
}

export interface AssistantFinal {
  sessionId: string;
  turnId: string;
  text: string;
}

export type PenglaiTtsLocale = "zh" | "en" | "ja";

export interface PenglaiTtsSynthesisRequest {
  operationId: string;
  sourceFinalId: string;
  finalText: string;
  finalDigest: string;
  voiceId: string;
  locale: PenglaiTtsLocale;
  deadlineMs?: number;
  ttlMs?: number;
}

export interface PenglaiTtsAudioHandle {
  id: string;
  digest: string;
  bytes: number;
  durationMs: number;
  voiceId: string;
  sourceFinalDigest: string;
  ownerOperation: string;
  expiresAt: number;
}

/** In-process typed Cordis capability; adapters never load a voice model. */
export interface PenglaiMossTtsClient {
  describeCapability?(): { model: string };
  listVoices?(): Array<{ id: string; displayName?: string; locale?: string }>;
  synthesize(request: PenglaiTtsSynthesisRequest): Promise<{
    handle: PenglaiTtsAudioHandle;
    operation: { operationId: string };
  }>;
  readOutput(handle: PenglaiTtsAudioHandle, ownerOperation: string): Promise<Buffer>;
  releaseOutput(handleId: string): Promise<void>;
  cancelSynthesis?(operationId: string): Promise<unknown>;
}

export interface PenglaiAsrAudioHandle {
  id: string;
  digest: string;
  mediaType: string;
  bytes: number;
  durationMs: number;
  source: "mic" | "im" | "attachment" | "fixture";
  ownerOperation: string;
  expiresAt: number;
}

export const PENGLAI_ASR_MODEL_STATES = [
  "not_installed",
  "verifying",
  "downloading",
  "paused",
  "ready",
  "corrupt",
  "failed",
] as const;

export type PenglaiAsrModelState = (typeof PENGLAI_ASR_MODEL_STATES)[number];

export interface PenglaiAsrClient {
  describeCapability?(): { model: PenglaiAsrModelState };
  stageAudio(
    buf: Buffer,
    input: {
      source: "im";
      ownerOperation: string;
      mediaType?: "audio/wav";
      ttlMs?: number;
    },
  ): Promise<PenglaiAsrAudioHandle>;
  transcribe(
    handle: PenglaiAsrAudioHandle,
    options: {
      authorized: boolean;
      claimed: boolean;
      privateChat: boolean;
      deadlineMs?: number;
    },
    operationId: string,
  ): Promise<{
    handle: PenglaiAsrAudioHandle;
    draft: {
      text: string;
      language?: string;
      emotion?: string;
      noSpeech?: boolean;
      confirmed: boolean;
    };
    draftDigest: string;
  }>;
  cancelTranscription?(operationId: string): Promise<unknown>;
}

export type ControlCommand =
  | { type: "help" }
  | { type: "bind"; token: string }
  | { type: "unbind" }
  | { type: "status" }
  | { type: "models"; pick?: string }
  | { type: "projects"; pick?: string }
  | { type: "sessions"; pick?: string }
  | { type: "new_session"; title: string }
  | { type: "steer"; text: string }
  | { type: "stop_current" }
  | { type: "clear_queue" }
  | { type: "context_status" }
  | { type: "memory_status" }
  | { type: "budget_status" }
  | { type: "companion_status" }
  | { type: "voice_status" }
  | { type: "voice_reply_mode"; mode: VoiceReplyMode }
  | { type: "voice_id"; voiceId?: string }
  | { type: "version" };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertSafeListenHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new PenglaiError("SECURITY_POLICY", `refusing listen host ${host}`);
  }
}

function defaultPort(protocol: string): string {
  if (protocol === "https:" || protocol === "wss:") return "443";
  if (protocol === "http:" || protocol === "ws:") return "80";
  return "";
}

export function exactOriginAllowed(origin: string | undefined, listenOrigin: string): boolean {
  if (!origin || origin === "null") return false;
  let got: URL;
  let expect: URL;
  try {
    got = new URL(origin);
    expect = new URL(listenOrigin);
  } catch {
    return false;
  }
  if (got.username || got.password) return false;
  if (got.protocol !== expect.protocol) return false;
  if (got.hostname !== expect.hostname) return false;
  const gp = got.port || defaultPort(got.protocol);
  const ep = expect.port || defaultPort(expect.protocol);
  return gp === ep;
}

export function exactHostAllowed(hostHeader: string | undefined, listenHost: string, listenPort: number): boolean {
  if (!hostHeader) return false;
  if (hostHeader.includes("@") || hostHeader.includes("://")) return false;
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (parsed.hostname !== listenHost) return false;
  const port = parsed.port || "80";
  return port === String(listenPort);
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function digestText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type TransportErrorClass = "auth" | "rate" | "network" | "server" | "unknown";

export function classifyTransportError(err: unknown): TransportErrorClass {
  const status =
    typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : Number.NaN;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (status === 401 || status === 403 || /auth|unauthorized|revoked|expired|forbidden/i.test(msg)) return "auth";
  if (status === 429 || /\b429\b|rate.?limit/i.test(msg)) return "rate";
  if ((status >= 500 && status <= 599) || /\b5\d\d\b/.test(msg)) return "server";
  if (/ECONN|ENOTFOUND|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|network|offline|socket/i.test(msg)) return "network";
  return "unknown";
}

export function backoffMs(attempt: number, klass: TransportErrorClass, jitter = 0.5): number {
  if (klass === "auth") return Number.POSITIVE_INFINITY;
  const safeJitter = Math.min(1, Math.max(0, jitter));
  const base = klass === "rate" ? 4_000 : klass === "server" ? 2_000 : 500;
  const exp = Math.min(base * 2 ** Math.max(0, attempt), 60_000);
  return Math.floor(exp * (0.5 + safeJitter * 0.5));
}

function redactPrivateKeyBlocks(text: string): string {
  const beginPrefix = "-----BEGIN ";
  let cursor = 0;
  let out = "";
  while (cursor < text.length) {
    const begin = text.indexOf(beginPrefix, cursor);
    if (begin < 0) return out + text.slice(cursor);
    out += text.slice(cursor, begin);
    const labelEnd = text.indexOf("-----", begin + beginPrefix.length);
    if (labelEnd < 0 || labelEnd - begin > 96) return out + text.slice(begin);
    const label = text.slice(begin + beginPrefix.length, labelEnd);
    const validLabel = label.endsWith("PRIVATE KEY") && [...label].every((char) => char === " " || (char >= "A" && char <= "Z"));
    if (!validLabel) {
      out += beginPrefix;
      cursor = begin + beginPrefix.length;
      continue;
    }
    const endMarker = `-----END ${label}-----`;
    const end = text.indexOf(endMarker, labelEnd + 5);
    if (end < 0) return out + text.slice(begin);
    out += "[redacted-key]";
    cursor = end + endMarker.length;
  }
  return out;
}

export function redactEvidenceText(text: string): string {
  return redactPrivateKeyBlocks(text)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bwxp_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[redacted-b64]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/transcript["']?\s*[:=]\s*["'][^"']{8,}/gi, "transcript:[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/g, "[redacted-path]")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

export function splitFragments(text: string, size: number = CONFIG.textFragmentChars): string[] {
  if (text.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}
