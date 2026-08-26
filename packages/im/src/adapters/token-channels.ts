import { PenglaiError } from "@penglai/contracts";
import { getChannelManifest, refuseFakeQr, type ChannelId } from "../registry.js";
import {
  connectionResultForMethod,
  type ChannelAdapter,
  type ChannelHealth,
  type ConnectionState,
  type InboundChannelEvent,
} from "../channel-adapter.js";

export type TokenChannelId = "slack" | "telegram" | "discord";

export interface TokenVault {
  resolve(ref: string): string | undefined;
}

/**
 * Token/OAuth channels. The product action is "Connect", never a forged QR.
 * They stay out of LIVE_CHANNEL_IDS until a real bidirectional proof exists.
 */
export class TokenChannelAdapter implements ChannelAdapter {
  readonly id: ChannelId;
  private enabled = false;
  private connection: ConnectionState = "disabled";
  private inbound: ((event: InboundChannelEvent) => void | Promise<void>) | undefined;

  constructor(
    id: TokenChannelId,
    private readonly vault: TokenVault,
  ) {
    this.id = id;
  }

  manifest() {
    return getChannelManifest(this.id);
  }

  async enable() {
    this.enabled = true;
    if (this.connection === "disabled") this.connection = "not_configured";
  }

  async disable() {
    this.enabled = false;
    this.connection = "disabled";
  }

  async beginConnection(input: { method: string; credentialRef?: string; riskAck?: boolean }) {
    refuseFakeQr(this.id, input.method);
    if (input.method !== "token" && input.method !== "oauth" && input.method !== "manifest") {
      throw new PenglaiError("INVALID_INPUT", "unsupported connection method");
    }
    await this.enable();
    void (input.credentialRef ? this.vault.resolve(input.credentialRef) : undefined);
    this.connection = "not_configured";
    return connectionResultForMethod(this.id, input.method);
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
      channel: this.id,
      live: false,
      enabled: this.enabled,
      connection: this.connection,
    };
  }

  async sendText(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${this.id}`);
  }

  async sendArtifact(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${this.id}`);
  }

  async disconnect() {
    this.connection = this.enabled ? "not_configured" : "disabled";
  }

  async logout() {
    await this.disconnect();
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
