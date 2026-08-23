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
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
} from "@penglai/contracts";
import type { RoutingControlPlane, VoiceInboundClaim } from "@penglai/routing-core";
import { doctorFeishu, FEISHU_RECEIVE_EVENT, type FeishuDoctorInput } from "./official.js";
import { inboundFeishuAudioToText, outboundFeishuNativeAudio } from "./media.js";
import { FeishuAppRegistration } from "./registration.js";

export const name = "feishu";
export const FEISHU_ACCOUNT_REF = "feishu-default";
export const FEISHU_ALLOWLIST_NOTICE =
  "蓬莱只回复扫码确认的飞书账号。请用该账号发消息，或在设置里显式指定允许身份。\nPenglai only replies to the Feishu account that confirmed the scan. Message from that account, or set the allowed identity explicitly in settings.";

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

export function parseFeishuEvent(raw: {
  chatType?: string;
  messageType?: string;
  messageId: string;
  openId?: string;
  text?: string;
}): InboundEnvelope | { reject: "group" | "media" } {
  if (raw.chatType && raw.chatType !== "p2p" && raw.chatType !== "private") return { reject: "group" };
  if (
    raw.messageType &&
    raw.messageType !== "text" &&
    raw.messageType !== "audio" &&
    raw.messageType !== "image" &&
    raw.messageType !== "file"
  ) {
    return { reject: "media" };
  }
  return {
    adapter: "feishu",
    adapterMessageKey: raw.messageId,
    accountRef: "feishu",
    peerRef: createHash("sha256").update(raw.openId ?? "unknown").digest("hex").slice(0, 24),
    chatKind: "private",
    bodyKind: raw.messageType === "audio" ? "voice" : raw.messageType === "image" || raw.messageType === "file" ? "media" : "text",
    ...(raw.text ? { text: raw.text } : {}),
    receivedAt: Date.now(),
    ...(raw.openId ? { vendorTarget: raw.openId } : {}),
  };
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
      text = content.text ?? "";
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

  private noticeAllowlist(openId?: string): void {
    if (!openId || !this.client) return;
    void this.sendText(openId, FEISHU_ALLOWLIST_NOTICE);
  }

  private rejectAllowlist(openId?: string): { kind: "rejected"; text: "allowlist" } {
    this.noticeAllowlist(openId);
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
      this.noticeAllowlist(fromOpenId);
      return { reject: "allowlist" };
    }
    if (parsed.bodyKind === "media") {
      if (!received.file?.fileKey) return { reject: "media" };
      this.lastEnqueue = this.ingestFile(parsed, received.file);
      return { accepted: true };
    }
    if (parsed.bodyKind === "voice") {
      if (!received.audio || received.audio.durationMs <= 0 || received.audio.durationMs > 180_000) {
        return { reject: "audio" };
      }
      this.lastEnqueue = Promise.resolve(
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
      });
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
    this.lastEnqueue = this.plane.submitInbound(parsed);
    if (Date.now() - started > 3000) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "feishu handler exceeded 3s");
    }
    return { accepted: true };
  }

  lastEnqueue: Promise<unknown> | undefined;

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
      if (complete) this.plane.markDelivered(item.outboxId, claimToken);
    }
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
      const errorClass = err instanceof PenglaiError ? err.errorClass : "DELIVERY_TRANSIENT";
      const retryable = errorClass === "DELIVERY_TRANSIENT" || errorClass === "DSH_UNAVAILABLE";
      this.plane.failVoiceInbound(claim, errorClass, retryable);
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
      return {
        kind: "rejected" as const,
        text: error instanceof PenglaiError ? error.message : "media admission failed",
      };
    }
    delete parsed.text;
    return this.plane.submitInbound(parsed);
  }

  private async downloadAudioResource(ref: FeishuAudioMediaRef, signal: AbortSignal): Promise<Buffer> {
    return this.downloadMessageResource(ref.messageId, ref.fileKey, "file", signal);
  }

  private async downloadMessageResource(messageId: string, fileKey: string, type: "file" | "image", signal: AbortSignal): Promise<Buffer> {
    const client = this.client;
    if (!client) throw new PenglaiError("AUTH_EXPIRED", "Feishu client unavailable");
    let response: Awaited<ReturnType<typeof client.im.messageResource.get>>;
    try {
      response = await client.im.messageResource.get({
        params: { type },
        path: { message_id: messageId, file_key: fileKey },
      });
    } catch (err) {
      const klass = classifyTransportError(err);
      throw new PenglaiError(klass === "auth" ? "AUTH_EXPIRED" : "DELIVERY_TRANSIENT", "Feishu audio resource download failed");
    }
    const stream = response.getReadableStream();
    const chunks: Buffer[] = [];
    let bytes = 0;
    const onAbort = () => stream.destroy(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        bytes += buf.length;
        if (bytes > 8 * 1024 * 1024) {
          stream.destroy();
          throw new PenglaiError("INVALID_INPUT", "Feishu audio resource size rejected");
        }
        chunks.push(buf);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw new PenglaiError("DELIVERY_TRANSIENT", "Feishu audio download cancelled");
    if (!bytes) throw new PenglaiError("INVALID_INPUT", "Feishu audio resource empty");
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
