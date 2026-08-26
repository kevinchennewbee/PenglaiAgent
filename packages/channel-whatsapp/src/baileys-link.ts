import { PenglaiError } from "@penglai/contracts";
import type { WhatsAppInbound, WhatsAppLinkSocket } from "./device-adapter.js";
import type { WhatsAppSessionStore } from "./session-store.js";
import { ingestBaileysUpsert, selfAccountJid } from "./inbound-jid.js";

type SignalKeyBag = Record<string, Record<string, unknown>>;

interface PersistedAuth {
  creds: unknown;
  keys: SignalKeyBag;
}

const silentBaileysLogger = {
  level: "silent",
  child() { return this; },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export class SerializedWhatsAppAuthWriter {
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private accepting = true;

  constructor(
    private readonly sessions: WhatsAppSessionStore,
    private readonly onError?: (code: string) => void,
  ) {}

  enqueue(bytes: Uint8Array): Promise<void> {
    if (!this.accepting) {
      return Promise.reject(new PenglaiError("SECURITY_POLICY", "WHATSAPP_AUTH_WRITER_CLOSED"));
    }
    const snapshot = Buffer.from(bytes);
    const operation = this.tail.then(() => this.sessions.write(snapshot));
    this.tail = operation.catch((error) => {
      this.failure = error;
      this.onError?.("WHATSAPP_AUTH_PERSIST_FAILED");
    });
    return operation;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) {
      throw new PenglaiError("STORE_CORRUPT", "WHATSAPP_AUTH_PERSIST_FAILED");
    }
  }

  async stop(): Promise<void> {
    this.accepting = false;
    await this.flush();
  }
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
    onMessage: (msg: WhatsAppInbound) => void | Promise<void>;
    isEcho?: (id: string) => boolean;
    onError?: (code: string) => void;
    onClose?: () => void;
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
    proto?: {
      Message?: {
        AppStateSyncKeyData?: { fromObject(value: unknown): unknown };
      };
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
      throw new PenglaiError("STORE_CORRUPT", "WHATSAPP_AUTH_STATE_INVALID");
    }
  }

  const authWriter = new SerializedWhatsAppAuthWriter(sessions, opts.onError);
  const persist = async () => {
    const blob: PersistedAuth = { creds, keys };
    await authWriter.enqueue(Buffer.from(stringify(blob)));
  };

  const keyStore = {
    async get(type: string, ids: string[]) {
      const data: Record<string, unknown> = {};
      const bag = keys[type] ?? {};
      for (const id of ids) {
        if (!(id in bag)) continue;
        const value = bag[id];
        data[id] =
          type === "app-state-sync-key" && value && baileys.proto?.Message?.AppStateSyncKeyData
            ? baileys.proto.Message.AppStateSyncKeyData.fromObject(value)
            : value;
      }
      return data;
    },
    async set(data: SignalKeyBag) {
      for (const [type, rows] of Object.entries(data ?? {})) {
        const bag = { ...(keys[type] ?? {}) };
        for (const [id, value] of Object.entries(rows ?? {})) {
          if (value == null) delete bag[id];
          else bag[id] = value;
        }
        keys[type] = bag;
      }
      await persist();
    },
  };

  const sock = makeWASocket({
    auth: { creds, keys: keyStore },
    printQRInTerminal: false,
    logger: silentBaileysLogger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
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
    if (rec.connection === "close") opts.onClose?.();
  });
  sock.ev.on("creds.update", (next) => {
    creds = { ...(asRecord(creds) ?? {}), ...(asRecord(next) ?? {}) };
    void persist().catch(() => undefined);
  });
  sock.ev.on("messages.upsert", (bundle) => {
    ingestBaileysUpsert(bundle as { messages?: Array<{ key?: { id?: string; fromMe?: boolean; remoteJid?: string }; message?: { conversation?: string } }> }, {
      accountJid: selfAccountJid(creds),
      isEcho: opts.isEcho ?? ((id) => false),
      onMessage: (message) => {
        void Promise.resolve(opts.onMessage(message)).catch(() => opts.onError?.("WHATSAPP_INBOUND_PERSIST_FAILED"));
      },
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
      try {
        await sock.logout();
      } finally {
        await authWriter.stop();
      }
    },
    async close() {
      await authWriter.stop();
      await sock.end?.(undefined);
    },
  };
}
