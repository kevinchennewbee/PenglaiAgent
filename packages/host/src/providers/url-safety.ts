const LOOPBACK_PROVIDER_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Public model endpoints require TLS; plain HTTP is exact-loopback only. */
export function assertSafeProviderBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("base URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("base URL must use https, or http on localhost");
  }
  if (url.username || url.password) throw new Error("base URL must not contain credentials");
  if (url.hash) throw new Error("base URL must not contain a fragment");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol === "http:" && !LOOPBACK_PROVIDER_HOSTS.has(hostname)) {
    throw new Error("public model endpoints must use https; http is allowed only on localhost/127.0.0.1/::1");
  }
  return url.href.replace(/\/$/, "");
}

/**
 * S1: Normalize a provider base URL to its credential origin boundary:
 * scheme + host + effective port. Path changes alone do not rebind secrets.
 */
export function providerOriginKey(raw: string): string {
  const normalized = assertSafeProviderBaseUrl(raw);
  const url = new URL(normalized);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port =
    url.port ||
    (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return `${url.protocol}//${hostname}:${port}`;
}

/** True when two base URLs share the same credential origin. */
export function sameProviderOrigin(a: string, b: string): boolean {
  try {
    return providerOriginKey(a) === providerOriginKey(b);
  } catch {
    return false;
  }
}

/** Exact-loopback / localhost endpoints (Owner-local OpenAI-compatible). */
export function isLocalProviderBaseUrl(raw: string): boolean {
  try {
    const url = new URL(assertSafeProviderBaseUrl(raw));
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return LOOPBACK_PROVIDER_HOSTS.has(hostname);
  } catch {
    return false;
  }
}
