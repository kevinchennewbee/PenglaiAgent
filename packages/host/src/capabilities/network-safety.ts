import dns from "node:dns/promises";
import net from "node:net";

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
  return mapped ? blockedIpv4(mapped) : false;
}

export function isBlockedNetworkAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family === 6) return blockedIpv6(address);
  return true;
}

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
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
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
