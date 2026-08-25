import { PenglaiError } from "@penglai/contracts";

export const name = "telegram";

export interface TelegramCredentials {
  token: string;
}

export interface TelegramInbound {
  messageId: string;
  senderId: string;
  chatId: string;
  text: string;
}

export type TelegramConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Telegram Bot HTTP API long polling. Never a QR shortcut. */
export class TelegramAdapter {
  connection: TelegramConnection = "not_configured";
  private token: string | undefined;
  webhookConflict = false;
  private offset = 0;
  private inboundHandler?: (msg: TelegramInbound) => void;

  constructor(
    private readonly vault: { resolve(ref: string): TelegramCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async beginConnection(input: { method: string; credentialRef: string }): Promise<{ kind: "token"; live: false; operationId: string }> {
    if (input.method === "qr") throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NO_QR");
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.token) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "telegram credentials missing");
    }
    this.connection = "connecting";
    const me = await this.fetchImpl(`https://api.telegram.org/bot${creds.token}/getMe`, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const meBody = (await me.json()) as { ok?: boolean };
    if (!meBody.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "TELEGRAM_TOKEN_INVALID");
    }
    const webhook = await this.fetchImpl(`https://api.telegram.org/bot${creds.token}/getWebhookInfo`, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const hookBody = (await webhook.json()) as { ok?: boolean; result?: { url?: string } };
    this.webhookConflict = Boolean(hookBody.result?.url);
    if (this.webhookConflict) {
      this.connection = "failed";
      throw new PenglaiError("SECURITY_POLICY", "TELEGRAM_WEBHOOK_CONFLICT");
    }
    this.token = creds.token;
    this.connection = "connected";
    this.startReceive();
    return { kind: "token", live: false, operationId: "telegram:token" };
  }

  async pollConnection(): Promise<{ status: TelegramConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: TelegramInbound) => void): void {
    this.inboundHandler = handler;
  }

  ingestUpdate(update: {
    update_id?: number;
    message?: { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } };
  }): void {
    if (update.update_id !== undefined) this.offset = Math.max(this.offset, update.update_id + 1);
    const msg = update.message;
    if (!msg?.text || msg.chat?.type !== "private") return;
    if (msg.message_id == null || msg.from?.id == null || msg.chat?.id == null) return;
    this.inboundHandler?.({
      messageId: String(msg.message_id),
      senderId: String(msg.from.id),
      chatId: String(msg.chat.id),
      text: msg.text,
    });
  }

  health() {
    return {
      channel: "telegram" as const,
      live: false,
      enabled: this.connection !== "disabled",
      connection: this.connection,
      webhookConflict: this.webhookConflict,
    };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.token) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:telegram");
    }
    if (!input.peerRef) throw new PenglaiError("INVALID_INPUT", "TELEGRAM_REPLY_TARGET");
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: input.peerRef, text: input.text }),
      redirect: "error",
    });
    const body = (await response.json()) as { ok?: boolean };
    if (!body.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "TELEGRAM_SEND_FAILED");
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.pollAbort?.abort();
    this.pollAbort = undefined;
    this.token = undefined;
    this.connection = "disabled";
  }

  private pollAbort: AbortController | undefined;

  private startReceive(): void {
    if (this.pollAbort || !this.token) return;
    this.pollAbort = new AbortController();
    const signal = this.pollAbort.signal;
    const loop = async () => {
      while (!signal.aborted && this.token) {
        try {
          await this.pollOnce(signal);
        } catch {
          if (signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, 2_000 + Math.floor(Math.random() * 1_000)));
        }
      }
    };
    void loop();
  }

  private async pollOnce(signal: AbortSignal): Promise<void> {
    if (!this.token) return;
    const response = await this.fetchImpl(
      `https://api.telegram.org/bot${this.token}/getUpdates?timeout=25&offset=${this.offset}&allowed_updates=${encodeURIComponent('["message"]')}`,
      { redirect: "error", signal },
    );
    const body = (await response.json()) as {
      ok?: boolean;
      result?: Array<{
        update_id?: number;
        message?: { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } };
      }>;
    };
    if (!body.ok || !Array.isArray(body.result)) return;
    for (const update of body.result) this.ingestUpdate(update);
  }
}
