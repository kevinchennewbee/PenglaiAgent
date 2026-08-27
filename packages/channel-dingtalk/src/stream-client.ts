import { PenglaiError } from "@penglai/contracts";
import type { DingTalkCredentials, DingTalkInbound, DingTalkStreamClient } from "./index.js";

type RobotPayload = {
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  senderStaffId?: string;
  senderId?: string;
  conversationId?: string;
  conversationType?: string;
  sessionWebhook?: string;
};

/**
 * Official dingtalk-stream DWClient. Connected only after Stream handshake
 * and robot listener registration. ACK the callback or DingTalk will retry.
 */
export async function createDingTalkStreamClient(
  creds: DingTalkCredentials,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DingTalkStreamClient> {
  const mod = await import("dingtalk-stream");
  if (typeof mod.DWClient !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "dingtalk-stream DWClient missing");
  }
  const topic = mod.TOPIC_ROBOT ?? "/v1.0/im/bot/messages/get";
  const raw = new mod.DWClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  let inbound: ((msg: DingTalkInbound) => void | Promise<void>) | undefined;
  let replyTarget: ((vendorTarget: string, sessionWebhook: string) => void | Promise<void>) | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  const webhooks = new Map(
    Object.entries(creds.sessionWebhooks ?? {}).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 && entry[0].length <= 256 && validSessionWebhook(entry[1]),
    ),
  );
  const syncConnected = (clientRef: DingTalkStreamClient) => {
    clientRef.connected = Boolean(raw.registered && raw.connected && !raw.reconnecting);
  };
  const client: DingTalkStreamClient = {
    connected: false,
    onMessage(handler) {
      inbound = handler;
    },
    onReplyTarget(handler) {
      replyTarget = handler;
    },
    async connect() {
      raw.registerCallbackListener(topic, (res) => {
        void (async () => {
          let payload: RobotPayload;
          try {
            payload = JSON.parse(String(res.data ?? "{}")) as RobotPayload;
          } catch {
            // Malformed input cannot become durable on retry. ACK it without
            // exposing vendor payload data in logs or diagnostics.
            raw.socketCallBackResponse(res.headers.messageId, { status: "SUCCESS" });
            return;
          }
          const messageId = String(payload.msgId ?? "").trim();
          const senderId = String(payload.senderStaffId || payload.senderId || "").trim();
          const text = String(payload.text?.content ?? "").trim();
          const webhook = String(payload.sessionWebhook ?? "").trim();
          const conversationType = String(payload.conversationType ?? "").trim();
          const vendorTarget = String(payload.conversationId ?? "").trim();
          if (messageId && senderId && text && conversationType === "1" && vendorTarget) {
            if (validSessionWebhook(webhook)) {
              webhooks.set(vendorTarget, webhook);
              await replyTarget?.(vendorTarget, webhook);
              await inbound?.({
                messageId,
                senderId,
                text,
                vendorTarget,
                chatType: "private",
                accountRef: creds.clientId,
              });
            }
          }
          // The SDK ignores callback return values. ACK malformed, unsupported,
          // or durably accepted messages; a durable-path rejection deliberately
          // leaves the callback unacknowledged so DingTalk retries it.
          raw.socketCallBackResponse(res.headers.messageId, { status: "SUCCESS" });
        })().catch(() => undefined);
      });
      await raw.connect();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (raw.registered) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!raw.registered) {
        throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_STREAM_HANDSHAKE");
      }
      syncConnected(client);
      healthTimer ??= setInterval(() => syncConnected(client), 500);
      healthTimer.unref?.();
    },
    async disconnect() {
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = undefined;
      }
      raw.disconnect();
      client.connected = false;
      webhooks.clear();
    },
    async send(peer, text) {
      const webhook = webhooks.get(peer);
      if (!webhook || !validSessionWebhook(webhook)) {
        throw new PenglaiError("INVALID_INPUT", "DINGTALK_REPLY_TARGET");
      }
      const response = await fetchImpl(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: text } }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_SEND_FAILED");
      const body = (await response.json()) as { errcode?: unknown };
      if (Number(body.errcode) !== 0) throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_SEND_FAILED");
    },
  };
  return client;
}

function validSessionWebhook(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.hostname === "oapi.dingtalk.com" &&
      url.pathname === "/robot/sendBySession"
    );
  } catch {
    return false;
  }
}
