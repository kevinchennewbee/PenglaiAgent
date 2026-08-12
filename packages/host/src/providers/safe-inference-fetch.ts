/**
 * R7: safe fetch injected into Pi provider streams so real inference shares
 * the same DNS / redirect / private-IP policy as list-models and smoke tests.
 *
 * Host-only module — must never enter the renderer graph.
 */

import {
  assertPublicHttpUrl,
  fetchPublicHttp,
} from "../capabilities/network-safety.js";
import {
  assertSafeProviderBaseUrl,
  isLocalProviderBaseUrl,
} from "./url-safety.js";

const MAX_REDIRECTS = 5;

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}

/**
 * Wrap the base fetch so that every provider request (turn streaming,
 * compaction, branch summary) is gated:
 * - public endpoints: connection-time private/metadata DNS gate + per-hop
 *   redirect revalidation (DNS rebinding protection);
 * - exact-loopback local endpoints: only the configured origin is reachable
 *   and each redirect hop is re-validated to the same local origin.
 */
export function buildSafeProviderFetch(
  configuredBaseUrl: string,
): typeof globalThis.fetch {
  const base = assertSafeProviderBaseUrl(configuredBaseUrl);
  const baseUrl = new URL(base);
  const local = isLocalProviderBaseUrl(base);

  return async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? new URL(input.toString())
          : new URL(input.url);
    if (url.username || url.password) {
      throw new Error("URL credentials are not allowed");
    }
    const baseInit: RequestInit = { ...init, redirect: "manual" };

    if (local) {
      let current = url;
      for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
        if (!sameOrigin(baseUrl, current)) {
          throw new Error("local provider request left the configured origin");
        }
        const res = await fetch(current, {
          ...baseInit,
          body: hop === 0 ? init?.body : undefined,
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) throw new Error("redirect without Location");
          current = new URL(location, current);
          continue;
        }
        return res;
      }
      throw new Error("too many redirects");
    }

    let currentUrl = url.toString();
    for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
      await assertPublicHttpUrl(currentUrl);
      const res = await fetchPublicHttp(currentUrl, {
        ...baseInit,
        body: hop === 0 ? init?.body : undefined,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error("redirect without Location");
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      return res;
    }
    throw new Error("too many redirects");
  };
}

/** Minimal shape of a ProviderStreams-like object used by openAICompletionsApi. */
export interface StreamableProvider {
  stream: (...args: any[]) => any;
  streamSimple: (...args: any[]) => any;
}

/**
 * Wrap a ProviderStreams implementation so every stream call carries the
 * safe fetch unless the caller explicitly supplied its own.
 * We intentionally keep `any` at this adapter boundary: the real signatures
 * come from @earendil-works/pi-ai types at the call site, and this wrapper
 * only forwards options + injects one field.
 */
export function wrapProviderStreamsWithSafeFetch<T extends StreamableProvider>(
  baseApi: T,
  baseUrl: string,
): T {
  const safeFetch = buildSafeProviderFetch(baseUrl);
  const stream = (...args: any[]): any => {
    const [model, context, options = {}] = args;
    return baseApi.stream(model, context, {
      ...options,
      fetch: options?.fetch ?? safeFetch,
    });
  };
  const streamSimple = (...args: any[]): any => {
    const [model, context, options = {}] = args;
    return baseApi.streamSimple(model, context, {
      ...options,
      fetch: options?.fetch ?? safeFetch,
    });
  };
  return { ...baseApi, stream, streamSimple } as T;
}
