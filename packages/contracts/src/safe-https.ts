import { PenglaiError } from "./errors.js";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function assertSafeHttpsUrl(url: string, label = "url"): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", `${label} is not a URL`);
  }
  if (parsed.protocol !== "https:") throw new PenglaiError("SECURITY_POLICY", `${label} must be https`);
  if (parsed.username || parsed.password) throw new PenglaiError("SECURITY_POLICY", `${label} must not include credentials`);
  if (parsed.port && parsed.port !== "443") throw new PenglaiError("SECURITY_POLICY", `${label} port is not allowed`);
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    throw new PenglaiError("SECURITY_POLICY", `${label} must not target localhost`);
  }
  if (IPV4.test(host) || host.includes(":")) {
    throw new PenglaiError("SECURITY_POLICY", `${label} must not use an IP literal`);
  }
  return parsed;
}

export const PLUGIN_LINK_KEYS = ["repository", "homepage", "documentation", "issues"] as const;
export type PluginLinkKey = (typeof PLUGIN_LINK_KEYS)[number];

export interface PluginLinksV1 {
  repository?: string;
  homepage?: string;
  documentation?: string;
  issues?: string;
}

export function parsePluginLinks(raw: unknown): PluginLinksV1 | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PenglaiError("INVALID_INPUT", "plugin links");
  }
  const src = raw as Record<string, unknown>;
  const out: PluginLinksV1 = {};
  for (const key of PLUGIN_LINK_KEYS) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== "string") throw new PenglaiError("INVALID_INPUT", `plugin link ${key}`);
    out[key] = assertSafeHttpsUrl(src[key], key).toString();
  }
  return Object.keys(out).length ? out : undefined;
}
