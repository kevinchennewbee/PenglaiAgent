import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, t } from "@penglai/contracts";
import {
  PluginDistributionClient,
  selectCatalogArtifact,
  type CachedPackage,
  type RegistrySnapshot,
} from "@penglai/plugin-registry";
import {
  PINNED_PLUGIN_DSH,
  consumePluginOwnerGrant,
  pluginPermissionDigest,
  runtimePluginTarget,
  type PluginCatalogEntry,
  type PluginOwnerAction,
  type ProductPluginTarget,
} from "@penglai/runtime";
import {
  rollbackLastGood,
  runProfileTransaction,
  type ResourceCounts,
} from "./profile-tx.js";
import { normalizeInventory, rowLoaded, rowMatches } from "./inventory.js";

export interface CenterHostLike {
  reconcile(): Array<{
    id: string;
    desired: string;
    installed: string;
    loaded: boolean;
    healthy: boolean;
  }>;
  desired(): Record<string, boolean>;
  setDesired(id: string, enabled: boolean): void;
  entries(): readonly PluginCatalogEntry[];
}

export interface PluginLifecycle {
  apply(input: {
    id: string;
    enabled: boolean;
    forceReload: boolean;
  }): Promise<void>;
}

export interface ResourceProbe {
  snapshot(): ResourceCounts;
}

export interface CenterRemote {
  list(): {
    inventory: unknown;
    catalog: ReturnType<CenterHostLike["reconcile"]>;
    remote: Array<Record<string, unknown>>;
    registry?: {
      source: string;
      sequence: number;
      tag: string;
      issuedAt: string;
      signatureOk: true;
      offline: boolean;
    };
    required: Record<string, boolean>;
    degraded?: boolean;
  };
  enable(id: string, capabilityId?: string): Promise<unknown>;
  disable(id: string): Promise<unknown>;
  update(id: string, capabilityId?: string): Promise<unknown>;
  rollback(id: string): Promise<unknown>;
  refreshRegistry(): Promise<unknown>;
  download(id: string): Promise<unknown>;
  installDisabled(id: string, capabilityId?: string): Promise<unknown>;
}

function catalogEntry(
  entries: readonly PluginCatalogEntry[],
  id: string,
  registry?: PluginDistributionClient,
  hostTarget: ProductPluginTarget = runtimePluginTarget(),
): PluginCatalogEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry) return entry;
  if (!registry) throw new PenglaiError("INVALID_INPUT", "unlisted package");
  const remote = registry.entry(id);
  const artifact = selectCatalogArtifact(remote.artifacts, hostTarget);
  if (remote.dsh.exact !== PINNED_PLUGIN_DSH) {
    throw new PenglaiError("SECURITY_POLICY", `${id} DSH pin is not ${PINNED_PLUGIN_DSH}`);
  }
  return {
    id: remote.id,
    version: remote.version,
    packageFile: `${remote.id.replace("@", "").replaceAll("/", "-")}-${remote.version}.tgz`,
    dsh: { exact: PINNED_PLUGIN_DSH },
    platforms: ["darwin-arm64", "darwin-x64", "win32-x64"],
    capabilities: remote.capabilities,
    permissions: remote.permissions,
    defaultEnabled: false,
    builtIn: false,
    source: "penglai-plugin-registry",
    provenanceClass: remote.provenanceClass === "community-reviewed" ? "community-reviewed" : "penglai-first-party",
    license: remote.license,
    migration: remote.migration,
    rollback: "last-good-profile",
    sha256: artifact.sha256,
    target: hostTarget,
    hasClient: Boolean(remote.clientEntry),
    entry: remote.entry,
    ...(remote.clientEntry ? { clientEntry: remote.clientEntry } : {}),
    networkOrigins: remote.networkOrigins,
    dataPaths: remote.dataPaths,
    nativeCode: remote.nativeCode,
    publisher: remote.publisher,
  };
}

