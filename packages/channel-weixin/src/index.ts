import { createHash, randomUUID } from "node:crypto";
import {
  PenglaiError,
  backoffMs,
  classifyTransportError,
  classifyMedia,
  MediaStore,
  mediaCaption,
  type InboundEnvelope,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
} from "@penglai/contracts";
import type { RoutingControlPlane, VoiceInboundClaim } from "@penglai/routing-core";
import { encodeWavToWeixinSilk } from "@penglai/audio-codecs";
import { ILinkClient, type ILinkFetch } from "./ilink.js";
import type { WeixinVoiceMediaRef } from "./cdn.js";
import { downloadAndDecryptWeixinCdn } from "./cdn.js";
import type { WeixinCdnMedia } from "./protocol.js";
import { inboundVoiceToText, outboundTtsAttachment, weixinVisibleAudioFallback } from "./media.js";
import {
  ILINK_BASE,
  ILINK_CDN_BASE,
  parseOfficialInbound,
  buildSendBody,
  type OfficialWeixinMessage,
} from "./protocol.js";

export type AuthState =
  | "idle"
  | "waiting"
  | "scanned"
  | "connected"
  | "expired"
  | "error"
  | "need_verify";

export interface WeixinTransport {
  getQr(): Promise<{ qrRef: string; qrImageRef?: string; expiresAt: number }>;
  pollQr(qrRef: string, verifyCode?: string): Promise<{ status: AuthState; tokenRef?: string; needsVerify?: boolean; scannerUserId?: string }>;
  getUpdates(buf: string, token?: string, signal?: AbortSignal): Promise<{ buf: string; messages: WeixinRaw[] }>;
  send(to: string, text: string, clientId: string, contextToken?: string): Promise<{ ok: true } | { error: "transient" | "permanent" | "auth" }>;
  downloadVoice?(ref: WeixinVoiceMediaRef, signal?: AbortSignal): Promise<Buffer>;
  downloadCdn?(media: WeixinCdnMedia, signal?: AbortSignal): Promise<Buffer>;
  sendAudioFile?(
    to: string,
    input: { data: Buffer; filename: string; clientId: string; contextToken?: string },
  ): Promise<{ ok: true } | { error: "transient" | "permanent" | "auth" }>;
  sendNativeVoice?(
    to: string,
    input: { data: Buffer; durationMs: number; sampleRate: number; clientId: string; contextToken?: string },
  ): Promise<{
    ok: true;
  } | {
    error: "transient" | "permanent" | "auth";
    /** Fixed-stage, non-secret diagnostic suitable for local owner UI. */
    diagnostic?: string;
  }>;
}

export interface WeixinRaw {
  messageId: string;
  fromUserId: string;
  chatType: "private" | "group";
  itemType: "text" | "voice" | "media" | "image" | "file" | "audio";
  text?: string;
  contextToken?: string;
  voice?: WeixinVoiceMediaRef;
  image?: WeixinCdnMedia;
  file?: { media?: WeixinCdnMedia; file_name?: string };
}

