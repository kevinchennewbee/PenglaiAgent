import { PenglaiError } from "@penglai/contracts";
import {
  CHANNEL_MANIFESTS,
  CONNECTION_METHODS,
  getChannelManifest,
  isNativeChannel,
  refuseFakeQr,
  type ChannelId,
  type ChannelManifestV1,
  type ConnectionMethod,
} from "./registry.js";
import { refuseUnavailableSend } from "./guided.js";

export const CONNECTION_STATES = [
  "disabled",
  "not_configured",
  "connecting",
  "connected",
  "degraded",
  "expired",
  "blocked",
  "failed",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export interface ChannelHealth {
  channel: ChannelId;
  runtimeBundled: boolean;
  enabled: boolean;
  connection: ConnectionState;
}

export interface InboundChannelEvent {
  channel: ChannelId;
  botId: string;
  accountRef: string;
  vendorMessageId: string;
  vendorTarget: string;
  senderId: string;
  peerRef: string;
  text?: string;
  chatType: "private";
  provenPrivate: true;
  idempotencyKey: string;
  vendorTime?: number;
}

/**
 * Closed connection result. Never includes SDK objects, secrets, filesystem
 * paths, generic execute, or arbitrary fetch capability.
 */
export type ConnectionResult =
  | { kind: "qr"; connection: "connecting"; operationId: string; expiresAt: number }
  | { kind: "oauth"; connection: "connecting"; operationId: string }
  | { kind: "manifest"; connection: "connecting"; operationId: string }
  | { kind: "token"; connection: "connecting"; operationId: string }
  | { kind: "device-link"; connection: "connecting"; operationId: string }
  | { kind: "manual-fallback"; connection: "connecting"; operationId: string };

export interface ChannelAdapter {
  readonly id: ChannelId;
  manifest(): ChannelManifestV1;
  enable(): Promise<void>;
  disable(): Promise<void>;
  beginConnection(input: {
    method: string;
    credentialRef?: string;
  }): Promise<ConnectionResult>;
  pollConnection(operationId: string): Promise<{ status: ConnectionState; accountRedacted?: string }>;
  cancelConnection(operationId: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<ChannelHealth>;
  sendText(input: { text: string; botId?: string; peerRef?: string }): Promise<{ delivered: true }>;
  sendArtifact(input: { artifactId: string; botId?: string; peerRef?: string }): Promise<{ delivered: true }>;
  disconnect(): Promise<void>;
  logout(): Promise<void>;
  deleteCredentials(): Promise<void>;
  onInbound(handler: (event: InboundChannelEvent) => void | Promise<void>): void;
  capabilityEvidence(): ChannelManifestV1["capabilityEvidence"];
  peekQr?(operationId: string): { verificationUrl?: string; qrPayload?: string; qrImageRef?: string; expiresAt?: number } | undefined;
  react?(input: {
    vendorTarget: string;
    vendorMessageId: string;
    emoji: string;
    action: "add" | "remove";
    signal: AbortSignal;
  }): Promise<void>;
  exportPersistedState?(): Record<string, unknown>;
  restorePersistedState?(state: Record<string, unknown>): void;
}

export function assertNativeSend(channel: ChannelId): void {
  if (!isNativeChannel(channel)) refuseUnavailableSend(channel);
}

export function connectionResultForMethod(id: ChannelId, method: string): ConnectionResult {
  refuseFakeQr(id, method);
  const wanted = method as ConnectionMethod;
  if (!(CONNECTION_METHODS as readonly string[]).includes(wanted)) {
    throw new PenglaiError("INVALID_INPUT", "CHANNEL_METHOD_UNSUPPORTED");
  }
  const operationId = `${id}:${wanted}`;
  if (wanted === "qr") return { kind: "qr", connection: "connecting", operationId, expiresAt: Date.now() + 120_000 };
  if (wanted === "oauth") return { kind: "oauth", connection: "connecting", operationId };
  if (wanted === "manifest") return { kind: "manifest", connection: "connecting", operationId };
  if (wanted === "token") return { kind: "token", connection: "connecting", operationId };
  if (wanted === "device-link") return { kind: "device-link", connection: "connecting", operationId };
  return { kind: "manual-fallback", connection: "connecting", operationId };
}

export function guidedAdapter(id: ChannelId): ChannelAdapter {
  let enabled = false;
  let connection: ConnectionState = "disabled";
  let inbound: ((event: InboundChannelEvent) => void | Promise<void>) | undefined;
  const manifest = CHANNEL_MANIFESTS[id];
  return {
    id,
    manifest() {
      return getChannelManifest(id);
    },
    async enable() {
      enabled = true;
      if (connection === "disabled") connection = "not_configured";
    },
    async disable() {
      enabled = false;
      connection = "disabled";
    },
    async beginConnection(input) {
      await this.enable();
      connection = "connecting";
      return connectionResultForMethod(id, input.method);
    },
    async pollConnection() {
      return { status: connection };
    },
    async cancelConnection() {
      connection = enabled ? "not_configured" : "disabled";
    },
    async start() {
      if (!enabled) throw new PenglaiError("SECURITY_POLICY", "CHANNEL_DISABLED");
    },
    async stop() {
      connection = enabled ? "not_configured" : "disabled";
    },
    async health() {
      return { channel: id, runtimeBundled: manifest.runtimeBundled, enabled, connection };
    },
    async sendText() {
      refuseUnavailableSend(id);
    },
    async sendArtifact() {
      refuseUnavailableSend(id);
    },
    async disconnect() {
      connection = enabled ? "not_configured" : "disabled";
    },
    async logout() {
      connection = enabled ? "not_configured" : "disabled";
    },
    async deleteCredentials() {
      connection = enabled ? "not_configured" : "disabled";
    },
    onInbound(handler) {
      inbound = handler;
      void inbound;
    },
    capabilityEvidence() {
      return manifest.capabilityEvidence;
    },
  };
}

export function requireAdapter(adapters: ReadonlyMap<ChannelId, ChannelAdapter>, channel: ChannelId): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) throw new PenglaiError("SECURITY_POLICY", `CHANNEL_ADAPTER_UNAVAILABLE:${channel}`);
  return adapter;
}