async function waitForInventory(
  inventory: { list(): unknown },
  id: string,
  enabled: boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let observed = "missing";
  while (Date.now() <= deadline) {
    const row = normalizeInventory(inventory.list()).find((candidate) =>
      rowMatches(candidate, id),
    );
    observed = row ? String(row.fiberPhase ?? "disabled") : "missing";
    if (rowLoaded(row) === enabled) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new PenglaiError(
    "DSH_UNAVAILABLE",
    `${id} loader postcondition expected enabled=${String(enabled)} observed=${observed}`,
  );
}

function previousEnabledFromJournal(txDir: string, id: string): boolean {
  const file = join(txDir, "journal.json");
  if (!existsSync(file)) {
    throw new PenglaiError("STORE_CORRUPT", "Center rollback journal missing");
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    id?: unknown;
    previousEnabled?: unknown;
  };
  if (raw.id !== id || typeof raw.previousEnabled !== "boolean") {
    throw new PenglaiError("STORE_CORRUPT", "Center rollback journal mismatch");
  }
  return raw.previousEnabled;
}

function isUnder(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function registryPackageRoot(userDataRoot: string, configured: string | undefined): string {
  const root = configured ?? join(userDataRoot, "plugins", "packages");
  if (!isAbsolute(root) || !isUnder(userDataRoot, root) || resolve(root) === resolve(userDataRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "registry package directory escaped userData");
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "registry package directory must not be a symlink");
  }
  if (!isUnder(realpathSync(userDataRoot), realpathSync(root))) {
    throw new PenglaiError("SECURITY_POLICY", "registry package directory resolved outside userData");
  }
  return root;
}

export function stageRegistryPackage(input: {
  pkg: CachedPackage;
  entry: PluginCatalogEntry;
  userDataRoot: string;
  registryPackagesDir?: string;
}): string {
  const root = registryPackageRoot(input.userDataRoot, input.registryPackagesDir);
  if (input.entry.source !== "penglai-plugin-registry") {
    throw new PenglaiError("SECURITY_POLICY", "only registry packages may enter the mutable package root");
  }
  if (input.pkg.id !== input.entry.id || input.pkg.version !== input.entry.version || input.pkg.sha256 !== input.entry.sha256) {
    throw new PenglaiError("SECURITY_POLICY", "downloaded package identity mismatch");
  }
  if (!existsSync(input.pkg.path) || !lstatSync(input.pkg.path).isFile() || lstatSync(input.pkg.path).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "downloaded package must be a regular cached file");
  }
  const bytes = readFileSync(input.pkg.path);
  if (createHash("sha256").update(bytes).digest("hex") !== input.entry.sha256) {
    throw new PenglaiError("SECURITY_POLICY", "downloaded package checksum mismatch");
  }
  const destination = join(root, input.entry.packageFile);
  if (!isUnder(root, destination)) {
    throw new PenglaiError("SECURITY_POLICY", "registry package escaped mutable package root");
  }
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" });
    renameSync(temp, destination);
  } finally {
    rmSync(temp, { force: true });
  }
  return destination;
}

