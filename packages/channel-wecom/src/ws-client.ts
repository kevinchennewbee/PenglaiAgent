import { PenglaiError } from "@penglai/contracts";
import type { WeComClient, WeComCredentials } from "./index.js";

export async function createWeComWsClient(
  creds: WeComCredentials,
  onMessage?: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void | Promise<void>,
): Promise<WeComClient> {
  const mod = await import("@wecom/aibot-node-sdk");
  if (typeof mod.WSClient !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "WECOM_WSCLIENT_MISSING");
  }
  const raw = new mod.WSClient({
    botId: creds.botId,
    secret: creds.secret,
    maxReconnectAttempts: 10,
  });
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
        raw.on("reconnecting", () => {
          client.connected = false;
        });
        raw.on("message.text", (frame) => {
          const payload = frame.body;
          if (!payload) return;
          const messageId = String(payload.msgid ?? "").trim();
          const senderId = String(payload.from?.userid ?? "").trim();
          const text = String(payload.text?.content ?? "").trim();
          const chattype = String(payload.chattype ?? "").trim();
          if (!messageId || !senderId || !text) return;
          if (chattype !== "single") return;
          void Promise.resolve(onMessage?.({
            messageId,
            senderId,
            text,
            vendorTarget: senderId,
            chatType: "private",
            accountRef: creds.botId,
          })).catch(() => {
            client.connected = false;
          });
        });
        raw.connect();
      });
    },
    async disconnect() {
      raw.disconnect();
      client.connected = false;
    },
    async send(peer, text) {
      if (!client.connected) {
        throw new PenglaiError("SECURITY_POLICY", "CHANNEL_TRANSPORT_UNAVAILABLE:wecom");
      }
      await raw.sendMessage(peer, { msgtype: "markdown", markdown: { content: text } });
    },
  };
  return client;
}
