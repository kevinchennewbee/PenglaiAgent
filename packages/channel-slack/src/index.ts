import { PenglaiError } from "@penglai/contracts";

export const name = "slack";

export interface SlackCredentials {
  botToken: string;
  appToken?: string;
}

export interface SlackInbound {
  messageId: string;
  senderId: string;
  channelId: string;
  text: string;
  chatType: "private";
  accountRef: string;
}

export type SlackConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export const SLACK_RECONNECT_DELAYS_MS = Object.freeze([1_000, 3_000, 5_000, 10_000, 30_000]);

/** Official Slack token/manifest. Never a QR shortcut. */
export class SlackAdapter {
  connection: SlackConnection = "not_configured";
  accountRef: string | undefined;
  private creds: SlackCredentials | undefined;
  private inboundHandler?: (msg: SlackInbound) => void | Promise<void>;

  private socket: { close(): void } | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private stopped = false;
  private helloSeen = false;

  constructor(
    private readonly vault: { resolve(ref: string): SlackCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly sockets?: {
      open(url: string, onEvent: (event: Record<string, unknown>) => void): { close(): void; send?(data: string): void; readyState?: number };
    },
  ) {}

  async beginConnection(input: { method: string; credentialRef: string }): Promise<{ kind: "token" | "manifest"; live: false; operationId: string }> {
    if (input.method === "qr") throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NO_QR");
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.botToken) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "slack credentials missing");
    }
    this.connection = "connecting";
    const response = await this.fetchImpl("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { authorization: `Bearer ${creds.botToken}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "SLACK_TOKEN_INVALID");
    }
    const body = (await response.json()) as { ok?: boolean; user_id?: string; bot_id?: string };
    if (!body.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "SLACK_TOKEN_INVALID");
    }
    this.accountRef = String(body.bot_id || body.user_id || "").trim() || undefined;
    this.creds = creds;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.helloSeen = false;
    if (!creds.appToken) {
      this.connection = "not_configured";
      throw new PenglaiError("INVALID_INPUT", "SLACK_APP_TOKEN_REQUIRED");
    }
    await this.openSocket(creds.appToken);
    if (!this.helloSeen) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SOCKET_HELLO");
    }
    return { kind: input.method === "manifest" ? "manifest" : "token", live: false, operationId: "slack:token" };
  }

  async pollConnection(): Promise<{ status: SlackConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: SlackInbound) => void | Promise<void>): void {
    this.inboundHandler = handler;
  }

  async ingestEvent(event: {
    type?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    channel_type?: string;
    thread_ts?: string;
    bot_id?: string;
  }): Promise<void> {
    if (event.bot_id || (event.type && event.type !== "message") || !event.text) return;
    if (event.thread_ts) return;
    if (event.channel_type !== "im") return;
    const channel = String(event.channel ?? "").trim();
    const messageId = String(event.ts ?? "").trim();
    const senderId = String(event.user ?? "").trim();
    if (!this.accountRef || !channel || !messageId || !senderId) return;
    await this.inboundHandler?.({
      messageId,
      senderId,
      channelId: channel,
      text: event.text,
      chatType: "private",
      accountRef: this.accountRef,
    });
  }

  health() {
    return { channel: "slack" as const, live: false, enabled: this.connection !== "disabled", connection: this.connection };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.creds) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:slack");
    }
    if (!input.peerRef) throw new PenglaiError("INVALID_INPUT", "SLACK_REPLY_TARGET");
    const response = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.creds.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: input.peerRef, text: input.text }),
      redirect: "error",
    });
    const body = (await response.json()) as { ok?: boolean };
    if (!response.ok || !body.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SEND_FAILED");
    return { delivered: true };
  }

  async react(input: {
    vendorTarget: string;
    vendorMessageId: string;
    emoji: string;
    action: "add" | "remove";
    signal: AbortSignal;
  }): Promise<void> {
    if (!this.creds?.botToken || !input.vendorTarget || !input.vendorMessageId || !input.emoji) return;
    const endpoint = input.action === "add" ? "reactions.add" : "reactions.remove";
    const response = await this.fetchImpl(`https://slack.com/api/${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.creds.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: input.vendorTarget, timestamp: input.vendorMessageId, name: input.emoji }),
      redirect: "error",
      signal: input.signal,
    });
    if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "SLACK_REACTION_FAILED");
    const body = (await response.json()) as { ok?: boolean };
    if (!body.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "SLACK_REACTION_FAILED");
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    this.connection = "disabled";
  }

  async logout(): Promise<void> {
    await this.disconnect();
    this.creds = undefined;
    this.accountRef = undefined;
  }

  /** Test seam: Socket Mode transport closed unexpectedly. */
  notifySocketClosed(): void {
    if (this.stopped) return;
    this.connection = "connecting";
    this.scheduleReconnect();
  }

  private async openSocket(appToken: string): Promise<void> {
    const response = await this.fetchImpl("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: { authorization: `Bearer ${appToken}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { ok?: boolean; url?: string };
    if (!body.ok || !body.url || !validSlackSocketUrl(body.url)) {
      throw new PenglaiError("AUTH_EXPIRED", "SLACK_SOCKET_OPEN");
    }
    const onEvent = async (event: Record<string, unknown>, socket?: { send?(data: string): void; close(): void; readyState?: number }) => {
      if (event.type === "hello") {
        this.reconnectAttempt = 0;
        this.helloSeen = true;
        this.connection = "connected";
        return;
      }
      if (event.type === "disconnect") {
        socket?.close();
        return;
      }
      if (event.type === "events_api") {
        const inner = (event.payload ?? event) as {
          event?: { type?: string; user?: string; text?: string; channel?: string; ts?: string; channel_type?: string; bot_id?: string };
        };
        if (inner.event) await this.ingestEvent(inner.event);
      }
      // Socket Mode ACK is a delivery acknowledgement. Send it only after the
      // message has crossed Penglai's durable inbound boundary.
      if (event.envelope_id && socket?.send && (socket.readyState === undefined || socket.readyState === 1)) {
        socket.send(JSON.stringify({ envelope_id: event.envelope_id }));
      }
    };
    if (this.sockets) {
      let opened: { close(): void; send?(data: string): void; readyState?: number } | undefined;
      opened = this.sockets.open(body.url, (event) => {
        void onEvent(event, opened).catch(() => undefined);
      });
      this.socket = opened;
      return;
    }
    const ws = new WebSocket(body.url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SOCKET_TIMEOUT")), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      ws.addEventListener("error", () => {
        finish(new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SOCKET_ERROR"));
      });
      ws.addEventListener("message", (ev) => {
        try {
          const parsed = JSON.parse(String((ev as MessageEvent).data)) as Record<string, unknown>;
          void onEvent(parsed, ws).catch(() => undefined);
          if (parsed.type === "hello") finish();
        } catch {
          /* ignore malformed */
        }
      });
    });
    ws.addEventListener("close", () => {
      if (this.stopped) return;
      this.connection = "connecting";
      this.scheduleReconnect();
    });
    this.socket = { close: () => ws.close() };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.creds?.appToken) return;
    const delay = SLACK_RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, SLACK_RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      const token = this.creds?.appToken;
      if (!token || this.stopped) return;
      void this.openSocket(token)
        .then(() => {
          this.reconnectAttempt = 0;
        })
        .catch(() => {
          this.connection = "failed";
          this.scheduleReconnect();
        });
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

function validSlackSocketUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "wss:" &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443") &&
      (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"))
    );
  } catch {
    return false;
  }
}
