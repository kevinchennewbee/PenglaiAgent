import { PenglaiError } from "@penglai/contracts";
import { QqQrAuth } from "./qr-auth.js";
import { createQqBotClient } from "./bot-client.js";

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
  private qr: { operationId: string; cancel(): void } | undefined;
  private lastQr: { operationId: string; image: string; expiresAt: number } | undefined;
  accountRef: string | undefined;
  private messageSeq = 0;
  private inboundHandler?: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void | Promise<void>;

  constructor(
    private readonly vault: { resolve(ref: string): QqCredentials | undefined; put?(ref: string, creds: QqCredentials): void | Promise<void> },
    private readonly factory?: (creds: QqCredentials) => QqClient,
    private readonly auth = new QqQrAuth(),
  ) {}

  async beginConnection(input: {
    method?: string;
    credentialRef?: string;
  }): Promise<{ kind: "qr" | "token"; operationId: string; connection: QqConnection }> {
    if (input.method === "qr" || !input.credentialRef) {
      this.connection = "connecting";
      const operationId = `qq:qr:${Date.now()}`;
      const started = this.auth.start({
        onQr: (image) => {
          this.lastQr = { operationId, image, expiresAt: Date.now() + 120_000 };
        },
        onSuccess: (creds) => {
          this.lastQr = undefined;
          void Promise.resolve()
            .then(() => this.vault.put?.("PENGLAI_QQ_BOT", creds))
            .then(() => this.connectWithRef("PENGLAI_QQ_BOT"))
            .catch(() => {
              this.connection = "failed";
              this.lastQr = undefined;
            });
        },
        onFailure: () => {
          this.connection = "failed";
          this.lastQr = undefined;
        },
      });
      this.qr = { operationId, cancel: started.cancel };
      return { kind: "qr", operationId, connection: this.connection };
    }
    return this.connectWithRef(input.credentialRef);
  }

  async pollConnection(operationId: string): Promise<{ status: QqConnection }> {
    void operationId;
    return { status: this.connection };
  }

  peekQr(operationId: string): { qrPayload: string; expiresAt: number } | undefined {
    if (!this.lastQr || this.lastQr.operationId !== operationId) return undefined;
    return { qrPayload: this.lastQr.image, expiresAt: this.lastQr.expiresAt };
  }

  onInbound(handler: (msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget: string;
    chatType: "private";
    accountRef: string;
  }) => void | Promise<void>): void {
    this.inboundHandler = handler;
  }

  async ingestMessage(msg: {
    messageId: string;
    senderId: string;
    text: string;
    vendorTarget?: string;
    chatType?: "private";
    accountRef?: string;
  }): Promise<void> {
    if (!this.accountRef) return;
    if (msg.chatType !== "private") return;
    await this.inboundHandler?.({
      messageId: msg.messageId,
      senderId: msg.senderId,
      text: msg.text,
      vendorTarget: msg.vendorTarget || msg.senderId,
      chatType: "private",
      accountRef: msg.accountRef || this.accountRef,
    });
  }

  exportPersistedState(): Record<string, unknown> {
    return { messageSeq: this.messageSeq };
  }

  restorePersistedState(state: Record<string, unknown>): void {
    if (typeof state.messageSeq === "number" && Number.isSafeInteger(state.messageSeq) && state.messageSeq > 0) {
      this.messageSeq = state.messageSeq;
    }
  }

  health() {
    return { channel: "qq" as const, runtimeBundled: true as const, enabled: this.connection !== "disabled", connection: this.connection };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.client?.send) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_TEXT_SEND_UNAVAILABLE:qq");
    }
    if (!input.peerRef) throw new PenglaiError("INVALID_INPUT", "QQ_REPLY_TARGET");
    await this.client.send(input.peerRef, input.text);
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.qr?.cancel();
    await this.client?.disconnect();
    this.client = undefined;
    this.qr = undefined;
    this.lastQr = undefined;
    this.connection = "disabled";
  }

  private async connectWithRef(credentialRef: string): Promise<{ kind: "token"; operationId: string; connection: QqConnection }> {
    const creds = this.vault.resolve(credentialRef);
    if (!creds?.appId || !creds.clientSecret) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "qq credentials missing");
    }
    this.connection = "connecting";
    this.accountRef = creds.appId;
    try {
      this.client = this.factory
        ? this.factory(creds)
        : await createQqBotClient(
            creds,
            (msg) => this.inboundHandler?.(msg),
            {
              value: this.messageSeq,
              persist: (next) => {
                this.messageSeq = next;
              },
            },
          );
      await this.client.connect();
      this.connection = this.client.connected === false ? "failed" : "connected";
    } catch {
      this.connection = "failed";
      throw new PenglaiError("DELIVERY_TRANSIENT", "qq connect failed");
    }
    return { kind: "token", operationId: `qq:token:${credentialRef}`, connection: this.connection };
  }
}
