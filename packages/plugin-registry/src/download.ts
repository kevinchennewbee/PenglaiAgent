import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { ALLOWED_ASSET_HOSTS } from "./catalog-schema.js";

export interface DownloadRequest {
  url: string;
  sha256: string;
  size: number;
  assetId?: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
}

export async function downloadVerifiedBytes(input: DownloadRequest): Promise<Buffer> {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PenglaiError("SECURITY_POLICY", "download URL must be exact https");
  }
  if (!ALLOWED_ASSET_HOSTS.includes(parsed.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", "download host not allowed");
  }
  if (input.size <= 0 || input.size > input.maxBytes) throw new PenglaiError("SECURITY_POLICY", "download size bound");
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.url, { redirect: "manual" });
  if (response.status !== 200 || response.redirected || (response.url && response.url !== input.url)) {
    throw new PenglaiError("SECURITY_POLICY", `download refused: ${response.status}`);
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== input.size) {
    throw new PenglaiError("SECURITY_POLICY", "content-length mismatch");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== input.size) throw new PenglaiError("SECURITY_POLICY", "downloaded size mismatch");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== input.sha256) throw new PenglaiError("SECURITY_POLICY", "downloaded sha256 mismatch");
  return bytes;
}

export function githubDigestToSha256(digest: string | undefined, expected: string): void {
  if (!digest) return;
  const value = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  if (value !== expected) throw new PenglaiError("SECURITY_POLICY", "GitHub asset digest mismatch");
}
