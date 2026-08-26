import { PenglaiError } from "@penglai/contracts";
import type { WhatsAppInbound, WhatsAppLinkSocket, WhatsAppSessionStore } from "./index.js";
import { ingestBaileysUpsert, selfAccountJid } from "./inbound-jid.js";

type SignalKeyBag = Record<string, Record<string, unknown>>;

interface PersistedAuth {
  creds: unknown;
  keys: SignalKeyBag;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/**
 * Production Baileys device-link. Tests inject startLink and never import this.
 * Creds and Signal keys both persist through EncryptedWhatsAppSessionStore.
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
    initAuthCreds?: Function;
    BufferJSON?: {
      replacer?: (this: unknown, key: string, value: unknown) => unknown;
      reviver?: (this: unknown, key: string, value: unknown) => unknown;
    };
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
  const stringify = (value: unknown) =>
    baileys.BufferJSON?.replacer ? JSON.stringify(value, baileys.BufferJSON.replacer) : JSON.stringify(value);
  const parse = (raw: string): unknown =>
    baileys.BufferJSON?.reviver ? JSON.parse(raw, baileys.BufferJSON.reviver) : JSON.parse(raw);

  const existing = await sessions.read();
  let creds: unknown = typeof baileys.initAuthCreds === "function" ? baileys.initAuthCreds() : {};
  let keys: SignalKeyBag = {};
  if (existing) {
    try {
      const parsed = parse(Buffer.from(existing).toString("utf8"));
      const rec = asRecord(parsed);
      if (rec && "creds" in rec) {
        creds = rec.creds;
        keys = (asRecord(rec.keys) as SignalKeyBag | undefined) ?? {};
      } else {
        creds = parsed;
      }
    } catch {
      /* start a fresh pairing if the encrypted blob is not auth JSON */
    }
  }

  const persist = async () => {
    const blob: PersistedAuth = { creds, keys };
    await sessions.write(Buffer.from(stringify(blob)));
  };

  const keyStore = {
    async get(type: string, ids: string[]) {
      const data: Record<string, unknown> = {};
      const bag = keys[type] ?? {};
      for (const id of ids) {
        if (id in bag) data[id] = bag[id];
      }
      return data;
    },
    async set(data: SignalKeyBag) {
      for (const [type, rows] of Object.entries(data ?? {})) {
        keys[type] = { ...(keys[type] ?? {}), ...rows };
      }
      await persist();
    },
  };

  const sock = makeWASocket({
    auth: { creds, keys: keyStore },
    printQRInTerminal: false,
  }) as {
    ev: { on(event: string, handler: (value: unknown) => void): void };
    sendMessage(jid: string, content: { text?: string; react?: { text: string; key: { id: string; remoteJid: string } } }, extra?: { messageId?: string }): Promise<unknown>;
    logout(): Promise<void>;
    end?: (error: unknown) => void;
    ws?: { close(): void };
  };
  sock.ev.on("connection.update", (update) => {
    const rec = (update ?? {}) as { qr?: string; connection?: string };
    if (rec.qr) opts.onQr(rec.qr);
    if (rec.connection === "open") opts.onOpen();
  });
  sock.ev.on("creds.update", (next) => {
    creds = { ...(asRecord(creds) ?? {}), ...(asRecord(next) ?? {}) };
    void persist();
  });
  sock.ev.on("messages.upsert", (bundle) => {
    ingestBaileysUpsert(bundle as { messages?: Array<{ key?: { id?: string; fromMe?: boolean; remoteJid?: string }; message?: { conversation?: string } }> }, {
      accountJid: selfAccountJid(creds),
      isEcho: (id) => false,
      onMessage: opts.onMessage,
    });
  });
  return {
    async send(jid, text, id) {
      await sock.sendMessage(jid, { text }, { messageId: id });
    },
    async react(jid, messageId, emoji, outboundId) {
      await sock.sendMessage(
        jid,
        { react: { text: emoji, key: { id: messageId, remoteJid: jid } } },
        { messageId: outboundId },
      );
    },
    async logout() {
      await sock.logout();
    },
    async close() {
      try {
        sock.end?.(undefined);
      } catch {
        sock.ws?.close();
      }
    },
  };
}
