import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { ALLOWED_ASSET_HOSTS, GITHUB_API_ORIGIN } from "./catalog-schema.js";

export interface DownloadRequest {
  url: string;
  sha256: string;
  size: number;
  assetId?: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
  skipHash?: boolean;
  ownerRepo?: string;
}

const REDIRECT_HOSTS = Object.freeze([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const MAX_REDIRECTS = 3;

export function assertSafeDownloadUrl(raw: string, previous?: URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "download URL invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new PenglaiError("SECURITY_POLICY", "download URL must be exact https");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new PenglaiError("SECURITY_POLICY", "download must use default https port");
  }
  if (
    parsed.search &&
    parsed.hostname !== "api.github.com" &&
    parsed.hostname !== "objects.githubusercontent.com" &&
    parsed.hostname !== "release-assets.githubusercontent.com"
  ) {
    throw new PenglaiError("SECURITY_POLICY", "download URL must be exact https");
  }
  if (!REDIRECT_HOSTS.includes(parsed.hostname) || !ALLOWED_ASSET_HOSTS.includes(parsed.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", `download host not allowed ${parsed.hostname}`);
  }
  if (parsed.hostname === "api.github.com" && parsed.origin !== GITHUB_API_ORIGIN) {
    throw new PenglaiError("SECURITY_POLICY", "download host not allowed");
  }
  if (parsed.hostname === "github.com" && !/^\/[^/]+\/[^/]+\/releases\/(download|assets)\//.test(parsed.pathname)) {
    throw new PenglaiError("SECURITY_POLICY", "github download path is not an immutable release asset");
  }
  if (
    parsed.hostname === "api.github.com" &&
    !/^\/repos\/[^/]+\/[^/]+\/(releases(\/assets\/\d+)?|releases\?)/.test(parsed.pathname) &&
    !/^\/repos\/[^/]+\/[^/]+\/releases(\/|$)/.test(parsed.pathname)
  ) {
    throw new PenglaiError("SECURITY_POLICY", "GitHub API path is not a release asset");
  }
  if (previous && parsed.hostname === "localhost") {
    throw new PenglaiError("SECURITY_POLICY", "download host not allowed localhost");
  }
  return parsed;
}

export async function downloadVerifiedBytes(input: DownloadRequest): Promise<Buffer> {
  // Keep the signed, tagged browser_download_url as the transport URL. The
  // asset id remains part of the signed catalog/update identity, but routing a
  // public download through the REST asset endpoint consumes GitHub's tiny
  // anonymous API quota and can make an otherwise public package return 403.
  const parsed = assertSafeDownloadUrl(input.url);
  if (input.size <= 0 || input.size > input.maxBytes) throw new PenglaiError("SECURITY_POLICY", "download size bound");
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(30_000);
  let current = parsed;
  let response: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headers: Record<string, string> = {};
    if (current.hostname === "api.github.com" && /\/releases\/assets\/\d+$/.test(current.pathname)) {
      headers.accept = "application/octet-stream";
    }
    response = await fetchImpl(current.href, { redirect: "manual", headers, signal: timeout });
    if (response.status === 200 && !response.redirected) break;
    if (response.status !== 301 && response.status !== 302 && response.status !== 303 && response.status !== 307 && response.status !== 308) {
      throw new PenglaiError("SECURITY_POLICY", `download refused: ${response.status}`);
    }
    const location = response.headers.get("location");
    if (!location || hop === MAX_REDIRECTS) {
      throw new PenglaiError("SECURITY_POLICY", `download refused: ${response.status}`);
    }
    const next = new URL(location, current);
    assertSafeDownloadUrl(next.href, current);
    current = next;
  }
  if (!response || response.status !== 200) {
    throw new PenglaiError("SECURITY_POLICY", `download refused: ${response?.status ?? 0}`);
  }
  const declared = response.headers.get("content-length");
  if (!input.skipHash && declared !== null && Number(declared) !== input.size) {
    throw new PenglaiError("SECURITY_POLICY", "content-length mismatch");
  }
  if (declared !== null && Number(declared) > input.maxBytes) {
    throw new PenglaiError("SECURITY_POLICY", "content-length mismatch");
  }
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let seen = 0;
  const body = response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      seen += chunk.length;
      if (seen > input.maxBytes || (!input.skipHash && seen > input.size)) {
        throw new PenglaiError("SECURITY_POLICY", "downloaded size mismatch");
      }
      hash.update(chunk);
      chunks.push(chunk);
    }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    seen = bytes.length;
    hash.update(bytes);
    chunks.push(bytes);
  }
  if (!input.skipHash && seen !== input.size) throw new PenglaiError("SECURITY_POLICY", "downloaded size mismatch");
  if (seen > input.maxBytes || seen <= 0) throw new PenglaiError("SECURITY_POLICY", "downloaded size mismatch");
  const digest = hash.digest("hex");
  if (!input.skipHash && digest !== input.sha256) throw new PenglaiError("SECURITY_POLICY", "downloaded sha256 mismatch");
  return Buffer.concat(chunks);
}

export function githubDigestToSha256(digest: string | undefined, expected: string): void {
  if (!digest) return;
  const value = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  if (value !== expected) throw new PenglaiError("SECURITY_POLICY", "GitHub asset digest mismatch");
}
