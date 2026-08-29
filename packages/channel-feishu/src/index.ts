import { createHash } from "node:crypto";
import { join } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  PenglaiError,
  classifyTransportError,
  classifyMedia,
  MediaStore,
  attachDownloadedMedia,
  type ImageAdmission,
  type ObjectStore,
  type InboundEnvelope,
  type ErrorClass,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
} from "@penglai/contracts";
import type {
  InboundFailureDiagnostic,
  InboundFailurePhase,
  RoutingControlPlane,
  VoiceInboundClaim,
} from "@penglai/routing-core";
import { doctorFeishu, FEISHU_RECEIVE_EVENT, type FeishuDoctorInput } from "./official.js";
import { inboundFeishuAudioToText, outboundFeishuNativeAudio } from "./media.js";
import { FeishuAppRegistration } from "./registration.js";

export const name = "feishu";
export const FEISHU_ACCOUNT_REF = "feishu-default";
export const FEISHU_ALLOWLIST_NOTICE =
  "蓬莱只回复扫码确认的飞书账号。请用该账号发消息，或在设置里显式指定允许身份。\nPenglai only replies to the Feishu account that confirmed the scan. Message from that account, or set the allowed identity explicitly in settings.";

export const FEISHU_STATUS_REACTIONS = {
  processing: "ONIT",
  success: "OK",
  error: "Disappointed",
} as const;

export type FeishuOwnerSource = "registration" | "explicit";

/** Persistence seam for the Feishu registration/owner identity (the unique allowlist). */
export interface FeishuOwnerStore {
  putAdapterConfig(accountId: string, adapter: string, json: string): void;
  getAdapterConfig(accountId: string): string | undefined;
  audit?(event: string, payload: Record<string, unknown>, ts: number): void;
}

function isOwnerStore(value: unknown): value is FeishuOwnerStore {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as FeishuOwnerStore).putAdapterConfig === "function" &&
      typeof (value as FeishuOwnerStore).getAdapterConfig === "function",
  );
}

export function feishuOwnerDigest(openId: string): string {
  return createHash("sha256").update(openId).digest("hex").slice(0, 16);
}

export type FeishuConnection = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export interface FeishuAudioMediaRef {
  messageId: string;
  fileKey: string;
  durationMs: number;
}

export interface FeishuFileMediaRef {
  messageId: string;
  fileKey: string;
  messageType: "image" | "file";
  filename?: string;
}

