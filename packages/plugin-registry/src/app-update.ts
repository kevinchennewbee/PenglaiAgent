import { createHash } from "node:crypto";
import { BOUNDED_HTTP_MAX_BYTES, PenglaiError } from "@penglai/contracts";
import { ALLOWED_ASSET_HOSTS, APP_REPO, GITHUB_OWNER, compareSemver } from "./catalog-schema.js";
import { canonicalizeBytes } from "./canonical-json.js";
import { downloadVerifiedBytes } from "./download.js";
import { EMBEDDED_UPDATER_PUBLIC_KEY } from "./embedded-keys.js";
import {
  appListUrl,
  fetchGithubReleasePages,
  fetchGithubReleaseTags,
  selectHighestAppRelease,
  taggedReleaseAssetUrl,
} from "./release-discovery.js";
import { decodeDetachedSignature, verifyBytes } from "./signature.js";
import { acceptMonotonic } from "./trust-ledger.js";

export const APP_UPDATE_SCHEMA = "penglai.app-update.v1" as const;
export const UPDATE_MANIFEST_ASSET = "update-manifest-v1.json";
export const UPDATE_MANIFEST_SIGNATURE_ASSET = "update-manifest-v1.json.sig";

export interface AppUpdatePlatform {
  assetId: number;
  url: string;
  size: number;
  sha256: string;
  signature: string;
}

