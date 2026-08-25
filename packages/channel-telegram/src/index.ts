import { PenglaiError } from "@penglai/contracts";

export const name = "telegram";

export interface TelegramCredentials {
  token: string;
}

export type TelegramConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Telegram Bot HTTP API long polling. Never a QR shortcut. */
export class TelegramAdapter {
  connection: TelegramConnection = "not_configured";
  private token?: string;
  webhookConflict = false;

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
    this.token = creds.token;
    this.connection = "connected";
    return { kind: "token", live: false, operationId: "telegram:token" };
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
    this.token = undefined;
    this.connection = "disabled";
  }
}
