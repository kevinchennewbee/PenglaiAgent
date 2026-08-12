/**
 * Host-only provider HTTP transport shared by list-models, smoke, and any
 * Host-side OpenAI-compatible fetch. Does not belong in the renderer graph.
 *
 * Policy:
 * - scheme / credential-in-URL / hostname normalization via assertSafeProviderBaseUrl
 * - public endpoints: DNS private/reserved/metadata gate + hop-by-hop redirect checks
 * - exact-loopback / explicit local providers: local mode with redirect revalidation
 * - redirect and timeout ceilings
 */

import {
  assertPublicHttpUrl,
  fetchPublicHttp,
} from "../capabilities/network-safety.js";
import {
  assertSafeProviderBaseUrl,
  isLocalProviderBaseUrl,
} from "./url-safety.js";

export const PROVIDER_TRANSPORT_MAX_REDIRECTS = 5;

export interface ProviderFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** When true, only exact-loopback / local base URLs are accepted. */
  requireLocal?: boolean;
}

/**
 * Fetch against a provider base URL + relative path (e.g. "/models",
 * "/chat/completions"). Revalidates every redirect hop for public hosts.
 */
export async function fetchProviderHttp(
  baseUrl: string,
  pathSuffix: string,
  options: ProviderFetchOptions = {},
): Promise<Response> {
  const root = assertSafeProviderBaseUrl(baseUrl);
  if (options.requireLocal && !isLocalProviderBaseUrl(root)) {
    throw new Error("local provider mode required for this call");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const suffix = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  const initial = `${root.replace(/\/+$/, "")}${suffix}`;
  const headers = options.headers ?? {};
  const method = options.method ?? "GET";
  const body = options.body;

  if (isLocalProviderBaseUrl(root)) {
    // Local Owner endpoints: still revalidate redirects so a local URL cannot
    // bounce into an unexpected private/metadata host without being rechecked
    // against the same base-URL safety rules.
    let current = initial;
    for (let hop = 0; hop < PROVIDER_TRANSPORT_MAX_REDIRECTS; hop += 1) {
      // Local first hop may be loopback; later hops must still be safe base URLs.
      if (hop > 0) {
        assertSafeProviderBaseUrl(current);
      }
      const res = await fetch(current, {
        method,
        headers,
        body: hop === 0 ? body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error("redirect without Location");
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    throw new Error("too many redirects");
  }

  // Public path: connection-time private-IP gate + manual redirects.
  let current = initial;
  for (let hop = 0; hop < PROVIDER_TRANSPORT_MAX_REDIRECTS; hop += 1) {
    await assertPublicHttpUrl(current);
    const res = await fetchPublicHttp(current, {
      method,
      headers,
      body: hop === 0 ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect without Location");
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}
