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
  chatType: "private";
  accountRef: string;
}

export type TelegramConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Telegram Bot HTTP API long polling. Never a QR shortcut. */
export class TelegramAdapter {
  connection: TelegramConnection = "not_configured";
  accountRef: string | undefined;
  private token: string | undefined;
  webhookConflict = false;
  private offset = 0;
  private inboundHandler?: (msg: TelegramInbound) => void;
  private offsetPersist?: (offset: number) => void;

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
    const meBody = (await me.json()) as { ok?: boolean; result?: { id?: number } };
    if (!meBody.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "TELEGRAM_TOKEN_INVALID");
    }
    this.accountRef = meBody.result?.id != null ? String(meBody.result.id) : undefined;
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

  setOffsetPersist(handler: (offset: number) => void): void {
    this.offsetPersist = handler;
  }

  ingestUpdate(update: {
    update_id?: number;
    message?: { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } };
  }): void {
    if (update.update_id !== undefined) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      this.offsetPersist?.(this.offset);
    }
    const msg = update.message;
    if (!msg?.text || msg.chat?.type !== "private") return;
    if (msg.message_id == null || msg.from?.id == null || msg.chat?.id == null || !this.accountRef) return;
    this.inboundHandler?.({
      messageId: String(msg.message_id),
      senderId: String(msg.from.id),
      chatId: String(msg.chat.id),
      text: msg.text,
      chatType: "private",
      accountRef: this.accountRef,
    });
  }

  getUpdateOffset(): number {
    return this.offset;
  }

  restoreUpdateOffset(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0) return;
    this.offset = offset;
  }

  exportPersistedState(): Record<string, unknown> {
    return { updateOffset: this.offset };
  }

  restorePersistedState(state: Record<string, unknown>): void {
    if (typeof state.updateOffset === "number") this.restoreUpdateOffset(state.updateOffset);
  }

  health() {
    return {
      channel: "telegram" as const,
      live: false,
      enabled: this.connection !== "disabled",
      connection: this.connection,
      webhookConflict: this.webhookConflict,
      updateOffset: this.offset,
      proxyConfigured: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY),
      noProxyConfigured: Boolean(process.env.NO_PROXY),
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

  async react(input: {
    vendorTarget: string;
    vendorMessageId: string;
    emoji: string;
    action: "add" | "remove";
    signal: AbortSignal;
  }): Promise<void> {
    if (!this.token || !input.vendorTarget || !input.vendorMessageId) return;
    const messageId = Number(input.vendorMessageId);
    if (!Number.isSafeInteger(messageId)) return;
    await this.fetchImpl(`https://api.telegram.org/bot${this.token}/setMessageReaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: input.vendorTarget,
        message_id: messageId,
        reaction: input.action === "add" ? [{ type: "emoji", emoji: input.emoji }] : [],
      }),
      redirect: "error",
      signal: input.signal,
    });
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
        } catch (error) {
          if (signal.aborted) return;
          const retryAfter = retryAfterMs(error);
          await new Promise((resolve) => setTimeout(resolve, retryAfter ?? 2_000 + Math.floor(Math.random() * 1_000)));
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
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "1");
      throw Object.assign(new Error("TELEGRAM_RATE_LIMIT"), {
        retryAfterMs: Math.min(60_000, Math.max(1_000, wait * 1000)),
      });
    }
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

function retryAfterMs(error: unknown): number | undefined {
  if (error && typeof error === "object" && "retryAfterMs" in error) {
    const value = Number((error as { retryAfterMs?: unknown }).retryAfterMs);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}
