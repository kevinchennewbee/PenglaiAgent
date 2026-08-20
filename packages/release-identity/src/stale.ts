import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { PenglaiError } from "@penglai/contracts";
import {
  CANDIDATE_SOURCE_SHA_NONE,
  PRODUCT_VERSION,
  STALE_ARTIFACTS,
  STALE_PATH_MARKERS,
} from "./pins.js";

export interface ArtifactManifestLike {
  sourceSha?: string;
  sha256?: string;
  artifactSha256?: string;
  dmgSha256?: string;
  productVersion?: string;
  version?: string;
  path?: string;
  candidateSourceSha?: string;
}

export function sha256Buffer(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function isStaleSha(hex: string | undefined): boolean {
  if (!hex) return false;
  const n = hex.toLowerCase();
  return STALE_ARTIFACTS.some(
    (a) =>
      (a.sha256 && (n === a.sha256 || n.startsWith(a.sha256.slice(0, 8)))) ||
      (a.sourceSha && (n === a.sourceSha || n.startsWith(a.sourceSha.slice(0, 7)))),
  );
}

export function isStalePath(path: string | undefined): boolean {
  if (!path) return false;
  return STALE_PATH_MARKERS.some((m) => path.includes(m));
}

export function assertArtifactNotStale(manifest: ArtifactManifestLike, diskSha?: string): void {
  const hashes = [
    manifest.sourceSha,
    manifest.sha256,
    manifest.artifactSha256,
    manifest.dmgSha256,
    diskSha,
    manifest.candidateSourceSha,
  ].filter((x): x is string => typeof x === "string" && x.length > 0 && x !== CANDIDATE_SOURCE_SHA_NONE);
  for (const h of hashes) {
    if (isStaleSha(h)) {
      throw new PenglaiError("INVALID_INPUT", `STALE_INVALIDATED artifact hash ${h.slice(0, 12)}`);
    }
  }
  const ver = manifest.productVersion ?? manifest.version ?? "";
  if (ver && ver !== PRODUCT_VERSION && /^0\.[0-4]\./.test(ver)) {
    throw new PenglaiError("INVALID_INPUT", `STALE_INVALIDATED product version ${ver}`);
  }
  if (ver && ver.includes("alpha")) {
    throw new PenglaiError("INVALID_INPUT", `STALE_INVALIDATED alpha product version ${ver}`);
  }
  const p = manifest.path ?? "";
  if (isStalePath(p)) {
    throw new PenglaiError("INVALID_INPUT", `STALE_INVALIDATED artifact path ${p}`);
  }
}

export function assertDiskMatchesDeclared(declaredSha: string, filePath: string): void {
  if (!existsSync(filePath)) {
    throw new PenglaiError("INVALID_INPUT", `declared artifact missing on disk`);
  }
  const got = sha256Buffer(readFileSync(filePath));
  if (got !== declaredSha.toLowerCase()) {
    throw new PenglaiError("INVALID_INPUT", `STATE/source/artifact hash mismatch declared=${declaredSha} disk=${got}`);
  }
}

export function assertStateArtifactConsistent(stateText: string, diskShaByPath: Record<string, string>): void {
  const shaRe = /`([0-9a-f]{64})`/gi;
  let m: RegExpExecArray | null;
  const mentioned = new Set<string>();
  while ((m = shaRe.exec(stateText))) {
    if (m[1]) mentioned.add(m[1].toLowerCase());
  }
  for (const [rel, disk] of Object.entries(diskShaByPath)) {
    const lower = disk.toLowerCase();
    const actualLine = stateText.match(/实际 SHA-256：`([0-9a-f]{64})`/i);
    if (actualLine?.[1] && actualLine[1].toLowerCase() !== lower && stateText.includes(rel.split("/").pop() ?? "")) {
      throw new PenglaiError("INVALID_INPUT", `STATE hash ${actualLine[1]} != disk ${lower} for ${rel}`);
    }
  }
}

export function assertBuildInputsNotStale(opts: {
  dirty: boolean;
  head: string;
  originMain: string;
  sourceSha?: string;
  artifactSha256?: string;
  allowDirtyDev?: boolean;
}): void {
  if (opts.head !== opts.originMain) {
    throw new PenglaiError("INVALID_INPUT", `HEAD != origin/main`);
  }
  if (!/^[0-9a-f]{40}$/.test(opts.head)) {
    throw new PenglaiError("INVALID_INPUT", "HEAD missing");
  }
  if (opts.sourceSha && opts.sourceSha !== CANDIDATE_SOURCE_SHA_NONE && isStaleSha(opts.sourceSha)) {
    throw new PenglaiError("INVALID_INPUT", `STALE sourceSha ${opts.sourceSha}`);
  }
  if (opts.artifactSha256 && isStaleSha(opts.artifactSha256)) {
    throw new PenglaiError("INVALID_INPUT", `STALE artifactSha256`);
  }
  if (opts.artifactSha256 && opts.dirty) {
    throw new PenglaiError("INVALID_INPUT", "frozen artifact cannot be built from dirty tree");
  }
  if (opts.dirty && !opts.allowDirtyDev && opts.sourceSha && opts.sourceSha !== CANDIDATE_SOURCE_SHA_NONE) {
    throw new PenglaiError("INVALID_INPUT", "dirty tree rejected for named sourceSha");
  }
}
