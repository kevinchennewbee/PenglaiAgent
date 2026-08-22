import { PenglaiError } from "@penglai/contracts";
import {
  CANDIDATE_KIND,
  GENERATION_ID,
  PINNED_DSH,
  PINNED_ELECTRON,
  PINNED_NODE,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  RELEASE_TARGETS,
  RUNTIME_INPUTS,
  TRUST_TIER,
  UPDATER_CHANNEL,
} from "./pins.js";

export const EXACT_USER_INSTALLERS = RELEASE_TARGETS.map((t) => t.installer);

export const EXACT_RELEASE_ASSETS = [
  ...EXACT_USER_INSTALLERS,
  "update-manifest-v1.json",
  "update-manifest-v1.json.sig",
  "release-manifest.json",
  "SBOM.cdx.json",
  "THIRD_PARTY_NOTICES.txt",
  "SHA256SUMS",
  "public-export-manifest.json",
] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const FORBIDDEN_URL = /latest|releases\/latest|http:\/\//i;

export interface RuntimeInput {
  kind: "node" | "electron";
  target: string;
  url: string;
  sha256: string;
  archive: string;
  filename: string;
}

export interface ReleaseContract {
  schemaVersion: 1;
  product: string;
  version: string;
  candidateKind: string;
  trustTier: string;
  generationId: string;
  electronVersion: string;
  nodeVersion: string;
  dshVersion: string;
  updaterChannel: string;
  updaterPublicKeyId: string;
  updaterPublicKeyHex: string;
  updaterManifestUrl: string;
  updaterManifestSignatureUrl: string;
  updaterAllowedAssetHosts: string[];
  publication: {
    repo: string;
    tag: string;
    release: string;
    channel: string;
  };
  targets: Array<{
    key: string;
    platform: string;
    arch: string;
    installer: string;
  }>;
  runtimeInputs: RuntimeInput[];
  exactAssets: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export function assertCanonicalDownloadUrl(url: string): void {
  if (FORBIDDEN_URL.test(url)) {
    throw new PenglaiError("SECURITY_POLICY", `non-canonical download URL ${url}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PenglaiError("INVALID_INPUT", `invalid download URL ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new PenglaiError("SECURITY_POLICY", `download must be https ${url}`);
  }
  const host = parsed.hostname;
  const ok =
    host === "nodejs.org" ||
    host === "github.com" ||
    host === "objects.githubusercontent.com";
  if (!ok) throw new PenglaiError("SECURITY_POLICY", `download host not allowlisted ${host}`);
}

export function assertCanonicalUpdaterManifestUrl(url: string, signature = false): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PenglaiError("INVALID_INPUT", "invalid updater manifest URL");
  }
  const expectedPath = signature
    ? "/kevinchennewbee/PenglaiAgent/releases/download/v0.5.3/update-manifest-v1.json.sig"
    : "/kevinchennewbee/PenglaiAgent/releases/download/v0.5.3/update-manifest-v1.json";
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== expectedPath ||
    /(^|[/_.-])latest([/_.-]|$)/i.test(parsed.pathname)
  ) {
    throw new PenglaiError("SECURITY_POLICY", "updater manifest URL is not canonical PUDP/1 HTTPS");
  }
}

