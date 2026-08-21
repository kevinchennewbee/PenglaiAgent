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
}

const API_HOSTS = Object.freeze(["api.github.com", ...ALLOWED_ASSET_HOSTS]);

export async function downloadVerifiedBytes(input: DownloadRequest): Promise<Buffer> {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new PenglaiError("SECURITY_POLICY", "download URL must be exact https");
  }
  if (parsed.search && parsed.hostname !== "api.github.com") {
    throw new PenglaiError("SECURITY_POLICY", "download URL must be exact https");
  }
  if (!API_HOSTS.includes(parsed.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", "download host not allowed");
  }
  if (parsed.hostname === "api.github.com" && parsed.origin !== GITHUB_API_ORIGIN) {
    throw new PenglaiError("SECURITY_POLICY", "download host not allowed");
  }
  if (input.size <= 0 || input.size > input.maxBytes) throw new PenglaiError("SECURITY_POLICY", "download size bound");
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.url, { redirect: "manual" });
  if (response.status !== 200 || response.redirected || (response.url && response.url !== input.url)) {
    throw new PenglaiError("SECURITY_POLICY", `download refused: ${response.status}`);
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