export interface CredentialVault {
  write(ref: string, secret: string): Promise<void>;
  read(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
  migrate?(fromRef: string, toRef: string): Promise<boolean>;
}

/** Persistence seam for the WeChat scanner identity (the unique allowlist owner). */
export interface WeixinOwnerStore {
  putAdapterConfig(accountId: string, adapter: string, json: string): void;
  getAdapterConfig(accountId: string): string | undefined;
}

// Official dsh-credentials only accepts POSIX identifiers as refs; the
// historical "weixin-bot-token" must remap to the canonical shared ref.
export const WEIXIN_TOKEN_CREDENTIAL_REF = "PENGLAI_WEIXIN_TOKEN";
export const WEIXIN_CONTEXT_CREDENTIAL_REF = "PENGLAI_WEIXIN_CONTEXT_TOKEN";
export const LEGACY_WEIXIN_TOKEN_REF = "weixin-bot-token";

export async function migrateWeixinTokenRef(vault: CredentialVault): Promise<boolean> {
  if (!vault.migrate) return false;
  return vault.migrate(LEGACY_WEIXIN_TOKEN_REF, WEIXIN_TOKEN_CREDENTIAL_REF);
}

export class MemoryVault implements CredentialVault {
  private readonly m = new Map<string, string>();
  async write(ref: string, secret: string): Promise<void> {
    this.m.set(ref, secret);
  }
  async read(ref: string): Promise<string | undefined> {
    return this.m.get(ref);
  }
  async delete(ref: string): Promise<void> {
    this.m.delete(ref);
  }
}

export function parseInbound(raw: WeixinRaw, accountRef: string): InboundEnvelope | { reject: string } {
  if (raw.chatType !== "private") return { reject: "group" };
  if (!["text", "voice", "image", "file", "audio"].includes(String(raw.itemType))) return { reject: "media" };
  const n = Number(raw.messageId);
  const official: OfficialWeixinMessage = {
    from_user_id: raw.fromUserId,
    message_type: 1,
    item_list: [
      {
        type:
          raw.itemType === "voice" || raw.itemType === "audio"
            ? 3
            : raw.itemType === "image"
              ? 2
              : raw.itemType === "file"
                ? 4
                : 1,
        msg_id: raw.messageId,
        text_item: { text: raw.text ?? "" },
        ...(raw.image ? { image_item: { media: raw.image } } : {}),
        ...(raw.file ? { file_item: raw.file } : {}),
      },
    ],
    ...(Number.isFinite(n) ? { message_id: n } : {}),
    ...(raw.contextToken ? { context_token: raw.contextToken } : {}),
  };
  const parsed = parseOfficialInbound(official, accountRef);
  if ("reject" in parsed) return { reject: parsed.reject };
  return parsed;
}

function officialToRaw(msg: OfficialWeixinMessage): WeixinRaw {
  const parsed = parseOfficialInbound(msg, "acct");
  if ("reject" in parsed) {
    return {
      messageId: String(msg.message_id ?? "x"),
      fromUserId: msg.from_user_id ?? "",
      chatType: parsed.reject === "group" ? "group" : "private",
      itemType: parsed.reject === "media" ? "media" : "text",
      text: "",
      ...(msg.context_token ? { contextToken: msg.context_token } : {}),
    };
  }
  const imageMedia = msg.item_list?.find((item) => item.image_item?.media)?.image_item?.media;
  const fileItem = msg.item_list?.find((item) => item.file_item)?.file_item;
  const voice = msg.item_list?.find((item) => item.type === 3)?.voice_item;
  const voiceRef = voice?.media
    ? {
        media: voice.media,
        encodeType: voice.encode_type ?? 0,
        sampleRate: voice.sample_rate ?? 24_000,
        playtimeMs: voice.playtime ?? 0,
      }
    : undefined;
  return {
    messageId: parsed.adapterMessageKey,
    fromUserId: msg.from_user_id ?? "",
    chatType: "private",
    itemType:
      parsed.bodyKind === "voice"
        ? "voice"
        : parsed.media?.kind === "image"
          ? "image"
          : parsed.bodyKind === "media"
            ? "file"
            : "text",
    text: parsed.text ?? "",
    ...(voiceRef ? { voice: voiceRef } : {}),
    ...(imageMedia ? { image: imageMedia } : {}),
    ...(fileItem ? { file: fileItem } : {}),
    ...(msg.context_token ? { contextToken: msg.context_token } : {}),
  };
}

export class ILinkTransport implements WeixinTransport {
  readonly client: ILinkClient;
  constructor(fetchImpl: ILinkFetch = fetch as unknown as ILinkFetch, base = ILINK_BASE) {
    this.client = new ILinkClient(fetchImpl, base);
  }

  async getQr() {
    return this.client.getQr();
  }

