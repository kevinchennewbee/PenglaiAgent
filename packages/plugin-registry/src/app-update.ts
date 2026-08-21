import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { ALLOWED_ASSET_HOSTS, APP_REPO, GITHUB_OWNER } from "./catalog-schema.js";
import { canonicalizeBytes } from "./canonical-json.js";
import { downloadVerifiedBytes } from "./download.js";
import { EMBEDDED_UPDATER_PUBLIC_KEY } from "./embedded-keys.js";
import { appListUrl, selectHighestAppRelease } from "./release-discovery.js";
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
  platforms: Record<string, AppUpdatePlatform>;
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

export function parseAppUpdateManifest(raw: unknown, nowMs = Date.now()): AppUpdateManifest {
  if (!isRecord(raw) || raw.schema !== APP_UPDATE_SCHEMA) {
    throw new PenglaiError("INVALID_INPUT", "app update schema");
  }
  if (raw.channel !== "stable") throw new PenglaiError("SECURITY_POLICY", "update channel");
  if (!Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 1) {
    throw new PenglaiError("SECURITY_POLICY", "update sequence");
  }
  const version = String(raw.version ?? "");
  const releaseTag = String(raw.releaseTag ?? "");
  if (releaseTag !== `v${version}`) throw new PenglaiError("SECURITY_POLICY", "releaseTag must match version");
  const expiresAt = Date.parse(String(raw.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt) || nowMs > expiresAt) throw new PenglaiError("SECURITY_POLICY", "update manifest expired");
  if (!isRecord(raw.platforms) || !isRecord(raw.migration)) throw new PenglaiError("INVALID_INPUT", "update platforms");
  const platforms: Record<string, AppUpdatePlatform> = {};
  for (const [key, value] of Object.entries(raw.platforms)) {
    platforms[key] = parsePlatform(value, releaseTag);
  }
  const migration = raw.migration;
  return {
    schema: APP_UPDATE_SCHEMA,
    sequence: Number(raw.sequence),
    version,
    channel: "stable",
    releaseTag,
    issuedAt: String(raw.issuedAt),
    expiresAt: String(raw.expiresAt),
    signingKeyId: String(raw.signingKeyId),
    minimumSourceVersion: String(raw.minimumSourceVersion),
    notesUrl: String(raw.notesUrl),
    platforms,
    migration: {
      fromSchema: Number(migration.fromSchema),
      toSchema: Number(migration.toSchema),
      backupRequired: true,
      rollbackCompatible: migration.rollbackCompatible === true,
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
  if (!/^[0-9a-f]{64}$/.test(String(raw.sha256 ?? ""))) throw new PenglaiError("SECURITY_POLICY", "update sha256");
  return {
    assetId: Number(raw.assetId),
    url,
    size: Number(raw.size),
    sha256: String(raw.sha256),
    signature: String(raw.signature),
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
    }
  | undefined
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const publicKeyHex = input.publicKeyHex ?? EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex;
  const signingKeyId = input.signingKeyId ?? EMBEDDED_UPDATER_PUBLIC_KEY.keyId;
  const list = await downloadVerifiedBytes({
    url: appListUrl(),
    sha256: "pending",
    size: 2 * 1024 * 1024,
    maxBytes: 2 * 1024 * 1024,
    fetchImpl,
    skipHash: true,
  });
  const raw = JSON.parse(list.toString("utf8")) as unknown;
  if (!Array.isArray(raw)) throw new PenglaiError("INVALID_INPUT", "GitHub app releases list");
  const release = selectHighestAppRelease(raw, input.currentVersion);
  if (!release) return undefined;
  const jsonAsset = release.assets.find((row) => row.name === UPDATE_MANIFEST_ASSET);
  const sigAsset = release.assets.find((row) => row.name === UPDATE_MANIFEST_SIGNATURE_ASSET);
  if (!jsonAsset || !sigAsset) throw new PenglaiError("INVALID_INPUT", "update manifest assets missing");
  const bytes = await downloadVerifiedBytes({
    url: jsonAsset.url,
    sha256: jsonAsset.digest ? jsonAsset.digest.replace(/^sha256:/, "") : "pending",
    size: jsonAsset.size,
    maxBytes: 1024 * 1024,
    assetId: jsonAsset.id,
    fetchImpl,
    skipHash: !jsonAsset.digest,
  });
  const sig = await downloadVerifiedBytes({
    url: sigAsset.url,
    sha256: "pending",
    size: sigAsset.size,
    maxBytes: 256,
    assetId: sigAsset.id,
    fetchImpl,
    skipHash: true,
  });
  const json = JSON.parse(bytes.toString("utf8")) as unknown;
  verifyBytes(bytes, decodeDetachedSignature(sig), publicKeyHex);
  const manifest = parseAppUpdateManifest(json, input.nowMs ?? Date.now());
  if (manifest.signingKeyId !== signingKeyId && manifest.signingKeyId !== publicKeyHex.slice(0, 24)) {
    throw new PenglaiError("SECURITY_POLICY", "update signingKeyId is not the embedded updater key");
  }
  if (manifest.releaseTag !== release.tag) {
    throw new PenglaiError("SECURITY_POLICY", "update manifest tag drifted from the discovered immutable release");
  }
  const digest = createHash("sha256").update(canonicalizeBytes(json)).digest("hex");
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
  return { tag: release.tag, digest, manifest, bytes };
}