export function assertReleaseContract(raw: unknown): ReleaseContract {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", "release-contract not an object");
  if (raw.schemaVersion !== 1) throw new PenglaiError("INVALID_INPUT", "schemaVersion");
  if (raw.product !== PRODUCT_NAME) throw new PenglaiError("INVALID_INPUT", "product");
  if (raw.version !== PRODUCT_VERSION) throw new PenglaiError("INVALID_INPUT", "version");
  if (raw.candidateKind !== CANDIDATE_KIND) throw new PenglaiError("INVALID_INPUT", "candidateKind");
  if (raw.trustTier !== TRUST_TIER) throw new PenglaiError("INVALID_INPUT", "trustTier");
  if (raw.generationId !== GENERATION_ID) throw new PenglaiError("INVALID_INPUT", "generationId");
  if (raw.electronVersion !== PINNED_ELECTRON) throw new PenglaiError("INVALID_INPUT", "electronVersion");
  if (raw.nodeVersion !== PINNED_NODE) throw new PenglaiError("INVALID_INPUT", "nodeVersion");
  if (raw.dshVersion !== PINNED_DSH) throw new PenglaiError("INVALID_INPUT", "dshVersion");
  if (raw.updaterChannel !== UPDATER_CHANNEL) throw new PenglaiError("INVALID_INPUT", "updaterChannel");
  if (typeof raw.updaterPublicKeyId !== "string" || raw.updaterPublicKeyId.length < 8) {
    throw new PenglaiError("INVALID_INPUT", "updaterPublicKeyId");
  }
  if (typeof raw.updaterPublicKeyHex !== "string" || !/^[0-9a-f]{64}$/.test(raw.updaterPublicKeyHex)) {
    throw new PenglaiError("INVALID_INPUT", "updaterPublicKeyHex must be 32-byte hex");
  }
  if (typeof raw.updaterManifestUrl !== "string" || typeof raw.updaterManifestSignatureUrl !== "string") {
    throw new PenglaiError("INVALID_INPUT", "updater manifest URLs missing");
  }
  assertCanonicalUpdaterManifestUrl(raw.updaterManifestUrl);
  assertCanonicalUpdaterManifestUrl(raw.updaterManifestSignatureUrl, true);
  if (
    !Array.isArray(raw.updaterAllowedAssetHosts) ||
    raw.updaterAllowedAssetHosts.length !== 1 ||
    raw.updaterAllowedAssetHosts[0] !== "github.com"
  ) {
    throw new PenglaiError("SECURITY_POLICY", "updater asset host allowlist invalid");
  }
  const pub = raw.publication;
  if (!isRecord(pub)) throw new PenglaiError("INVALID_INPUT", "publication");
  if (pub.repo !== "kevinchennewbee/PenglaiAgent") throw new PenglaiError("SECURITY_POLICY", "publication.repo");
  if (pub.tag !== "v0.5.3") throw new PenglaiError("SECURITY_POLICY", "publication.tag");
  if (pub.release !== "v0.5.3") throw new PenglaiError("SECURITY_POLICY", "publication.release");
  if (pub.channel !== "stable-v0.5.3") throw new PenglaiError("SECURITY_POLICY", "publication.channel");
  if (!Array.isArray(raw.targets) || raw.targets.length !== RELEASE_TARGETS.length) {
    throw new PenglaiError("INVALID_INPUT", "targets");
  }
  for (let i = 0; i < RELEASE_TARGETS.length; i += 1) {
    const expect = RELEASE_TARGETS[i]!;
    const got = raw.targets[i] as Record<string, unknown>;
    if (got.key !== expect.key || got.installer !== expect.installer) {
      throw new PenglaiError("INVALID_INPUT", `target ${expect.key}`);
    }
  }
  if (!Array.isArray(raw.runtimeInputs)) throw new PenglaiError("INVALID_INPUT", "runtimeInputs");
  const inputs = raw.runtimeInputs as RuntimeInput[];
  const required = RUNTIME_INPUTS.map((row) => `${row.target}:${row.kind}`);
  const have = new Set(inputs.map((i) => `${i.target}:${i.kind}`));
  for (const key of required) {
    if (!have.has(key)) throw new PenglaiError("INVALID_INPUT", `missing runtime input ${key}`);
  }
  for (const input of inputs) {
    if (!HEX64.test(input.sha256)) throw new PenglaiError("INVALID_INPUT", `runtime sha256 ${input.filename}`);
    assertCanonicalDownloadUrl(input.url);
    if (input.url.includes("latest")) throw new PenglaiError("SECURITY_POLICY", "latest URL");
    const expect = RUNTIME_INPUTS.find((row) => row.target === input.target && row.kind === input.kind);
    if (!expect) throw new PenglaiError("INVALID_INPUT", `unexpected runtime input ${input.target}:${input.kind}`);
    if (input.filename !== expect.filename || input.url !== expect.url || input.sha256 !== expect.sha256) {
      throw new PenglaiError("INVALID_INPUT", `runtime input drift ${input.target}:${input.kind}`);
    }
  }
  if (inputs.length !== required.length) {
    throw new PenglaiError("INVALID_INPUT", `runtime input count ${inputs.length}`);
  }
  if (!Array.isArray(raw.exactAssets)) throw new PenglaiError("INVALID_INPUT", "exactAssets");
  const assets = raw.exactAssets.map(String);
  for (const name of EXACT_RELEASE_ASSETS) {
    if (!assets.includes(name)) throw new PenglaiError("INVALID_INPUT", `exact asset missing ${name}`);
  }
  if (assets.length !== EXACT_RELEASE_ASSETS.length) {
    throw new PenglaiError("INVALID_INPUT", `exact asset count ${assets.length}`);
  }
  return raw as unknown as ReleaseContract;
}

export function updaterRequiresIndependentSignature(contract: ReleaseContract): boolean {
  return Boolean(contract.updaterPublicKeyId && contract.updaterPublicKeyHex);
}
