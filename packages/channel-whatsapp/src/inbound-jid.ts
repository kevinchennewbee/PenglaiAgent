import {
  isHostedLidUser,
  isHostedPnUser,
  isJidBot,
  isJidBroadcast,
  isJidGroup,
  isJidMetaAI,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import type { WhatsAppInbound } from "./index.js";

/** Pinned Baileys documents LID private users via `isLidUser` (`@lid`). */
export const PINNED_BAILEYS = "7.0.0-rc14";
export const LID_PRIVATE_SUPPORTED = true;

export type WhatsAppJidKind = "private" | "group" | "broadcast" | "status" | "newsletter" | "unknown";

export function classifyWhatsAppPeerJid(jid: string | undefined): { kind: WhatsAppJidKind; normalized: string } {
  const decoded = jidDecode(jid);
  if (!jid || !decoded?.user || !decoded.server) return { kind: "unknown", normalized: "" };
  const normalized = jidNormalizedUser(jid);
  if (!normalized) return { kind: "unknown", normalized: "" };
  if (isJidStatusBroadcast(jid) || isJidStatusBroadcast(normalized)) return { kind: "status", normalized };
  if (isJidNewsletter(jid) || isJidNewsletter(normalized)) return { kind: "newsletter", normalized };
  if (isJidBroadcast(jid) || isJidBroadcast(normalized)) return { kind: "broadcast", normalized };
  if (isJidGroup(jid) || isJidGroup(normalized)) return { kind: "group", normalized };
  if (
    isJidMetaAI(jid) ||
    isJidBot(jid) ||
    isHostedPnUser(jid) ||
    isHostedLidUser(jid) ||
    isJidMetaAI(normalized) ||
    isJidBot(normalized) ||
    isHostedPnUser(normalized) ||
    isHostedLidUser(normalized)
  ) {
    return { kind: "unknown", normalized };
  }
  if (isPnUser(normalized) || isLidUser(normalized)) return { kind: "private", normalized };
  return { kind: "unknown", normalized };
}

export function selfAccountJid(creds: unknown): string | undefined {
  const rec = creds && typeof creds === "object" ? (creds as Record<string, unknown>) : undefined;
  const me = rec?.me && typeof rec.me === "object" ? (rec.me as Record<string, unknown>) : undefined;
  const id = typeof me?.id === "string" ? me.id.trim() : "";
  if (!id) return undefined;
  const classified = classifyWhatsAppPeerJid(id);
  if (classified.kind !== "private") return undefined;
  return classified.normalized;
}

function inboundText(message: {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  documentMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  reactionMessage?: { text?: string };
} | undefined): string {
  return String(
    message?.conversation ||
      message?.extendedTextMessage?.text ||
      message?.imageMessage?.caption ||
      message?.documentMessage?.caption ||
      message?.videoMessage?.caption ||
      "",
  ).trim();
}

export function extractWhatsAppInbound(input: {
  message: {
    key?: { id?: string; fromMe?: boolean; remoteJid?: string };
    message?: Parameters<typeof inboundText>[0];
  };
  accountJid: string | undefined;
  isEcho: (id: string) => boolean;
}): WhatsAppInbound | undefined {
  const account = classifyWhatsAppPeerJid(input.accountJid);
  if (!input.accountJid || account.kind !== "private") return undefined;
  const key = input.message.key;
  if (key?.fromMe) return undefined;
  const id = String(key?.id ?? "").trim();
  if (!id || input.isEcho(id)) return undefined;
  const peer = classifyWhatsAppPeerJid(key?.remoteJid);
  if (peer.kind !== "private") return undefined;
  const text = inboundText(input.message.message);
  if (!text) return undefined;
  return {
    messageId: id,
    senderId: peer.normalized,
    text,
    vendorTarget: peer.normalized,
    chatType: "private",
    accountRef: account.normalized,
  };
}

export function ingestBaileysUpsert(
  bundle: { messages?: Array<Parameters<typeof extractWhatsAppInbound>[0]["message"]> } | undefined,
  opts: { accountJid: string | undefined; isEcho: (id: string) => boolean; onMessage: (msg: WhatsAppInbound) => void },
): void {
  for (const message of bundle?.messages ?? []) {
    const inbound = extractWhatsAppInbound({
      message,
      accountJid: opts.accountJid,
      isEcho: opts.isEcho,
    });
    if (inbound) opts.onMessage(inbound);
  }
}
