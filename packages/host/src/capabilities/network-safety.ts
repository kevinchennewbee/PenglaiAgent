import dns from "node:dns/promises";
import dnsCallback from "node:dns";
import net from "node:net";
import { Agent } from "undici";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google",
]);

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function syntheticProxyIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  return octets.length === 4 && octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return blockedIpv4(mapped);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return blockedIpv4(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
  }
  return false;
}

function normalizedHostname(hostname: string): string {
  const lowered = hostname.toLowerCase().replace(/\.$/, "");
  return lowered.startsWith("[") && lowered.endsWith("]") ? lowered.slice(1, -1) : lowered;
}

export function isBlockedNetworkAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family === 6) return blockedIpv6(address);
  return true;
}

/**
 * Connection-time DNS gate used by Undici. URL preflight alone has a DNS
 * rebinding time-of-check/time-of-use gap: a hostname may resolve publicly
 * during validation and privately when the socket is opened. This lookup is
 * installed on the actual HTTP connector, so every new socket validates the
 * address it will connect to.
 */
function safeConnectionLookup(
  hostname: string,
  options: { family?: number; hints?: number },
  callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  const normalizedHost = normalizedHostname(hostname);
  if (
    !normalizedHost ||
    BLOCKED_HOSTS.has(normalizedHost) ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local")
  ) {
    callback(Object.assign(new Error("local or private hosts are not allowed"), { code: "EACCES" }), "", 0);
    return;
  }
  dnsCallback.lookup(
    hostname,
    { family: options.family === 4 || options.family === 6 ? options.family : 0, hints: options.hints, all: false, verbatim: true },
    (error, address, family) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const literalHost = net.isIP(normalizedHost) !== 0;
      const allowedSyntheticProxy = !literalHost && family === 4 && syntheticProxyIpv4(address);
      if (!allowedSyntheticProxy && isBlockedNetworkAddress(address)) {
        callback(
          Object.assign(new Error(`connection resolved to a private or reserved address (${address})`), { code: "EACCES" }),
          "",
          0,
        );
        return;
      }
      callback(null, address, family);
    },
  );
}

const PUBLIC_NETWORK_DISPATCHER = new Agent({
  connect: {
    // Node's overloaded LookupFunction type includes an `all: true` form;
    // this connector deliberately forces a single address so that the exact
    // address handed to the socket is the one checked above.
    lookup: safeConnectionLookup as never,
  },
  autoSelectFamily: false,
});

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http/https URLs are allowed");
  }
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  const host = normalizedHostname(url.hostname);
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("local or private hosts are not allowed");
  }
  if (net.isIP(host)) {
    if (isBlockedNetworkAddress(host)) throw new Error("private or reserved IP addresses are not allowed");
    return url;
  }
  const rows = await dns.lookup(host, { all: true, verbatim: true });
  if (rows.length === 0) throw new Error("host did not resolve");
  for (const row of rows) {
    // Clash/mihomo-style TUN DNS deliberately maps public domain names into
    // RFC 2544's 198.18/15 benchmark range. The original hostname is still
    // sent to fetch and revalidated on every redirect; only a literal user-
    // supplied 198.18/15 address remains blocked above.
    if (row.family === 4 && syntheticProxyIpv4(row.address)) continue;
    if (isBlockedNetworkAddress(row.address)) {
      throw new Error(`host resolves to a private or reserved address (${row.address})`);
    }
  }
  return url;
}

/** Fetch through the connection-time public-network gate. Redirects remain
 * manual/error at callers so each Location is separately revalidated. */
export async function fetchPublicHttp(
  rawUrl: string | URL,
  init: globalThis.RequestInit = {},
): Promise<globalThis.Response> {
  const url = await assertPublicHttpUrl(rawUrl.toString());
  // Node's built-in fetch is powered by Undici and accepts its Dispatcher
  // extension. Keep the standard fetch entry point so tests can replace the
  // transport, while production sockets use the guarded dispatcher.
  return fetch(url, {
    ...init,
    dispatcher: PUBLIC_NETWORK_DISPATCHER,
  } as globalThis.RequestInit);
}
