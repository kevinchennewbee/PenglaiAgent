import { PenglaiError } from "@penglai/contracts";
import type { WeComClient, WeComCredentials } from "./index.js";

type WeComMessage = {
  msgid?: string;
  msgtype?: string;
  text?: { content?: string };
  from?: { userid?: string };
  chattype?: string;
};

export async function createWeComWsClient(
  creds: WeComCredentials,
  onMessage?: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void,
): Promise<WeComClient> {
  const mod = (await import("@wecom/aibot-node-sdk")) as unknown as {
    WSClient?: new (opts: { botid?: string; botId?: string; secret: string }) => {
      on(event: string, handler: (...args: unknown[]) => void): void;
      connect(): Promise<void> | void;
      disconnect?(): Promise<void> | void;
      close?(): Promise<void> | void;
      sendMessage?(payload: unknown): Promise<unknown>;
    };
  };
  if (typeof mod.WSClient !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "WECOM_WSCLIENT_MISSING");
  }
  const raw = new mod.WSClient({ botid: creds.botId, botId: creds.botId, secret: creds.secret });
  const client: WeComClient = {
    connected: false,
    async connect() {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new PenglaiError("DELIVERY_TRANSIENT", "WECOM_AUTH_TIMEOUT")), 20_000);
        raw.on("authenticated", () => {
          clearTimeout(timer);
          client.connected = true;
          resolve();
        });
        raw.on("error", (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
        raw.on("disconnected", () => {
          client.connected = false;
        });
        raw.on("message", (event) => {
          const payload = (event ?? {}) as WeComMessage;
          const messageId = String(payload.msgid ?? "").trim();
          const senderId = String(payload.from?.userid ?? "").trim();
          const text = String(payload.text?.content ?? "").trim();
          const chattype = String(payload.chattype ?? "").trim();
          if (!messageId || !senderId || !text) return;
          if (chattype !== "single" && chattype !== "p2p") return;
          onMessage?.({
            messageId,
            senderId,
            text,
            vendorTarget: senderId,
            chatType: "private",
            accountRef: creds.botId,
          });
        });
        void raw.connect();
      });
    },
    async disconnect() {
      await (raw.disconnect ?? raw.close)?.();
      client.connected = false;
    },
    async send(peer, text) {
      if (!client.connected || typeof raw.sendMessage !== "function") {
        throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:wecom");
      }
      await raw.sendMessage({ touser: peer, msgtype: "text", text: { content: text } });
    },
  };
  return client;
}
