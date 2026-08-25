import { PenglaiError } from "@penglai/contracts";
import { DingTalkDeviceAuth } from "./device-auth.js";

export const name = "dingtalk";
export { DingTalkDeviceAuth } from "./device-auth.js";

export interface DingTalkCredentials {
  clientId: string;
  clientSecret: string;
}

export interface DingTalkInbound {
  messageId: string;
  senderId: string;
  text: string;
}

export interface DingTalkStreamClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  send?(peer: string, text: string): Promise<void>;
  onMessage?(handler: (msg: DingTalkInbound) => void): void;
  connected?: boolean;
}

export interface DingTalkStreamFactory {
  (creds: DingTalkCredentials): DingTalkStreamClient;
}

export type DingTalkConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export class DingTalkAdapter {
  connection: DingTalkConnection = "not_configured";
  private client: DingTalkStreamClient | undefined;
  private qr?: { operationId: string; deviceCode: string; verificationUrl: string; expiresAt: number };
  readonly inbound: DingTalkInbound[] = [];

  constructor(
    private readonly vault: { resolve(ref: string): DingTalkCredentials | undefined; put?(ref: string, creds: DingTalkCredentials): void },
    private readonly factory?: DingTalkStreamFactory,
    private readonly auth = new DingTalkDeviceAuth(),
  ) {}

  async beginConnection(input: {
    method?: string;
    credentialRef?: string;
  }): Promise<{ kind: "qr" | "token"; live: false; operationId: string; expiresAt?: number; connection: DingTalkConnection }> {
    if (input.method === "qr" || !input.credentialRef) {
      this.connection = "connecting";
      const session = await this.auth.start();
      const operationId = `dingtalk:qr:${session.deviceCode.slice(0, 8)}`;
      this.qr = { operationId, deviceCode: session.deviceCode, verificationUrl: session.verificationUrl, expiresAt: session.expiresAt };
      return { kind: "qr", live: false, operationId, expiresAt: session.expiresAt, connection: this.connection };
    }
    return this.connectWithRef(input.credentialRef);
  }

  async pollConnection(operationId: string): Promise<{ status: DingTalkConnection }> {
    if (!this.qr || this.qr.operationId !== operationId) {
      return { status: this.connection };
    }
    const poll = await this.auth.poll(this.qr.deviceCode);
    if (poll.status === "SUCCESS" && poll.clientId && poll.clientSecret) {
      this.vault.put?.("PENGLAI_DINGTALK_CLIENT", { clientId: poll.clientId, clientSecret: poll.clientSecret });
      this.qr = undefined;
      await this.connectWithRef("PENGLAI_DINGTALK_CLIENT");
      return { status: this.connection };
    }
    if (poll.status === "EXPIRED" || poll.status === "FAIL") {
      this.connection = poll.status === "EXPIRED" ? "failed" : "failed";
      this.qr = undefined;
    }
    return { status: this.connection };
  }

  peekQr(operationId: string): { verificationUrl: string; expiresAt: number } | undefined {
    if (!this.qr || this.qr.operationId !== operationId) return undefined;
    return { verificationUrl: this.qr.verificationUrl, expiresAt: this.qr.expiresAt };
  }

  health() {
    return { channel: "dingtalk" as const, live: false, enabled: this.connection !== "disabled", connection: this.connection };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.client?.send) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:dingtalk");
    }
    await this.client.send(input.peerRef ?? "peer", input.text);
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect();
    this.client = undefined;
    this.qr = undefined;
    this.connection = "disabled";
  }

  private async connectWithRef(credentialRef: string): Promise<{ kind: "token"; live: false; operationId: string; connection: DingTalkConnection }> {
    const creds = this.vault.resolve(credentialRef);
    if (!creds?.clientId || !creds.clientSecret) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "dingtalk credentials missing");
    }
    this.connection = "connecting";
    try {
      this.client = this.factory ? this.factory(creds) : await this.createOfficialClient(creds);
      this.client.onMessage?.((msg) => this.inbound.push(msg));
      await this.client.connect();
      this.connection = this.client.connected === false ? "failed" : "connected";
    } catch {
      this.connection = "failed";
      throw new PenglaiError("DELIVERY_TRANSIENT", "dingtalk stream connect failed");
    }
    return { kind: "token", live: false, operationId: `dingtalk:token:${credentialRef}`, connection: this.connection };
  }

  private async createOfficialClient(creds: DingTalkCredentials): Promise<DingTalkStreamClient> {
    const mod = (await import("dingtalk-stream")) as unknown as {
      DWClient?: new (opts: { clientId: string; clientSecret: string }) => {
        connect(): Promise<void> | void;
        disconnect(): Promise<void> | void;
      };
    };
    if (typeof mod.DWClient !== "function") {
      throw new PenglaiError("DSH_UNAVAILABLE", "dingtalk-stream DWClient missing");
    }
    const raw = new mod.DWClient({ clientId: creds.clientId, clientSecret: creds.clientSecret });
    const client: DingTalkStreamClient = {
      connected: false,
      async connect() {
        await raw.connect();
        client.connected = true;
      },
      async disconnect() {
        await raw.disconnect();
        client.connected = false;
      },
    };
    return client;
  }
}
