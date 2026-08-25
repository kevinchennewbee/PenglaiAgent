import { PenglaiError } from "@penglai/contracts";

export const name = "discord";

export interface DiscordCredentials {
  token: string;
}

export interface DiscordInbound {
  messageId: string;
  senderId: string;
  channelId: string;
  text: string;
}

export type DiscordConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Discord Bot REST. Never a QR shortcut. */
export class DiscordAdapter {
  connection: DiscordConnection = "not_configured";
  private token: string | undefined;
  intentsHint = "Enable Message Content Intent in the Discord Developer Portal.";
  private inboundHandler?: (msg: DiscordInbound) => void;

  constructor(
    private readonly vault: { resolve(ref: string): DiscordCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async beginConnection(input: { method: string; credentialRef: string }): Promise<{ kind: "token"; live: false; operationId: string }> {
    if (input.method === "qr") throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NO_QR");
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.token) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "discord credentials missing");
    }
    this.connection = "connecting";
    const response = await this.fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bot ${creds.token}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "DISCORD_TOKEN_INVALID");
    }
    this.token = creds.token;
    this.connection = "connected";
    return { kind: "token", live: false, operationId: "discord:token" };
  }

  async pollConnection(): Promise<{ status: DiscordConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: DiscordInbound) => void): void {
    this.inboundHandler = handler;
  }

  ingestMessage(event: {
    id?: string;
    content?: string;
    channel_id?: string;
    author?: { id?: string; bot?: boolean };
    guild_id?: string;
  }): void {
    if (event.guild_id || event.author?.bot || !event.content) return;
    this.inboundHandler?.({
      messageId: String(event.id ?? Date.now()),
      senderId: String(event.author?.id ?? "unknown"),
      channelId: String(event.channel_id ?? ""),
      text: event.content,
    });
  }

  health() {
    return {
      channel: "discord" as const,
      live: false,
      enabled: this.connection !== "disabled",
      connection: this.connection,
      intentsHint: this.intentsHint,
    };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.token || !input.peerRef) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:discord");
    }
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${input.peerRef}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: input.text }),
      redirect: "error",
    });
    if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_SEND_FAILED");
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.token = undefined;
    this.connection = "disabled";
  }
}
