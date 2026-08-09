/**
 * HTTP/WebSocket bridge: talks to the Host loopback surface directly.
 * Used by plain-browser dev (token injected by the Vite dev proxy, so this
 * bridge carries an empty token) and by vitest integration suites (explicit
 * endpoint URLs + test token). The Tauri webview uses the native bridge
 * instead — the credential never reaches renderer JS there.
 */

import type { RuntimeHandshake } from "@penglai/protocol";
import { ResilientSubscription } from "./resilient.js";
import {
  BridgeError,
  type HostEventListener,
  type HostStatusInfo,
  type PenglaiBridge,
  type SubscriptionState,
} from "./types.js";

export interface HttpBridgeOptions {
  /** GET handshake endpoint (…/health direct, or the dev-proxy path). */
  healthUrl: string;
  /** POST JSON-RPC endpoint (…/api direct, or the dev-proxy path). */
  rpcUrl: string;
  /** WS endpoint (…/ws direct, or the dev-proxy path). */
  wsUrl: string;
  /** Loopback token; "" when a dev proxy injects it server-side. */
  token: string;
  /** Optional endpoint returning {home} (dev proxy); home() → null without it. */
  homeUrl?: string;
}

function websocketAuthProtocol(token: string): string {
  const bytes = new TextEncoder().encode(token);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `penglai.auth.${encoded}`;
}

interface RpcEnvelope {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: { code?: string } };
}

export class HttpBridge implements PenglaiBridge {
  readonly kind = "http" as const;
  private rpcSeq = 0;

  constructor(private readonly options: HttpBridgeOptions) {}

  async status(): Promise<HostStatusInfo> {
    try {
      const res = await fetch(this.options.healthUrl);
      if (!res.ok) {
        return { ok: false, error: `host health probe failed: HTTP ${res.status}` };
      }
      const handshake = (await res.json()) as RuntimeHandshake;
      return { ok: true, handshake };
    } catch (error) {
      return {
        ok: false,
        error: `host unreachable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.rpcSeq += 1;
    let res: Response;
    try {
      res = await fetch(this.options.rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.options.token ? { "X-Penglai-Token": this.options.token } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.rpcSeq, method, params }),
      });
    } catch (error) {
      throw new BridgeError(
        `host unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (res.status === 401) {
      throw new BridgeError("host rejected the token (401)", "unauthorized");
    }
    const body = (await res.json().catch(() => null)) as RpcEnvelope | null;
    if (!body) {
      throw new BridgeError(`host returned a non-JSON response (HTTP ${res.status})`);
    }
    if (body.error) {
      throw new BridgeError(body.error.message, body.error.data?.code);
    }
    return body.result as T;
  }

  subscribe(
    channelId: string,
    onEvent: HostEventListener,
    onState?: (state: SubscriptionState) => void,
  ): Promise<() => void> {
    const subscription = new ResilientSubscription(
      (dispatch, onClosed) => {
        const query = `channel=${encodeURIComponent(channelId)}`;
        const protocols = this.options.token ? [websocketAuthProtocol(this.options.token)] : undefined;
        const ws = new WebSocket(`${this.options.wsUrl}?${query}`, protocols);
        return {
          connect: () =>
            new Promise<void>((resolvePromise, rejectPromise) => {
              ws.onerror = () => rejectPromise(new Error("host event channel failed"));
              ws.onclose = () =>
                rejectPromise(new Error("host event channel closed during connect"));
              ws.onopen = () => {
                // Steady-state wiring: events dispatch to the owner; closes
                // drive the resilient reconnect loop.
                ws.onerror = null;
                ws.onmessage = (message) => {
                  try {
                    dispatch(JSON.parse(String(message.data)) as Record<string, unknown>);
                  } catch {
                    /* ignore malformed frames */
                  }
                };
                ws.onclose = () => onClosed(null);
                resolvePromise();
              };
            }),
          close: () => {
            try {
              ws.close();
            } catch {
              /* already closed */
            }
          },
        };
      },
      onEvent,
      onState,
    );
    return subscription.start().then(() => () => subscription.close());
  }

  async home(): Promise<string | null> {
    if (!this.options.homeUrl) return null;
    try {
      const res = await fetch(this.options.homeUrl);
      if (!res.ok) return null;
      const body = (await res.json()) as { home?: unknown };
      return typeof body.home === "string" && body.home.length > 0 ? body.home : null;
    } catch {
      return null;
    }
  }
}
