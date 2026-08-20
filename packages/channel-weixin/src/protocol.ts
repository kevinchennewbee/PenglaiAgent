import { createHash } from "node:crypto";
import { isRecord, type InboundEnvelope } from "@penglai/contracts";

/** Official iLink bot surface. Isolated rewrite; not an OpenClaw plugin. */
export const ILINK_BASE = "https://ilinkai.weixin.qq.com";
export const ILINK_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
export const DEFAULT_ILINK_BOT_TYPE = "3";
export const ILINK_APP_ID = "bot";
export const ILINK_BOT_AGENT = "Penglai/0.5.0";
/** Exact Tencent channel package pinned by docs/compatibility/WEIXIN_R2.md. */
export const ILINK_CHANNEL_VERSION = "2.4.6";
/** 0x00MMNNPP, matching Tencent's buildClientVersion("2.4.6"). */
export const ILINK_APP_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
/** Exact April 2026 Hermes native-voice request identity, probe-only. */
export const ILINK_LEGACY_VOICE_CHANNEL_VERSION = "2.2.0";
export const ILINK_LEGACY_VOICE_CLIENT_VERSION = (2 << 16) | (2 << 8);
export const QR_TTL_MS = 5 * 60_000;
export const STATUS_POLL_TIMEOUT_MS = 35_000;
export const QR_ORIGIN = ILINK_BASE;
export const QR_ENDPOINT = "/ilink/bot/get_bot_qrcode";
export const QR_STATUS_ENDPOINT = "/ilink/bot/get_qrcode_status";
export const GET_UPDATES_ENDPOINT = "/ilink/bot/getupdates";
export const SEND_ENDPOINT = "/ilink/bot/sendmessage";
export const ALLOWED_REDIRECT_HOSTS = ["ilinkai.weixin.qq.com"] as const;

