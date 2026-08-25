import { PenglaiError } from "@penglai/contracts";

export const name = "whatsapp";
export const WHATSAPP_RISK_ACK_VERSION = "0.5.7-wa-1";

export type WhatsAppConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

export interface WhatsAppSessionStore {
  read(): Promise<Uint8Array | undefined>;
  write(bytes: Uint8Array): Promise<void>;
  wipe(): Promise<void>;
}

/**
 * Opt-in WhatsApp device-link. This is a community protocol, not WhatsApp
 * Cloud API. Baileys is injected when the production dependency is present.
 */
export class WhatsAppDeviceAdapter {
  connection: WhatsAppConnection = "disabled";
  riskAckAt: number | null = null;
  riskAckVersion: string | null = null;
  private echoIds = new Set<string>();

  constructor(
    private readonly sessions: WhatsAppSessionStore,
    private readonly startLink: (opts: {
      onQr: (ref: string) => void;
      onOpen: () => void;
    }) => Promise<{ send(jid: string, text: string, id: string): Promise<void>; logout(): Promise<void> }>,
  ) {}

  async beginConnection(input: { method: string; riskAck?: boolean }): Promise<{ kind: "device-link"; live: false; operationId: string }> {
    if (input.riskAck !== true && this.riskAckAt == null) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_RISK_ACK");
    }
    if (input.method !== "device-link") throw new PenglaiError("INVALID_INPUT", "unsupported connection method");
    this.riskAckAt = Date.now();
    this.riskAckVersion = WHATSAPP_RISK_ACK_VERSION;
    this.connection = "connecting";
    await this.startLink({
      onQr: () => undefined,
      onOpen: () => {
        this.connection = "connected";
      },
    });
    return { kind: "device-link", live: false, operationId: "whatsapp:device-link" };
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
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:whatsapp");
    void input;
  }

  reserveOutboundId(): string {
    const id = `wa-${Date.now()}-${this.echoIds.size}`;
    this.echoIds.add(id);
    return id;
  }

  isEcho(id: string): boolean {
    return this.echoIds.has(id);
  }

  async logout(): Promise<void> {
    await this.sessions.wipe();
    this.echoIds.clear();
    this.connection = "disabled";
    this.riskAckAt = null;
    this.riskAckVersion = null;
  }
}
