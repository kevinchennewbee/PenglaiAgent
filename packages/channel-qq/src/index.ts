import { PenglaiError } from "@penglai/contracts";
import { QqQrAuth } from "./qr-auth.js";

export const name = "qq";
export { QqQrAuth } from "./qr-auth.js";

export interface QqCredentials {
  appId: string;
  clientSecret: string;
}

export interface QqClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  send?(peer: string, text: string): Promise<void>;
  connected?: boolean;
}

export type QqConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export class QqAdapter {
  connection: QqConnection = "not_configured";
  private client: QqClient | undefined;
  private qr?: { operationId: string; cancel(): void };

  constructor(
    private readonly vault: { resolve(ref: string): QqCredentials | undefined; put?(ref: string, creds: QqCredentials): void },
    private readonly factory?: (creds: QqCredentials) => QqClient,
    private readonly auth = new QqQrAuth(),
  ) {}

  async beginConnection(input: {
    method?: string;
    credentialRef?: string;
  }): Promise<{ kind: "qr" | "token"; live: false; operationId: string; connection: QqConnection }> {
    if (input.method === "qr" || !input.credentialRef) {
      this.connection = "connecting";
      const operationId = `qq:qr:${Date.now()}`;
      this.qr = this.auth.start({
        onSuccess: (creds) => {
          this.vault.put?.("PENGLAI_QQ_BOT", creds);
          void this.connectWithRef("PENGLAI_QQ_BOT");
        },
        onFailure: () => {
          this.connection = "failed";
        },
      });
      this.qr = { operationId, cancel: this.qr.cancel };
      return { kind: "qr", live: false, operationId, connection: this.connection };
    }
    return this.connectWithRef(input.credentialRef);
  }

  async pollConnection(operationId: string): Promise<{ status: QqConnection }> {
    void operationId;
    return { status: this.connection };
  }

  health() {
    return { channel: "qq" as const, live: false, enabled: this.connection !== "disabled", connection: this.connection };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.client?.send) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:qq");
    }
    await this.client.send(input.peerRef ?? "peer", input.text);
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.qr?.cancel();
    await this.client?.disconnect();
    this.client = undefined;
    this.qr = undefined;
    this.connection = "disabled";
  }

  private async connectWithRef(credentialRef: string): Promise<{ kind: "token"; live: false; operationId: string; connection: QqConnection }> {
    const creds = this.vault.resolve(credentialRef);
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
    return { kind: "token", live: false, operationId: `qq:token:${credentialRef}`, connection: this.connection };
  }
}
