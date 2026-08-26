import { PenglaiError } from "@penglai/contracts";

export const name = "discord";

/** GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT */
export const DISCORD_GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

export const DISCORD_RECONNECT_DELAYS_MS = Object.freeze([1_000, 3_000, 5_000, 10_000, 30_000]);

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

export interface DiscordSocket {
  readyState: number;
  addEventListener(type: string, listener: (ev: { data?: unknown; code?: number }) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Official Discord Bot REST. Never a QR shortcut. */
export class DiscordAdapter {
  connection: DiscordConnection = "not_configured";
  accountRef: string | undefined;
  private token: string | undefined;
  intentsHint = "Enable Message Content Intent in the Discord Developer Portal.";
  private inboundHandler?: (msg: DiscordInbound) => void;

  private gateway: { close(): void } | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private gatewayUrl: string | null = null;
  private heartbeatAcked = true;
  private generation = 0;
  private stopped = false;
  private dmChannelIds = new Set<string>();
  private groupDmChannelIds = new Set<string>();

  constructor(
    private readonly vault: { resolve(ref: string): DiscordCredentials | undefined },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly transport?: {
      connect?(token: string, onMessage: (event: Parameters<DiscordAdapter["ingestMessage"]>[0]) => void): { close(): void };
      createWebSocket?(url: string): DiscordSocket;
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
    this.sessionId = null;
    this.resumeUrl = null;
    this.sequence = null;
    if (this.transport?.connect) {
      this.gateway = this.transport.connect(creds.token, (event) => this.ingestMessage(event));
    } else {
      await this.connectGateway(false);
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
    channel_type?: number;
  }): void {
    if (event.guild_id || event.author?.bot || !event.content) return;
    const messageId = String(event.id ?? "").trim();
    const senderId = String(event.author?.id ?? "").trim();
    const channelId = String(event.channel_id ?? "").trim();
    if (!this.accountRef || !messageId || !senderId || !channelId) return;
    if (event.channel_type === 3 || this.groupDmChannelIds.has(channelId)) return;
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
      intents: DISCORD_GATEWAY_INTENTS,
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

  async react(input: {
    vendorTarget: string;
    vendorMessageId: string;
    emoji: string;
    action: "add" | "remove";
    signal: AbortSignal;
  }): Promise<void> {
    if (!this.token || !input.vendorTarget || !input.vendorMessageId || !input.emoji) return;
    const encoded = encodeURIComponent(input.emoji);
    const url = `https://discord.com/api/v10/channels/${input.vendorTarget}/messages/${input.vendorMessageId}/reactions/${encoded}/@me`;
    await this.fetchImpl(url, {
      method: input.action === "add" ? "PUT" : "DELETE",
      headers: { authorization: `Bot ${this.token}` },
      redirect: "error",
      signal: input.signal,
    });
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.gateway?.close();
    this.gateway = undefined;
    this.token = undefined;
    this.sessionId = null;
    this.resumeUrl = null;
    this.connection = "disabled";
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.heartbeatAcked = true;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.token) return;
    const delay = DISCORD_RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, DISCORD_RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    this.reconnectAttempt += 1;
    this.connection = "connecting";
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectGateway(Boolean(this.sessionId))
        .then(() => {
          this.reconnectAttempt = 0;
          if (!this.stopped) this.connection = "connected";
        })
        .catch(() => {
          this.connection = "failed";
          this.scheduleReconnect();
        });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async connectGateway(resume: boolean): Promise<void> {
    const hello = await this.fetchImpl("https://discord.com/api/v10/gateway", {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await hello.json()) as { url?: string };
    if (!body.url?.startsWith("wss://")) throw new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_URL");
    this.gatewayUrl = body.url;
    const url = new URL(resume && this.resumeUrl ? this.resumeUrl : body.url);
    url.searchParams.set("v", "10");
    url.searchParams.set("encoding", "json");
    const create = this.transport?.createWebSocket ?? ((href: string) => new WebSocket(href) as unknown as DiscordSocket);
    const ws = create(url.href);
    const generation = ++this.generation;
    if (!resume) this.sequence = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_TIMEOUT")), 15_000);
      let identified = false;
      const markReady = () => {
        if (identified) return;
        identified = true;
        clearTimeout(timer);
        resolve();
      };
      ws.addEventListener("message", (ev) => {
        if (generation !== this.generation || this.stopped) return;
        try {
          const parsed = JSON.parse(String(ev.data ?? "")) as {
            op?: number;
            t?: string;
            d?: Record<string, unknown> | boolean;
            s?: number | null;
          };
          this.handleGatewayPacket(parsed, ws, resume, markReady, () => {
            clearTimeout(timer);
            reject(new PenglaiError("DELIVERY_TRANSIENT", "DISCORD_GATEWAY_HELLO"));
          });
        } catch {
          /* ignore malformed */
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
      ws.addEventListener("close", (event) => {
        this.clearHeartbeat();
        if (this.stopped) return;
        const code = Number(event.code) || 0;
        if (code === 4004 || code === 4013 || code === 4014) {
          this.connection = "failed";
          if (!identified) {
            clearTimeout(timer);
            reject(new PenglaiError("AUTH_EXPIRED", code === 4004 ? "DISCORD_TOKEN_INVALID" : "DISCORD_INTENTS"));
          }
          return;
        }
        if (this.connection === "connected" || identified) this.scheduleReconnect();
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

  handleGatewayPacket(
    parsed: { op?: number; t?: string; d?: Record<string, unknown> | boolean; s?: number | null },
    ws: DiscordSocket,
    resume: boolean,
    markReady: () => void,
    onBadHello: () => void,
  ): void {
    if (typeof parsed.s === "number") this.sequence = parsed.s;
    if (parsed.op === 10) {
      const hello = parsed.d && typeof parsed.d === "object" ? parsed.d : undefined;
      const interval = Number(hello?.heartbeat_interval);
      if (!Number.isFinite(interval) || interval < 1_000) {
        onBadHello();
        return;
      }
      this.startHeartbeat(interval, ws);
      if (resume && this.sessionId && this.token) {
        this.sendGateway(ws, {
          op: 6,
          d: { token: this.token, session_id: this.sessionId, seq: this.sequence },
        });
      } else if (this.token) {
        this.sendGateway(ws, {
          op: 2,
          d: {
            token: this.token,
            intents: DISCORD_GATEWAY_INTENTS,
            properties: { os: "penglai", browser: "penglai", device: "penglai" },
          },
        });
      }
      return;
    }
    if (parsed.op === 11) {
      this.heartbeatAcked = true;
      return;
    }
    if (parsed.op === 1) {
      this.heartbeat(ws);
      return;
    }
    if (parsed.op === 7) {
      ws.close(4000, "Reconnect requested");
      return;
    }
    if (parsed.op === 9) {
      if (parsed.d !== true) {
        this.sessionId = null;
        this.resumeUrl = null;
        this.sequence = null;
      }
      ws.close(4000, "Invalid session");
      return;
    }
    if (parsed.op !== 0) return;
    if (parsed.t === "READY" && parsed.d && typeof parsed.d === "object") {
      this.sessionId = typeof parsed.d.session_id === "string" ? parsed.d.session_id : null;
      this.resumeUrl = typeof parsed.d.resume_gateway_url === "string" ? parsed.d.resume_gateway_url : null;
      this.rememberPrivateChannels(parsed.d.private_channels);
      markReady();
    } else if (parsed.t === "RESUMED") {
      markReady();
    } else if (parsed.t === "MESSAGE_CREATE" && parsed.d && typeof parsed.d === "object") {
      this.ingestMessage(parsed.d);
    }
  }

  private rememberPrivateChannels(channels: unknown): void {
    if (!Array.isArray(channels)) return;
    for (const row of channels) {
      const rec = row as { id?: string; type?: number };
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      if (rec.type === 1) this.dmChannelIds.add(id);
      if (rec.type === 3) this.groupDmChannelIds.add(id);
    }
  }

  private sendGateway(ws: DiscordSocket, payload: unknown): void {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  private startHeartbeat(interval: number, ws: DiscordSocket): void {
    this.clearHeartbeat();
    this.heartbeatAcked = true;
    const schedule = (delay: number) => {
      this.heartbeatTimer = setTimeout(() => {
        if (this.stopped || this.gateway === undefined) return;
        if (!this.heartbeatAcked) {
          ws.close(4000, "Heartbeat was not acknowledged");
          return;
        }
        this.heartbeat(ws);
        schedule(interval);
      }, delay);
      this.heartbeatTimer?.unref?.();
    };
    schedule(Math.floor(interval * Math.random()));
  }

  private heartbeat(ws: DiscordSocket): void {
    this.heartbeatAcked = false;
    this.sendGateway(ws, { op: 1, d: this.sequence });
  }
}