export function randomWechatUin(randomBytes: (n: number) => Uint8Array = (n) => {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}): string {
  const bytes = randomBytes(4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
  const n = view.getUint32(0, false);
  return Buffer.from(String(n), "utf8").toString("base64");
}

export function buildIlinkBaseInfo(): { channel_version: string; bot_agent: string } {
  return { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT };
}

export function assertRedirectBase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("redirect base is not a URL");
  }
  if (parsed.protocol !== "https:") throw new Error("redirect base must be https");
  if (!(ALLOWED_REDIRECT_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new Error("redirect host not allowlisted");
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export const MessageType = { NONE: 0, USER: 1, BOT: 2 } as const;
export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface WeixinCdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface WeixinVoiceItem {
  media?: WeixinCdnMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
  len?: string;
}

export interface WeixinFileItem {
  media?: WeixinCdnMedia;
  file_name?: string;
  len?: string;
}

export type OfficialQrStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

export interface OfficialWeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  group_id?: string;
  message_type?: number;
  item_list?: Array<{
    type?: number;
    msg_id?: string;
    text_item?: { text?: string };
    voice_item?: WeixinVoiceItem;
    file_item?: WeixinFileItem;
  }>;
  context_token?: string;
}

export function buildFileSendBody(input: {
  to: string;
  filename: string;
  bytes: number;
  clientId: string;
  downloadEncryptedQueryParam: string;
  aesKeyHex: string;
  contextToken?: string;
}): Record<string, unknown> {
  return {
    msg: {
      from_user_id: "",
      to_user_id: input.to,
      client_id: input.clientId,
      message_type: MessageType.BOT,
      message_state: 2,
      item_list: [{
        type: MessageItemType.FILE,
        file_item: {
          media: {
            encrypt_query_param: input.downloadEncryptedQueryParam,
            aes_key: Buffer.from(input.aesKeyHex, "ascii").toString("base64"),
            encrypt_type: 1,
          },
          file_name: input.filename,
          len: String(input.bytes),
        },
      }],
      ...(input.contextToken ? { context_token: input.contextToken } : {}),
    },
    base_info: buildIlinkBaseInfo(),
  };
}

export function buildVoiceSendBody(input: {
  to: string;
  bytes: number;
  durationMs: number;
  sampleRate: number;
  clientId: string;
  downloadEncryptedQueryParam: string;
  aesKeyHex: string;
  contextToken?: string;
}): Record<string, unknown> {
  return {
    msg: {
      from_user_id: "",
      to_user_id: input.to,
      client_id: input.clientId,
      message_type: MessageType.BOT,
      message_state: 2,
      item_list: [{
        type: MessageItemType.VOICE,
        voice_item: {
          media: {
            encrypt_query_param: input.downloadEncryptedQueryParam,
            aes_key: Buffer.from(input.aesKeyHex, "ascii").toString("base64"),
            encrypt_type: 1,
          },
          encode_type: 6,
          bits_per_sample: 16,
          sample_rate: input.sampleRate,
          playtime: input.durationMs,
          len: String(input.bytes),
        },
      }],
      ...(input.contextToken ? { context_token: input.contextToken } : {}),
    },
    base_info: buildIlinkBaseInfo(),
  };
}

/**
 * Historical Hermes shape that was reported visible before the current iLink
 * VOICE regression: Tencent SILK media plus playtime=0, with no newer voice
 * metadata. This is only exercised behind the owner-visible capability probe.
 */
export function buildLegacyVisibleVoiceSendBody(input: {
  to: string;
  clientId: string;
  downloadEncryptedQueryParam: string;
  aesKeyHex: string;
  contextToken?: string;
}): Record<string, unknown> {
  return {
    msg: {
      from_user_id: "",
      to_user_id: input.to,
      client_id: input.clientId,
      message_type: MessageType.BOT,
      message_state: 2,
      item_list: [{
        type: MessageItemType.VOICE,
        voice_item: {
          media: {
            encrypt_query_param: input.downloadEncryptedQueryParam,
            aes_key: Buffer.from(input.aesKeyHex, "ascii").toString("base64"),
            encrypt_type: 1,
          },
          playtime: 0,
        },
      }],
      ...(input.contextToken ? { context_token: input.contextToken } : {}),
    },
    base_info: { channel_version: ILINK_LEGACY_VOICE_CHANNEL_VERSION },
  };
}

export function parseOfficialInbound(
  msg: OfficialWeixinMessage,
  accountRef: string,
): InboundEnvelope | { reject: "group" | "media" | "non_user" } {
  if (msg.group_id) return { reject: "group" };
  if (msg.message_type !== undefined && msg.message_type !== MessageType.USER) {
    return { reject: "non_user" };
  }
  const items = msg.item_list ?? [];
  const voiceOnly = items.length > 0 && items.every((it) => it.type === MessageItemType.VOICE);
  if (items.some((it) => it.type !== undefined && it.type !== MessageItemType.TEXT && it.type !== MessageItemType.VOICE)) {
    return { reject: "media" };
  }
  if (items.some((it) => it.type === MessageItemType.VOICE) && !voiceOnly) {
    return { reject: "media" };
  }
  const text = items.map((it) => it.text_item?.text ?? "").join("");
  const msgId =
    items.find((it) => it.msg_id)?.msg_id ??
    (msg.message_id !== undefined ? String(msg.message_id) : undefined) ??
    createHash("sha256").update(JSON.stringify({ accountRef, text, seq: msg.seq ?? 0 })).digest("hex");
  const from = msg.from_user_id ?? "";
  return {
    adapter: "weixin",
    adapterMessageKey: msgId,
    accountRef,
    peerRef: createHash("sha256").update(from).digest("hex").slice(0, 24),
    vendorTarget: from,
    chatKind: "private",
    bodyKind: voiceOnly ? "voice" : "text",
    text,
    receivedAt: Date.now(),
  };
}

export function buildSendBody(input: {
  to: string;
  text: string;
  clientId: string;
  contextToken?: string;
}): Record<string, unknown> {
  return {
    msg: {
      from_user_id: "",
      to_user_id: input.to,
      client_id: input.clientId,
      message_type: MessageType.BOT,
      message_state: 2,
      item_list: input.text ? [{ type: MessageItemType.TEXT, text_item: { text: input.text } }] : [],
      ...(input.contextToken ? { context_token: input.contextToken } : {}),
    },
    base_info: buildIlinkBaseInfo(),
  };
}

export function mapQrStatus(status: string): OfficialQrStatus | "error" {
  const known: OfficialQrStatus[] = [
    "wait",
    "scaned",
    "confirmed",
    "expired",
    "scaned_but_redirect",
    "need_verifycode",
    "verify_code_blocked",
    "binded_redirect",
  ];
  return (known as string[]).includes(status) ? (status as OfficialQrStatus) : "error";
}

export function asOfficialMessage(value: unknown): OfficialWeixinMessage | undefined {
  if (!isRecord(value)) return undefined;
  return value as OfficialWeixinMessage;
}
