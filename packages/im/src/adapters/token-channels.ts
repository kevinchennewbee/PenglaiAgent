import { PenglaiError } from "@penglai/contracts";
import type { ChannelId } from "../registry.js";
import { refuseFakeQr } from "../registry.js";
import type { ChannelAdapter, ChannelHealth } from "../channel-adapter.js";

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
  private connected = false;

  constructor(
    id: TokenChannelId,
    private readonly vault: TokenVault,
  ) {
    this.id = id;
  }

  async beginConnection(input: { method: string; credentialRef?: string; riskAck?: boolean }) {
    refuseFakeQr(this.id, input.method);
    if (input.method !== "token" && input.method !== "oauth" && input.method !== "manifest") {
      throw new PenglaiError("INVALID_INPUT", "unsupported connection method");
    }
    const token = input.credentialRef ? this.vault.resolve(input.credentialRef) : undefined;
    this.connected = Boolean(token);
    return { qr: false as const, live: false as const };
  }

  async health(): Promise<ChannelHealth> {
    return {
      channel: this.id,
      live: false,
      connection: this.connected ? "connected" : "not_configured",
    };
  }

  async sendText(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${this.id}`);
  }

  async sendArtifact(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${this.id}`);
  }
}
