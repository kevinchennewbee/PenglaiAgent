import { PenglaiError } from "@penglai/contracts";
import type { QqClient, QqCredentials } from "./index.js";
import {
  applyC2cPassiveQuota,
  chunkMarkdownText,
  isMarkdownRejection,
  markdownPayload,
  nextMessageSeq,
  plainPayload,
} from "./markdown-reply.js";

export async function createQqBotClient(
  creds: QqCredentials,
  onMessage?: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void,
): Promise<QqClient> {
  const mod = (await import("@tencent-connect/qqbot-nodejs")) as unknown as {
    QQBot?: new (opts: { appID?: string; appId?: string; secret?: string; clientSecret?: string }) => {
      on(event: string, handler: (...args: unknown[]) => void): void;
      start?(): Promise<void> | void;
      connect?(): Promise<void> | void;
      stop?(): Promise<void> | void;
      close?(): Promise<void> | void;
      sendMessage?(id: string, payload: unknown): Promise<unknown>;
      send?(payload: unknown): Promise<unknown>;
    };
  };
  if (typeof mod.QQBot !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "QQBOT_MISSING");
  }
  const raw = new mod.QQBot({
    appID: creds.appId,
    appId: creds.appId,
    secret: creds.clientSecret,
    clientSecret: creds.clientSecret,
  });
  let lastSeq = 0;
  const client: QqClient = {
    connected: false,
    async connect() {
      raw.on("message", (event) => {
        const rec = (event ?? {}) as {
          id?: string;
          content?: string;
          author?: { id?: string };
          chat_type?: number | string;
        };
        const messageId = String(rec.id ?? "").trim();
        const senderId = String(rec.author?.id ?? "").trim();
        const text = String(rec.content ?? "").trim();
        const chatType = rec.chat_type;
        if (!messageId || !senderId || !text) return;
        if (chatType !== 0 && chatType !== "c2c" && chatType !== "private") return;
        onMessage?.({
          messageId,
          senderId,
          text,
          vendorTarget: senderId,
          chatType: "private",
          accountRef: creds.appId,
        });
      });
      await (raw.start ?? raw.connect)?.();
      client.connected = true;
    },
    async disconnect() {
      await (raw.stop ?? raw.close)?.();
      client.connected = false;
    },
    async send(peer, text) {
      if (!client.connected || (typeof raw.sendMessage !== "function" && typeof raw.send !== "function")) {
        throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:qq");
      }
      let deliveredMarkdown = false;
      const quota = applyC2cPassiveQuota(chunkMarkdownText(text));
      for (const chunk of quota.chunks) {
        const seq = nextMessageSeq(lastSeq);
        lastSeq = seq;
        const markdown = { ...markdownPayload(chunk, seq), target: peer };
        try {
          if (typeof raw.send === "function") await raw.send(markdown);
          else await raw.sendMessage?.(peer, markdown);
          deliveredMarkdown = true;
        } catch (error) {
          if (deliveredMarkdown) {
            throw new PenglaiError("DELIVERY_TRANSIENT", "QQ_MARKDOWN_PARTIAL");
          }
          if (!isMarkdownRejection(error)) throw error;
          if (typeof raw.send === "function") await raw.send({ ...plainPayload(chunk, seq), target: peer });
          else await raw.sendMessage?.(peer, plainPayload(chunk, seq));
        }
      }
    },
  };
  return client;
}