  async pollQr(qrRef: string, verifyCode?: string) {
    const p = await this.client.pollQr(qrRef, verifyCode);
    const status: AuthState = p.needsVerify
      ? "need_verify"
      : p.status === "wait"
        ? "waiting"
        : p.status === "scaned" || p.status === "scaned_but_redirect" || p.status === "binded_redirect"
          ? "scanned"
          : p.status === "confirmed"
            ? "connected"
            : p.status === "expired"
              ? "expired"
              : "error";
    return {
      status,
      ...(p.tokenRef ? { tokenRef: p.tokenRef } : {}),
      ...(p.scannerUserId || p.accountRef ? { scannerUserId: p.scannerUserId || p.accountRef } : {}),
      needsVerify: p.needsVerify,
    };
  }

  async getUpdates(buf: string, token?: string, signal?: AbortSignal) {
    if (!token) return { buf, messages: [] };
    const out = await this.client.getUpdates(token, buf, signal);
    return { buf: out.buf, messages: out.messages.map(officialToRaw) };
  }

  async send(to: string, text: string, clientId: string, contextToken?: string) {
    const token = this.lastToken;
    if (!token) return { error: "auth" as const };
    return this.client.send(token, buildSendBody({ to, text, clientId, ...(contextToken ? { contextToken } : {}) }));
  }

  downloadVoice(ref: WeixinVoiceMediaRef, signal?: AbortSignal) {
    return this.client.downloadVoice(ref, signal);
  }

  downloadCdn(media: WeixinCdnMedia, signal?: AbortSignal) {
    return downloadAndDecryptWeixinCdn(media, ILINK_CDN_BASE, fetch, signal);
  }

  async sendAudioFile(
    to: string,
    input: { data: Buffer; filename: string; clientId: string; contextToken?: string },
  ) {
    const token = this.lastToken;
    if (!token) return { error: "auth" as const };
    return this.client.sendAudioFile(token, {
      to,
      data: input.data,
      filename: input.filename,
      clientId: input.clientId,
      ...(input.contextToken ? { contextToken: input.contextToken } : {}),
    });
  }

  async sendNativeVoice(
    to: string,
    input: { data: Buffer; durationMs: number; sampleRate: number; clientId: string; contextToken?: string },
  ) {
    const token = this.lastToken;
    if (!token) return { error: "auth" as const };
    return this.client.sendNativeVoice(token, {
      to,
      data: input.data,
      durationMs: input.durationMs,
      sampleRate: input.sampleRate,
      clientId: input.clientId,
      ...(input.contextToken ? { contextToken: input.contextToken } : {}),
    });
  }

  lastToken: string | undefined;
}

export class WeixinAdapter {
  authState: AuthState = "idle";
  private tokenRef = WEIXIN_TOKEN_CREDENTIAL_REF;
  private lastQrRef: string | undefined;
  private contextByPeer = new Map<string, string>();
  private ownerUserId: string | undefined;
  private nativeVoiceEnabled = false;
  private pendingNativeVoiceProbeId: string | undefined;
  private lastNativeVoiceDiagnostic: string | undefined;
  private receiveAttempts = 0;
  private cursorBlocked = false;
  private voiceAbort = new AbortController();
  private readonly activeVoiceJobs = new Map<string, Promise<void>>();
  readonly mediaStore = new MediaStore();
  constructor(
    private readonly plane: RoutingControlPlane,
    private readonly transport: WeixinTransport,
    private readonly vault: CredentialVault,
    private readonly accountRef = "acct",
    private readonly cursors?: { putCursor(accountId: string, adapter: string, cursor: string): void; getCursor(accountId: string, adapter: string): string | undefined },
    private readonly voice?: {
      readonly asr?: PenglaiAsrClient | undefined;
      readonly tts?: PenglaiMossTtsClient | undefined;
    },
    private readonly ownerStore?: WeixinOwnerStore,
  ) {
    this.buf = this.cursors?.getCursor(this.accountRef, "weixin") ?? "";
    this.restoreOwner();
    void migrateWeixinTokenRef(this.vault).catch(() => {
      /* legacy token stays put; re-login overwrites it under the canonical ref */
    });
  }

