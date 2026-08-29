import { PenglaiError } from "@penglai/contracts";
import type { QqClient, QqCredentials } from "./index.js";
import {
  applyC2cPassiveQuota,
  chunkMarkdownText,
  isMarkdownRejection,
  markdownPayload,
  nextRestartSafeSeq,
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
  }) => void | Promise<void>,
  seq?: { value: number; persist(next: number): void },
): Promise<QqClient> {
  const mod = await import("@tencent-connect/qqbot-nodejs");
  if (typeof mod.QQBot !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "QQBOT_MISSING");
  }
  const raw = new mod.QQBot({
    appId: creds.appId,
    appSecret: creds.clientSecret,
    accountId: creds.appId,
  });
  let lastSeq = seq?.value ?? 0;
  let run: Promise<void> | undefined;
  const client: QqClient = {
    connected: false,
    async connect() {
      raw.on("message", async (_ctx, message) => {
        if (message.kind !== "c2c") return;
        const messageId = message.messageId.trim();
        const senderId = message.senderId.trim();
        const text = message.content.trim();
        if (!messageId || !senderId || !text) return;
        await onMessage?.({
          messageId,
          senderId,
          text,
          vendorTarget: message.replyTarget.targetId,
          chatType: "private",
          accountRef: creds.appId,
        });
      });
      let resolveReady!: () => void;
      let rejectReady!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const onReady = () => {
        client.connected = true;
        resolveReady();
      };
      const onError = (error: Error) => {
        if (!client.connected) rejectReady(error);
      };
      raw.on("ready", onReady);
      raw.on("resumed", onReady);
      raw.on("error", onError);
      run = raw.start();
      void run.catch((error) => {
        client.connected = false;
        rejectReady(error);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("QQ_GATEWAY_READY_TIMEOUT")), 30_000);
        timer.unref?.();
      });
      try {
        await Promise.race([ready, timeout]);
      } catch (error) {
        raw.stop();
        await run.catch(() => undefined);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async disconnect() {
      raw.stop();
      await run?.catch(() => undefined);
      run = undefined;
      client.connected = false;
    },
    async send(peer, text) {
      if (!client.connected) {
        throw new PenglaiError("SECURITY_POLICY", "CHANNEL_TRANSPORT_UNAVAILABLE:qq");
      }
      let deliveredMarkdown = false;
      const quota = applyC2cPassiveQuota(chunkMarkdownText(text));
      for (const chunk of quota.chunks) {
        const nextSeq = nextRestartSafeSeq(lastSeq);
        lastSeq = nextSeq;
        seq?.persist(nextSeq);
        const target = { scope: "c2c" as const, targetId: peer };
        const markdown = { ...markdownPayload(chunk, nextSeq), target };
        try {
          await raw.send(markdown);
          deliveredMarkdown = true;
        } catch (error) {
          if (deliveredMarkdown) {
            throw new PenglaiError("DELIVERY_TRANSIENT", "QQ_MARKDOWN_PARTIAL");
          }
          if (!isMarkdownRejection(error)) throw error;
          await raw.send({ ...plainPayload(chunk, nextSeq), target });
        }
      }
    },
  };
  return client;
}
