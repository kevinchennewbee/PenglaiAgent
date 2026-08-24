import { PenglaiError } from "@penglai/contracts";

export const PLUGIN_CATALOG_V1 = "penglai.plugin-catalog.v1" as const;
export const PINNED_DSH = "0.1.1-rc.2" as const;
export const CENTER_PROTOCOL = 1 as const;
export const CATALOG_SEQUENCE_FLOOR = 6 as const;
export const GITHUB_OWNER = "kevinchennewbee";
export const PLUGIN_REGISTRY_REPO = "PenglaiPluginRegistry";
export const APP_REPO = "PenglaiAgent";
export const GITHUB_API_ORIGIN = "https://api.github.com";
export const ALLOWED_ASSET_HOSTS = Object.freeze([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export type ProvenanceClass =
  | "official-core"
  | "penglai-builtin"
  | "penglai-first-party"
  | "community-reviewed";

export interface CatalogArtifact {
  target: string;
  releaseTag: string;
  assetId: number;
  url: string;
  size: number;
  sha256: string;
  signatureAsset: string;
}

export interface CatalogEntry {
  id: string;
  version: string;
  title: { en: string; "zh-CN": string };
  summary: { en: string; "zh-CN": string };
  publisher: string;
  provenanceClass: ProvenanceClass;
  license: string;
  dsh: { exact: typeof PINNED_DSH };
  minPenglai: string;
  capabilities: string[];
  permissions: string[];
  defaultEnabled: false;
  entry: string;
  clientEntry?: string;
  targets: string[];
  nativeCode: false;
  networkOrigins: string[];
  dataPaths: string[];
  artifacts: CatalogArtifact[];
  migration: string;
  rollback: string;
}

export interface CatalogRevocation {
  id: string;
  version: string;
  sha256: string;
  severity: "critical" | "high" | "superseded";
  reason: string;
  advisory: string;
  replacement?: string;
}

export interface SignedPluginCatalog {
  schema: typeof PLUGIN_CATALOG_V1;
  catalogId: string;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  centerProtocol: typeof CENTER_PROTOCOL;
  signingKeyId: string;
  entries: CatalogEntry[];
  revocations: CatalogRevocation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PenglaiError("INVALID_INPUT", `${label} required`);
  return value;
}

function requireSha(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new PenglaiError("SECURITY_POLICY", `${label} must be lowercase sha256`);
  return text;
}

function requireHttpsGithubAsset(url: string, releaseTag: string, filename: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "artifact URL invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new PenglaiError("SECURITY_POLICY", "artifact URL must be https without credentials/query");
  }
  if (!ALLOWED_ASSET_HOSTS.includes(parsed.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", "artifact host not allowed");
  }
  const expected = `/kevinchennewbee/${PLUGIN_REGISTRY_REPO}/releases/download/${releaseTag}/${filename}`;
  if (parsed.hostname === "github.com" && parsed.pathname !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "artifact path is not the immutable registry release asset");
  }
  if (/(^|[/_.-])latest([/_.-]|$)/i.test(parsed.pathname)) {
    throw new PenglaiError("SECURITY_POLICY", "mutable latest asset is not a trust source");
  }
  return parsed;
}

export function parseSignedPluginCatalog(raw: unknown, nowMs = Date.now()): SignedPluginCatalog {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", "catalog");
  if (raw.schema !== PLUGIN_CATALOG_V1) throw new PenglaiError("INVALID_INPUT", "catalog schema");
  if (raw.centerProtocol !== CENTER_PROTOCOL) throw new PenglaiError("SECURITY_POLICY", "center protocol");
  if (!Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < CATALOG_SEQUENCE_FLOOR) {
    throw new PenglaiError("SECURITY_POLICY", "catalog sequence");
  }
  const issuedAt = Date.parse(requireString(raw.issuedAt, "issuedAt"));
  const expiresAt = Date.parse(requireString(raw.expiresAt, "expiresAt"));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new PenglaiError("SECURITY_POLICY", "catalog timestamps");
  }
  if (nowMs > expiresAt) throw new PenglaiError("SECURITY_POLICY", "catalog expired");
  if (Math.abs(nowMs - issuedAt) > 24 * 60 * 60 * 1000 && nowMs < issuedAt - 24 * 60 * 60 * 1000) {
    throw new PenglaiError("SECURITY_POLICY", "catalog clock skew");
  }
  if (!Array.isArray(raw.entries) || !Array.isArray(raw.revocations)) {
    throw new PenglaiError("INVALID_INPUT", "catalog entries/revocations");
  }
  const seen = new Set<string>();
  const entries = raw.entries.map((item) => parseEntry(item, seen));
  return {
    schema: PLUGIN_CATALOG_V1,
    catalogId: requireString(raw.catalogId, "catalogId"),
    sequence: Number(raw.sequence),
    issuedAt: requireString(raw.issuedAt, "issuedAt"),
    expiresAt: requireString(raw.expiresAt, "expiresAt"),
    centerProtocol: CENTER_PROTOCOL,
    signingKeyId: requireString(raw.signingKeyId, "signingKeyId"),
    entries,
    revocations: raw.revocations.map((item) => parseRevocation(item)),
  };
}

