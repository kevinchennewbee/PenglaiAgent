import { PenglaiError } from "@penglai/contracts";
import { WeComQrAuth } from "./qr-auth.js";
import { createWeComWsClient } from "./ws-client.js";

export const name = "wecom";
export { WeComQrAuth } from "./qr-auth.js";

export interface WeComCredentials {
  botId: string;
  secret: string;
}

export interface WeComClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  send?(peer: string, text: string): Promise<void>;
  connected?: boolean;
}

export type WeComConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export class WeComAdapter {
  connection: WeComConnection = "not_configured";
  private client: WeComClient | undefined;
  private qr: { operationId: string; scode: string; verificationUrl: string; expiresAt: number } | undefined;
  accountRef: string | undefined;
  private inboundHandler?: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void;

  constructor(
    private readonly vault: { resolve(ref: string): WeComCredentials | undefined; put?(ref: string, creds: WeComCredentials): void | Promise<void> },
    private readonly factory?: (creds: WeComCredentials) => WeComClient,
    private readonly auth = new WeComQrAuth(),
  ) {}

  async beginConnection(input: {
    method?: string;
    credentialRef?: string;
  }): Promise<{ kind: "qr" | "token"; live: false; operationId: string; expiresAt?: number; connection: WeComConnection }> {
    if (input.method === "qr" || !input.credentialRef) {
      this.connection = "connecting";
      const session = await this.auth.start();
      const operationId = `wecom:qr:${session.scode.slice(0, 8)}`;
      this.qr = { operationId, scode: session.scode, verificationUrl: session.verificationUrl, expiresAt: session.expiresAt };
      return { kind: "qr", live: false, operationId, expiresAt: session.expiresAt, connection: this.connection };
    }
    return this.connectWithRef(input.credentialRef);
  }

  async pollConnection(operationId: string): Promise<{ status: WeComConnection }> {
    if (!this.qr || this.qr.operationId !== operationId) return { status: this.connection };
    const poll = await this.auth.poll(this.qr.scode);
    if (poll.status === "success" && poll.botId && poll.secret) {
      await this.vault.put?.("PENGLAI_WECOM_BOT", { botId: poll.botId, secret: poll.secret });
      this.qr = undefined;
      await this.connectWithRef("PENGLAI_WECOM_BOT");
    } else if (poll.status === "expired" || poll.status === "failed") {
      this.connection = "failed";
      this.qr = undefined;
    }
    return { status: this.connection };
  }

  peekQr(operationId: string): { verificationUrl: string; expiresAt: number } | undefined {
    if (!this.qr || this.qr.operationId !== operationId) return undefined;
    return { verificationUrl: this.qr.verificationUrl, expiresAt: this.qr.expiresAt };
  }

  onInbound(handler: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void): void {
    this.inboundHandler = handler;
  }

  ingestMessage(msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget?: string;
    chatType?: "private";
    accountRef?: string;
  }): void {
    if (!this.accountRef) return;
    if (msg.chatType !== "private") return;
    this.inboundHandler?.({
      messageId: msg.messageId,
      senderId: msg.senderId,
      text: msg.text,
      vendorTarget: msg.vendorTarget || msg.senderId,
      chatType: "private",
      accountRef: msg.accountRef || this.accountRef,
    });
  }

  health() {
    const transport = this.client?.connected;
    const connection =
      this.connection === "connected" && transport === false ? "connecting" : this.connection;
    return { channel: "wecom" as const, live: false, enabled: this.connection !== "disabled", connection };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.client?.send) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:wecom");
    }
    if (!input.peerRef) throw new PenglaiError("INVALID_INPUT", "WECOM_REPLY_TARGET");
    await this.client.send(input.peerRef, input.text);
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect();
    this.client = undefined;
    this.qr = undefined;
    this.connection = "disabled";
  }

  private async connectWithRef(credentialRef: string): Promise<{ kind: "token"; live: false; operationId: string; connection: WeComConnection }> {
    const creds = this.vault.resolve(credentialRef);
    if (!creds?.botId || !creds.secret) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "wecom credentials missing");
    }
    this.connection = "connecting";
    this.accountRef = creds.botId;
    try {
      this.client = this.factory ? this.factory(creds) : await createWeComWsClient(creds, (msg) => this.inboundHandler?.(msg));
      await this.client.connect();
      this.connection = this.client.connected === false ? "failed" : "connected";
    } catch {
      this.connection = "failed";
      throw new PenglaiError("DELIVERY_TRANSIENT", "wecom connect failed");
    }
    return { kind: "token", live: false, operationId: `wecom:token:${credentialRef}`, connection: this.connection };
  }
}
