import { PenglaiError } from "@penglai/contracts";
import { DingTalkAdapter } from "@penglai/channel-dingtalk";
import { WeComAdapter } from "@penglai/channel-wecom";
import { QqAdapter } from "@penglai/channel-qq";
import { SlackAdapter } from "@penglai/channel-slack";
import { TelegramAdapter } from "@penglai/channel-telegram";
import { DiscordAdapter } from "@penglai/channel-discord";
import { IMessageAdapter } from "@penglai/channel-imessage";
import { getChannelManifest, type ChannelId } from "../registry.js";
import {
  type ChannelAdapter,
  type ChannelHealth,
  type ConnectionResult,
  type ConnectionState,
  type InboundChannelEvent,
} from "../channel-adapter.js";
import { tryParseInboundEnvelope } from "../inbound-envelope.js";

export interface QrPeek {
  verificationUrl?: string;
  qrPayload?: string;
  qrImageRef?: string;
  expiresAt?: number;
}

export interface NativeWrapOpts {
  hashPeer: (senderId: string, accountRef: string) => string;
}

type NativeLike = {
  accountRef?: string | undefined;
  beginConnection(input: { method?: string; credentialRef?: string }): Promise<{
    kind: "qr" | "token" | "manifest" | "device-link" | "manual-fallback";
    connection: string;
    operationId: string;
    expiresAt?: number;
  }>;
  inspectPermissions?(): Promise<{ platform: string; database: string; automation: string }>;
  pollConnection(operationId?: string): Promise<{ status: string }>;
  health(): { channel: ChannelId; runtimeBundled: true; enabled?: boolean; connection: string };
  sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }>;
  disconnect(): Promise<void>;
  logout?(): Promise<void>;
  peekQr?(operationId?: string): QrPeek | undefined;
  onInbound?(handler: (msg: Record<string, unknown>) => void | Promise<void>): void;
  react?(input: {
    vendorTarget: string;
    vendorMessageId: string;
    emoji: string;
    action: "add" | "remove";
    signal: AbortSignal;
  }): Promise<void>;
  exportPersistedState?(): Record<string, unknown>;
  restorePersistedState?(state: Record<string, unknown>): void;
};

function mapInbound(
  id: ChannelId,
  msg: Record<string, unknown>,
  hashPeer: (senderId: string, accountRef: string) => string,
): InboundChannelEvent | undefined {
  const parsed = tryParseInboundEnvelope(id, msg, hashPeer);
  if ("reject" in parsed) return undefined;
  if (!parsed.provenPrivate || parsed.chatType !== "private") return undefined;
  return parsed;
}

export function wrapNative(
  id: ChannelId,
  adapter: NativeLike,
  opts: NativeWrapOpts,
): ChannelAdapter & { peekQr(operationId: string): QrPeek | undefined } {
  const manifest = getChannelManifest(id);
  let inbound: ((event: InboundChannelEvent) => void | Promise<void>) | undefined;
  let generation = 0;
  adapter.onInbound?.(async (msg) => {
    const seen = generation;
    const event = mapInbound(id, msg as Record<string, unknown>, opts.hashPeer);
    if (seen !== generation) return;
    if (!event || event.chatType !== "private" || !event.provenPrivate) return;
    await inbound?.(event);
  });
  let enabled = false;
  return {
    id,
    manifest: () => manifest,
    async enable() {
      enabled = true;
    },
    async disable() {
      generation += 1;
      enabled = false;
      await adapter.disconnect();
    },
    async beginConnection(input) {
      enabled = true;
      const begun = await adapter.beginConnection(input);
      if (begun.kind === "qr") {
        return { kind: "qr", connection: "connecting", operationId: begun.operationId, expiresAt: begun.expiresAt ?? Date.now() + 120_000 };
      }
      if (begun.kind === "device-link") return { kind: "device-link", connection: "connecting", operationId: begun.operationId };
      if (begun.kind === "manifest") return { kind: "manifest", connection: "connecting", operationId: begun.operationId };
      if (begun.kind === "manual-fallback") {
        return { kind: "manual-fallback", connection: "connecting", operationId: begun.operationId };
      }
      return { kind: "token", connection: "connecting", operationId: begun.operationId };
    },
    async pollConnection(operationId) {
      const polled = await adapter.pollConnection(operationId);
      return { status: polled.status as ConnectionState };
    },
    async cancelConnection() {
      generation += 1;
      await adapter.disconnect();
    },
    async start() {
      if (!enabled) throw new PenglaiError("SECURITY_POLICY", "CHANNEL_DISABLED");
    },
    async stop() {
      await adapter.disconnect();
    },
    async health(): Promise<ChannelHealth> {
      const row = adapter.health();
      const connection = row.connection === "blocked"
        ? "blocked"
        : enabled
          ? (row.connection as ConnectionState)
          : "disabled";
      return {
        channel: id,
        runtimeBundled: manifest.runtimeBundled,
        enabled: connection === "blocked" ? false : enabled,
        connection,
      };
    },
    accountIdentity: () => adapter.accountRef,
    sendText: (input) => adapter.sendText(input),
    async sendArtifact() {
      throw new PenglaiError("SECURITY_POLICY", `CHANNEL_ARTIFACT_SEND_UNAVAILABLE:${id}`);
    },
    async disconnect() {
      generation += 1;
      await adapter.disconnect();
    },
    async logout() {
      generation += 1;
      enabled = false;
      await (adapter.logout ? adapter.logout() : adapter.disconnect());
    },
    async deleteCredentials() {
      generation += 1;
      enabled = false;
      await (adapter.logout ? adapter.logout() : adapter.disconnect());
    },
    onInbound(handler) {
      inbound = handler;
    },
    capabilityEvidence: () => manifest.capabilityEvidence,
    peekQr(operationId: string) {
      return adapter.peekQr?.(operationId);
    },
    ...(adapter.inspectPermissions
      ? { inspectPermissions: () => adapter.inspectPermissions!() }
      : {}),
    ...(adapter.react
      ? {
          react: (input: {
            vendorTarget: string;
            vendorMessageId: string;
            emoji: string;
            action: "add" | "remove";
            signal: AbortSignal;
          }) => adapter.react!(input),
        }
      : {}),
    ...(adapter.exportPersistedState
      ? { exportPersistedState: () => adapter.exportPersistedState!() }
      : {}),
    ...(adapter.restorePersistedState
      ? { restorePersistedState: (state: Record<string, unknown>) => adapter.restorePersistedState!(state) }
      : {}),
  };
}

export function dingtalkChannelAdapter(adapter: DingTalkAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("dingtalk", adapter as unknown as NativeLike, opts);
}

export function wecomChannelAdapter(adapter: WeComAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("wecom", adapter as unknown as NativeLike, opts);
}

export function qqChannelAdapter(adapter: QqAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("qq", adapter as unknown as NativeLike, opts);
}

export function slackChannelAdapter(adapter: SlackAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("slack", adapter as unknown as NativeLike, opts);
}

export function telegramChannelAdapter(adapter: TelegramAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("telegram", adapter as unknown as NativeLike, opts);
}

export function discordChannelAdapter(adapter: DiscordAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("discord", adapter as unknown as NativeLike, opts);
}

export function imessageChannelAdapter(adapter: IMessageAdapter, opts: NativeWrapOpts): ChannelAdapter {
  return wrapNative("imessage", adapter as unknown as NativeLike, opts);
}
