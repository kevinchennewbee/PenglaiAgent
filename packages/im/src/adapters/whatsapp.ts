import { PenglaiError } from "@penglai/contracts";
import { getChannelManifest } from "../registry.js";
import {
  type ChannelAdapter,
  type ChannelHealth,
  type ConnectionResult,
  type ConnectionState,
  type InboundChannelEvent,
} from "../channel-adapter.js";

/**
 * Source-only compatibility shell. Penglai 0.5.7 does not bundle a WhatsApp
 * runtime, so every connection attempt fails before any external side effect.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = "whatsapp" as const;
  private enabled = false;
  private connection: ConnectionState = "disabled";
  private riskAckAt: number | null = null;
  private inbound: ((event: InboundChannelEvent) => void | Promise<void>) | undefined;

  manifest() {
    return getChannelManifest(this.id);
  }

  async enable() {
    if (this.riskAckAt == null) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_RISK_ACK");
    }
    this.enabled = true;
    if (this.connection === "disabled") this.connection = "not_configured";
  }

  async disable() {
    this.enabled = false;
    this.connection = "disabled";
  }

  async beginConnection(input: { method: string; riskAck?: boolean }): Promise<ConnectionResult> {
    void input;
    throw new PenglaiError("DSH_UNAVAILABLE", "CHANNEL_RUNTIME_NOT_BUNDLED:whatsapp");
  }

  async pollConnection() {
    return { status: this.connection };
  }

  async cancelConnection() {
    this.connection = this.enabled ? "not_configured" : "disabled";
  }

  async start() {
    if (!this.enabled) throw new PenglaiError("SECURITY_POLICY", "CHANNEL_DISABLED");
  }

  async stop() {
    this.connection = this.enabled ? "not_configured" : "disabled";
  }

  async health(): Promise<ChannelHealth> {
    return {
      channel: "whatsapp",
      live: false,
      enabled: this.enabled,
      connection: this.connection,
    };
  }

  async sendText(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:whatsapp");
  }

  async sendArtifact(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:whatsapp");
  }

  async disconnect() {
    this.connection = this.enabled ? "not_configured" : "disabled";
  }

  async logout() {
    this.enabled = false;
    this.connection = "disabled";
    this.riskAckAt = null;
  }

  async deleteCredentials() {
    await this.logout();
  }

  onInbound(handler: (event: InboundChannelEvent) => void | Promise<void>) {
    this.inbound = handler;
    void this.inbound;
  }

  capabilities() {
    return this.manifest().capabilities;
  }
}
