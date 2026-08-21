import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, t } from "@penglai/contracts";
import {
  PluginDistributionClient,
  type CachedPackage,
  type RegistrySnapshot,
} from "@penglai/plugin-registry";
import { type PluginCatalogEntry } from "@penglai/runtime";
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
  enable(id: string): Promise<unknown>;
  disable(id: string): Promise<unknown>;
  update(id: string): Promise<unknown>;
  rollback(id: string): Promise<unknown>;
  refreshRegistry(): Promise<unknown>;
  download(id: string): Promise<unknown>;
  installDisabled(id: string): Promise<unknown>;
}

function catalogEntry(
  entries: readonly PluginCatalogEntry[],
  id: string,
): PluginCatalogEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new PenglaiError("INVALID_INPUT", "unlisted package");
  return entry;
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

export function createCenterRemote(opts: {
  host: CenterHostLike;
  inventory: { list(): unknown };
  catalog: readonly PluginCatalogEntry[];
  lifecycle: PluginLifecycle;
  resourceProbe: (id: string) => ResourceProbe | undefined;
  profileDir: string;
  txDir: string;
  pluginsDir: string;
  userDataRoot: string;
  registry?: PluginDistributionClient;
  stagePackage?: (pkg: CachedPackage) => Promise<void>;
}): CenterRemote {
  const transact = async (
    id: string,
    action: "enable" | "disable" | "update",
  ) => {
    const entry = catalogEntry(opts.catalog, id);
    if (action === "disable" && id === "@penglai/plugin-center") {
      throw new PenglaiError("SECURITY_POLICY", "required plugin cannot be disabled");
    }
    const previousEnabled = Boolean(opts.host.desired()[id]);
    const probe = opts.resourceProbe(id);
    return runProfileTransaction({
      userDataRoot: opts.userDataRoot,
      profileDir: opts.profileDir,
      txDir: opts.txDir,
      pluginsDir: opts.pluginsDir,
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
          enabled: recon ? recon.desired !== "disabled" : false,
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
    enable(id: string) {
      return transact(id, "enable");
    },
    disable(id: string) {
      return transact(id, "disable");
    },
    update(id: string) {
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
    async installDisabled(id: string) {
      if (!opts.registry) throw new PenglaiError("INVALID_INPUT", "remote plugin registry is not configured");
      const pkg = await opts.registry.downloadPackage(id);
      await opts.stagePackage?.(pkg);
      try {
        opts.host.setDesired(id, false);
      } catch {
        /* remote plugins are not first-party catalog rows until loader inventories them */
      }
      return { id, version: pkg.version, sha256: pkg.sha256, enabled: false, installed: true };
    },
    async rollback(id: string) {
      catalogEntry(opts.catalog, id);
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
  enable(input: { id: string }) {
    return this.impl.enable(input.id);
  }

  @Remote
  disable(input: { id: string }) {
    return this.impl.disable(input.id);
  }

  @Remote
  update(input: { id: string }) {
    return this.impl.update(input.id);
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
  installDisabled(input: { id: string }) {
    return this.impl.installDisabled(input.id);
  }
}