function parseEntry(raw: unknown, seen: Set<string>): CatalogEntry {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", "catalog entry");
  if (raw.defaultEnabled !== false) throw new PenglaiError("SECURITY_POLICY", "remote plugins cannot defaultEnabled");
  if (!isRecord(raw.dsh) || raw.dsh.exact !== PINNED_DSH) {
    throw new PenglaiError("SECURITY_POLICY", "plugin DSH pin must be 0.1.1-rc.2");
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length < 1) {
    throw new PenglaiError("INVALID_INPUT", "plugin artifacts");
  }
  const id = requireString(raw.id, "id");
  const version = requireString(raw.version, "version");
  const artifacts = raw.artifacts.map((item) => parseArtifact(item));
  for (const artifact of artifacts) {
    const key = `${id}@${version}:${artifact.target}:${artifact.sha256}`;
    if (seen.has(key)) throw new PenglaiError("SECURITY_POLICY", "duplicate plugin artifact identity");
    seen.add(key);
  }
  if (raw.nativeCode !== false) throw new PenglaiError("SECURITY_POLICY", "remote plugin cannot ship nativeCode");
  const entry = requireString(raw.entry, "entry");
  if (entry.includes("..") || entry.startsWith("/") || entry.startsWith("\\")) {
    throw new PenglaiError("SECURITY_POLICY", "plugin entry path escape");
  }
  const targets = stringList(raw.targets, "targets");
  if (!targets.length) throw new PenglaiError("INVALID_INPUT", "plugin targets");
  return {
    id,
    version,
    title: localePair(raw.title, "title"),
    summary: localePair(raw.summary, "summary"),
    publisher: requireString(raw.publisher, "publisher"),
    provenanceClass: parseProvenance(raw.provenanceClass),
    license: requireString(raw.license, "license"),
    dsh: { exact: PINNED_DSH },
    minPenglai: requireString(raw.minPenglai, "minPenglai"),
    capabilities: stringList(raw.capabilities, "capabilities"),
    permissions: stringList(raw.permissions, "permissions"),
    defaultEnabled: false,
    entry,
    ...(typeof raw.clientEntry === "string" && raw.clientEntry
      ? { clientEntry: requireString(raw.clientEntry, "clientEntry") }
      : {}),
    targets,
    nativeCode: false,
    networkOrigins: stringList(raw.networkOrigins, "networkOrigins"),
    dataPaths: stringList(raw.dataPaths, "dataPaths"),
    artifacts,
    migration: requireString(raw.migration, "migration"),
    rollback: requireString(raw.rollback, "rollback"),
  };
}

function parseArtifact(raw: unknown): CatalogArtifact {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", "artifact");
  const url = requireString(raw.url, "url");
  const releaseTag = requireString(raw.releaseTag, "releaseTag");
  const filename = url.slice(url.lastIndexOf("/") + 1);
  requireHttpsGithubAsset(url, releaseTag, filename);
  if (!Number.isSafeInteger(raw.assetId) || Number(raw.assetId) <= 0) {
    throw new PenglaiError("SECURITY_POLICY", "artifact assetId");
  }
  if (!Number.isSafeInteger(raw.size) || Number(raw.size) <= 0 || Number(raw.size) > 64 * 1024 * 1024) {
    throw new PenglaiError("SECURITY_POLICY", "artifact size");
  }
  return {
    target: requireString(raw.target, "target"),
    releaseTag,
    assetId: Number(raw.assetId),
    url,
    size: Number(raw.size),
    sha256: requireSha(raw.sha256, "sha256"),
    signatureAsset: requireString(raw.signatureAsset, "signatureAsset"),
  };
}

function parseRevocation(raw: unknown): CatalogRevocation {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", "revocation");
  const severity = raw.severity;
  if (severity !== "critical" && severity !== "high" && severity !== "superseded") {
    throw new PenglaiError("INVALID_INPUT", "revocation severity");
  }
  return {
    id: requireString(raw.id, "revocation.id"),
    version: requireString(raw.version, "revocation.version"),
    sha256: requireSha(raw.sha256, "revocation.sha256"),
    severity,
    reason: requireString(raw.reason, "reason"),
    advisory: requireString(raw.advisory, "advisory"),
    ...(typeof raw.replacement === "string" ? { replacement: raw.replacement } : {}),
  };
}

function localePair(raw: unknown, label: string): { en: string; "zh-CN": string } {
  if (!isRecord(raw)) throw new PenglaiError("INVALID_INPUT", label);
  return { en: requireString(raw.en, `${label}.en`), "zh-CN": requireString(raw["zh-CN"], `${label}.zh-CN`) };
}

function parseProvenance(value: unknown): ProvenanceClass {
  if (
    value === "official-core" ||
    value === "penglai-builtin" ||
    value === "penglai-first-party" ||
    value === "community-reviewed"
  ) {
    return value;
  }
  throw new PenglaiError("SECURITY_POLICY", "unknown provenance class");
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PenglaiError("INVALID_INPUT", label);
  }
  return value.map((item) => String(item));
}

export function assertCompatibleWithPenglai(
  entry: CatalogEntry,
  penglaiVersion: string,
  dshExact: string,
): void {
  if (entry.dsh.exact !== dshExact) throw new PenglaiError("DSH_CONTRACT_DRIFT", `incompatible DSH ${entry.dsh.exact}`);
  if (compareSemver(penglaiVersion, entry.minPenglai) < 0) {
    throw new PenglaiError("SECURITY_POLICY", `${entry.id} requires Penglai ${entry.minPenglai}`);
  }
}

export function compareSemver(a: string, b: string): number {
  const numericPrefix = (part: string): number => {
    let end = 0;
    while (end < part.length) {
      const code = part.charCodeAt(end);
      if (code < 48 || code > 57) break;
      end += 1;
    }
    return end === 0 ? 0 : Number.parseInt(part.slice(0, end), 10) || 0;
  };
  const pa = a.split(".").map(numericPrefix);
  const pb = b.split(".").map(numericPrefix);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}
