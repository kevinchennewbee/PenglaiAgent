import { PenglaiError } from "@penglai/contracts";

export const name = "wecom";

export interface WeComCredentials {
  botId: string;
  secret: string;
}

export interface WeComClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  connected?: boolean;
}

export type WeComConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export class WeComAdapter {
  connection: WeComConnection = "not_configured";
  private client: WeComClient | undefined;

  constructor(
    private readonly vault: { resolve(ref: string): WeComCredentials | undefined },
    private readonly factory?: (creds: WeComCredentials) => WeComClient,
  ) {}

  async beginConnection(input: { credentialRef: string }): Promise<{ qr: false; live: false; connection: WeComConnection }> {
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.botId || !creds.secret) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "wecom credentials missing");
    }
    this.connection = "connecting";
    try {
      this.client = this.factory
        ? this.factory(creds)
        : {
            connected: false,
            async connect() {
              await import("@wecom/aibot-node-sdk");
              this.connected = true;
            },
            async disconnect() {
              this.connected = false;
            },
          };
      await this.client.connect();
      this.connection = this.client.connected === false ? "failed" : "connected";
    } catch {
      this.connection = "failed";
      throw new PenglaiError("DELIVERY_TRANSIENT", "wecom connect failed");
    }
    return { qr: false, live: false, connection: this.connection };
  }

  health() {
    return { channel: "wecom" as const, live: false, connection: this.connection };
  }

  async sendText(_input: { text: string }): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:wecom");
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect();
    this.client = undefined;
    this.connection = "disabled";
  }
}
