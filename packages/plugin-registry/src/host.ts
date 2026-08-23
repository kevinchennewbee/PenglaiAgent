import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { inspectTarGz } from "./tar.js";
import { canonicalizeBytes } from "./canonical-json.js";
import {
  assertCompatibleWithPenglai,
  PINNED_DSH,
  parseSignedPluginCatalog,
  type CatalogEntry,
  type SignedPluginCatalog,
} from "./catalog-schema.js";
import { selectCatalogArtifact } from "./catalog-artifact.js";
import { downloadVerifiedBytes, githubDigestToSha256 } from "./download.js";
import { EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY } from "./embedded-keys.js";
import {
  assertManifestMatchesCatalog,
  inspectPluginEntries,
  type EmbeddedPluginManifestV2,
} from "./archive-policy.js";
import {
  catalogListUrl,
  fetchGithubReleasePages,
  fetchGithubReleaseTags,
  selectHighestCatalogRelease,
  taggedReleaseAssetUrl,
  type DiscoveredRelease,
} from "./release-discovery.js";
import { assertInstallAllowed, shouldDisableOnBoot } from "./revocation.js";
import { decodeDetachedSignature, verifyBytes } from "./signature.js";
import {
  acceptMonotonic,
  contentAddressedPath,
  readTrustState,
} from "./trust-ledger.js";

export const CATALOG_JSON_ASSET = "plugin-catalog-v1.json";
export const CATALOG_SIG_ASSET = "plugin-catalog-v1.json.sig";
export const MAX_CATALOG_BYTES = 1024 * 1024;
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;

export interface RegistryHostConfig {
  cacheRoot: string;
  trustPath: string;
  lastGoodPath: string;
  penglaiVersion: string;
  dshExact?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  keyEpoch?: number;
  target?: string;
}

export interface RegistrySnapshot {
  source: "github-immutable" | "github-signed-tag-fallback" | "last-good-offline";
  tag: string;
  sequence: number;
  digest: string;
  issuedAt: string;
  expiresAt: string;
  signingKeyId: string;
  signatureOk: true;
  catalog: SignedPluginCatalog;
  offline: boolean;
  catalogBytes?: string;
  signatureBytes?: string;
}

