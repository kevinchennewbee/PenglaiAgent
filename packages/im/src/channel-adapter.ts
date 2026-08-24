import { PenglaiError } from "@penglai/contracts";
import { isLiveChannel, type ChannelId } from "./registry.js";
import { refuseUnliveSend } from "./guided.js";

export interface ChannelHealth {
  channel: ChannelId;
  live: boolean;
  connection: "not_configured" | "connecting" | "connected" | "failed" | "disabled";
}

export interface ChannelAdapter {
  readonly id: ChannelId;
  beginConnection(input: { method: string; riskAck?: boolean }): Promise<{ qr: boolean; live: boolean }>;
  health(): Promise<ChannelHealth>;
  sendText(input: { text: string }): Promise<{ delivered: true }>;
  sendArtifact(input: { artifactId: string }): Promise<{ delivered: true }>;
}

export function assertLiveSend(channel: ChannelId): void {
  if (!isLiveChannel(channel)) refuseUnliveSend(channel);
}

export function guidedAdapter(id: ChannelId): ChannelAdapter {
  return {
    id,
    async beginConnection() {
      return { qr: false, live: false };
    },
    async health() {
      return { channel: id, live: false, connection: "disabled" };
    },
    async sendText() {
      refuseUnliveSend(id);
    },
    async sendArtifact() {
      refuseUnliveSend(id);
    },
  };
}

export function requireAdapter(adapters: ReadonlyMap<ChannelId, ChannelAdapter>, channel: ChannelId): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${channel}`);
  return adapter;
}
