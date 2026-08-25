import { PenglaiError } from "@penglai/contracts";
import type { WhatsAppInbound, WhatsAppLinkSocket, WhatsAppSessionStore } from "./index.js";

/**
 * Production Baileys device-link. Tests inject startLink and never import this.
 */
export async function startBaileysLink(
  sessions: WhatsAppSessionStore,
  opts: {
    onQr: (ref: string) => void;
    onOpen: () => void;
    onMessage: (msg: WhatsAppInbound) => void;
  },
): Promise<WhatsAppLinkSocket> {
  let baileys: {
    default?: Function;
    makeWASocket?: Function;
    DisconnectReason?: { loggedOut?: number };
    initAuthCreds?: Function;
  };
  try {
    baileys = (await import("@whiskeysockets/baileys")) as typeof baileys;
  } catch {
    throw new PenglaiError("DSH_UNAVAILABLE", "WHATSAPP_BAILEYS_MISSING");
  }
  const makeWASocket = baileys.makeWASocket ?? baileys.default;
  if (typeof makeWASocket !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "WHATSAPP_BAILEYS_MISSING");
  }
  const existing = await sessions.read();
  const creds = existing
    ? JSON.parse(Buffer.from(existing).toString("utf8"))
    : typeof baileys.initAuthCreds === "function"
      ? baileys.initAuthCreds()
      : {};
  const sock = makeWASocket({
    auth: { creds, keys: { get: async () => null, set: async () => undefined } },
    printQRInTerminal: false,
  }) as {
    ev: { on(event: string, handler: (value: unknown) => void): void };
    sendMessage(jid: string, content: { text: string }, extra?: { messageId?: string }): Promise<unknown>;
    logout(): Promise<void>;
  };
  sock.ev.on("connection.update", (update) => {
    const rec = (update ?? {}) as { qr?: string; connection?: string };
    if (rec.qr) opts.onQr(rec.qr);
    if (rec.connection === "open") opts.onOpen();
  });
  sock.ev.on("creds.update", (next) => {
    void sessions.write(Buffer.from(JSON.stringify(next)));
  });
  sock.ev.on("messages.upsert", (bundle) => {
    const rec = (bundle ?? {}) as { messages?: Array<{ key?: { id?: string; fromMe?: boolean; remoteJid?: string }; message?: { conversation?: string } }> };
    for (const message of rec.messages ?? []) {
      if (message.key?.fromMe) continue;
      const text = String(message.message?.conversation ?? "").trim();
      const id = String(message.key?.id ?? "").trim();
      const from = String(message.key?.remoteJid ?? "").trim();
      if (!text || !id || !from) continue;
      opts.onMessage({ messageId: id, senderId: from, text });
    }
  });
  return {
    async send(jid, text, id) {
      await sock.sendMessage(jid, { text }, { messageId: id });
    },
    async logout() {
      await sock.logout();
    },
  };
}