export interface AppUpdateManifest {
  schema: typeof APP_UPDATE_SCHEMA;
  sequence: number;
  version: string;
  channel: "stable";
  releaseTag: string;
  issuedAt: string;
  expiresAt: string;
  signingKeyId: string;
  minimumSourceVersion: string;
  notesUrl: string;
  candidateSourceSha: string;
  publicExportTreeSha256: string;
  platforms: Record<string, AppUpdatePlatform>;
  releaseManifestSha256?: string;
  migration: {
    fromSchema: number;
    toSchema: number;
    backupRequired: true;
    rollbackCompatible: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const UPDATE_TARGETS = ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"] as const;

function requireSemver(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new PenglaiError("INVALID_INPUT", `${label} must be semver`);
  }
  return value;
}

function requireIdentitySha(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} sha256 must be a real digest`);
  }
  return value;
}

export function assertDistinctManifestIdentities(updateManifestSha256: string, releaseManifestSha256?: string): void {
  if (!releaseManifestSha256) return;
  if (updateManifestSha256 === releaseManifestSha256) {
    throw new PenglaiError("SECURITY_POLICY", "update and release manifests must be different identities");
  }
}

export function resolveReleaseManifestSha256(input: {
  updateManifestSha256: string;
  releaseManifestSha256?: string;
  version: string;
  candidateSourceSha: string;
  applying: boolean;
}): string {
  assertDistinctManifestIdentities(input.updateManifestSha256, input.releaseManifestSha256);
  if (input.applying && !input.releaseManifestSha256) {
    throw new PenglaiError("SECURITY_POLICY", "release manifest identity required to apply an update");
  }
  if (input.releaseManifestSha256) return input.releaseManifestSha256;
  return createHash("sha256")
    .update(`unspecified-release:${input.version}:${input.candidateSourceSha}`)
    .digest("hex");
}

export function parseAppUpdateManifest(raw: unknown, nowMs = Date.now()): AppUpdateManifest {
  if (!isRecord(raw) || raw.schema !== APP_UPDATE_SCHEMA) {
    throw new PenglaiError("INVALID_INPUT", "app update schema");
  }
  if (raw.channel !== "stable") throw new PenglaiError("SECURITY_POLICY", "update channel");
  if (!Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 1) {
    throw new PenglaiError("SECURITY_POLICY", "update sequence");
  }
  const version = requireSemver(raw.version, "version");
  const minimumSourceVersion = requireSemver(raw.minimumSourceVersion, "minimumSourceVersion");
  const releaseTag = String(raw.releaseTag ?? "");
  if (releaseTag !== `v${version}`) throw new PenglaiError("SECURITY_POLICY", "releaseTag must match version");
  const issuedAt = Date.parse(String(raw.issuedAt ?? ""));
  const expiresAt = Date.parse(String(raw.expiresAt ?? ""));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new PenglaiError("SECURITY_POLICY", "update timestamps");
  }
  if (nowMs > expiresAt) throw new PenglaiError("SECURITY_POLICY", "update manifest expired");
  if (!isRecord(raw.platforms) || !isRecord(raw.migration)) throw new PenglaiError("INVALID_INPUT", "update platforms");
  if (raw.migration.backupRequired !== true) {
    throw new PenglaiError("SECURITY_POLICY", "update backupRequired must be true");
  }
  const fromSchema = Number(raw.migration.fromSchema);
  const toSchema = Number(raw.migration.toSchema);
  if (!Number.isSafeInteger(fromSchema) || !Number.isSafeInteger(toSchema) || fromSchema < 1 || toSchema < fromSchema) {
    throw new PenglaiError("SECURITY_POLICY", "update migration schema range");
  }
  const platforms: Record<string, AppUpdatePlatform> = {};
  for (const [key, value] of Object.entries(raw.platforms)) {
    if (!(UPDATE_TARGETS as readonly string[]).includes(key)) {
      throw new PenglaiError("SECURITY_POLICY", `unsupported update target ${key}`);
    }
    platforms[key] = parsePlatform(value, releaseTag);
  }
  const notesUrl = String(raw.notesUrl ?? "");
  if (!notesUrl.startsWith("https://github.com/kevinchennewbee/PenglaiAgent/releases/")) {
    throw new PenglaiError("SECURITY_POLICY", "update notes URL");
  }
  return {
    schema: APP_UPDATE_SCHEMA,
    sequence: Number(raw.sequence),
    version,
    channel: "stable",
    releaseTag,
    issuedAt: String(raw.issuedAt),
    expiresAt: String(raw.expiresAt),
    signingKeyId: String(raw.signingKeyId ?? ""),
    minimumSourceVersion,
    notesUrl,
    candidateSourceSha: requireIdentitySha(raw.candidateSourceSha, "candidate source"),
    publicExportTreeSha256: requireIdentitySha(raw.publicExportTreeSha256, "public export tree"),
    ...(raw.releaseManifestSha256 !== undefined
      ? { releaseManifestSha256: requireIdentitySha(raw.releaseManifestSha256, "release manifest") }
      : {}),
    platforms,
    migration: {
      fromSchema,
      toSchema,
      backupRequired: true,
      rollbackCompatible: raw.migration.rollbackCompatible === true,
    },
  };
}

function parsePlatform(raw: unknown, releaseTag: string): AppUpdatePlatform {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", "platform");
  const url = String(raw.url ?? "");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username) {
    throw new PenglaiError("SECURITY_POLICY", "update asset URL");
  }
  if (!ALLOWED_ASSET_HOSTS.includes(parsed.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", "update asset host");
  }
  if (parsed.hostname === "github.com") {
    const prefix = `/${GITHUB_OWNER}/${APP_REPO}/releases/download/${releaseTag}/`;
    if (!parsed.pathname.startsWith(prefix) || /(^|[/_.-])latest([/_.-]|$)/i.test(parsed.pathname)) {
      throw new PenglaiError("SECURITY_POLICY", "update asset is not the immutable tagged release");
    }
  }
  if (!/^[0-9a-f]{64}$/.test(String(raw.sha256 ?? "")) || /^0{64}$/.test(String(raw.sha256))) {
    throw new PenglaiError("SECURITY_POLICY", "update sha256");
  }
  if (!Number.isSafeInteger(raw.assetId) || Number(raw.assetId) <= 0) {
    throw new PenglaiError("SECURITY_POLICY", "update assetId");
  }
  if (!Number.isSafeInteger(raw.size) || Number(raw.size) <= 0) {
    throw new PenglaiError("SECURITY_POLICY", "update size");
  }
  if (typeof raw.signature !== "string" || !raw.signature) {
    throw new PenglaiError("SECURITY_POLICY", "update signature");
  }
  return {
    assetId: Number(raw.assetId),
    url,
    size: Number(raw.size),
    sha256: String(raw.sha256),
    signature: raw.signature,
  };
}

export async function discoverSignedAppUpdate(input: {
  currentVersion: string;
  fetchImpl?: typeof fetch;
  publicKeyHex?: string;
  signingKeyId?: string;
  trustPath?: string;
  keyEpoch?: number;
  nowMs?: number;
}): Promise<
  | {
      tag: string;
      digest: string;
      manifest: AppUpdateManifest;
      bytes: Buffer;
      assets: Array<{ id: number; name: string; size: number; url: string }>;
    }
  | undefined
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const publicKeyHex = input.publicKeyHex ?? EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex;
  const signingKeyId = input.signingKeyId ?? EMBEDDED_UPDATER_PUBLIC_KEY.keyId;
  let release;
  let atomFallback = false;
  try {
    const listed = await fetchGithubReleasePages({
      url: appListUrl(),
      fetchImpl,
      timeoutMs: 15_000,
      maxPages: 5,
      maxBytes: BOUNDED_HTTP_MAX_BYTES.registryMetadata,
    });
    release = selectHighestAppRelease(listed.releases, input.currentVersion);
  } catch (error) {
    const fallbackAllowed =
      (error instanceof PenglaiError && error.errorClass === "DELIVERY_TRANSIENT") ||
      error instanceof TypeError ||
      (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
    if (!fallbackAllowed) throw error;
    const tags = await fetchGithubReleaseTags({
      owner: GITHUB_OWNER,
      repo: APP_REPO,
      fetchImpl,
      maxBytes: BOUNDED_HTTP_MAX_BYTES.registryMetadata,
    });
    release = selectHighestAppRelease(
      tags.map((tag) => ({ tag_name: tag, immutable: true, assets: [] })),
      input.currentVersion,
    );
    atomFallback = true;
  }
  if (!release) return undefined;
  const jsonAsset = atomFallback
    ? undefined
    : release.assets.find((row) => row.name === UPDATE_MANIFEST_ASSET);
  const sigAsset = atomFallback
    ? undefined
    : release.assets.find((row) => row.name === UPDATE_MANIFEST_SIGNATURE_ASSET);
  if (!atomFallback && (!jsonAsset || !sigAsset)) {
    throw new PenglaiError("INVALID_INPUT", "update manifest assets missing");
  }
  const ownerRepo = `${GITHUB_OWNER}/${APP_REPO}`;
  const bytes = await downloadVerifiedBytes({
    url: jsonAsset?.url ?? taggedReleaseAssetUrl(GITHUB_OWNER, APP_REPO, release.tag, UPDATE_MANIFEST_ASSET),
    sha256: jsonAsset?.digest ? jsonAsset.digest.replace(/^sha256:/, "") : "pending",
    size: jsonAsset?.size ?? 1,
    maxBytes: 1024 * 1024,
    ...(jsonAsset ? { assetId: jsonAsset.id } : {}),
    ownerRepo,
    fetchImpl,
    skipHash: !jsonAsset?.digest,
  });
  const sig = await downloadVerifiedBytes({
    url: sigAsset?.url ?? taggedReleaseAssetUrl(GITHUB_OWNER, APP_REPO, release.tag, UPDATE_MANIFEST_SIGNATURE_ASSET),
    sha256: "pending",
    size: sigAsset?.size ?? 1,
    maxBytes: 256,
    ...(sigAsset ? { assetId: sigAsset.id } : {}),
    ownerRepo,
    fetchImpl,
    skipHash: true,
  });
  const json = JSON.parse(bytes.toString("utf8")) as unknown;
  verifyBytes(bytes, decodeDetachedSignature(sig), publicKeyHex);
  const manifest = parseAppUpdateManifest(json, input.nowMs ?? Date.now());
  if (compareSemver(input.currentVersion, manifest.minimumSourceVersion) < 0) {
    throw new PenglaiError("SECURITY_POLICY", "below minimum");
  }
  if (manifest.signingKeyId !== signingKeyId && manifest.signingKeyId !== publicKeyHex.slice(0, 24)) {
    throw new PenglaiError("SECURITY_POLICY", "update signingKeyId is not the embedded updater key");
  }
  if (manifest.releaseTag !== release.tag) {
    throw new PenglaiError("SECURITY_POLICY", "update manifest tag drifted from the discovered immutable release");
  }
  const digest = createHash("sha256").update(canonicalizeBytes(json)).digest("hex");
  assertDistinctManifestIdentities(digest, manifest.releaseManifestSha256);
  if (input.trustPath) {
    acceptMonotonic({
      path: input.trustPath,
      kind: "app-update",
      sequence: manifest.sequence,
      keyEpoch: input.keyEpoch ?? EMBEDDED_UPDATER_PUBLIC_KEY.epoch,
      digest,
      tag: release.tag,
    });
  }
  const assets = atomFallback
    ? Object.values(manifest.platforms).map((platform) => ({
        id: platform.assetId,
        name: decodeURIComponent(new URL(platform.url).pathname.slice(new URL(platform.url).pathname.lastIndexOf("/") + 1)),
        size: platform.size,
        url: platform.url,
      }))
    : release.assets;
  return { tag: release.tag, digest, manifest, bytes, assets };
}
