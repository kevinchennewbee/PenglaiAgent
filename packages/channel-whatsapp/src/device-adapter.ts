import { PenglaiError } from "@penglai/contracts";
import type { WhatsAppSessionStore } from "./session-store.js";

export const WHATSAPP_RISK_ACK_VERSION = "0.5.7-wa-1";

export type WhatsAppConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export interface WhatsAppLinkSocket {
  send(jid: string, text: string, id: string): Promise<void>;
  react?(jid: string, messageId: string, emoji: string, outboundId: string): Promise<void>;
  logout(): Promise<void>;
  close?(): Promise<void>;
}

export interface WhatsAppInbound {
  messageId: string;
  senderId: string;
  text: string;
  vendorTarget: string;
  chatType: "private";
  accountRef: string;
}

/**
 * Opt-in WhatsApp device-link. Community protocol, not WhatsApp Cloud API.
 * Baileys is injected by the host when the production dependency is present.
 */
export class WhatsAppDeviceAdapter {
  connection: WhatsAppConnection = "disabled";
  accountRef: string | undefined;
  riskAckAt: number | null = null;
  riskAckVersion: string | null = null;
  lastQr: string | undefined;
  private echoIds = new Set<string>();
  private socket: WhatsAppLinkSocket | undefined;
  private inboundHandler?: (msg: WhatsAppInbound) => void | Promise<void>;
  private operationId = "whatsapp:device-link";
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private stopped = true;
  private generation = 0;

  constructor(
    private readonly sessions: WhatsAppSessionStore,
    private readonly startLink: (opts: {
      onQr: (ref: string) => void;
      onOpen: () => void;
      onMessage: (msg: WhatsAppInbound) => void | Promise<void>;
      isEcho: (id: string) => boolean;
      onError?: (code: string) => void;
      onClose?: () => void;
    }) => Promise<WhatsAppLinkSocket>,
    private readonly reconnectDelaysMs: readonly number[] = [1_000, 3_000, 5_000, 10_000, 30_000],
  ) {}

  async beginConnection(input: { method: string; riskAck?: boolean }): Promise<{ kind: "device-link"; live: false; operationId: string }> {
    if (input.riskAck !== true && this.riskAckAt == null) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_RISK_ACK");
    }
    if (input.method !== "device-link") throw new PenglaiError("INVALID_INPUT", "unsupported connection method");
    this.riskAckAt = Date.now();
    this.riskAckVersion = WHATSAPP_RISK_ACK_VERSION;
    this.connection = "connecting";
    this.operationId = `whatsapp:device-link:${Date.now()}`;
    this.stopped = false;
    this.reconnectAttempt = 0;
    const generation = ++this.generation;
    await this.openLink(generation);
    return { kind: "device-link", live: false, operationId: this.operationId };
  }

  private async openLink(generation: number): Promise<void> {
    const socket = await this.startLink({
      onQr: (ref) => {
        if (this.stopped || generation !== this.generation) return;
        this.lastQr = ref;
        this.connection = "connecting";
      },
      onOpen: () => {
        if (this.stopped || generation !== this.generation) return;
        this.connection = "connected";
        this.lastQr = undefined;
        this.reconnectAttempt = 0;
      },
      onMessage: async (msg) => {
        if (this.stopped || generation !== this.generation) return;
        if (this.isEcho(msg.messageId)) return;
        await this.inboundHandler?.(msg);
      },
      isEcho: (id) => this.isEcho(id),
      onError: () => {
        if (this.stopped || generation !== this.generation) return;
        this.connection = "failed";
      },
      onClose: () => {
        if (this.stopped || generation !== this.generation) return;
        this.socket = undefined;
        this.connection = "connecting";
        this.scheduleReconnect(generation);
      },
    });
    if (this.stopped || generation !== this.generation) {
      await socket.close?.();
      return;
    }
    this.socket = socket;
  }

  private scheduleReconnect(generation: number): void {
    if (this.stopped || generation !== this.generation || this.reconnectTimer) return;
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? 30_000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped || generation !== this.generation) return;
      void this.openLink(generation).catch(() => {
        if (this.stopped || generation !== this.generation) return;
        this.connection = "failed";
        this.scheduleReconnect(generation);
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async pollConnection(): Promise<{ status: WhatsAppConnection }> {
    return { status: this.connection };
  }

  peekQr(): { qrPayload: string } | undefined {
    if (!this.lastQr || this.connection !== "connecting") return undefined;
    return { qrPayload: this.lastQr };
  }

  onInbound(handler: (msg: WhatsAppInbound) => void | Promise<void>): void {
    this.inboundHandler = handler;
  }

  health() {
    return {
      channel: "whatsapp" as const,
      live: false,
      enabled: this.connection !== "disabled",
      connection: this.connection,
      risk: "community-protocol" as const,
      supportLevel: "experimental" as const,
      riskAckVersion: this.riskAckVersion,
    };
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.socket || !input.peerRef) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:whatsapp");
    }
    const id = this.reserveOutboundId();
    await this.socket.send(input.peerRef, input.text, id);
    return { delivered: true };
  }

  reserveOutboundId(): string {
    const id = `wa-${Date.now()}-${this.echoIds.size}`;
    this.echoIds.add(id);
    return id;
  }

  isEcho(id: string): boolean {
    return this.echoIds.has(id);
  }

  exportPersistedState(): Record<string, unknown> {
    return { echoIds: [...this.echoIds].slice(-256) };
  }

  restorePersistedState(state: Record<string, unknown>): void {
    if (!Array.isArray(state.echoIds)) return;
    for (const id of state.echoIds) {
      if (typeof id === "string" && id) this.echoIds.add(id);
    }
  }

  async react(input: {
    vendorTarget: string;
    vendorMessageId: string;
    emoji: string;
    action: "add" | "remove";
    signal: AbortSignal;
  }): Promise<void> {
    if (this.connection !== "connected" || !this.socket || !input.vendorTarget || !input.vendorMessageId) return;
    if (typeof this.socket.react !== "function") return;
    input.signal.throwIfAborted();
    const id = this.reserveOutboundId();
    await this.socket.react(input.vendorTarget, input.vendorMessageId, input.action === "add" ? input.emoji : "", id);
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    await this.socket?.close?.();
    this.socket = undefined;
    this.lastQr = undefined;
    this.connection = this.riskAckAt ? "not_configured" : "disabled";
  }

  async logout(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    await this.socket?.logout();
    await this.sessions.wipe();
    this.socket = undefined;
    this.echoIds.clear();
    this.lastQr = undefined;
    this.connection = "disabled";
    this.riskAckAt = null;
    this.riskAckVersion = null;
  }
}

export async function missingBaileysLink(): Promise<WhatsAppLinkSocket> {
  throw new PenglaiError("DSH_UNAVAILABLE", "WHATSAPP_BAILEYS_MISSING");
}