  private restoreOwner(): void {
    if (!this.ownerStore) return;
    const raw = this.ownerStore.getAdapterConfig(this.accountRef);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        ownerUserId?: string;
        nativeVoiceEnabled?: boolean;
        pendingNativeVoiceProbeId?: string;
      };
      if (parsed.ownerUserId) {
        this.ownerUserId = parsed.ownerUserId;
        this.authState = "connected";
      }
      this.nativeVoiceEnabled = parsed.nativeVoiceEnabled === true;
      if (typeof parsed.pendingNativeVoiceProbeId === "string") {
        this.pendingNativeVoiceProbeId = parsed.pendingNativeVoiceProbeId;
      }
    } catch {
      /* corrupt owner config: stay in a no-owner state, blocking cursor advance */
    }
  }

  private persistOwner(): void {
    this.ownerStore?.putAdapterConfig(this.accountRef, "weixin", JSON.stringify({
      ownerUserId: this.ownerUserId,
      nativeVoiceEnabled: this.nativeVoiceEnabled,
      pendingNativeVoiceProbeId: this.pendingNativeVoiceProbeId,
    }));
  }

  get ownerKnown(): boolean {
    return this.ownerUserId !== undefined;
  }

  async startQr(): Promise<{ qrRef: string; qrImageRef?: string }> {
    const qr = await this.transport.getQr();
    this.authState = "waiting";
    this.lastQrRef = qr.qrRef;
    return { qrRef: qr.qrRef, ...(qr.qrImageRef ? { qrImageRef: qr.qrImageRef } : {}) };
  }

  async poll(qrRef: string, verifyCode?: string): Promise<AuthState> {
    const s = await this.transport.pollQr(qrRef, verifyCode);
    if (s.needsVerify) {
      this.authState = "need_verify";
      return this.authState;
    }
    this.authState = s.status;
    if (s.status === "connected" && s.tokenRef) {
      await this.vault.write(this.tokenRef, s.tokenRef);
      if (this.transport instanceof ILinkTransport) this.transport.lastToken = s.tokenRef;
      if (s.scannerUserId) {
        this.ownerUserId = s.scannerUserId;
        this.persistOwner();
      }
      this.authState = "connected";
      this.lastQrRef = undefined;
    }
    return this.authState;
  }

  async logout(): Promise<void> {
    this.stopReceive();
    await this.vault.delete(this.tokenRef);
    await this.vault.delete(WEIXIN_CONTEXT_CREDENTIAL_REF);
    this.authState = "idle";
    this.lastQrRef = undefined;
    this.contextByPeer.clear();
    this.ownerUserId = undefined;
    this.nativeVoiceEnabled = false;
    this.pendingNativeVoiceProbeId = undefined;
    this.lastNativeVoiceDiagnostic = undefined;
    this.persistOwner();
    this.receiveAttempts = 0;
  }

  assertAllowlisted(fromUserId: string): "ok" | "allowlist" {
    if (!fromUserId || !this.ownerUserId) return "allowlist";
    return this.ownerUserId === fromUserId ? "ok" : "allowlist";
  }

  nativeVoiceCapability(): { enabled: boolean; pendingProbeId?: string; diagnostic?: string } {
    return {
      enabled: this.nativeVoiceEnabled,
      ...(this.pendingNativeVoiceProbeId ? { pendingProbeId: this.pendingNativeVoiceProbeId } : {}),
      ...(this.lastNativeVoiceDiagnostic ? { diagnostic: this.lastNativeVoiceDiagnostic } : {}),
    };
  }

  async probeNativeVoiceBubble(): Promise<{ probeId: string; state: "awaiting-visible-confirmation" }> {
    this.lastNativeVoiceDiagnostic = "native-probe-prerequisites";
    if (!this.ownerUserId || !this.voice?.tts || !this.transport.sendNativeVoice) {
      throw new PenglaiError("DSH_UNAVAILABLE", "Weixin native voice probe prerequisites unavailable");
    }
    const token = await this.vault.read(this.tokenRef);
    if (!token) throw new PenglaiError("AUTH_EXPIRED", "Weixin credential missing");
    if (this.transport instanceof ILinkTransport) this.transport.lastToken = token;
    const contextToken = this.contextByPeer.get(this.ownerUserId)
      ?? await this.vault.read(WEIXIN_CONTEXT_CREDENTIAL_REF);
    if (!contextToken) {
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "Weixin native voice probe needs a fresh inbound message context",
      );
    }
    const probeId = randomUUID();
    const operationId = `weixin-native-probe-${probeId}`;
    this.lastNativeVoiceDiagnostic = "native-probe-tts";
    const generated = await outboundTtsAttachment({
      finalText: "蓬莱语音测试。请确认这是一条可以播放的微信语音气泡。",
      sourceFinalId: operationId,
      operationId,
      voiceId: "moss-zh-default",
    }, "voice", this.voice.tts);
    if (!generated.audio) throw new PenglaiError("DSH_UNAVAILABLE", "MOSS-TTS probe produced no audio");
    this.lastNativeVoiceDiagnostic = "native-probe-silk-encode";
    const silk = await encodeWavToWeixinSilk(generated.audio.wav);
    this.lastNativeVoiceDiagnostic = "native-probe-transport";
    const sent = await this.transport.sendNativeVoice(this.ownerUserId, {
      data: silk.data,
      durationMs: silk.durationMs,
      sampleRate: silk.sampleRate,
      clientId: `penglai-native-probe-${probeId}`,
      contextToken,
    });
    if ("error" in sent) {
      this.lastNativeVoiceDiagnostic = sent.diagnostic ?? `native-voice-${sent.error}`;
      throw new PenglaiError(
        sent.error === "auth" ? "AUTH_EXPIRED" : "DELIVERY_TRANSIENT",
        `Weixin native voice probe was not accepted${sent.diagnostic ? ` (${sent.diagnostic})` : ""}`,
      );
    }
    this.nativeVoiceEnabled = false;
    this.pendingNativeVoiceProbeId = probeId;
    this.lastNativeVoiceDiagnostic = undefined;
    this.persistOwner();
    return { probeId, state: "awaiting-visible-confirmation" };
  }

  confirmNativeVoiceBubble(input: { probeId: string; visible: boolean }): { enabled: boolean } {
    if (!this.pendingNativeVoiceProbeId || input.probeId !== this.pendingNativeVoiceProbeId) {
      throw new PenglaiError("INVALID_INPUT", "Weixin native voice probe confirmation rejected");
    }
    this.nativeVoiceEnabled = input.visible;
    this.pendingNativeVoiceProbeId = undefined;
    this.persistOwner();
    return { enabled: this.nativeVoiceEnabled };
  }

  disableNativeVoiceBubble(): { enabled: false } {
    this.nativeVoiceEnabled = false;
    this.pendingNativeVoiceProbeId = undefined;
    this.persistOwner();
    return { enabled: false };
  }

  /**
   * Deterministic owner-only text round-trip probe. The renderer cannot supply
   * arbitrary text or a vendor target; both are fixed/derived inside the
   * credential-bearing adapter.
   */
  async probeTextRoundTrip(): Promise<{ sent: true }> {
    if (!this.ownerUserId) {
      throw new PenglaiError("DSH_UNAVAILABLE", "Weixin owner unavailable for text probe");
    }
    const token = await this.vault.read(this.tokenRef);
    if (!token) throw new PenglaiError("AUTH_EXPIRED", "Weixin credential missing");
    if (this.transport instanceof ILinkTransport) this.transport.lastToken = token;
    const contextToken = this.contextByPeer.get(this.ownerUserId)
      ?? await this.vault.read(WEIXIN_CONTEXT_CREDENTIAL_REF);
    const result = await this.transport.send(
      this.ownerUserId,
      "蓬莱文字通道测试，请回复：收到文字",
      `penglai-text-probe-${randomUUID()}`,
      contextToken,
    );
    if ("error" in result) {
      throw new PenglaiError(
        result.error === "auth" ? "AUTH_EXPIRED" : "DELIVERY_TRANSIENT",
        "Weixin text probe was not accepted",
      );
    }
    return { sent: true };
  }

  private receiveTimer: ReturnType<typeof setTimeout> | undefined;
  private receiveStopped = false;

  async startReceive(onRaw?: (raw: WeixinRaw) => Promise<void>, signal?: AbortSignal): Promise<void> {
    this.receiveStopped = false;
    if (this.voiceAbort.signal.aborted) this.voiceAbort = new AbortController();
    void this.resumePendingVoiceClaims();
    const loop = async () => {
      while (!this.receiveStopped && !signal?.aborted) {
        const token = await this.vault.read(this.tokenRef);
        if (!token) throw new PenglaiError("AUTH_EXPIRED", "weixin credential missing");
        if (this.transport instanceof ILinkTransport) this.transport.lastToken = token;
        try {
          const out = await this.transport.getUpdates(this.buf, token, signal);
          this.receiveAttempts = 0;
          this.cursorBlocked = false;
          for (const raw of out.messages) {
            if (onRaw) await onRaw(raw);
            else await this.ingest(raw);
          }
          this.buf = out.buf;
          if (!this.cursorBlocked) {
            this.cursors?.putCursor(this.accountRef, "weixin", this.buf);
          }
        } catch (err) {
          const klass = classifyTransportError(err);
          if (klass === "auth") {
            this.authState = "error";
            this.receiveStopped = true;
            return;
          }
          const wait = backoffMs(this.receiveAttempts, klass);
          this.receiveAttempts += 1;
          await new Promise((resolve) => {
            this.receiveTimer = setTimeout(resolve, Number.isFinite(wait) ? wait : 60_000);
            this.receiveTimer.unref?.();
          });
          continue;
        }
        await new Promise((resolve) => {
          this.receiveTimer = setTimeout(resolve, 1500);
          this.receiveTimer.unref?.();
        });
      }
    };
    void loop();
  }

  stopReceive(): void {
    this.receiveStopped = true;
    if (this.receiveTimer) clearTimeout(this.receiveTimer);
    this.receiveTimer = undefined;
    this.voiceAbort.abort("weixin stopped");
  }

  cancelQr(): void {
    this.lastQrRef = undefined;
    if (this.authState === "waiting" || this.authState === "scanned" || this.authState === "need_verify") {
      this.authState = "idle";
    }
  }

  get hasActiveQr(): boolean {
    return this.lastQrRef !== undefined;
  }

  private buf: string;

  async ingest(raw: WeixinRaw) {
    const parsed = parseInbound(raw, this.accountRef);
    if ("reject" in parsed) {
      return { kind: "rejected" as const, text: parsed.reject };
    }
    if (this.assertAllowlisted(raw.fromUserId) === "allowlist") {
      // A message from an unknown owner must not advance the cursor, or it is
      // silently lost and cannot be replayed after a re-scan. A known owner
      // rejecting an intruder may advance (the rejection is deterministic).
      if (!this.ownerUserId) this.cursorBlocked = true;
      return { kind: "rejected" as const, text: "allowlist" };
    }
    if (raw.contextToken) {
      this.contextByPeer.set(parsed.peerRef, raw.contextToken);
      if (parsed.vendorTarget) this.contextByPeer.set(parsed.vendorTarget, raw.contextToken);
      await this.vault.write(WEIXIN_CONTEXT_CREDENTIAL_REF, raw.contextToken);
    }
    if (parsed.bodyKind === "media") {
      const media = parsed.media;
      const cdn = raw.image ?? raw.file?.media;
      if (!media || !cdn) return { kind: "rejected" as const, text: "media reference missing" };
      const downloader = this.transport.downloadCdn
        ?? ((item: WeixinCdnMedia, signal?: AbortSignal) => downloadAndDecryptWeixinCdn(item, ILINK_CDN_BASE, fetch, signal));
      const bytes = await downloader(cdn);
      const kind = classifyMedia({
        bytes,
        ...(raw.file?.file_name ?? media.filename ? { filename: raw.file?.file_name ?? media.filename } : {}),
        ...(media.mime ? { mime: media.mime } : {}),
      });
      parsed.media = this.mediaStore.put(bytes, {
        kind,
        source: "weixin",
        sourceMessageId: parsed.adapterMessageKey,
        sourceResourceId: media.sourceResourceId,
        mime: kind === "image" ? "image/png" : kind === "pdf" ? "application/pdf" : kind === "office" ? "application/vnd.openxmlformats-officedocument" : "application/octet-stream",
        ...(raw.file?.file_name ? { filename: raw.file.file_name } : {}),
      });
      parsed.text = parsed.text || mediaCaption(parsed.media);
      return this.plane.submitInbound(parsed);
    }
    if (parsed.bodyKind === "voice") {
      if (!raw.voice) return { kind: "rejected" as const, text: "voice media missing" };
      const mediaRefJson = JSON.stringify({ schema: 1, ...raw.voice });
      const claim = await this.plane.claimVoiceInbound(parsed, {
        mediaRefJson,
        durationMs: raw.voice.playtimeMs,
      });
      if (claim.kind !== "voice_claim") return claim;
      if (claim.state === "transcribed" || claim.state === "failed") {
        return { kind: "accepted" as const, text: "duplicate ignored" };
      }
      this.scheduleVoiceClaim(claim, raw.voice);
      return { kind: "accepted" as const, text: "voice claimed" };
    }
    return this.plane.submitInbound(parsed);
  }

  async pumpOutbox(routeId: string, to: string, contextToken?: string): Promise<void> {
    const token = await this.vault.read(this.tokenRef);
    if (this.transport instanceof ILinkTransport) this.transport.lastToken = token;
    for (const item of this.plane.dueOutbox(routeId)) {
      if (!token) {
        this.plane.markSendResult(item.outboxId, "auth");
        this.authState = "error";
        throw new PenglaiError("AUTH_EXPIRED", "weixin credential missing");
      }
      const claimToken = this.plane.markSending(item.outboxId, "weixin");
      if (!claimToken) continue;
      const delivery = this.plane.resolveVoiceDelivery(item.outboxId);
      const currentTarget = delivery.vendorTarget;
      const ctx = contextToken
        ?? this.contextByPeer.get(currentTarget)
        ?? await this.vault.read(WEIXIN_CONTEXT_CREDENTIAL_REF);
      let receipt = this.plane.store.getVoiceDeliveryReceipt(item.outboxId);
      const needsText = delivery.mode === "text" || delivery.mode === "text-and-voice";
      if (needsText && !receipt.textSent) {
        const textResult = await this.transport.send(currentTarget, delivery.finalText, `${item.outboxId}-text`, ctx);
        if (!("ok" in textResult && textResult.ok)) {
          this.plane.markSendResult(item.outboxId, "error" in textResult ? textResult.error : "transient", claimToken);
          continue;
        }
        receipt = this.plane.store.markVoiceDeliveryPart(item.outboxId, "text", this.plane.clock.now());
      }
      if (delivery.mode !== "text" && !receipt.audioSent && !receipt.fallbackUsed) {
        const audioResult = await this.trySendAudio(currentTarget, ctx, delivery);
        if (audioResult.ok) {
          receipt = this.plane.store.markVoiceDeliveryPart(
            item.outboxId,
            "audio",
            this.plane.clock.now(),
            audioResult.digest,
          );
        } else {
          if (!receipt.textSent) {
            const fallback = await this.transport.send(currentTarget, delivery.finalText, `${item.outboxId}-fallback`, ctx);
            if (!("ok" in fallback && fallback.ok)) {
              this.plane.markSendResult(item.outboxId, "error" in fallback ? fallback.error : "transient", claimToken);
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

  private scheduleVoiceClaim(claim: VoiceInboundClaim, ref: WeixinVoiceMediaRef): void {
    if (this.activeVoiceJobs.has(claim.inboundId)) return;
    const task = this.processVoiceClaim(claim, ref).finally(() => {
      this.activeVoiceJobs.delete(claim.inboundId);
    });
    this.activeVoiceJobs.set(claim.inboundId, task);
  }

  private async resumePendingVoiceClaims(): Promise<void> {
    for (const claim of this.plane.pendingVoiceClaims("weixin")) {
      const job = this.plane.store.getVoiceJob(claim.inboundId);
      if (!job) continue;
      try {
        const parsed = JSON.parse(job.mediaRefJson) as { schema?: number } & WeixinVoiceMediaRef;
        if (parsed.schema !== 1 || !parsed.media) throw new Error("invalid Weixin voice job");
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

  private async processVoiceClaim(claim: VoiceInboundClaim, ref: WeixinVoiceMediaRef): Promise<void> {
    if (!this.voice?.asr || !this.transport.downloadVoice) {
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
      const silk = await this.transport.downloadVoice(ref, this.voiceAbort.signal);
      const transcript = await inboundVoiceToText(silk, this.voice.asr, {
        authorized: true,
        claimed: true,
        privateChat: true,
        operationId,
        sampleRate: ref.sampleRate,
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

  private async trySendAudio(
    to: string,
    contextToken: string | undefined,
    delivery: ReturnType<RoutingControlPlane["resolveVoiceDelivery"]>,
  ): Promise<{ ok: true; digest: string } | { ok: false }> {
    if (!this.voice?.tts || !this.transport.sendAudioFile) return { ok: false };
    if (this.voiceAbort.signal.aborted) return { ok: false };
    const cancel = () => {
      void this.voice?.tts?.cancelSynthesis?.(delivery.operationId).catch(() => undefined);
    };
    this.voiceAbort.signal.addEventListener("abort", cancel, { once: true });
    try {
      const generated = await outboundTtsAttachment({
        finalText: delivery.finalText,
        sourceFinalId: delivery.sourceFinalId,
        operationId: delivery.operationId,
        voiceId: delivery.voiceId,
      }, "voice", this.voice.tts);
      if (!generated.audio) return { ok: false };
      if (this.nativeVoiceEnabled && this.transport.sendNativeVoice) {
        try {
          const silk = await encodeWavToWeixinSilk(generated.audio.wav);
          const nativeSent = await this.transport.sendNativeVoice(to, {
            data: silk.data,
            durationMs: silk.durationMs,
            sampleRate: silk.sampleRate,
            clientId: `${delivery.outboxId}-native-voice`,
            ...(contextToken ? { contextToken } : {}),
          });
          if ("ok" in nativeSent && nativeSent.ok) {
            return { ok: true, digest: createHash("sha256").update(silk.data).digest("hex") };
          }
        } catch {
          // The native bubble is capability-probe-only. Any codec/vendor
          // failure falls through to the visible playable FILE contract.
        }
      }
      const attachment = weixinVisibleAudioFallback(generated.audio);
      const sent = await this.transport.sendAudioFile(to, {
        data: attachment.data,
        filename: attachment.filename,
        clientId: `${delivery.outboxId}-audio`,
        ...(contextToken ? { contextToken } : {}),
      });
      return "ok" in sent && sent.ok ? { ok: true, digest: attachment.digest } : { ok: false };
    } catch {
      return { ok: false };
    } finally {
      this.voiceAbort.signal.removeEventListener("abort", cancel);
    }
  }

  health(): { authState: AuthState; hasCredential: boolean } {
    const authState = this.authState === "idle" && this.ownerUserId ? "connected" : this.authState;
    return { authState, hasCredential: authState === "connected" || Boolean(this.ownerUserId) };
  }
}

export {
  ILINK_BASE,
  ILINK_CDN_BASE,
  DEFAULT_ILINK_BOT_TYPE,
  parseOfficialInbound,
  buildSendBody,
  randomWechatUin,
} from "./protocol.js";
export { ILinkClient } from "./ilink.js";
export { isPngDataUrl, renderQrPngDataUrl, renderWeixinQrImage, WEIXIN_QR_PNG_PREFIX } from "./qr-image.js";
export * from "./media.js";
export const ILINK_PATHS = {
  qr: "/ilink/bot/get_bot_qrcode?bot_type=3",
  qrStatus: "/ilink/bot/get_qrcode_status",
  updates: "/ilink/bot/getupdates",
  send: "/ilink/bot/sendmessage",
} as const;
