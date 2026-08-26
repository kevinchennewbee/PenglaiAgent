import { PenglaiError } from "@penglai/contracts";

export const name = "whatsapp";
export const WHATSAPP_RISK_ACK_VERSION = "0.5.7-wa-1";
export { EncryptedWhatsAppSessionStore, type WhatsAppSessionStore } from "./session-store.js";
export { startBaileysLink } from "./baileys-link.js";
import type { WhatsAppSessionStore } from "./session-store.js";

export type WhatsAppConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export interface WhatsAppLinkSocket {
  send(jid: string, text: string, id: string): Promise<void>;
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
  private inboundHandler?: (msg: WhatsAppInbound) => void;
  private operationId = "whatsapp:device-link";

  constructor(
    private readonly sessions: WhatsAppSessionStore,
    private readonly startLink: (opts: {
      onQr: (ref: string) => void;
      onOpen: () => void;
      onMessage: (msg: WhatsAppInbound) => void;
    }) => Promise<WhatsAppLinkSocket>,
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
    this.socket = await this.startLink({
      onQr: (ref) => {
        this.lastQr = ref;
      },
      onOpen: () => {
        this.connection = "connected";
        this.lastQr = undefined;
      },
      onMessage: (msg) => {
        if (this.isEcho(msg.messageId)) return;
        this.inboundHandler?.(msg);
      },
    });
    return { kind: "device-link", live: false, operationId: this.operationId };
  }

  async pollConnection(): Promise<{ status: WhatsAppConnection }> {
    return { status: this.connection };
  }

  peekQr(): { qrPayload: string } | undefined {
    if (!this.lastQr || this.connection !== "connecting") return undefined;
    return { qrPayload: this.lastQr };
  }

  onInbound(handler: (msg: WhatsAppInbound) => void): void {
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

  async disconnect(): Promise<void> {
    await this.socket?.close?.().catch(() => undefined);
    this.socket = undefined;
    this.lastQr = undefined;
    this.connection = this.riskAckAt ? "not_configured" : "disabled";
  }

  async logout(): Promise<void> {
    await this.socket?.logout().catch(() => undefined);
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
