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
}

export type SlackConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Slack token/manifest. Never a QR shortcut. */
export class SlackAdapter {
  connection: SlackConnection = "not_configured";
  private creds: SlackCredentials | undefined;
  private inboundHandler?: (msg: SlackInbound) => void;

  constructor(
    private readonly vault: { resolve(ref: string): SlackCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
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
    const body = (await response.json()) as { ok?: boolean };
    if (!body.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "SLACK_TOKEN_INVALID");
    }
    this.creds = creds;
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
    bot_id?: string;
  }): void {
    if (event.bot_id || (event.type && event.type !== "message") || !event.text) return;
    const channel = String(event.channel ?? "");
    const privateChat = event.channel_type === "im" || channel.startsWith("D");
    if (!privateChat) return;
    this.inboundHandler?.({
      messageId: String(event.ts ?? `${Date.now()}`),
      senderId: String(event.user ?? "unknown"),
      channelId: channel,
      text: event.text,
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
    this.creds = undefined;
    this.connection = "disabled";
  }
}