class FeishuMediaFailure extends PenglaiError {
  constructor(
    errorClass: ErrorClass,
    readonly diagnostic: InboundFailureDiagnostic,
  ) {
    super(errorClass, `FEISHU_MEDIA_${diagnostic.phase.toUpperCase().replaceAll("-", "_")}_${diagnostic.reason.toUpperCase().replaceAll("-", "_")}`);
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const row = error as { status?: unknown; response?: { status?: unknown } };
  const value = row.status ?? row.response?.status;
  const status = Number(value);
  return Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

export function classifyFeishuResourceError(error: unknown): {
  errorClass: ErrorClass;
  diagnostic: InboundFailureDiagnostic;
} {
  const status = errorStatus(error);
  if (status === 400) return { errorClass: "INVALID_INPUT", diagnostic: { phase: "resource-request", reason: "resource-identity-rejected" } };
  if (status === 401) return { errorClass: "AUTH_EXPIRED", diagnostic: { phase: "resource-request", reason: "credential-invalid" } };
  if (status === 403) return { errorClass: "AUTH_EXPIRED", diagnostic: { phase: "resource-request", reason: "permission-missing" } };
  if (status === 404) return { errorClass: "INVALID_INPUT", diagnostic: { phase: "resource-request", reason: "resource-not-found" } };
  if (status === 429) return { errorClass: "DELIVERY_TRANSIENT", diagnostic: { phase: "resource-request", reason: "rate-limited" } };
  const transport = classifyTransportError(error);
  if (transport === "auth") return { errorClass: "AUTH_EXPIRED", diagnostic: { phase: "resource-request", reason: "credential-invalid" } };
  if (transport === "network") return { errorClass: "DELIVERY_TRANSIENT", diagnostic: { phase: "resource-request", reason: "network" } };
  if (transport === "server") return { errorClass: "DELIVERY_TRANSIENT", diagnostic: { phase: "resource-request", reason: "server" } };
  if (transport === "rate") return { errorClass: "DELIVERY_TRANSIENT", diagnostic: { phase: "resource-request", reason: "rate-limited" } };
  return { errorClass: "DELIVERY_TRANSIENT", diagnostic: { phase: "resource-request", reason: "unknown" } };
}

function resourceRequestFailure(error: unknown): FeishuMediaFailure {
  const failure = classifyFeishuResourceError(error);
  return new FeishuMediaFailure(failure.errorClass, failure.diagnostic);
}

function classifyMediaFailure(
  error: unknown,
  fallbackPhase: InboundFailurePhase,
): { errorClass: ErrorClass; diagnostic: InboundFailureDiagnostic } {
  if (error instanceof FeishuMediaFailure) {
    return { errorClass: error.errorClass, diagnostic: error.diagnostic };
  }
  const errorClass = error instanceof PenglaiError ? error.errorClass : "DELIVERY_TRANSIENT";
  const reason =
    errorClass === "AUTH_EXPIRED" || errorClass === "UNAUTHORIZED"
      ? "credential-invalid"
      : errorClass === "INVALID_INPUT" || errorClass === "SECURITY_POLICY"
        ? "type-rejected"
        : errorClass === "DSH_UNAVAILABLE"
          ? "client-unavailable"
          : "unknown";
  return { errorClass, diagnostic: { phase: fallbackPhase, reason } };
}

export function parseFeishuEvent(raw: {
  chatType?: string;
  messageType?: string;
  messageId: string;
  openId?: string;
  text?: string;
}): InboundEnvelope | { reject: "group" | "media" | "chatType" | "sender" } {
  if (!raw.chatType) return { reject: "chatType" };
  if (raw.chatType !== "p2p" && raw.chatType !== "private") {
    return { reject: raw.chatType === "group" ? "group" : "chatType" };
  }
  if (!raw.openId) return { reject: "sender" };
  if (
    raw.messageType &&
    raw.messageType !== "text" &&
    raw.messageType !== "post" &&
    raw.messageType !== "audio" &&
    raw.messageType !== "image" &&
    raw.messageType !== "file"
  ) {
    return { reject: "media" };
  }
  if (raw.messageType === "post" && !raw.text) return { reject: "media" };
  return {
    adapter: "feishu",
    adapterMessageKey: raw.messageId,
    accountRef: "feishu",
    peerRef: createHash("sha256").update(raw.openId).digest("hex").slice(0, 24),
    chatKind: "private",
    bodyKind: raw.messageType === "audio" ? "voice" : raw.messageType === "image" || raw.messageType === "file" ? "media" : "text",
    ...(raw.text ? { text: raw.text } : {}),
    receivedAt: Date.now(),
    ...(raw.openId ? { vendorTarget: raw.openId } : {}),
  };
}

export function extractFeishuPostText(content: unknown): string | undefined {
  const rec = content && typeof content === "object" ? (content as Record<string, unknown>) : {};
  const post = rec.post && typeof rec.post === "object" ? (rec.post as Record<string, unknown>) : rec;
  const locale =
    (post.zh_cn && typeof post.zh_cn === "object" ? (post.zh_cn as Record<string, unknown>) : undefined) ??
    (post.en_us && typeof post.en_us === "object" ? (post.en_us as Record<string, unknown>) : undefined);
  if (!locale || !Array.isArray(locale.content) || locale.content.length !== 1) return undefined;
  const paragraph = locale.content[0];
  if (!Array.isArray(paragraph) || paragraph.length !== 1) return undefined;
  const run = paragraph[0];
  if (!run || typeof run !== "object") return undefined;
  const item = run as Record<string, unknown>;
  if (item.tag !== "text" || typeof item.text !== "string" || item.style) return undefined;
  const text = item.text.trim();
  return text || undefined;
}

export function parseOfficialReceiveWithMedia(data: unknown): {
  parsed: ReturnType<typeof parseFeishuEvent>;
  audio?: FeishuAudioMediaRef;
  file?: FeishuFileMediaRef;
} {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const event = (rec.event && typeof rec.event === "object" ? rec.event : rec) as Record<string, unknown>;
  const message = (event.message && typeof event.message === "object" ? event.message : {}) as Record<string, unknown>;
  const sender = (event.sender && typeof event.sender === "object" ? event.sender : {}) as Record<string, unknown>;
  const senderId = (sender.sender_id && typeof sender.sender_id === "object" ? sender.sender_id : {}) as Record<string, unknown>;
  let text = "";
  let fileKey = "";
  let durationMs = 0;
  let filename = "";
  if (typeof message.content === "string") {
    try {
      const content = JSON.parse(message.content) as {
        text?: string;
        file_key?: string;
        image_key?: string;
        file_name?: string;
        duration?: number | string;
      };
      text = content.text ?? extractFeishuPostText(content) ?? "";
      fileKey = typeof content.file_key === "string" ? content.file_key : typeof content.image_key === "string" ? content.image_key : "";
      durationMs = Number(content.duration ?? 0);
      filename = typeof content.file_name === "string" ? content.file_name : "";
    } catch {
      text = "";
    }
  }
  const input: Parameters<typeof parseFeishuEvent>[0] = {
    messageId: String(message.message_id ?? rec.event_id ?? ""),
    text,
  };
  if (typeof message.chat_type === "string") input.chatType = message.chat_type;
  if (typeof message.message_type === "string") input.messageType = message.message_type;
  if (typeof senderId.open_id === "string") input.openId = senderId.open_id;
  const parsed = parseFeishuEvent(input);
  const messageId = input.messageId;
  const isAudio = !("reject" in parsed) && parsed.bodyKind === "voice";
  const isFile = !("reject" in parsed) && parsed.bodyKind === "media" && (input.messageType === "image" || input.messageType === "file");
  return {
    parsed,
    ...(isAudio && fileKey && Number.isSafeInteger(durationMs)
      ? { audio: { messageId, fileKey, durationMs } }
      : {}),
    ...(isFile && fileKey
      ? {
          file: {
            messageId,
            fileKey,
            messageType: input.messageType === "image" ? "image" : "file",
            ...(filename ? { filename } : {}),
          },
        }
      : {}),
  };
}

export function parseOfficialReceive(data: unknown): ReturnType<typeof parseFeishuEvent> {
  return parseOfficialReceiveWithMedia(data).parsed;
}

export interface LarkFactory {
  Client: typeof Lark.Client;
  WSClient: typeof Lark.WSClient;
  EventDispatcher: typeof Lark.EventDispatcher;
}

export class FeishuAdapter {
  status: FeishuConnection = "idle";
  setupRequired = true;
  private ws: InstanceType<typeof Lark.WSClient> | undefined;
  private client: InstanceType<typeof Lark.Client> | undefined;
  private revision = 0;
  private voiceAbort = new AbortController();
  private readonly activeVoiceJobs = new Map<string, Promise<void>>();
  private readonly registration = new FeishuAppRegistration();
  private readonly ownerStore: FeishuOwnerStore | undefined;
  private ownerOpenId: string | undefined;
  seen = new Set<string>();
  readonly mediaStore = new MediaStore(
    ...(process.env.PENGLAI_USER_DATA ? [join(process.env.PENGLAI_USER_DATA, "media", "feishu")] : []),
  );
  imageAdmission?: ImageAdmission;
  objectStore?: ObjectStore;
  onAdmittedBytes?: (input: {
    bytes: Buffer;
    filename?: string;
    mime?: string;
    routeId: string;
    workspaceId: string;
    sessionId: string;
    turnId: string;
    objectHandle?: string;
  }) => void;

  constructor(
    private readonly plane: RoutingControlPlane,
    public appId?: string,
    private readonly sdk: LarkFactory = Lark,
    private readonly dedupe?: {
      claimDedupe(adapter: string, eventKey: string, tenant?: string, appId?: string): boolean;
    },
    private readonly expected?: { tenant?: string; appId?: string },
    private readonly voice?: {
      readonly asr?: PenglaiAsrClient | undefined;
      readonly tts?: PenglaiMossTtsClient | undefined;
    },
    ownerStore?: FeishuOwnerStore,
  ) {
    this.setupRequired = !appId;
    this.ownerStore = ownerStore ?? (isOwnerStore(this.dedupe) ? this.dedupe : undefined);
    this.restoreIdentity();
  }

  get ownerKnown(): boolean {
    return this.ownerOpenId !== undefined;
  }

  getOwnerOpenId(): string | undefined {
    return this.ownerOpenId;
  }

  assertAllowlisted(fromOpenId: string): "ok" | "allowlist" {
    if (!fromOpenId || !this.ownerOpenId) return "allowlist";
    return this.ownerOpenId === fromOpenId ? "ok" : "allowlist";
  }

  setOwner(openId: string, source: FeishuOwnerSource): void {
    const trimmed = openId.trim();
    if (trimmed.length < 3 || trimmed.length > 128 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      throw new PenglaiError("INVALID_INPUT", "feishu owner invalid");
    }
    const changed = this.ownerOpenId !== trimmed;
    this.ownerOpenId = trimmed;
    this.persistIdentity();
    if (changed) this.auditOwner(source);
  }

  setAppId(appId: string): void {
    this.appId = appId.trim() || undefined;
    this.setupRequired = !this.appId;
    this.persistIdentity();
  }

  clearIdentity(): void {
    this.appId = undefined;
    this.ownerOpenId = undefined;
    this.setupRequired = true;
    this.persistIdentity();
  }

  private restoreIdentity(): void {
    const raw = this.ownerStore?.getAdapterConfig(FEISHU_ACCOUNT_REF);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { appId?: string; ownerOpenId?: string };
      if (typeof parsed.appId === "string" && parsed.appId.trim()) {
        this.appId = parsed.appId.trim();
        this.setupRequired = false;
      }
      if (typeof parsed.ownerOpenId === "string" && parsed.ownerOpenId.trim()) {
        this.ownerOpenId = parsed.ownerOpenId.trim();
      }
    } catch {
      /* ignore corrupt adapter config */
    }
  }

  private persistIdentity(): void {
    this.ownerStore?.putAdapterConfig(
      FEISHU_ACCOUNT_REF,
      "feishu",
      JSON.stringify({
        ...(this.appId ? { appId: this.appId } : {}),
        ...(this.ownerOpenId ? { ownerOpenId: this.ownerOpenId } : {}),
      }),
    );
  }

  private auditOwner(source: FeishuOwnerSource): void {
    this.ownerStore?.audit?.("feishu.owner", { source, ownerDigest: feishuOwnerDigest(this.ownerOpenId ?? "") }, Date.now());
  }

  private rejectAllowlist(_openId?: string): { kind: "rejected"; text: "allowlist" } {
    return { kind: "rejected", text: "allowlist" };
  }

  checklist(): string[] {
    return [
      "Create a Feishu enterprise self-built app",
      "Enable bot capability",
      "Grant p2p receive and send-as-bot scopes",
      "Select long connection",
      "Subscribe im.message.receive_v1",
      "Create and publish an app version if the official scan page requires it",
    ];
  }

  doctor(input: FeishuDoctorInput) {
    return doctorFeishu(input);
  }

  startQr() {
    return this.registration.begin();
  }

  pollQr(challengeId: string) {
    return this.registration.poll(challengeId);
  }

  takeQrCredentials(challengeId: string) {
    return this.registration.takeConfirmed(challengeId);
  }

  cancelQr(challengeId?: string) {
    if (challengeId) this.registration.cancel(challengeId);
  }

  async connect(appId: string, appSecret: string): Promise<void> {
    if (!appId || !appSecret) throw new PenglaiError("UNAUTHORIZED", "app credentials required");
    this.appId = appId;
    this.setupRequired = false;
    this.status = "connecting";
    if (this.voiceAbort.signal.aborted) this.voiceAbort = new AbortController();
    const client = new this.sdk.Client({ appId, appSecret });
    const dispatcher = new this.sdk.EventDispatcher({});
    dispatcher.register({
      [FEISHU_RECEIVE_EVENT]: (data: unknown) => this.enqueueReceive(data),
    });
    const next = new this.sdk.WSClient({ appId, appSecret, autoReconnect: true });
    await next.start({ eventDispatcher: dispatcher });
    const prev = this.ws;
    this.client = client;
    this.ws = next;
    this.revision += 1;
    this.status = "connected";
    prev?.close({ force: true });
    void this.resumePendingVoiceClaims();
  }

  stop(): void {
    this.ws?.close({ force: true });
    this.ws = undefined;
    this.client = undefined;
    this.voiceAbort.abort("feishu stopped");
    this.status = "idle";
  }

  identityFrom(data: unknown): { tenant?: string; appId?: string } {
    const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const header = (rec.header && typeof rec.header === "object" ? rec.header : rec) as Record<string, unknown>;
    return {
      ...(typeof header.tenant_key === "string" ? { tenant: header.tenant_key } : {}),
      ...(typeof header.app_id === "string" ? { appId: header.app_id } : {}),
    };
  }

  enqueueReceive(data: unknown): { accepted: true } | { reject: string } {
    const started = Date.now();
    const identity = this.identityFrom(data);
    if (this.expected?.tenant && identity.tenant && identity.tenant !== this.expected.tenant) {
      return { reject: "tenant" };
    }
    if (this.expected?.appId && identity.appId && identity.appId !== this.expected.appId) {
      return { reject: "app" };
    }
    const received = parseOfficialReceiveWithMedia(data);
    const parsed = received.parsed;
    if ("reject" in parsed) return { reject: parsed.reject };
    const fromOpenId = parsed.vendorTarget ?? "";
    if (this.assertAllowlisted(fromOpenId) === "allowlist") {
      return { reject: "allowlist" };
    }
    if (parsed.bodyKind === "media") {
      if (!received.file?.fileKey) return { reject: "media" };
      this.trackInboundTask(parsed, this.ingestFile(parsed, received.file));
      return { accepted: true };
    }
    if (parsed.bodyKind === "voice") {
      if (!received.audio || received.audio.durationMs <= 0 || received.audio.durationMs > 180_000) {
        return { reject: "audio" };
      }
      this.trackInboundTask(parsed, Promise.resolve(
        this.plane.claimVoiceInbound(parsed, {
          mediaRefJson: JSON.stringify({ schema: 1, ...received.audio }),
          durationMs: received.audio.durationMs,
        }),
      ).then((claim) => {
        if (claim.kind !== "voice_claim") return claim;
        if (claim.state !== "transcribed" && claim.state !== "failed") {
          this.scheduleVoiceClaim(claim, received.audio!);
        }
        return { kind: "accepted" as const, text: "voice claimed" };
      }));
      if (Date.now() - started > 3000) {
        throw new PenglaiError("DELIVERY_TRANSIENT", "feishu handler exceeded 3s");
      }
      return { accepted: true };
    }
    if (this.dedupe) {
      const fresh = this.dedupe.claimDedupe("feishu", parsed.adapterMessageKey, identity.tenant, identity.appId);
      if (!fresh) {
        const routeId = this.plane.ensureRoute(parsed);
        if (this.plane.store.findInboundByKey(routeId, parsed.adapterMessageKey)) return { accepted: true };
      }
    } else if (this.seen.has(parsed.adapterMessageKey)) {
      return { accepted: true };
    } else {
      this.seen.add(parsed.adapterMessageKey);
    }
    this.trackInboundTask(parsed, this.plane.submitInbound(parsed));
    this.fireReaction(parsed.adapterMessageKey, "processing");
    if (Date.now() - started > 3000) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "feishu handler exceeded 3s");
    }
    return { accepted: true };
  }

  lastEnqueue: Promise<unknown> | undefined;

  private trackInboundTask(parsed: InboundEnvelope, task: Promise<unknown>): void {
    this.lastEnqueue = task.catch((error: unknown) => {
      const failure = classifyMediaFailure(error, "media-admission");
      const diagnostic =
        error instanceof FeishuMediaFailure || parsed.bodyKind === "media"
          ? failure.diagnostic
          : undefined;
      this.fireReaction(parsed.adapterMessageKey, "error");
      try {
        return this.plane.recordInboundFailure(parsed, failure.errorClass, diagnostic);
      } catch {
        // A broken persistence layer must not turn an already-acknowledged
        // vendor callback into an unhandled process-level rejection.
        return {
          kind: "rejected" as const,
          text: "inbound processing failed",
          errorClass: "DELIVERY_TRANSIENT",
        };
      }
    });
  }

  async pumpOutbox(routeId: string, to: string): Promise<void> {
    if (!to) throw new PenglaiError("SECURITY_POLICY", "vendor reply target required");
    for (const item of this.plane.dueOutbox(routeId)) {
      const claimToken = this.plane.markSending(item.outboxId, "feishu");
      if (!claimToken) continue;
      const delivery = this.plane.resolveVoiceDelivery(item.outboxId);
      const currentTarget = delivery.vendorTarget;
      let receipt = this.plane.store.getVoiceDeliveryReceipt(item.outboxId);
      const needsText = delivery.mode === "text" || delivery.mode === "text-and-voice";
      if (needsText && !receipt.textSent) {
        const textResult = await this.sendText(currentTarget, delivery.finalText);
        if (!("ok" in textResult && textResult.ok)) {
          this.plane.markSendResult(item.outboxId, this.mapSendError(textResult), claimToken);
          this.fireReaction(this.plane.store.getInbound(item.inboundId)?.adapterMessageKey, "error");
          continue;
        }
        receipt = this.plane.store.markVoiceDeliveryPart(item.outboxId, "text", this.plane.clock.now());
      }
      if (delivery.mode !== "text" && !receipt.audioSent && !receipt.fallbackUsed) {
        const audio = await this.trySendAudio(currentTarget, delivery);
        if (audio.ok) {
          receipt = this.plane.store.markVoiceDeliveryPart(item.outboxId, "audio", this.plane.clock.now(), audio.digest);
        } else {
          if (!receipt.textSent) {
            const fallback = await this.sendText(currentTarget, delivery.finalText);
            if (!("ok" in fallback && fallback.ok)) {
              this.plane.markSendResult(item.outboxId, this.mapSendError(fallback), claimToken);
              continue;
            }
            receipt = this.plane.store.markVoiceDeliveryPart(item.outboxId, "text", this.plane.clock.now());
          }
          receipt = this.plane.store.markVoiceDeliveryPart(item.outboxId, "fallback", this.plane.clock.now());
        }
      }
      const complete = delivery.mode === "text"
        ? receipt.textSent
        : receipt.audioSent || (receipt.fallbackUsed && receipt.textSent);
      if (complete) {
        this.plane.markDelivered(item.outboxId, claimToken);
        this.fireReaction(this.plane.store.getInbound(item.inboundId)?.adapterMessageKey, "success");
      }
    }
  }

  async react(input: { vendorMessageId: string; kind: keyof typeof FEISHU_STATUS_REACTIONS }): Promise<void> {
    const emoji = FEISHU_STATUS_REACTIONS[input.kind];
    const api = this.client as
      | { im?: { messageReaction?: { create?: (opts: unknown) => Promise<unknown> } } }
      | undefined;
    const create = api?.im?.messageReaction?.create;
    if (typeof create !== "function" || !input.vendorMessageId) return;
    await create({
      path: { message_id: input.vendorMessageId },
      data: { reaction_type: { emoji_type: emoji } },
    });
  }

  private fireReaction(messageId: string | undefined, kind: keyof typeof FEISHU_STATUS_REACTIONS): void {
    if (!messageId) return;
    void this.react({ vendorMessageId: messageId, kind }).catch(() => undefined);
  }

  async sendText(receiveId: string, text: string, replyTo?: string): Promise<{ ok: true } | { error: string }> {
    if (!this.client) return { error: "not connected" };
    try {
      if (replyTo) {
        await this.client.im.message.reply({
          path: { message_id: replyTo },
          data: { content: JSON.stringify({ text }), msg_type: "text" },
        });
      } else {
        await this.client.im.message.create({
          params: { receive_id_type: "open_id" },
          data: { receive_id: receiveId, content: JSON.stringify({ text }), msg_type: "text" },
        });
      }
      return { ok: true };
    } catch (err) {
      const klass = classifyTransportError(err);
      if (klass === "auth") return { error: "auth" };
      if (klass === "rate") return { error: "429" };
      if (klass === "network") return { error: "network" };
      return { error: "send failed" };
    }
  }

  async sendFile(receiveId: string, data: Buffer, filename: string): Promise<{ ok: true } | { error: string }> {
    if (!this.client) return { error: "not connected" };
    if (!data.length || data.length > 30 * 1024 * 1024) return { error: "file size rejected" };
    try {
      const uploaded = await this.client.im.file.create({
        data: { file_type: "stream", file_name: filename, file: data },
      });
      if (!uploaded?.file_key) return { error: "file upload missing key" };
      await this.client.im.message.create({
        params: { receive_id_type: "open_id" },
        data: {
          receive_id: receiveId,
          content: JSON.stringify({ file_key: uploaded.file_key }),
          msg_type: "file",
        },
      });
      return { ok: true };
    } catch (err) {
      const klass = classifyTransportError(err);
      if (klass === "auth") return { error: "auth" };
      if (klass === "rate") return { error: "429" };
      return { error: "transient" };
    }
  }

  async ingest(raw: Parameters<typeof parseFeishuEvent>[0]) {
    const parsed = parseFeishuEvent(raw);
    if ("reject" in parsed) return { kind: "rejected" as const, text: parsed.reject };
    if (this.assertAllowlisted(parsed.vendorTarget ?? "") === "allowlist") {
      return this.rejectAllowlist(parsed.vendorTarget);
    }
    return this.plane.submitInbound(parsed);
  }

  private scheduleVoiceClaim(claim: VoiceInboundClaim, ref: FeishuAudioMediaRef): void {
    if (this.activeVoiceJobs.has(claim.inboundId)) return;
    const task = this.processVoiceClaim(claim, ref).finally(() => {
      this.activeVoiceJobs.delete(claim.inboundId);
    });
    this.activeVoiceJobs.set(claim.inboundId, task);
  }

  private async resumePendingVoiceClaims(): Promise<void> {
    for (const claim of this.plane.pendingVoiceClaims("feishu")) {
      const job = this.plane.store.getVoiceJob(claim.inboundId);
      if (!job) continue;
      try {
        const parsed = JSON.parse(job.mediaRefJson) as { schema?: number } & FeishuAudioMediaRef;
        if (parsed.schema !== 1 || !parsed.messageId || !parsed.fileKey) throw new Error("invalid Feishu voice job");
        this.scheduleVoiceClaim(claim, parsed);
      } catch {
        this.plane.failVoiceInbound(claim, "STORE_CORRUPT", false);
      }
    }
  }

  /** Resume durable voice claims when the optional ASR capability is hot-plugged. */
  retryPendingVoiceClaims(): void {
    if (!this.voice?.asr) return;
    void this.resumePendingVoiceClaims();
  }

  private async processVoiceClaim(claim: VoiceInboundClaim, ref: FeishuAudioMediaRef): Promise<void> {
    if (!this.voice?.asr || !this.client) {
      this.plane.failVoiceInbound(claim, "DSH_UNAVAILABLE", true);
      return;
    }
    this.plane.markVoiceProcessing(claim);
    const operationId = `asr_${createHash("sha256").update(claim.inboundId).digest("hex").slice(0, 32)}`;
    const cancel = () => {
      void this.voice?.asr?.cancelTranscription?.(operationId).catch(() => undefined);
    };
    this.voiceAbort.signal.addEventListener("abort", cancel, { once: true });
    try {
      const opus = await this.downloadAudioResource(ref, this.voiceAbort.signal);
      const transcript = await inboundFeishuAudioToText(opus, this.voice.asr, {
        authorized: true,
        claimed: true,
        privateChat: true,
        operationId,
      });
      const result = await this.plane.completeVoiceInbound(claim, transcript, transcript.digest);
      if (result.kind === "rejected") {
        this.plane.failVoiceInbound(claim, result.errorClass ?? "INVALID_INPUT", false);
      }
    } catch (err) {
      const failure = classifyMediaFailure(err, "transcription");
      const retryable = failure.errorClass === "DELIVERY_TRANSIENT" || failure.errorClass === "DSH_UNAVAILABLE";
      this.plane.failVoiceInbound(claim, failure.errorClass, retryable, failure.diagnostic);
    } finally {
      this.voiceAbort.signal.removeEventListener("abort", cancel);
    }
  }

  private async ingestFile(parsed: InboundEnvelope, ref: FeishuFileMediaRef) {
    const bytes = await this.downloadMessageResource(ref.messageId, ref.fileKey, ref.messageType === "image" ? "image" : "file", this.voiceAbort.signal);
    try {
      parsed.media = await attachDownloadedMedia({
        store: this.mediaStore,
        bytes,
        base: {
          kind: classifyMedia({
            bytes,
            ...(ref.filename ? { filename: ref.filename } : {}),
            ...(ref.messageType === "image" ? { mime: "image/png" } : {}),
          }),
          source: "feishu",
          sourceMessageId: ref.messageId,
          sourceResourceId: ref.fileKey,
          mime: ref.messageType === "image" ? "image/png" : "application/octet-stream",
          ...(ref.filename ? { filename: ref.filename } : {}),
        },
        ...(this.imageAdmission ? { imageAdmission: this.imageAdmission } : {}),
        ...(this.objectStore ? { objectStore: this.objectStore } : {}),
      });
    } catch (error) {
      const failure = classifyMediaFailure(error, "media-admission");
      throw new FeishuMediaFailure(failure.errorClass, failure.diagnostic);
    }
    delete parsed.text;
    const submitted = await this.plane.submitInbound(parsed);
    if (submitted.kind === "rejected") {
      const errorClass = submitted.errorClass ?? "INVALID_INPUT";
      const failure = classifyMediaFailure(
        new PenglaiError(errorClass, "Feishu media admission rejected"),
        "media-admission",
      );
      return this.plane.recordInboundFailure(parsed, failure.errorClass, failure.diagnostic);
    }
    if (submitted.kind === "accepted" && submitted.text === "queued") {
      const routeId = this.plane.ensureRoute(parsed);
      const binding = this.plane.store.activeBinding(routeId);
      if (binding) {
        try {
          this.onAdmittedBytes?.({
            bytes,
            mime: parsed.media.mime,
            routeId,
            workspaceId: binding.workspaceIdentity,
            sessionId: binding.sessionId,
            turnId: parsed.adapterMessageKey,
            ...(ref.filename ? { filename: ref.filename } : {}),
            ...(parsed.media.officeHandle ? { objectHandle: parsed.media.officeHandle } : {}),
          });
        } catch {
          // The official Turn is already queued. Artifact indexing is an
          // optional, fail-open enhancement and must not duplicate the Turn.
        }
      }
    }
    return submitted;
  }

  private async downloadAudioResource(ref: FeishuAudioMediaRef, signal: AbortSignal): Promise<Buffer> {
    return this.downloadMessageResource(ref.messageId, ref.fileKey, "file", signal);
  }

  private async downloadMessageResource(messageId: string, fileKey: string, type: "file" | "image", signal: AbortSignal): Promise<Buffer> {
    const client = this.client;
    if (!client) {
      throw new FeishuMediaFailure("AUTH_EXPIRED", {
        phase: "resource-request",
        reason: "client-unavailable",
      });
    }
    let response: Awaited<ReturnType<typeof client.im.messageResource.get>>;
    try {
      response = await client.im.messageResource.get({
        params: { type },
        path: { message_id: messageId, file_key: fileKey },
      });
    } catch (err) {
      throw resourceRequestFailure(err);
    }
    let stream: ReturnType<typeof response.getReadableStream>;
    try {
      stream = response.getReadableStream();
    } catch (error) {
      throw resourceRequestFailure(error);
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const onAbort = () => stream.destroy(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      try {
        for await (const chunk of stream) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          bytes += buf.length;
          if (bytes > 8 * 1024 * 1024) {
            stream.destroy();
            throw new FeishuMediaFailure("INVALID_INPUT", {
              phase: "resource-validation",
              reason: "too-large",
            });
          }
          chunks.push(buf);
        }
      } catch (error) {
        if (error instanceof FeishuMediaFailure) throw error;
        if (signal.aborted) {
          throw new FeishuMediaFailure("DELIVERY_TRANSIENT", {
            phase: "resource-stream",
            reason: "cancelled",
          });
        }
        const transport = classifyTransportError(error);
        throw new FeishuMediaFailure("DELIVERY_TRANSIENT", {
          phase: "resource-stream",
          reason: transport === "network" ? "network" : transport === "server" ? "server" : "unknown",
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) {
      throw new FeishuMediaFailure("DELIVERY_TRANSIENT", {
        phase: "resource-stream",
        reason: "cancelled",
      });
    }
    if (!bytes) {
      throw new FeishuMediaFailure("INVALID_INPUT", {
        phase: "resource-validation",
        reason: "empty",
      });
    }
    return Buffer.concat(chunks);
  }

  private async trySendAudio(
    to: string,
    delivery: ReturnType<RoutingControlPlane["resolveVoiceDelivery"]>,
  ): Promise<{ ok: true; digest: string } | { ok: false }> {
    if (!this.voice?.tts || !this.client) return { ok: false };
    if (this.voiceAbort.signal.aborted) return { ok: false };
    const cancel = () => {
      void this.voice?.tts?.cancelSynthesis?.(delivery.operationId).catch(() => undefined);
    };
    this.voiceAbort.signal.addEventListener("abort", cancel, { once: true });
    try {
      const audio = await outboundFeishuNativeAudio({
        finalText: delivery.finalText,
        sourceFinalId: delivery.sourceFinalId,
        operationId: delivery.operationId,
        voiceId: delivery.voiceId,
      }, this.voice.tts);
      const uploaded = await this.client.im.file.create({
        data: {
          file_type: "opus",
          file_name: audio.filename,
          duration: audio.durationMs,
          file: audio.opus,
        },
      });
      const fileKey = uploaded?.file_key;
      if (!fileKey) return { ok: false };
      await this.client.im.message.create({
        params: { receive_id_type: "open_id" },
        data: {
          receive_id: to,
          content: JSON.stringify({ file_key: fileKey }),
          msg_type: "audio",
        },
      });
      return { ok: true, digest: audio.digest };
    } catch {
      return { ok: false };
    } finally {
      this.voiceAbort.signal.removeEventListener("abort", cancel);
    }
  }

  private mapSendError(result: { ok: true } | { error: string }): "transient" | "permanent" | "auth" {
    if ("ok" in result) return "transient";
    if (result.error === "auth") return "auth";
    if (result.error === "not connected") return "auth";
    return "transient";
  }
}

export { doctorFeishu, FEISHU_RECEIVE_EVENT, isForbiddenBaseAuth, isOfficialAppRegistrationQr } from "./official.js";
export { FeishuAppRegistration, decorateFeishuQrUrl, penglaiFeishuAddons } from "./registration.js";
export * from "./media.js";
