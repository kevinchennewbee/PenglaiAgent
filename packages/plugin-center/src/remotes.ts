import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  evaluateInventory,
  refuseRequiredPluginDisable,
  pluginPermissionDigest,
  runtimePluginTarget,
  OwnerApprovalBroker,
  createHostOwnerDialog,
  type PluginCatalogEntry,
  type PluginOwnerAction,
  type ProductPluginTarget,
} from "@penglai/runtime/plugin-host";

const PLUGIN_BROKER_ACTION = {
  "plugin-enable": "plugin.enable",
  "plugin-update": "plugin.update",
  "plugin-install": "plugin.install",
  "plugin-disable": "plugin.disable",
  "plugin-rollback": "plugin.rollback",
} as const;

export type CenterOwnerProof = { actionId: string; receipt: string };
import {
  rollbackLastGood,
  pluginActionFailureCode,
  readPluginTransactionDiagnostic,
  runProfileTransaction,
  type PluginActivationObservation,
  type ResourceCounts,
} from "./profile-tx.js";
import { normalizeInventory, rowLoaded, rowMatches } from "./inventory.js";
import { buildResourcePressure, type ResourcePressureSnapshot } from "./resource-pressure.js";

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
    present: boolean;
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
    resourcePressure: ResourcePressureSnapshot;
    latestTransaction: ReturnType<typeof readPluginTransactionDiagnostic>;
  };
  enable(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  installEnable(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  disable(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  update(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  rollback(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  refreshRegistry(): Promise<unknown>;
  download(id: string): Promise<unknown>;
  installDisabled(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
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
    throw new PenglaiError(
      "SECURITY_POLICY",
      `${id} DSH pin is not ${PINNED_PLUGIN_DSH}`,
    );
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
    provenanceClass:
      remote.provenanceClass === "community-reviewed"
        ? "community-reviewed"
        : "penglai-first-party",
    license: remote.license,
    migration: remote.migration,
    rollback: "last-good-profile",
    installClass:
      remote.provenanceClass === "community-reviewed"
        ? "community-reviewed"
        : "optional-first-party",
    userVisible: false,
    updatePolicy: "signed-overlay",
    resourcePolicy: "none",
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

export function inventoryActivationObservation(
  inventory: { list(): unknown },
  id: string,
  at = new Date().toISOString(),
): PluginActivationObservation {
  const row = normalizeInventory(inventory.list()).find((candidate) =>
    rowMatches(candidate, id),
  );
  if (!row) {
    return {
      source: "official-inventory",
      at,
      present: false,
      enabled: false,
      phase: "missing",
    };
  }
  const enabled = rowLoaded(row);
  const rawPhase = String(row.fiberPhase ?? "").toLowerCase();
  const phase = enabled
    ? "active"
    : ["unloading", "disposing", "stopping", "teardown"].includes(rawPhase)
      ? "unloading"
      : rawPhase === "loading"
        ? "loading"
        : ["pending", "starting", "setup", "created"].includes(rawPhase)
          ? "pending"
          : ["failed", "error", "disposed", "dead"].includes(rawPhase) ||
              row.health === "failed"
            ? "failed"
            : row.disabled === true || row.enabled === false
              ? "disabled"
              : "unknown";
  return {
    source: "official-inventory",
    at,
    present: true,
    enabled,
    phase,
  };
}

export async function waitForInventory(
  inventory: { list(): unknown },
  id: string,
  enabled: boolean,
  present = true,
  timeoutMs = 8_000,
  observe: (observation: PluginActivationObservation) => void = () => undefined,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const observation = inventoryActivationObservation(inventory, id);
    observe(observation);
    const converged = !present
      ? !observation.present
      : enabled
        ? observation.present &&
          observation.enabled &&
          observation.phase === "active"
        : observation.present &&
          !observation.enabled &&
          observation.phase === "disabled";
    if (converged) {
      return;
    }
    if (observation.phase === "failed") {
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "PLUGIN_RUNTIME_UNAVAILABLE",
      );
    }
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new PenglaiError(
    "DSH_UNAVAILABLE",
    "PLUGIN_ACTIVATION_TIMEOUT",
  );
}

const PUBLIC_INVENTORY_PHASES = new Set([
  "missing",
  "pending",
  "loading",
  "active",
  "unloading",
  "disabled",
  "failed",
  "unknown",
]);
const PUBLIC_INVENTORY_HEALTH = new Set(["ready", "degraded", "failed"]);

function publicPluginIdentity(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 160) return undefined;
  return /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i.test(
    value,
  )
    ? value
    : undefined;
}

function publicPluginVersion(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(value) ? value : undefined;
}

function publicInventory(rows: ReturnType<typeof normalizeInventory>): {
  entries: Array<Record<string, unknown>>;
} {
  return {
    entries: rows.map((row) => {
      const id =
        publicPluginIdentity(row.id) ??
        publicPluginIdentity(row.moduleName) ??
        publicPluginIdentity(row.name);
      const observation = id
        ? inventoryActivationObservation({ list: () => [row] }, id)
        : undefined;
      const phase = observation?.phase ?? "unknown";
      const health = PUBLIC_INVENTORY_HEALTH.has(String(row.health))
        ? String(row.health)
        : undefined;
      return {
        ...(id ? { id, moduleName: id } : {}),
        ...(publicPluginVersion(row.version)
          ? { version: publicPluginVersion(row.version) }
          : {}),
        enabled: observation?.enabled === true,
        disabled: observation?.phase === "disabled",
        loaded: observation?.phase === "active",
        fiberPhase: PUBLIC_INVENTORY_PHASES.has(phase) ? phase : "unknown",
        ...(health ? { health } : {}),
        ...(typeof row.healthy === "boolean" ? { healthy: row.healthy } : {}),
      };
    }),
  };
}

function previousStateFromJournal(
  txDir: string,
  id: string,
): { enabled: boolean; present: boolean } {
  const file = join(txDir, "journal.json");
  if (!existsSync(file)) {
    throw new PenglaiError("STORE_CORRUPT", "Center rollback journal missing");
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    id?: unknown;
    previousEnabled?: unknown;
    previousPresent?: unknown;
  };
  if (raw.id !== id || typeof raw.previousEnabled !== "boolean") {
    throw new PenglaiError("STORE_CORRUPT", "Center rollback journal mismatch");
  }
  return {
    enabled: raw.previousEnabled,
    present: raw.previousPresent !== false,
  };
}

function isUnder(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function registryPackageRoot(
  userDataRoot: string,
  configured: string | undefined,
): string {
  const root = configured ?? join(userDataRoot, "plugins", "packages");
  if (
    !isAbsolute(root) ||
    !isUnder(userDataRoot, root) ||
    resolve(root) === resolve(userDataRoot)
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "registry package directory escaped userData",
    );
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink()) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "registry package directory must not be a symlink",
    );
  }
  if (!isUnder(realpathSync(userDataRoot), realpathSync(root))) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "registry package directory resolved outside userData",
    );
  }
  return root;
}