export interface CachedPackage {
  id: string;
  version: string;
  sha256: string;
  size: number;
  path: string;
  signaturePath: string;
  manifest: EmbeddedPluginManifestV2;
  files: string[];
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function assetNamed(release: DiscoveredRelease, name: string) {
  const asset = release.assets.find((row) => row.name === name);
  if (!asset || !asset.url || asset.id <= 0) {
    throw new PenglaiError("INVALID_INPUT", `release missing ${name}`);
  }
  return asset;
}

function discoveryFallbackAllowed(error: unknown): boolean {
  if (error instanceof PenglaiError) return error.errorClass === "DELIVERY_TRANSIENT";
  return (
    error instanceof TypeError ||
    (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
  );
}

export class PluginDistributionClient {
  readonly #config: RegistryHostConfig;
  #snapshot: RegistrySnapshot | undefined;

  constructor(config: RegistryHostConfig) {
    mkdirSync(config.cacheRoot, { recursive: true, mode: 0o700 });
    mkdirSync(dirname(config.trustPath), { recursive: true, mode: 0o700 });
    this.#config = config;
  }

  snapshot(): RegistrySnapshot | undefined {
    return this.#snapshot ?? this.#readLastGood();
  }

  lastGood(): RegistrySnapshot | undefined {
    return this.#readLastGood();
  }

  async refresh(): Promise<RegistrySnapshot> {
    const now = this.#config.nowMs?.() ?? Date.now();
    const fetchImpl = this.#config.fetchImpl ?? fetch;
    try {
      let release: DiscoveredRelease;
      let atomFallback = false;
      try {
        const listed = await fetchGithubReleasePages({
          url: catalogListUrl(),
          fetchImpl,
          timeoutMs: 15_000,
          maxPages: 5,
          maxBytes: MAX_CATALOG_BYTES,
        });
        release = selectHighestCatalogRelease(listed.releases);
      } catch (error) {
        if (!discoveryFallbackAllowed(error)) throw error;
        const tags = await fetchGithubReleaseTags({
          owner: "kevinchennewbee",
          repo: "PenglaiPluginRegistry",
          fetchImpl,
          maxBytes: MAX_CATALOG_BYTES,
        });
        release = selectHighestCatalogRelease(
          tags.map((tag) => ({ tag_name: tag, immutable: true, assets: [] })),
        );
        atomFallback = true;
      }
      const jsonAsset = atomFallback ? undefined : assetNamed(release, CATALOG_JSON_ASSET);
      const sigAsset = atomFallback ? undefined : assetNamed(release, CATALOG_SIG_ASSET);
      const jsonBytes = await downloadVerifiedBytes({
        url: jsonAsset?.url ?? taggedReleaseAssetUrl("kevinchennewbee", "PenglaiPluginRegistry", release.tag, CATALOG_JSON_ASSET),
        sha256: jsonAsset?.digest ? jsonAsset.digest.replace(/^sha256:/, "") : "pending",
        size: jsonAsset?.size ?? 1,
        maxBytes: MAX_CATALOG_BYTES,
        ...(jsonAsset ? { assetId: jsonAsset.id } : {}),
        fetchImpl,
        skipHash: !jsonAsset?.digest,
      });
      if (jsonAsset?.digest) githubDigestToSha256(jsonAsset.digest, createHash("sha256").update(jsonBytes).digest("hex"));
      const sigBytes = await downloadVerifiedBytes({
        url: sigAsset?.url ?? taggedReleaseAssetUrl("kevinchennewbee", "PenglaiPluginRegistry", release.tag, CATALOG_SIG_ASSET),
        sha256: "pending",
        size: sigAsset?.size ?? 1,
        maxBytes: 256,
        ...(sigAsset ? { assetId: sigAsset.id } : {}),
        fetchImpl,
        skipHash: true,
      });
      const json = JSON.parse(jsonBytes.toString("utf8")) as unknown;
      const digest = createHash("sha256").update(canonicalizeBytes(json)).digest("hex");
      verifyBytes(canonicalizeBytes(json), decodeDetachedSignature(sigBytes), EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.publicKeyHex);
      const catalog = parseSignedPluginCatalog(json, now);
      const catalogTag = `plugin-catalog-v1.${String(catalog.sequence).padStart(6, "0")}`;
      if (release.tag !== catalogTag) {
        throw new PenglaiError("SECURITY_POLICY", "catalog sequence does not match release tag");
      }
      if (catalog.signingKeyId !== EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.keyId) {
        throw new PenglaiError("SECURITY_POLICY", "catalog signingKeyId is not the embedded plugin key");
      }
      acceptMonotonic({
        path: this.#config.trustPath,
        kind: "plugin-catalog",
        sequence: catalog.sequence,
        keyEpoch: this.#config.keyEpoch ?? 1,
        digest,
        tag: release.tag,
      });
      const snapshot: RegistrySnapshot = {
        source: atomFallback ? "github-signed-tag-fallback" : "github-immutable",
        tag: release.tag,
        sequence: catalog.sequence,
        digest,
        issuedAt: catalog.issuedAt,
        expiresAt: catalog.expiresAt,
        signingKeyId: catalog.signingKeyId,
        signatureOk: true,
        catalog,
        offline: false,
        catalogBytes: canonicalizeBytes(json).toString("base64"),
        signatureBytes: sigBytes.toString("base64"),
      };
      this.#snapshot = snapshot;
      atomicJson(this.#config.lastGoodPath, snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const security = /signature|SECURITY_POLICY|rollback|digest|tamper|expired|sequence|key epoch/i.test(message);
      if (security) throw error;
      const last = this.#readLastGood(now);
      if (last) {
        this.#snapshot = { ...last, source: "last-good-offline", offline: true };
        return this.#snapshot;
      }
      throw error;
    }
  }

  entry(id: string): CatalogEntry {
    const catalog = this.snapshot()?.catalog;
    if (!catalog) throw new PenglaiError("INVALID_INPUT", "plugin catalog not loaded");
    const entry = catalog.entries.find((row) => row.id === id);
    if (!entry) throw new PenglaiError("INVALID_INPUT", `${id} is not in the signed catalog`);
    assertCompatibleWithPenglai(entry, this.#config.penglaiVersion, this.#config.dshExact ?? PINNED_DSH);
    return entry;
  }

  async downloadPackage(id: string, target = this.#config.target ?? "any"): Promise<CachedPackage> {
    const catalog = this.snapshot()?.catalog;
    if (!catalog) throw new PenglaiError("INVALID_INPUT", "plugin catalog not loaded");
    const entry = this.entry(id);
    const artifact = selectCatalogArtifact(entry.artifacts, target);
    assertInstallAllowed(catalog, entry.id, entry.version, artifact.sha256);
    const fetchImpl = this.#config.fetchImpl ?? fetch;
    const tgz = await downloadVerifiedBytes({
      url: artifact.url,
      sha256: artifact.sha256,
      size: artifact.size,
      maxBytes: MAX_PACKAGE_BYTES,
      assetId: artifact.assetId,
      fetchImpl,
    });
    const sigUrl = artifact.url.replace(/[^/]+$/, artifact.signatureAsset);
    const sig = await downloadVerifiedBytes({
      url: sigUrl,
      sha256: "pending",
      size: 128,
      maxBytes: 256,
      fetchImpl,
      skipHash: true,
    });
    verifyBytes(tgz, decodeDetachedSignature(sig), EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.publicKeyHex);
    const tarEntries = inspectTarGz(tgz).map((row) => ({
      path: row.path,
      kind: row.kind,
      data: row.data,
    }));
    const inspected = inspectPluginEntries(tarEntries);
    assertManifestMatchesCatalog({
      catalogId: entry.id,
      catalogVersion: entry.version,
      catalogPermissions: entry.permissions,
      catalogCapabilities: entry.capabilities,
      catalogDsh: entry.dsh.exact,
      manifest: inspected.manifest,
    });
    const tgzPath = contentAddressedPath(this.#config.cacheRoot, artifact.sha256, ".tgz");
    const sigPath = contentAddressedPath(this.#config.cacheRoot, artifact.sha256, ".tgz.sig");
    mkdirSync(this.#config.cacheRoot, { recursive: true, mode: 0o700 });
    const tmp = `${tgzPath}.${process.pid}.tmp`;
    writeFileSync(tmp, tgz, { mode: 0o600 });
    renameSync(tmp, tgzPath);
    writeFileSync(sigPath, sig, { mode: 0o600 });
    return {
      id: entry.id,
      version: entry.version,
      sha256: artifact.sha256,
      size: artifact.size,
      path: tgzPath,
      signaturePath: sigPath,
      manifest: inspected.manifest,
      files: inspected.files,
    };
  }

  revokedOnBoot(id: string, version: string, sha256: string): boolean {
    const catalog = this.snapshot()?.catalog;
    if (!catalog) return false;
    return shouldDisableOnBoot(catalog, id, version, sha256);
  }

  cards(): Array<Record<string, unknown>> {
    const snap = this.snapshot();
    if (!snap) return [];
    return snap.catalog.entries.map((entry) => {
      const hostTarget = this.#config.target ?? "any";
      let artifact: (typeof entry.artifacts)[number] | undefined;
      try {
        artifact = selectCatalogArtifact(entry.artifacts, hostTarget);
      } catch {
        artifact = undefined;
      }
      const revoked = artifact
        ? shouldDisableOnBoot(snap.catalog, entry.id, entry.version, artifact.sha256)
        : false;
      const cached = artifact ? existsSync(contentAddressedPath(this.#config.cacheRoot, artifact.sha256, ".tgz")) : false;
      return {
        id: entry.id,
        version: entry.version,
        title: entry.title,
        summary: entry.summary,
        publisher: entry.publisher,
        provenanceClass: entry.provenanceClass,
        source: "penglai-plugin-registry",
        dshExact: entry.dsh.exact,
        dshCompatible: entry.dsh.exact === (this.#config.dshExact ?? PINNED_DSH),
        permissions: entry.permissions,
        capabilities: entry.capabilities,
        signature: { keyId: snap.signingKeyId, ok: snap.signatureOk },
        issuedAt: snap.issuedAt,
        updatedAt: snap.issuedAt,
        downloaded: cached,
        revoked,
        defaultEnabled: false,
        sha256: artifact?.sha256,
        entry: entry.entry,
        ...(entry.clientEntry ? { clientEntry: entry.clientEntry } : {}),
        targets: entry.targets,
        networkOrigins: entry.networkOrigins,
        dataPaths: entry.dataPaths,
        nativeCode: entry.nativeCode,
        incompatible: Boolean(
          hostTarget &&
            !entry.artifacts.some((row) => row.target === hostTarget || row.target === "any"),
        ),
      };
    });
  }

  #readLastGood(nowMs = this.#config.nowMs?.() ?? Date.now()): RegistrySnapshot | undefined {
    if (!existsSync(this.#config.lastGoodPath)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(this.#config.lastGoodPath, "utf8")) as RegistrySnapshot;
      if (!raw.catalogBytes || !raw.signatureBytes) {
        throw new PenglaiError("STORE_CORRUPT", "last-good plugin catalog missing signature bytes");
      }
      const catalogBytes = Buffer.from(raw.catalogBytes, "base64");
      const signatureBytes = Buffer.from(raw.signatureBytes, "base64");
      verifyBytes(catalogBytes, decodeDetachedSignature(signatureBytes), EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.publicKeyHex);
      const catalog = parseSignedPluginCatalog(JSON.parse(catalogBytes.toString("utf8")), nowMs);
      const digest = createHash("sha256").update(catalogBytes).digest("hex");
      const ledger = readTrustState(this.#config.trustPath);
      if (ledger && (ledger.lastDigest !== digest || ledger.highestSequence !== catalog.sequence)) {
        throw new PenglaiError("SECURITY_POLICY", "last-good catalog does not match trust ledger");
      }
      return { ...raw, catalog, digest, signatureOk: true };
    } catch (error) {
      if (error instanceof PenglaiError) throw error;
      throw new PenglaiError("STORE_CORRUPT", "last-good plugin catalog is unusable");
    }
  }
}
