import { PenglaiError } from "@penglai/contracts";
import { DingTalkDeviceAuth } from "./device-auth.js";

export const name = "dingtalk";
export { DingTalkDeviceAuth, DINGTALK_REGISTRATION_SOURCE } from "./device-auth.js";

export interface DingTalkCredentials {
  clientId: string;
  clientSecret: string;
}

export interface DingTalkInbound {
  messageId: string;
  senderId: string;
  text: string;
  vendorTarget: string;
  chatType: "private";
  accountRef: string;
}

export interface DingTalkStreamClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  send?(peer: string, text: string): Promise<void>;
  onMessage?(handler: (msg: DingTalkInbound) => void | Promise<void>): void;
  connected?: boolean;
}

export interface DingTalkStreamFactory {
  (creds: DingTalkCredentials): DingTalkStreamClient;
}

export type DingTalkConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export class DingTalkAdapter {
  connection: DingTalkConnection = "not_configured";
  accountRef: string | undefined;
  private client: DingTalkStreamClient | undefined;
  private qr: { operationId: string; deviceCode: string; verificationUrl: string; expiresAt: number } | undefined;
  readonly inbound: DingTalkInbound[] = [];
  private inboundHandler?: (msg: DingTalkInbound) => void | Promise<void>;

  constructor(
    private readonly vault: { resolve(ref: string): DingTalkCredentials | undefined; put?(ref: string, creds: DingTalkCredentials): void | Promise<void> },
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
      await this.vault.put?.("PENGLAI_DINGTALK_CLIENT", { clientId: poll.clientId, clientSecret: poll.clientSecret });
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
    const transport = this.client?.connected;
    const connection =
      this.connection === "connected" && transport === false ? "connecting" : this.connection;
    return { channel: "dingtalk" as const, live: false, enabled: this.connection !== "disabled", connection };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.client?.send) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:dingtalk");
    }
    if (!input.peerRef) throw new PenglaiError("INVALID_INPUT", "DINGTALK_REPLY_TARGET");
    await this.client.send(input.peerRef, input.text);
    return { delivered: true };
  }

  onInbound(handler: (msg: DingTalkInbound) => void | Promise<void>): void {
    this.inboundHandler = handler;
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
    this.accountRef = creds.clientId;
    try {
      this.client = this.factory ? this.factory(creds) : await this.createOfficialClient(creds);
      this.client.onMessage?.(async (msg) => {
        const event = {
          ...msg,
          accountRef: msg.accountRef || creds.clientId,
          chatType: "private" as const,
          vendorTarget: msg.vendorTarget || msg.senderId,
        };
        this.inbound.push(event);
        await this.inboundHandler?.(event);
      });
      await this.client.connect();
      this.connection = this.client.connected === false ? "failed" : "connected";
    } catch {
      this.connection = "failed";
      throw new PenglaiError("DELIVERY_TRANSIENT", "dingtalk stream connect failed");
    }
    return { kind: "token", live: false, operationId: `dingtalk:token:${credentialRef}`, connection: this.connection };
  }

  private async createOfficialClient(creds: DingTalkCredentials): Promise<DingTalkStreamClient> {
    const { createDingTalkStreamClient } = await import("./stream-client.js");
    return createDingTalkStreamClient(creds);
  }
}
