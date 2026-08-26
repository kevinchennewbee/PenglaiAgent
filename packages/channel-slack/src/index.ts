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

/** Official Slack token/manifest. Never a QR shortcut. */
export class SlackAdapter {
  connection: SlackConnection = "not_configured";
  accountRef: string | undefined;
  private creds: SlackCredentials | undefined;
  private inboundHandler?: (msg: SlackInbound) => void;

  private socket: { close(): void } | undefined;

  constructor(
    private readonly vault: { resolve(ref: string): SlackCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly sockets?: {
      open(url: string, onEvent: (event: Record<string, unknown>) => void): { close(): void };
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
    const body = (await response.json()) as { ok?: boolean; user_id?: string; bot_id?: string };
    if (!body.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "SLACK_TOKEN_INVALID");
    }
    this.accountRef = String(body.bot_id || body.user_id || "").trim() || undefined;
    this.creds = creds;
    if (!creds.appToken) {
      this.connection = "not_configured";
      throw new PenglaiError("INVALID_INPUT", "SLACK_APP_TOKEN_REQUIRED");
    }
    await this.openSocket(creds.appToken);
    this.connection = "connected";
    return { kind: input.method === "manifest" ? "manifest" : "token", live: false, operationId: "slack:token" };
  }

  async pollConnection(): Promise<{ status: SlackConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: SlackInbound) => void): void {
    this.inboundHandler = handler;
  }

  ingestEvent(event: {
    type?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    channel_type?: string;
    thread_ts?: string;
    bot_id?: string;
  }): void {
    if (event.bot_id || (event.type && event.type !== "message") || !event.text) return;
    if (event.thread_ts) return;
    if (event.channel_type !== "im") return;
    const channel = String(event.channel ?? "").trim();
    const messageId = String(event.ts ?? "").trim();
    const senderId = String(event.user ?? "").trim();
    if (!this.accountRef || !channel || !messageId || !senderId) return;
    this.inboundHandler?.({
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
    if (!body.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SEND_FAILED");
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
    this.creds = undefined;
    this.connection = "disabled";
  }

  private async openSocket(appToken: string): Promise<void> {
    const response = await this.fetchImpl("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: { authorization: `Bearer ${appToken}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { ok?: boolean; url?: string };
    if (!body.ok || !body.url || !body.url.startsWith("wss://")) {
      throw new PenglaiError("AUTH_EXPIRED", "SLACK_SOCKET_OPEN");
    }
    const onEvent = (event: Record<string, unknown>) => {
      if (event.type === "events_api") {
        const inner = (event.payload ?? event) as {
          event?: { type?: string; user?: string; text?: string; channel?: string; ts?: string; channel_type?: string; bot_id?: string };
        };
        if (inner.event) this.ingestEvent(inner.event);
      }
    };
    if (this.sockets) {
      this.socket = this.sockets.open(body.url, onEvent);
      return;
    }
    const ws = new WebSocket(body.url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SOCKET_TIMEOUT")), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new PenglaiError("DELIVERY_TRANSIENT", "SLACK_SOCKET_ERROR"));
      });
    });
    ws.addEventListener("message", (ev) => {
      try {
        const parsed = JSON.parse(String((ev as MessageEvent).data)) as Record<string, unknown>;
        if (parsed.envelope_id) {
          ws.send(JSON.stringify({ envelope_id: parsed.envelope_id }));
        }
        onEvent(parsed);
      } catch {
        /* ignore malformed */
      }
    });
    this.socket = { close: () => ws.close() };
  }
}
