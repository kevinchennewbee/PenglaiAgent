import { PenglaiError } from "@penglai/contracts";
import { DingTalkAdapter } from "@penglai/channel-dingtalk";
import { WeComAdapter } from "@penglai/channel-wecom";
import { QqAdapter } from "@penglai/channel-qq";
import { SlackAdapter } from "@penglai/channel-slack";
import { TelegramAdapter } from "@penglai/channel-telegram";
import { DiscordAdapter } from "@penglai/channel-discord";
import { WhatsAppDeviceAdapter } from "@penglai/channel-whatsapp";
import { getChannelManifest, type ChannelId } from "../registry.js";
import {
  type ChannelAdapter,
  type ChannelHealth,
  type ConnectionResult,
  type ConnectionState,
  type InboundChannelEvent,
} from "../channel-adapter.js";

export interface QrPeek {
  verificationUrl?: string;
  expiresAt?: number;
}

type NativeLike = {
  beginConnection(input: { method?: string; credentialRef?: string; riskAck?: boolean }): Promise<{
    kind: "qr" | "token" | "manifest" | "device-link";
    live: false;
    operationId: string;
    expiresAt?: number;
  }>;
  pollConnection(operationId?: string): Promise<{ status: string }>;
  health(): { channel: ChannelId; live: boolean; enabled?: boolean; connection: string };
  sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }>;
  disconnect(): Promise<void>;
  logout?(): Promise<void>;
  peekQr?(operationId?: string): QrPeek | undefined;
  onInbound?(handler: (msg: Record<string, string>) => void): void;
};

function mapInbound(id: ChannelId, msg: Record<string, string>): InboundChannelEvent {
  const vendorTarget = msg.channelId || msg.chatId || msg.senderId || "peer";
  const peerRef = msg.senderId || msg.peerRef || vendorTarget;
  return {
    channel: id,
    botId: `${id}-default`,
    vendorMessageId: msg.messageId || `${Date.now()}`,
    vendorTarget,
    peerRef,
    ...(msg.text ? { text: msg.text } : {}),
    chatType: "private",
  };
}

export function wrapNative(id: ChannelId, adapter: NativeLike): ChannelAdapter & { peekQr(operationId: string): QrPeek | undefined } {
  const manifest = getChannelManifest(id);
  let inbound: ((event: InboundChannelEvent) => void) | undefined;
  adapter.onInbound?.((msg) => {
    const event = mapInbound(id, msg);
    if (event.chatType !== "private") return;
    inbound?.(event);
  });
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
      if (begun.kind === "device-link") return { kind: "device-link", live: false, operationId: begun.operationId };
      if (begun.kind === "manifest") return { kind: "manifest", live: false, operationId: begun.operationId };
      return { kind: "token", live: false, operationId: begun.operationId };
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
    logout: () => (adapter.logout ? adapter.logout() : adapter.disconnect()),
    deleteCredentials: () => (adapter.logout ? adapter.logout() : adapter.disconnect()),
    onInbound(handler) {
      inbound = handler;
    },
    capabilities: () => manifest.capabilities,
    peekQr(operationId: string) {
      return adapter.peekQr?.(operationId);
    },
  };
}

export function dingtalkChannelAdapter(adapter: DingTalkAdapter): ChannelAdapter {
  return wrapNative("dingtalk", adapter as unknown as NativeLike);
}

export function wecomChannelAdapter(adapter: WeComAdapter): ChannelAdapter {
  return wrapNative("wecom", adapter as unknown as NativeLike);
}

export function qqChannelAdapter(adapter: QqAdapter): ChannelAdapter {
  return wrapNative("qq", adapter as unknown as NativeLike);
}

export function slackChannelAdapter(adapter: SlackAdapter): ChannelAdapter {
  return wrapNative("slack", adapter as unknown as NativeLike);
}

export function telegramChannelAdapter(adapter: TelegramAdapter): ChannelAdapter {
  return wrapNative("telegram", adapter as unknown as NativeLike);
}

export function discordChannelAdapter(adapter: DiscordAdapter): ChannelAdapter {
  return wrapNative("discord", adapter as unknown as NativeLike);
}

export function whatsappChannelAdapter(adapter: WhatsAppDeviceAdapter): ChannelAdapter {
  return wrapNative("whatsapp", adapter as unknown as NativeLike);
}
