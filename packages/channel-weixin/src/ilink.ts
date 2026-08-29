import {
  BOUNDED_HTTP_MAX_BYTES,
  PenglaiError,
  isRecord,
  jsonMimeAllowed,
  readBoundedResponse,
} from "@penglai/contracts";
import {
  DEFAULT_ILINK_BOT_TYPE,
  ILINK_APP_ID,
  ILINK_APP_CLIENT_VERSION,
  ILINK_BASE,
  ILINK_CDN_BASE,
  ILINK_LEGACY_VOICE_CHANNEL_VERSION,
  ILINK_LEGACY_VOICE_CLIENT_VERSION,
  QR_TTL_MS,
  assertRedirectBase,
  buildIlinkBaseInfo,
  buildFileSendBody,
  buildLegacyVisibleVoiceSendBody,
  mapQrStatus,
  randomWechatUin,
  type OfficialQrStatus,
  type OfficialWeixinMessage,
} from "./protocol.js";
import {
  downloadAndDecryptWeixinVoice,
  uploadWeixinAudioFile,
  uploadWeixinVoice,
  type WeixinVoiceMediaRef,
} from "./cdn.js";
import { renderWeixinQrImage } from "./qr-image.js";

export interface ILinkFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    headers?: { get(name: string): string | null };
    body?: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }>;
}

export const WEIXIN_ILINK_PHASES = [
  "qr-start",
  "qr-poll",
  "updates",
  "upload-url",
  "send-message",
  "typing-config",
  "typing-send",
  "unknown",
] as const;

export type WeixinIlinkPhase = (typeof WEIXIN_ILINK_PHASES)[number];
export type WeixinIlinkFailureKind = "auth" | "rate" | "protocol" | "delivery";

export interface WeixinIlinkResponseObservation {
  phase: WeixinIlinkPhase;
  httpStatus: number;
  contentType: string;
}

export class WeixinIlinkResponseError extends PenglaiError {
  constructor(
    readonly failureKind: WeixinIlinkFailureKind,
    errorClass: "AUTH_EXPIRED" | "DELIVERY_TRANSIENT" | "DELIVERY_PERMANENT" | "SECURITY_POLICY",
    code: string,
    readonly observation: WeixinIlinkResponseObservation,
  ) {
    super(errorClass, code);
    this.name = "WeixinIlinkResponseError";
  }
}

export function weixinIlinkResponseObservation(
  error: unknown,
): WeixinIlinkResponseObservation | undefined {
  if (!(error instanceof WeixinIlinkResponseError)) return undefined;
  return parseWeixinIlinkResponseObservation(error.observation);
}

export function parseWeixinIlinkResponseObservation(
  value: unknown,
): WeixinIlinkResponseObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { phase, httpStatus, contentType } = value as Record<string, unknown>;
  if (
    typeof phase !== "string" ||
    !(WEIXIN_ILINK_PHASES as readonly string[]).includes(phase) ||
    typeof httpStatus !== "number" ||
    !Number.isSafeInteger(httpStatus) ||
    httpStatus < 0 ||
    httpStatus > 599 ||
    !safeObservedContentType(contentType)
  ) {
    return undefined;
  }
  return {
    phase: phase as WeixinIlinkPhase,
    httpStatus,
    contentType,
  };
}

function ilinkPhase(url: string): WeixinIlinkPhase {
  let leaf = "";
  try {
    leaf = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "unknown";
  }
  return {
    get_bot_qrcode: "qr-start",
    get_qrcode_status: "qr-poll",
    getupdates: "updates",
    getuploadurl: "upload-url",
    sendmessage: "send-message",
    getconfig: "typing-config",
    sendtyping: "typing-send",
  }[leaf] as WeixinIlinkPhase | undefined ?? "unknown";
}

