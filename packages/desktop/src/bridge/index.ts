/**
 * Bridge selection: the Tauri webview uses the native shell bridge; a plain
 * browser (vite dev) uses the HTTP bridge against the dev proxy (which
 * injects the loopback token server-side — see vite.config.ts).
 */

import { HttpBridge } from "./http-bridge.js";
import { TauriBridge } from "./tauri-bridge.js";
import type { PenglaiBridge } from "./types.js";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

export function createBridge(): PenglaiBridge {
  if (isTauriRuntime()) return new TauriBridge();
  // Plain-browser dev: same-origin paths proxied to the Host with the token
  // injected by the dev server; ws scheme mirrors the page scheme.
  const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
  return new HttpBridge({
    healthUrl: "/penglai-health",
    rpcUrl: "/penglai-api",
    wsUrl: `${wsScheme}://${window.location.host}/penglai-ws`,
    token: "",
    homeUrl: "/penglai-home",
  });
}

export {
  BridgeError,
  reconnectDelayMs,
  toBridgeError,
  type HostEventListener,
  type HostStatusInfo,
  type PenglaiBridge as Bridge,
  type SubscriptionState,
} from "./types.js";
export { HttpBridge, type HttpBridgeOptions } from "./http-bridge.js";
export { ResilientSubscription } from "./resilient.js";
