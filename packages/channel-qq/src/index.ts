import { PenglaiError } from "@penglai/contracts";

export const name = "qq";

export interface QqCredentials {
  appId: string;
  clientSecret: string;
}

export interface QqClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  connected?: boolean;
}

export type QqConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export class QqAdapter {
  connection: QqConnection = "not_configured";
  private client: QqClient | undefined;

  constructor(
    private readonly vault: { resolve(ref: string): QqCredentials | undefined },
    private readonly factory?: (creds: QqCredentials) => QqClient,
  ) {}

  async beginConnection(input: { credentialRef: string }): Promise<{ qr: false; live: false; connection: QqConnection }> {
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.appId || !creds.clientSecret) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "qq credentials missing");
    }
    this.connection = "connecting";
    try {
      this.client = this.factory
        ? this.factory(creds)
        : {
            connected: false,
            async connect() {
              await import("@tencent-connect/qqbot-nodejs");
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
      throw new PenglaiError("DELIVERY_TRANSIENT", "qq connect failed");
    }
    return { qr: false, live: false, connection: this.connection };
  }

  health() {
    return { channel: "qq" as const, live: false, connection: this.connection };
  }

  async sendText(_input: { text: string }): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:qq");
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect();
    this.client = undefined;
    this.connection = "disabled";
  }
}
