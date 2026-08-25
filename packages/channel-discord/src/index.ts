import { PenglaiError } from "@penglai/contracts";

export const name = "discord";

export interface DiscordCredentials {
  token: string;
}

export type DiscordConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Discord Bot REST. Never a QR shortcut. Gateway reconnect is a later host duty. */
export class DiscordAdapter {
  connection: DiscordConnection = "not_configured";
  private token?: string;
  intentsHint = "Enable Message Content Intent in the Discord Developer Portal.";

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
