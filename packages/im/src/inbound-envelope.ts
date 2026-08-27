import { PenglaiError, parseClosedEnum } from "@penglai/contracts";
import type { InboundChannelEvent } from "./channel-adapter.js";
import type { ChannelId } from "./registry.js";

export const INBOUND_CHAT_TYPES = ["private", "group", "thread"] as const;
export type InboundChatType = (typeof INBOUND_CHAT_TYPES)[number];

export function channelConfigAccountId(channel: string): string {
  return `cfg:${channel}`;
}

export function legacyDefaultAccountId(channel: string): string {
  return `${channel}-default`;
}

export function isForbiddenDefaultAccount(channel: string, accountRef: string): boolean {
  return accountRef === legacyDefaultAccountId(channel);
}

export function inboundIdempotencyKey(channel: string, accountRef: string, vendorMessageId: string): string {
  return `${channel}:${accountRef}:${vendorMessageId}`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function parseInboundEnvelope(
  channel: ChannelId,
  msg: Record<string, unknown>,
  hashPeer: (senderId: string, accountRef: string) => string,
): InboundChannelEvent {
  const chatTypeRaw = msg.chatType ?? msg.chat_type;
  if (chatTypeRaw === undefined || chatTypeRaw === null || String(chatTypeRaw).trim() === "") {
    throw new PenglaiError("INVALID_INPUT", "UNKNOWN_CHAT_TYPE");
  }
  const chatType = parseClosedEnum(String(chatTypeRaw), INBOUND_CHAT_TYPES, "CHAT_TYPE", "INVALID_INPUT");
  if (chatType !== "private") {
    throw new PenglaiError("INVALID_INPUT", "CHAT_TYPE_UNSUPPORTED");
  }
  const tenant = str(msg.tenant);
  const server = str(msg.server);
  const thread = str(msg.thread ?? msg.thread_ts);
  if (tenant || server || thread) {
    throw new PenglaiError("INVALID_INPUT", "CHAT_SCOPE_UNSUPPORTED");
  }
  const accountRef = str(msg.accountRef || msg.botId);
  if (!accountRef) throw new PenglaiError("INVALID_INPUT", "ACCOUNT_REF_REQUIRED");
  if (isForbiddenDefaultAccount(channel, accountRef)) {
    throw new PenglaiError("INVALID_INPUT", "LEGACY_DEFAULT_ACCOUNT");
  }
  const vendorMessageId = str(msg.vendorMessageId || msg.messageId);
  const senderId = str(msg.senderId);
  const vendorTarget = str(msg.vendorTarget || msg.channelId || msg.chatId || msg.conversationId);
  if (!vendorMessageId || !senderId || !vendorTarget) {
    throw new PenglaiError("INVALID_INPUT", "INBOUND_ENVELOPE_INCOMPLETE");
  }
  const text = str(msg.text);
  const vendorTimeRaw = msg.vendorTime ?? msg.date;
  const vendorTime =
    typeof vendorTimeRaw === "number" && Number.isFinite(vendorTimeRaw)
      ? vendorTimeRaw
      : typeof vendorTimeRaw === "string" && /^\d+$/.test(vendorTimeRaw)
        ? Number(vendorTimeRaw)
        : undefined;
  return {
    channel,
    botId: accountRef,
    accountRef,
    vendorMessageId,
    vendorTarget,
    senderId,
    peerRef: hashPeer(senderId, accountRef),
    chatType: "private",
    provenPrivate: true,
    idempotencyKey: inboundIdempotencyKey(channel, accountRef, vendorMessageId),
    ...(vendorTime !== undefined ? { vendorTime } : {}),
    ...(text ? { text } : {}),
  };
}

export function tryParseInboundEnvelope(
  channel: ChannelId,
  msg: Record<string, unknown>,
  hashPeer: (senderId: string, accountRef: string) => string,
): InboundChannelEvent | { reject: string } {
  try {
    return parseInboundEnvelope(channel, msg, hashPeer);
  } catch (error) {
    if (error instanceof PenglaiError) return { reject: error.message };
    throw error;
  }
}