export function stageRegistryPackage(input: {
  pkg: CachedPackage;
  entry: PluginCatalogEntry;
  userDataRoot: string;
  registryPackagesDir?: string;
}): string {
  const root = registryPackageRoot(
    input.userDataRoot,
    input.registryPackagesDir,
  );
  if (input.entry.source !== "penglai-plugin-registry") {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "only registry packages may enter the mutable package root",
    );
  }
  if (
    input.pkg.id !== input.entry.id ||
    input.pkg.version !== input.entry.version ||
    input.pkg.sha256 !== input.entry.sha256
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "downloaded package identity mismatch",
    );
  }
  let packageFd: number | undefined;
  let bytes: Buffer;
  try {
    packageFd = openSync(
      input.pkg.path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const openedStat = fstatSync(packageFd);
    const pathStat = lstatSync(input.pkg.path);
    if (
      !openedStat.isFile() ||
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "downloaded package must be a regular cached file",
      );
    }
    bytes = readFileSync(packageFd);
  } catch (error) {
    if (error instanceof PenglaiError) throw error;
    throw new PenglaiError(
      "SECURITY_POLICY",
      "downloaded package must be a regular cached file",
    );
  } finally {
    if (packageFd !== undefined) closeSync(packageFd);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== input.entry.sha256) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "downloaded package checksum mismatch",
    );
  }
  const destination = join(root, input.entry.packageFile);
  if (!isUnder(root, destination)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "registry package escaped mutable package root",
    );
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
  /** Test/integration seam; production creates the window-bound broker below. */
  ownerBroker?: OwnerApprovalBroker;
}): CenterRemote {
  const hostTarget = (): ProductPluginTarget =>
    opts.target ?? runtimePluginTarget();
  const owner =
    opts.ownerBroker ??
    new OwnerApprovalBroker(opts.userDataRoot, {
      dialog: createHostOwnerDialog(opts.userDataRoot),
    });
  const requireOwner = (
    id: string,
    action: PluginOwnerAction,
    proof: CenterOwnerProof | string | undefined,
  ): (() => void) => {
    if (!proof || typeof proof === "string")
      throw new PenglaiError(
        "SECURITY_POLICY",
        "native owner capability is required",
      );
    if (proof.receipt.startsWith("owncap_")) {
      throw new PenglaiError("SECURITY_POLICY", "plugin broker receipt required");
    }
    const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
    const inspected = owner.inspect(proof.actionId);
    const expectedAction = PLUGIN_BROKER_ACTION[action];
    const permissionDigest = pluginPermissionDigest({
      permissions: entry.permissions,
      ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
      ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
      nativeCode: entry.nativeCode === true,
    });
    if (
      inspected.pluginId !== id ||
      inspected.action !== expectedAction ||
      inspected.objectId !== id ||
      inspected.sourceDigest !== `sha256:${entry.sha256.replace(/^sha256:/, "")}` ||
      inspected.permissionDigest !== `sha256:${permissionDigest}`
    ) {
      throw new PenglaiError("SECURITY_POLICY", "plugin broker intent mismatch");
    }
    const reserved = owner.consumeApproval({
      receipt: proof.receipt,
      intentDigest: inspected.intentDigest,
      actionId: proof.actionId,
    });
    return () =>
      owner.completeApproval({
        actionId: proof.actionId,
        reservationId: reserved.reservationId,
        resultDigest: entry.sha256.replace(/^sha256:/, ""),
      });
  };
  const transact = async (
    id: string,
    action: "enable" | "disable" | "update" | "install",
  ) => {
    if (action === "disable") refuseRequiredPluginDisable(id);
    const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
    const previousEnabled = Boolean(opts.host.desired()[id]);
    const previousPresent = normalizeInventory(opts.inventory.list()).some(
      (row) => rowMatches(row, id),
    );
    const probe = opts.resourceProbe(id);
    try {
      return await runProfileTransaction({
        userDataRoot: opts.userDataRoot,
        profileDir: opts.profileDir,
        txDir: opts.txDir,
        pluginsDir:
          entry.source === "penglai-plugin-registry"
            ? registryPackageRoot(opts.userDataRoot, opts.registryPackagesDir)
            : opts.pluginsDir,
        entry,
        action,
        previousEnabled,
        previousPresent,
        applyLive: (input) => opts.lifecycle.apply(input),
        verifyActual: (input, observe) =>
          waitForInventory(
            opts.inventory,
            input.id,
            input.enabled,
            input.present,
            8_000,
            observe,
          ),
        ...(probe ? { readResources: () => probe.snapshot() } : {}),
        commitDesired: (enabled) => opts.host.setDesired(id, enabled),
        rollbackDesired: (enabled) => opts.host.setDesired(id, enabled),
      });
    } catch (error) {
      throw new PenglaiError(
        error instanceof PenglaiError ? error.errorClass : "DSH_UNAVAILABLE",
        pluginActionFailureCode(error),
      );
    }
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
          installed:
            recon?.installed ?? (card.downloaded ? "cached" : "not-installed"),
          loaded: rowLoaded(row),
          enabled: recon
            ? recon.desired !== "disabled"
            : Boolean(opts.host.desired()[String(card.id)]),
          rollbackAvailable: existsSync(join(opts.txDir, "last-good")),
        };
      });
      const proof = evaluateInventory({ entries: rows });
      const pressureIds = [
        ...opts.catalog.map((entry) => entry.id),
        ...(opts.registry?.cards() ?? []).map((entry) => String(entry.id)),
      ];
      return {
        inventory: publicInventory(rows),
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
        resourcePressure: buildResourcePressure(pressureIds, opts.resourceProbe),
        latestTransaction: readPluginTransactionDiagnostic(opts.txDir),
        required: {
          credentials: proof.credentials,
          "plugin-center": proof.pluginCenter,
          office: proof.office,
          memory: proof.memory,
          im: proof.im,
          smokeDisabled: proof.smokeDisabled,
        },
      };
    },
    enable(id: string, proof?: CenterOwnerProof | string) {
      const finishOwnerAction = requireOwner(id, "plugin-enable", proof);
      return transact(id, "enable").then((result) => {
        finishOwnerAction();
        return result;
      });
    },
    async installEnable(id: string, proof?: CenterOwnerProof | string) {
      const finishOwnerAction = requireOwner(id, "plugin-enable", proof);
      const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      if (entry.source === "penglai-plugin-registry") {
        if (!opts.registry)
          throw new PenglaiError(
            "INVALID_INPUT",
            "remote plugin registry is not configured",
          );
        const pkg = await opts.registry.downloadPackage(id, hostTarget());
        stageRegistryPackage({
          pkg,
          entry,
          userDataRoot: opts.userDataRoot,
          ...(opts.registryPackagesDir
            ? { registryPackagesDir: opts.registryPackagesDir }
            : {}),
        });
      }
      const result = await transact(id, "enable");
      finishOwnerAction();
      return result;
    },
    disable(id: string, proof?: CenterOwnerProof | string) {
      refuseRequiredPluginDisable(id);
      const finishOwnerAction = requireOwner(id, "plugin-disable", proof);
      return transact(id, "disable").then((result) => {
        finishOwnerAction();
        return result;
      });
    },
    async update(id: string, proof?: CenterOwnerProof | string) {
      const finishOwnerAction = requireOwner(id, "plugin-update", proof);
      const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      if (entry.source === "penglai-plugin-registry") {
        if (!opts.registry)
          throw new PenglaiError(
            "INVALID_INPUT",
            "remote plugin registry is not configured",
          );
        const pkg = await opts.registry.downloadPackage(id, hostTarget());
        stageRegistryPackage({
          pkg,
          entry,
          userDataRoot: opts.userDataRoot,
          ...(opts.registryPackagesDir
            ? { registryPackagesDir: opts.registryPackagesDir }
            : {}),
        });
      }
      const result = await transact(id, "update");
      finishOwnerAction();
      return result;
    },
    async refreshRegistry() {
      if (arguments.length > 0) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "production refresh does not accept renderer URL, public key, or signingKeyId",
        );
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
      if (!opts.registry)
        throw new PenglaiError(
          "INVALID_INPUT",
          "remote plugin registry is not configured",
        );
      return opts.registry.downloadPackage(id);
    },
    async installDisabled(id: string, proof?: CenterOwnerProof | string) {
      if (!opts.registry)
        throw new PenglaiError(
          "INVALID_INPUT",
          "remote plugin registry is not configured",
        );
      const finishOwnerAction = requireOwner(id, "plugin-install", proof);
      const pkg = await opts.registry.downloadPackage(id, hostTarget());
      const entry = catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      stageRegistryPackage({
        pkg,
        entry,
        userDataRoot: opts.userDataRoot,
        ...(opts.registryPackagesDir
          ? { registryPackagesDir: opts.registryPackagesDir }
          : {}),
      });
      const installed = await transact(id, "install");
      await waitForInventory(opts.inventory, id, false);
      finishOwnerAction();
      return {
        id,
        version: pkg.version,
        sha256: pkg.sha256,
        enabled: false,
        installed: true,
        phase: installed.phase,
      };
    },
    async rollback(id: string, proof?: CenterOwnerProof | string) {
      const finishOwnerAction = requireOwner(id, "plugin-rollback", proof);
      catalogEntry(opts.catalog, id, opts.registry, hostTarget());
      const previous = previousStateFromJournal(opts.txDir, id);
      const out = await rollbackLastGood({
        userDataRoot: opts.userDataRoot,
        profileDir: opts.profileDir,
        txDir: opts.txDir,
        id,
      });
      await opts.lifecycle.apply({
        id,
        enabled: previous.enabled,
        forceReload: true,
        present: previous.present,
      });
      await waitForInventory(
        opts.inventory,
        id,
        previous.enabled,
        previous.present,
      );
      opts.host.setDesired(id, previous.enabled);
      finishOwnerAction();
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
  enable(input: { id: string; actionId?: string; receipt?: string; capabilityId?: string }) {
    return this.impl.enable(input.id, input.actionId && input.receipt ? { actionId: input.actionId, receipt: input.receipt } : input.capabilityId);
  }

  @Remote
  installEnable(input: { id: string; actionId?: string; receipt?: string; capabilityId?: string }) {
    return this.impl.installEnable(input.id, input.actionId && input.receipt ? { actionId: input.actionId, receipt: input.receipt } : input.capabilityId);
  }

  @Remote
  disable(input: { id: string; actionId?: string; receipt?: string; capabilityId?: string }) {
    return this.impl.disable(input.id, input.actionId && input.receipt ? { actionId: input.actionId, receipt: input.receipt } : input.capabilityId);
  }

  @Remote
  update(input: { id: string; actionId?: string; receipt?: string; capabilityId?: string }) {
    return this.impl.update(input.id, input.actionId && input.receipt ? { actionId: input.actionId, receipt: input.receipt } : input.capabilityId);
  }

  @Remote
  rollback(input: { id: string; actionId?: string; receipt?: string; capabilityId?: string }) {
    return this.impl.rollback(input.id, input.actionId && input.receipt ? { actionId: input.actionId, receipt: input.receipt } : input.capabilityId);
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
  installDisabled(input: { id: string; actionId?: string; receipt?: string; capabilityId?: string }) {
    return this.impl.installDisabled(input.id, input.actionId && input.receipt ? { actionId: input.actionId, receipt: input.receipt } : input.capabilityId);
  }
}
