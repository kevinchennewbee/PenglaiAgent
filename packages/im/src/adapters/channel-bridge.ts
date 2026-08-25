import { PenglaiError } from "@penglai/contracts";
import { DingTalkAdapter } from "@penglai/channel-dingtalk";
import { WeComAdapter } from "@penglai/channel-wecom";
import { QqAdapter } from "@penglai/channel-qq";
import { getChannelManifest, type ChannelId } from "../registry.js";
import {
  type ChannelAdapter,
  type ChannelHealth,
  type ConnectionResult,
  type ConnectionState,
  type InboundChannelEvent,
} from "../channel-adapter.js";

type QrLike = {
  beginConnection(input: { method?: string; credentialRef?: string }): Promise<{
    kind: "qr" | "token";
    live: false;
    operationId: string;
    expiresAt?: number;
  }>;
  pollConnection(operationId: string): Promise<{ status: string }>;
  health(): { channel: ChannelId; live: boolean; enabled?: boolean; connection: string };
  sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }>;
  disconnect(): Promise<void>;
};

function wrap(id: ChannelId, adapter: QrLike): ChannelAdapter {
  const manifest = getChannelManifest(id);
  let inbound: ((event: InboundChannelEvent) => void) | undefined;
  return {
    id,
    manifest: () => manifest,
    async enable() {},
    async disable() {
      await adapter.disconnect();
    },
    async beginConnection(input) {
      const begun = await adapter.beginConnection(input);
      if (begun.kind === "qr") {
        return { kind: "qr", live: false, operationId: begun.operationId, expiresAt: begun.expiresAt ?? Date.now() + 120_000 };
      }
      return { kind: begun.kind, live: false, operationId: begun.operationId };
    },
    async pollConnection(operationId) {
      const polled = await adapter.pollConnection(operationId);
      return { status: polled.status as ConnectionState };
    },
    async cancelConnection() {
      await adapter.disconnect();
    },
    async start() {},
    async stop() {
      await adapter.disconnect();
    },
    async health(): Promise<ChannelHealth> {
      const row = adapter.health();
      return {
        channel: id,
        live: false,
        enabled: row.enabled ?? row.connection !== "disabled",
        connection: row.connection as ConnectionState,
      };
    },
    sendText: (input) => adapter.sendText(input),
    async sendArtifact() {
      throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${id}`);
    },
    disconnect: () => adapter.disconnect(),
    logout: () => adapter.disconnect(),
    deleteCredentials: () => adapter.disconnect(),
    onInbound(handler) {
      inbound = handler;
      void inbound;
    },
    capabilities: () => manifest.capabilities,
  };
}

export function dingtalkChannelAdapter(adapter: DingTalkAdapter): ChannelAdapter {
  return wrap("dingtalk", adapter);
}

export function wecomChannelAdapter(adapter: WeComAdapter): ChannelAdapter {
  return wrap("wecom", adapter);
}

export function qqChannelAdapter(adapter: QqAdapter): ChannelAdapter {
  return wrap("qq", adapter);
}
