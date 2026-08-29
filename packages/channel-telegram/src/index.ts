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
  private inboundHandler?: (msg: TelegramInbound) => void | Promise<void>;
  private offsetPersist?: (offset: number) => void;

  constructor(
    private readonly vault: { resolve(ref: string): TelegramCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async beginConnection(input: { method: string; credentialRef: string }): Promise<{ kind: "token"; connection: TelegramConnection; operationId: string }> {
    if (input.method === "qr") throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NO_QR");
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.token) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "telegram credentials missing");
    }
    this.connection = "connecting";
    const me = await this.fetchApi(creds.token, "getMe", {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const meBody = await readTelegramJson<{ ok?: boolean; result?: { id?: number } }>(me);
    if (!me.ok || !meBody.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "TELEGRAM_TOKEN_INVALID");
    }
    this.accountRef = meBody.result?.id != null ? String(meBody.result.id) : undefined;
    const webhook = await this.fetchApi(creds.token, "getWebhookInfo", {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const hookBody = await readTelegramJson<{ ok?: boolean; result?: { url?: string } }>(webhook);
    if (!webhook.ok || !hookBody.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "TELEGRAM_WEBHOOK_INFO_FAILED");
    }
    this.webhookConflict = Boolean(hookBody.result?.url);
    if (this.webhookConflict) {
      this.connection = "failed";
      throw new PenglaiError("SECURITY_POLICY", "TELEGRAM_WEBHOOK_CONFLICT");
    }
    this.token = creds.token;
    this.connection = "connected";
    this.startReceive();
    return { kind: "token", connection: this.connection, operationId: "telegram:token" };
  }

  async pollConnection(): Promise<{ status: TelegramConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: TelegramInbound) => void | Promise<void>): void {
    this.inboundHandler = handler;
  }

  setOffsetPersist(handler: (offset: number) => void): void {
    this.offsetPersist = handler;
  }

  async ingestUpdate(update: {
    update_id?: number;
    message?: { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } };
  }): Promise<void> {
    const nextOffset = update.update_id === undefined
      ? this.offset
      : Math.max(this.offset, update.update_id + 1);
    const msg = update.message;
    if (msg?.text && msg.chat?.type === "private" && msg.message_id != null && msg.from?.id != null && msg.chat?.id != null && this.accountRef) {
      await this.inboundHandler?.({
        messageId: String(msg.message_id),
        senderId: String(msg.from.id),
        chatId: String(msg.chat.id),
        text: msg.text,
        chatType: "private",
        accountRef: this.accountRef,
      });
    }
    // Telegram's offset is its delivery acknowledgement. Advance it only after
    // Penglai's inbound path has durably accepted a private message.
    if (nextOffset !== this.offset) {
      this.offset = nextOffset;
      this.offsetPersist?.(this.offset);
    }
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
      runtimeBundled: true as const,
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
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_TEXT_SEND_UNAVAILABLE:telegram");
    }
    if (!input.peerRef) throw new PenglaiError("INVALID_INPUT", "TELEGRAM_REPLY_TARGET");
    const response = await this.fetchApi(this.token, "sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: input.peerRef, text: input.text }),
      redirect: "error",
    });
    const body = await readTelegramJson<{ ok?: boolean }>(response);
    if (!response.ok || !body.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "TELEGRAM_SEND_FAILED");
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
    const response = await this.fetchApi(this.token, "setMessageReaction", {
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
    const body = await readTelegramJson<{ ok?: boolean }>(response);
    if (!response.ok || !body.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "TELEGRAM_REACTION_FAILED");
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
      let consecutiveFailures = 0;
      while (!signal.aborted && this.token) {
        try {
          await this.pollOnce(signal);
          consecutiveFailures = 0;
          this.connection = "connected";
        } catch (error) {
          if (signal.aborted) return;
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) this.connection = "failed";
          const retryAfter = retryAfterMs(error);
          await abortableDelay(retryAfter ?? 2_000 + Math.floor(Math.random() * 1_000), signal);
        }
      }
    };
    void loop();
  }

  private async pollOnce(signal: AbortSignal): Promise<void> {
    if (!this.token) return;
    const response = await this.fetchApi(
      this.token,
      "getUpdates",
      { redirect: "error", signal },
      new URLSearchParams({ timeout: "25", offset: String(this.offset), allowed_updates: '["message"]' }),
    );
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "1");
      throw Object.assign(new Error("TELEGRAM_RATE_LIMIT"), {
        retryAfterMs: Math.min(60_000, Math.max(1_000, wait * 1000)),
      });
    }
    const body = await readTelegramJson<{
      ok?: boolean;
      result?: Array<{
        update_id?: number;
        message?: { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } };
      }>;
    }>(response);
    if (!response.ok || !body.ok || !Array.isArray(body.result)) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "TELEGRAM_POLL_FAILED");
    }
    for (const update of body.result) await this.ingestUpdate(update);
  }

  private async fetchApi(
    token: string,
    method: string,
    init: RequestInit,
    query?: URLSearchParams,
  ): Promise<Response> {
    const suffix = query ? `?${query.toString()}` : "";
    try {
      return await this.fetchImpl(`https://api.telegram.org/bot${token}/${method}${suffix}`, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      // Never propagate a fetch implementation error that may contain the URL
      // because Telegram embeds the bot token in the request path.
      throw new PenglaiError("DELIVERY_TRANSIENT", `TELEGRAM_${method.toUpperCase()}_NETWORK`);
    }
  }
}

async function readTelegramJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 1024 * 1024) {
    throw new PenglaiError("DELIVERY_TRANSIENT", "TELEGRAM_RESPONSE_TOO_LARGE");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PenglaiError("DELIVERY_TRANSIENT", "TELEGRAM_RESPONSE_INVALID");
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      done();
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function retryAfterMs(error: unknown): number | undefined {
  if (error && typeof error === "object" && "retryAfterMs" in error) {
    const value = Number((error as { retryAfterMs?: unknown }).retryAfterMs);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}