function safeObservedContentType(value: unknown): value is string {
  return (
    value === "missing" ||
    value === "invalid" ||
    (typeof value === "string" &&
      /^[a-z0-9!#$&^_.+-]{1,63}\/[a-z0-9!#$&^_.+-]{1,63}$/.test(value))
  );
}

function safeContentType(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "missing";
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType.length <= 127 &&
    /^[a-z0-9!#$&^_.+-]{1,63}\/[a-z0-9!#$&^_.+-]{1,63}$/.test(mediaType)
    ? mediaType
    : "invalid";
}

function responseObservation(
  url: string,
  response: { status: number; headers?: { get(name: string): string | null } },
): WeixinIlinkResponseObservation {
  let contentType: unknown = null;
  try {
    contentType = response.headers?.get("content-type") ?? null;
  } catch {
    contentType = null;
  }
  return {
    phase: ilinkPhase(url),
    httpStatus:
      Number.isSafeInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status
        : 0,
    contentType: safeContentType(contentType),
  };
}

function boundedFailureKind(code: string): WeixinIlinkFailureKind {
  return [
    "BOUNDED_HTTP_MIME",
    "BOUNDED_HTTP_JSON",
    "BOUNDED_HTTP_EMPTY",
    "BOUNDED_HTTP_TOO_LARGE",
    "BOUNDED_HTTP_DECLARED_LENGTH",
  ].includes(code)
    ? "protocol"
    : "delivery";
}

export interface QrStart {
  qrRef: string;
  qrImageRef: string;
  expiresAt: number;
}

export interface QrPoll {
  status: OfficialQrStatus | "error";
  tokenRef?: string;
  accountRef?: string;
  scannerUserId?: string;
  needsVerify: boolean;
}

function headers(token?: string, clientVersion = ILINK_APP_CLIENT_VERSION): Record<string, string> {
  const hdrs: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(clientVersion),
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (token) hdrs.Authorization = `Bearer ${token}`;
  return hdrs;
}

export class ILinkClient {
  constructor(
    private readonly fetchImpl: ILinkFetch,
    private base = ILINK_BASE,
    private readonly mediaFetch: typeof fetch = fetch,
    private readonly localTokenList: string[] = [],
    private readonly cdnBase = ILINK_CDN_BASE,
  ) {}

  applyRedirectBase(url: string): string {
    this.base = assertRedirectBase(url);
    return this.base;
  }

  async getQr(botType = DEFAULT_ILINK_BOT_TYPE): Promise<QrStart> {
    const url = `${this.base}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`;
    const raw = await this.post(url, { local_token_list: this.localTokenList }, undefined);
    const qrRef = String(raw.qrcode ?? "");
    if (!qrRef) throw new PenglaiError("AUTH_EXPIRED", "qr missing");
    const payload = String(raw.qrcode_img_content ?? "");
    if (!payload) throw new PenglaiError("INVALID_INPUT", "weixin qr image missing");
    return {
      qrRef,
      qrImageRef: await renderWeixinQrImage(payload),
      expiresAt: Date.now() + QR_TTL_MS,
    };
  }

  async pollQr(qrRef: string, verifyCode?: string): Promise<QrPoll> {
    let endpoint = `${this.base}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrRef)}`;
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    const raw = await this.get(endpoint);
    const status = mapQrStatus(String(raw.status ?? "error"));
    if (status === "scaned_but_redirect" && typeof raw.baseurl === "string") {
      this.applyRedirectBase(raw.baseurl);
    }
    return {
      status,
      ...(typeof raw.bot_token === "string" ? { tokenRef: raw.bot_token } : {}),
      ...(typeof raw.ilink_bot_id === "string" ? { accountRef: raw.ilink_bot_id } : {}),
      ...(typeof raw.scan_user_id === "string"
        ? { scannerUserId: raw.scan_user_id }
        : typeof raw.ilink_user_id === "string"
          ? { scannerUserId: raw.ilink_user_id }
          : {}),
      needsVerify: status === "need_verifycode" || status === "verify_code_blocked",
    };
  }

  async getUpdates(
    token: string,
    buf: string,
    signal?: AbortSignal,
  ): Promise<{ buf: string; messages: OfficialWeixinMessage[]; errcode?: number; baseurl?: string }> {
    const raw = await this.post(
      `${this.base}/ilink/bot/getupdates`,
      { get_updates_buf: buf },
      token,
      signal,
    );
    const errcode = typeof raw.errcode === "number" ? raw.errcode : undefined;
    if (errcode === -14) throw new PenglaiError("AUTH_EXPIRED", "session timeout");
    const messages = Array.isArray(raw.msgs)
      ? raw.msgs.filter((m): m is OfficialWeixinMessage => isRecord(m))
      : [];
    if (typeof raw.baseurl === "string") this.applyRedirectBase(raw.baseurl);
    return {
      buf: String(raw.get_updates_buf ?? buf),
      messages,
      ...(errcode !== undefined ? { errcode } : {}),
      ...(typeof raw.baseurl === "string" ? { baseurl: raw.baseurl } : {}),
    };
  }

  downloadVoice(ref: WeixinVoiceMediaRef, signal?: AbortSignal): Promise<Buffer> {
    return downloadAndDecryptWeixinVoice(ref, this.cdnBase, this.mediaFetch, signal);
  }

  async sendAudioFile(
    token: string,
    input: {
      to: string;
      data: Buffer;
      filename: string;
      clientId: string;
      contextToken?: string;
    },
  ): Promise<{ ok: true } | { error: "transient" | "permanent" | "auth" }> {
    try {
      const uploaded = await uploadWeixinAudioFile({
        data: input.data,
        to: input.to,
        base: this.cdnBase,
        getUploadUrl: (request) => this.post(`${this.base}/ilink/bot/getuploadurl`, request, token),
      }, this.mediaFetch);
      return this.send(token, buildFileSendBody({
        to: input.to,
        filename: input.filename,
        bytes: uploaded.bytes,
        clientId: input.clientId,
        downloadEncryptedQueryParam: uploaded.downloadEncryptedQueryParam,
        aesKeyHex: uploaded.aesKeyHex,
        ...(input.contextToken ? { contextToken: input.contextToken } : {}),
      }));
    } catch (err) {
      if (err instanceof PenglaiError && err.errorClass === "AUTH_EXPIRED") return { error: "auth" };
      if (err instanceof PenglaiError && err.errorClass === "INVALID_INPUT") return { error: "permanent" };
      return { error: "transient" };
    }
  }

  async sendNativeVoice(
    token: string,
    input: {
      to: string;
      data: Buffer;
      durationMs: number;
      sampleRate: number;
      clientId: string;
      contextToken?: string;
    },
  ): Promise<{
    ok: true;
  } | {
    error: "transient" | "permanent" | "auth";
    diagnostic?: string;
  }> {
    try {
      const legacyVoice = {
        clientVersion: ILINK_LEGACY_VOICE_CLIENT_VERSION,
        channelVersion: ILINK_LEGACY_VOICE_CHANNEL_VERSION,
      };
      const uploaded = await uploadWeixinVoice({
        data: input.data,
        to: input.to,
        base: this.cdnBase,
        getUploadUrl: (request) => this.post(
          `${this.base}/ilink/bot/getuploadurl`,
          request,
          token,
          undefined,
          legacyVoice,
        ),
      }, this.mediaFetch);
      return this.send(token, buildLegacyVisibleVoiceSendBody({
        to: input.to,
        clientId: input.clientId,
        downloadEncryptedQueryParam: uploaded.downloadEncryptedQueryParam,
        aesKeyHex: uploaded.aesKeyHex,
        ...(input.contextToken ? { contextToken: input.contextToken } : {}),
      }), legacyVoice);
    } catch (err) {
      if (err instanceof PenglaiError && err.errorClass === "AUTH_EXPIRED") {
        return { error: "auth", diagnostic: err.message };
      }
      if (err instanceof PenglaiError && (err.errorClass === "INVALID_INPUT" || err.errorClass === "SECURITY_POLICY")) {
        return { error: "permanent", diagnostic: err.message };
      }
      return {
        error: "transient",
        ...(err instanceof PenglaiError ? { diagnostic: err.message } : { diagnostic: "native-voice-unknown" }),
      };
    }
  }

  async send(
    token: string,
    body: Record<string, unknown>,
    compatibility?: { clientVersion: number; channelVersion: string },
  ): Promise<{
    ok: true;
  } | {
    error: "transient" | "permanent" | "auth";
    diagnostic?: string;
  }> {
    try {
      const raw = await this.post(`${this.base}/ilink/bot/sendmessage`, body, token, undefined, compatibility);
      const code = typeof raw.ret === "number" && raw.ret !== 0
        ? raw.ret
        : typeof raw.errcode === "number" && raw.errcode !== 0
          ? raw.errcode
          : 0;
      if (code !== 0) {
        if (code === -14) return { error: "auth", diagnostic: `sendmessage-code-${code}` };
        return { error: "permanent", diagnostic: `sendmessage-code-${code}` };
      }
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof PenglaiError && err.errorClass === "AUTH_EXPIRED") return { error: "auth" };
      if (err instanceof PenglaiError && err.errorClass === "DELIVERY_TRANSIENT") return { error: "transient" };
      return { error: "transient" };
    }
  }

  async getTypingTicket(token: string, toUserId: string, contextToken?: string): Promise<string | undefined> {
    try {
      const raw = await this.post(`${this.base}/ilink/bot/getconfig`, {
        ilink_user_id: toUserId,
        ...(contextToken ? { context_token: contextToken } : {}),
      }, token, AbortSignal.timeout(8_000));
      const ticket = typeof raw.typing_ticket === "string" ? raw.typing_ticket.trim() : "";
      return ticket || undefined;
    } catch {
      return undefined;
    }
  }

  async sendTyping(token: string, toUserId: string, typingTicket: string, status: 1 | 2): Promise<boolean> {
    try {
      const raw = await this.post(`${this.base}/ilink/bot/sendtyping`, {
        ilink_user_id: toUserId,
        typing_ticket: typingTicket,
        status,
      }, token, AbortSignal.timeout(8_000));
      const code = typeof raw.ret === "number" ? raw.ret : 0;
      return code === 0;
    } catch {
      return false;
    }
  }

  private async get(url: string): Promise<Record<string, unknown>> {
    return this.request(url, { method: "GET", headers: headers() });
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    token?: string,
    signal?: AbortSignal,
    compatibility?: { clientVersion: number; channelVersion: string },
  ): Promise<Record<string, unknown>> {
    const init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } = {
      method: "POST",
      headers: headers(token, compatibility?.clientVersion),
      body: JSON.stringify({
        ...body,
        base_info: compatibility
          ? { channel_version: compatibility.channelVersion }
          : buildIlinkBaseInfo(),
      }),
    };
    if (signal) init.signal = signal;
    return this.request(url, init);
  }

  private async request(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    let res: { ok: boolean; status: number; text(): Promise<string> };
    try {
      res = await this.fetchImpl(url, init);
    } catch {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ilink network");
    }
    const observation = responseObservation(url, res);
    let text: string;
    try {
      const bounded = await readBoundedResponse({
        response: res,
        maxBytes: BOUNDED_HTTP_MAX_BYTES.weixinIlink,
        category: "weixin-ilink",
        timeoutMs: 30_000,
        mimeAllowed: jsonMimeAllowed,
        ...(init.signal ? { signal: init.signal } : {}),
      });
      text = bounded.bytes.toString("utf8");
    } catch (error) {
      if (error instanceof PenglaiError) {
        throw new WeixinIlinkResponseError(
          boundedFailureKind(error.message),
          error.errorClass === "SECURITY_POLICY" ? "SECURITY_POLICY" : "DELIVERY_TRANSIENT",
          error.message,
          observation,
        );
      }
      throw new WeixinIlinkResponseError(
        "delivery",
        "DELIVERY_TRANSIENT",
        "ILINK_RESPONSE_READ",
        observation,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new WeixinIlinkResponseError(
        "auth",
        "AUTH_EXPIRED",
        "ILINK_HTTP_AUTH",
        observation,
      );
    }
    if (!res.ok) {
      throw new WeixinIlinkResponseError(
        res.status === 429 ? "rate" : "delivery",
        res.status === 429 || res.status >= 500
          ? "DELIVERY_TRANSIENT"
          : "DELIVERY_PERMANENT",
        "ILINK_HTTP_STATUS",
        observation,
      );
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        throw new WeixinIlinkResponseError(
          "protocol",
          "DELIVERY_TRANSIENT",
          "ILINK_JSON_SHAPE",
          observation,
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof WeixinIlinkResponseError) throw error;
      throw new WeixinIlinkResponseError(
        "protocol",
        "DELIVERY_TRANSIENT",
        "BOUNDED_HTTP_JSON",
        observation,
      );
    }
  }
}
