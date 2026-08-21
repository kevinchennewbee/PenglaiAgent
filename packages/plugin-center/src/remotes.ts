import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, t } from "@penglai/contracts";
import { verifySignedCatalog } from "@penglai/plugin-registry";
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
    required: Record<string, boolean>;
  };
  enable(id: string): Promise<unknown>;
  disable(id: string): Promise<unknown>;
  update(id: string): Promise<unknown>;
  rollback(id: string): Promise<unknown>;
  refreshRegistry(input?: { url?: string; json?: unknown; signature?: Buffer; publicKeyHex?: string; signingKeyId?: string }): unknown;
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
      return {
        inventory: raw,
        catalog,
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
    refreshRegistry(input?: { url?: string; json?: unknown; signature?: Buffer; publicKeyHex?: string; signingKeyId?: string }) {
      if (input?.url) {
        throw new PenglaiError("SECURITY_POLICY", "arbitrary catalog URL is not an install source");
      }
      const disclaimer = {
        sandbox: false,
        sharedProcess: t("en", "pluginSharedProcess"),
        noArbitraryInstall: t("en", "pluginNoArbitraryInstall"),
      };
      if (input?.json && input.signature && input.publicKeyHex && input.signingKeyId) {
        const verified = verifySignedCatalog({
          json: input.json,
          signature: input.signature,
          publicKeyHex: input.publicKeyHex,
          signingKeyId: input.signingKeyId,
        });
        return { ...disclaimer, digest: verified.digest, sequence: verified.catalog.sequence };
      }
      return { ...disclaimer, source: "bundled-first-party" };
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
}
