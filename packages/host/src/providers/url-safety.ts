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
