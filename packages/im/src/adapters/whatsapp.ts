import { PenglaiError } from "@penglai/contracts";
import type { ChannelAdapter, ChannelHealth } from "../channel-adapter.js";

/**
 * WhatsApp stays experimental. Penglai does not vendor Baileys or claim
 * account safety. Enable only after an explicit risk acknowledgement.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = "whatsapp" as const;
  private enabled = false;

  async beginConnection(input: { method: string; riskAck?: boolean }) {
    if (input.riskAck !== true) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_RISK_ACK");
    }
    if (input.method !== "device-link") {
      throw new PenglaiError("INVALID_INPUT", "unsupported connection method");
    }
    this.enabled = true;
    return { qr: false as const, live: false as const };
  }

  async health(): Promise<ChannelHealth> {
    return {
      channel: "whatsapp",
      live: false,
      connection: this.enabled ? "not_configured" : "disabled",
    };
  }

  async sendText(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:whatsapp");
  }

  async sendArtifact(): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:whatsapp");
  }
}
