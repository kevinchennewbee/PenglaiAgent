import { PenglaiError } from "@penglai/contracts";

export const name = "discord";

export interface DiscordCredentials {
  token: string;
}

export interface DiscordInbound {
  messageId: string;
  senderId: string;
  channelId: string;
  text: string;
  chatType: "private";
  accountRef: string;
}

export type DiscordConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/** Official Discord Bot REST. Never a QR shortcut. */
export class DiscordAdapter {
  connection: DiscordConnection = "not_configured";
  accountRef: string | undefined;
  private token: string | undefined;
  intentsHint = "Enable Message Content Intent in the Discord Developer Portal.";
  private inboundHandler?: (msg: DiscordInbound) => void;

  private gateway: { close(): void } | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private sequence: number | null = null;
  private stopped = false;

  constructor(
    private readonly vault: { resolve(ref: string): DiscordCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly gateways?: {
      connect(token: string, onMessage: (event: Parameters<DiscordAdapter["ingestMessage"]>[0]) => void): { close(): void };
    },
  ) {}

  async beginConnection(input: { method: string; credentialRef: string }): Promise<{ kind: "token"; live: false; operationId: string }> {
    if (input.method === "qr") throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NO_QR");
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.token) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "discord credentials missing");
    }
    this.connection = "connecting";
    const response = await this.fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bot ${creds.token}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      this.connection = "failed";
      throw new PenglaiError("AUTH_EXPIRED", "DISCORD_TOKEN_INVALID");
    }
    const me = (await response.json()) as { id?: string };
    this.accountRef = String(me.id ?? "").trim() || undefined;
    this.token = creds.token;
    this.stopped = false;
    this.reconnectAttempt = 0;
    if (this.gateways) {
      this.gateway = this.gateways.connect(creds.token, (event) => this.ingestMessage(event));
    } else {
      await this.connectGateway(creds.token);
    }
    this.connection = "connected";
    return { kind: "token", live: false, operationId: "discord:token" };
  }

  async pollConnection(): Promise<{ status: DiscordConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: DiscordInbound) => void): void {
    this.inboundHandler = handler;
  }

  ingestMessage(event: {
    id?: string;
    content?: string;
    channel_id?: string;
    author?: { id?: string; bot?: boolean };
    guild_id?: string;
  }): void {
    if (event.guild_id || event.author?.bot || !event.content) return;
    const messageId = String(event.id ?? "").trim();
    const senderId = String(event.author?.id ?? "").trim();
    const channelId = String(event.channel_id ?? "").trim();
    if (!this.accountRef || !messageId || !senderId || !channelId) return;
    this.inboundHandler?.({
      messageId,
      senderId,
      channelId,
      text: event.content,
      chatType: "private",
      accountRef: this.accountRef,
    });
  }

  health() {
    return {
      channel: "discord" as const,
      live: false,
      enabled: this.connection !== "disabled",
      connection: this.connection,
      intentsHint: this.intentsHint,
    };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.token || !input.peerRef) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:discord");
    }
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${input.peerRef}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: input.text }),
      redirect: "error",
    });
    if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_SEND_FAILED");
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.gateway?.close();
    this.gateway = undefined;
    this.token = undefined;
    this.connection = "disabled";
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleReconnect(token: string): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = [1_000, 3_000, 10_000][Math.min(this.reconnectAttempt, 2)] ?? 10_000;
    this.reconnectAttempt += 1;
    this.connection = "connecting";
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectGateway(token)
        .then(() => {
          this.reconnectAttempt = 0;
          if (!this.stopped) this.connection = "connected";
        })
        .catch(() => {
          this.connection = "failed";
          this.scheduleReconnect(token);
        });
    }, delay);
  }

  private async connectGateway(token: string): Promise<void> {
    const hello = await this.fetchImpl("https://discord.com/api/v10/gateway", {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await hello.json()) as { url?: string };
    if (!body.url?.startsWith("wss://")) throw new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_URL");
    const ws = new WebSocket(`${body.url}?v=10&encoding=json`);
    this.sequence = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_TIMEOUT")), 15_000);
      let identified = false;
      ws.addEventListener("message", (ev) => {
        try {
          const parsed = JSON.parse(String((ev as MessageEvent).data)) as {
            op?: number;
            t?: string;
            d?: Record<string, unknown>;
            s?: number | null;
          };
          if (typeof parsed.s === "number") this.sequence = parsed.s;
          if (parsed.op === 10) {
            const interval = Number((parsed.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval);
            if (!Number.isFinite(interval) || interval <= 0) {
              clearTimeout(timer);
              reject(new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_HELLO"));
              return;
            }
            this.clearHeartbeat();
            this.heartbeatTimer = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: 1, d: this.sequence }));
              }
            }, interval);
            ws.send(JSON.stringify({
              op: 2,
              d: {
                token,
                intents: 4096 | 512,
                properties: { os: "penglai", browser: "penglai", device: "penglai" },
              },
            }));
          }
          if (parsed.t === "READY" && !identified) {
            identified = true;
            clearTimeout(timer);
            resolve();
          }
          if (parsed.t === "MESSAGE_CREATE" && parsed.d) this.ingestMessage(parsed.d);
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener("error", () => {
        this.clearHeartbeat();
        if (!identified) {
          clearTimeout(timer);
          reject(new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_ERROR"));
        } else if (!this.stopped) {
          this.connection = "failed";
        }
      });
      ws.addEventListener("close", () => {
        this.clearHeartbeat();
        if (this.stopped) return;
        if (this.connection === "connected" || identified) this.scheduleReconnect(token);
        else if (!identified) {
          clearTimeout(timer);
          reject(new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_CLOSED"));
        }
      });
    });
    this.gateway = {
      close: () => {
        this.clearHeartbeat();
        ws.close();
      },
    };
  }
}
