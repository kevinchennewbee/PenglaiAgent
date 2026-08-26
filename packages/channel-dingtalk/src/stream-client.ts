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
  const mod = (await import("dingtalk-stream")) as {
    DWClient?: new (opts: { clientId: string; clientSecret: string; autoReconnect?: boolean }) => {
      connected?: boolean;
      registered?: boolean;
      reconnecting?: boolean;
      registerCallbackListener?(topic: string, handler: (res: { data?: string }) => Promise<unknown> | unknown): void;
      connect(): Promise<void> | void;
      disconnect(): Promise<void> | void;
    };
    TOPIC_ROBOT?: string;
  };
  if (typeof mod.DWClient !== "function") {
    throw new PenglaiError("DSH_UNAVAILABLE", "dingtalk-stream DWClient missing");
  }
  const topic = mod.TOPIC_ROBOT ?? "/v1.0/im/bot/messages/get";
  const raw = new mod.DWClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    autoReconnect: true,
  });
  let inbound: ((msg: DingTalkInbound) => void) | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  const webhooks = new Map<string, string>();
  const syncConnected = (clientRef: DingTalkStreamClient) => {
    clientRef.connected = Boolean(raw.registered && raw.connected && !raw.reconnecting);
  };
  const client: DingTalkStreamClient = {
    connected: false,
    onMessage(handler) {
      inbound = handler;
    },
    async connect() {
      raw.registerCallbackListener?.(topic, async (res) => {
        let payload: RobotPayload = {};
        try {
          payload = JSON.parse(String(res.data ?? "{}")) as RobotPayload;
        } catch {
          return { status: "SUCCESS" };
        }
        const messageId = String(payload.msgId ?? "").trim();
        const senderId = String(payload.senderStaffId || payload.senderId || "").trim();
        const text = String(payload.text?.content ?? "").trim();
        const webhook = String(payload.sessionWebhook ?? "").trim();
        const conversationType = String(payload.conversationType ?? "").trim();
        const vendorTarget = String(payload.conversationId ?? "").trim();
        if (!messageId || !senderId || !text) return { status: "SUCCESS" };
        if (conversationType !== "1" || !vendorTarget) return { status: "SUCCESS" };
        if (webhook) webhooks.set(vendorTarget, webhook);
        inbound?.({
          messageId,
          senderId,
          text,
          vendorTarget,
          chatType: "private",
          accountRef: creds.clientId,
        });
        return { status: "SUCCESS" };
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
      await raw.disconnect();
      client.connected = false;
      webhooks.clear();
    },
    async send(peer, text) {
      const webhook = webhooks.get(peer);
      if (!webhook || !/^https:\/\/[a-z0-9.-]*dingtalk\.com\//i.test(webhook)) {
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
    },
  };
  return client;
}