export function createCenterRemote(opts: {
  host: CenterHostLike;
  inventory: { list(): unknown };
  catalog: readonly PluginCatalogEntry[];
  lifecycle: PluginLifecycle;
  resourceProbe: (id: string) => ResourceProbe | undefined;
  profileDir: string;
  txDir: string;
  /** Read-only packages shipped inside the application. */
  pluginsDir: string;
  /** Mutable, app-private packages downloaded from the signed registry. */
  registryPackagesDir?: string;
  userDataRoot: string;
  registry?: PluginDistributionClient;
  target?: ProductPluginTarget;
}): CenterRemote {
  const hostTarget = (): ProductPluginTarget => opts.target ?? runtimePluginTarget();
  const requireOwner = (id: string, action: PluginOwnerAction, capabilityId: string | undefined): void => {
    if (!capabilityId) throw new PenglaiError("SECURITY_POLICY", "native owner capability is required");
    const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
    consumePluginOwnerGrant({
      userDataRoot: opts.userDataRoot,
      capabilityId,
      action,
      pluginId: id,
      version: entry.version,
      sha256: entry.sha256,
      permissionDigest: pluginPermissionDigest({
        permissions: entry.permissions,
        ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
        ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
        nativeCode: entry.nativeCode === true,
      }),
    });
  };
  const transact = async (
    id: string,
    action: "enable" | "disable" | "update" | "install",
  ) => {
    const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
    if (action === "disable" && id === "@penglai/plugin-center") {
      throw new PenglaiError("SECURITY_POLICY", "required plugin cannot be disabled");
    }
    const previousEnabled = Boolean(opts.host.desired()[id]);
    const probe = opts.resourceProbe(id);
    return runProfileTransaction({
      userDataRoot: opts.userDataRoot,
      profileDir: opts.profileDir,
      txDir: opts.txDir,
      pluginsDir: entry.source === "penglai-plugin-registry"
        ? registryPackageRoot(opts.userDataRoot, opts.registryPackagesDir)
        : opts.pluginsDir,
      entry,
      action,
      previousEnabled,
      applyLive: (input) => opts.lifecycle.apply(input),
      verifyActual: (input) =>
        waitForInventory(opts.inventory, input.id, input.enabled),
      ...(probe ? { readResources: () => probe.snapshot() } : {}),
      commitDesired: (enabled) => opts.host.setDesired(id, enabled),
      rollbackDesired: (enabled) => opts.host.setDesired(id, enabled),
    });
  };
  return {
    list() {
      let raw: unknown = [];
      let inventoryFailed = false;
      try {
        raw = opts.inventory.list();
      } catch {
        raw = [];
        inventoryFailed = true;
      }
      const rows = normalizeInventory(raw);
      let catalog: ReturnType<CenterHostLike["reconcile"]> = [];
      let reconcileFailed = false;
      try {
        catalog = opts.host.reconcile();
      } catch {
        catalog = [];
        reconcileFailed = true;
      }
      const snap = opts.registry?.snapshot();
      const remote = (opts.registry?.cards() ?? []).map((card) => {
        const row = rows.find((entry) => rowMatches(entry, String(card.id)));
        const recon = catalog.find((entry) => entry.id === card.id);
        return {
          ...card,
          installed: recon?.installed ?? (card.downloaded ? "cached" : "not-installed"),
          loaded: rowLoaded(row),
          enabled: recon
            ? recon.desired !== "disabled"
            : Boolean(opts.host.desired()[String(card.id)]),
          rollbackAvailable: existsSync(join(opts.txDir, "last-good")),
        };
      });
      return {
        inventory: raw,
        catalog,
        remote,
        ...(snap
          ? {
              registry: {
                source: snap.source,
                sequence: snap.sequence,
                tag: snap.tag,
                issuedAt: snap.issuedAt,
                signatureOk: true as const,
                offline: snap.offline,
              },
            }
          : {}),
        degraded: inventoryFailed || reconcileFailed,
        required: {
          credentials: rows.some(
            (entry) =>
              rowMatches(entry, "@deepseek-ai/dsh-credentials-local") &&
              rowLoaded(entry),
          ),
          "plugin-center": rows.some(
            (entry) => rowMatches(entry, "@penglai/plugin-center") && rowLoaded(entry),
          ),
          im: rows.some(
            (entry) => rowMatches(entry, "@penglai/im") && rowLoaded(entry),
          ),
        },
      };
    },
    enable(id: string, capabilityId?: string) {
      requireOwner(id, "plugin-enable", capabilityId);
      return transact(id, "enable");
    },
    disable(id: string) {
      return transact(id, "disable");
    },
    async update(id: string, capabilityId?: string) {
      requireOwner(id, "plugin-update", capabilityId);
      const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      if (entry.source === "penglai-plugin-registry") {
        if (!opts.registry) throw new PenglaiError("INVALID_INPUT", "remote plugin registry is not configured");
        const pkg = await opts.registry.downloadPackage(id, hostTarget());
        stageRegistryPackage({ pkg, entry, userDataRoot: opts.userDataRoot, ...(opts.registryPackagesDir ? { registryPackagesDir: opts.registryPackagesDir } : {}) });
      }
      return transact(id, "update");
    },
    async refreshRegistry() {
      if (arguments.length > 0) {
        throw new PenglaiError("SECURITY_POLICY", "production refresh does not accept renderer URL, public key, or signingKeyId");
      }
      const disclaimer = {
        sandbox: false,
        sharedProcess: t("en", "pluginSharedProcess"),
        noArbitraryInstall: t("en", "pluginNoArbitraryInstall"),
      };
      if (!opts.registry) {
        return { ...disclaimer, source: "bundled-first-party" };
      }
      const snap: RegistrySnapshot = await opts.registry.refresh();
      return {
        ...disclaimer,
        source: snap.source,
        digest: snap.digest,
        sequence: snap.sequence,
        tag: snap.tag,
        signingKeyId: snap.signingKeyId,
        offline: snap.offline,
      };
    },
    async download(id: string) {
      if (!opts.registry) throw new PenglaiError("INVALID_INPUT", "remote plugin registry is not configured");
      return opts.registry.downloadPackage(id);
    },
    async installDisabled(id: string, capabilityId?: string) {
      if (!opts.registry) throw new PenglaiError("INVALID_INPUT", "remote plugin registry is not configured");
      requireOwner(id, "plugin-install", capabilityId);
      const pkg = await opts.registry.downloadPackage(id, hostTarget());
      const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      stageRegistryPackage({ pkg, entry, userDataRoot: opts.userDataRoot, ...(opts.registryPackagesDir ? { registryPackagesDir: opts.registryPackagesDir } : {}) });
      const installed = await transact(id, "install");
      await waitForInventory(opts.inventory, id, false);
      return { id, version: pkg.version, sha256: pkg.sha256, enabled: false, installed: true, phase: installed.phase };
    },
    async rollback(id: string) {
      catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      const enabled = previousEnabledFromJournal(opts.txDir, id);
      const out = await rollbackLastGood({
        userDataRoot: opts.userDataRoot,
        profileDir: opts.profileDir,
        txDir: opts.txDir,
        id,
      });
      await opts.lifecycle.apply({ id, enabled, forceReload: true });
      await waitForInventory(opts.inventory, id, enabled);
      opts.host.setDesired(id, enabled);
      return out;
    },
  };
}

export class PenglaiCenterRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: CenterRemote,
  ) {
    super(ctx, "penglaiCenter");
  }

  @Remote
  list() {
    return this.impl.list();
  }

  @Remote
  enable(input: { id: string; capabilityId?: string }) {
    return this.impl.enable(input.id, input.capabilityId);
  }

  @Remote
  disable(input: { id: string }) {
    return this.impl.disable(input.id);
  }

  @Remote
  update(input: { id: string; capabilityId?: string }) {
    return this.impl.update(input.id, input.capabilityId);
  }

  @Remote
  rollback(input: { id: string }) {
    return this.impl.rollback(input.id);
  }

  @Remote
  refreshRegistry() {
    return this.impl.refreshRegistry();
  }

  @Remote
  download(input: { id: string }) {
    return this.impl.download(input.id);
  }

  @Remote
  installDisabled(input: { id: string; capabilityId?: string }) {
    return this.impl.installDisabled(input.id, input.capabilityId);
  }
}
