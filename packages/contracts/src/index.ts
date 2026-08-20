import { createHash } from "node:crypto";
export * from "./i18n.js";
export * from "./typert.js";

export const SCHEMA_VERSION = 9;
export const RELEASE = "0.5.0";

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
});

export type ErrorClass =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "BINDING_STALE"
  | "DSH_UNAVAILABLE"
  | "DSH_CONTRACT_DRIFT"
  | "DELIVERY_TRANSIENT"
  | "DELIVERY_PERMANENT"
  | "AUTH_EXPIRED"
  | "STORE_CORRUPT"
  | "SECURITY_POLICY";

export class PenglaiError extends Error {
  readonly errorClass: ErrorClass;
  constructor(errorClass: ErrorClass, message: string) {
    super(message);
    this.name = "PenglaiError";
    this.errorClass = errorClass;
  }
}

export type AdapterName = "mock" | "weixin" | "feishu";

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

export type OutboxState = "pending" | "sending" | "retryable" | "delivered" | "dead";

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
}

export interface ModelInput {
  sessionId: string;
  inboundId: string;
  routeId: string;
  text: string;
  source: PenglaiImSource;
  mode: "followup" | "steer";
  recovery?: true;
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

export interface PenglaiAsrClient {
  describeCapability?(): { model: string };
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
  | { type: "voice_id"; voiceId?: string };

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

export function redactEvidenceText(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-key]")
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
