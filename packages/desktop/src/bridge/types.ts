/**
 * Desktop ↔ Host bridge contract.
 *
 * The renderer never touches the loopback credential directly: in the Tauri
 * webview every call crosses the native shell (host_rpc / host_subscribe);
 * in plain-browser dev and in tests an HTTP/WebSocket pair talks to the
 * same Host surface (dev token injected by the Vite proxy, tests pass an
 * explicit token). Both implementations share this interface and the
 * resilient-subscription reconnect discipline.
 */

import type { RuntimeHandshake } from "@penglai/protocol";

export type BridgeKind = "tauri" | "http";

export interface HostStatusInfo {
  ok: boolean;
  error?: string;
  handshake?: RuntimeHandshake;
}

export type HostEventListener = (event: Record<string, unknown>) => void;

/** Subscription transport state for UI indicators (断线重连角标). */
export type SubscriptionState = "open" | "reconnecting" | "closed";

export interface PenglaiBridge {
  readonly kind: BridgeKind;
  /** Liveness + compatibility probe (unauthenticated /health). */
  status(): Promise<HostStatusInfo>;
  /**
   * JSON-RPC over the token-gated surface. Application errors throw a
   * BridgeError carrying the protocol error code (budget_exceeded,
   * conversation_busy, needs_work_mode …) when the Host supplied one.
   */
  rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /**
   * Subscribe to a Host event channel (conversation id, task id, "budget",
   * "voice"). Reconnects with backoff until unsubscribed; `onState` reports
   * transport transitions for the connection badge.
   */
  subscribe(
    channelId: string,
    onEvent: HostEventListener,
    onState?: (state: SubscriptionState) => void,
  ): Promise<() => void>;
  /**
   * The assistant's data dir (chat-mode ground anchor). Only the native
   * shell can resolve it; the HTTP bridge returns null.
   */
  home(): Promise<string | null>;
}

/** RPC failure with an optional protocol error code. */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

/** Deterministic reconnect backoff: 400ms, 800, 1600 … capped at 6s. */
export function reconnectDelayMs(attempt: number): number {
  const base = 400 * Math.pow(2, Math.min(attempt, 4));
  return Math.min(base, 6000);
}

/** Extract a BridgeError-shaped value from an unknown thrown error. */
export function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  const shaped = error as { message?: unknown; code?: unknown } | null;
  if (shaped && typeof shaped.message === "string") {
    return new BridgeError(
      shaped.message,
      typeof shaped.code === "string" ? shaped.code : undefined,
    );
  }
  return new BridgeError(error instanceof Error ? error.message : String(error));
}
