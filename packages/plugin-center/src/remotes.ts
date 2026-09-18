import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, PenglaiRemote } from "@penglai/contracts";
import type { PluginCatalogEntry } from "@penglai/runtime/plugin-host";
import type {
  PluginActivationObservation,
  ResourceCounts,
} from "./profile-tx.js";
import { normalizeInventory, rowLoaded, rowMatches } from "./inventory.js";
import type { ResourcePressureSnapshot } from "./resource-pressure.js";

export type CenterOwnerProof = { actionId: string; receipt: string };

export interface CenterHostLike {
  reconcile(): Array<{
    id: string;
    desired: string;
    installed: string;
    loaded: boolean;
    healthy: boolean;
  }>;
  entries?(): readonly PluginCatalogEntry[];
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
      sequence?: number;
      tag?: string;
      issuedAt?: string;
      signatureOk?: true;
      offline?: boolean;
    };
    required: Record<string, boolean>;
    degraded?: boolean;
    resourcePressure: ResourcePressureSnapshot;
    latestTransaction: unknown;
  };
  enable(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  installEnable(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  disable(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  update(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  rollback(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  refreshRegistry(): Promise<unknown>;
  download(id: string): Promise<unknown>;
  installDisabled(id: string, proof?: CenterOwnerProof | string): Promise<unknown>;
  exportDiagnostics(): unknown;
  conversationUsage(input?: Record<string, unknown>): unknown;
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
  inventory: { list(): unknown; refresh?(): Promise<void> },
  id: string,
  enabled: boolean,
  present = true,
  timeoutMs = 8_000,
  observe: (observation: PluginActivationObservation) => void = () => undefined,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    await inventory.refresh?.();
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
    if (converged) return;
    if (observation.phase === "failed") {
      throw new PenglaiError("DSH_UNAVAILABLE", "PLUGIN_RUNTIME_UNAVAILABLE");
    }
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new PenglaiError("DSH_UNAVAILABLE", "PLUGIN_ACTIVATION_TIMEOUT");
}

export function assertPluginServiceHealthy(
  health: ((id: string) => { healthy: boolean; error?: string }) | undefined,
  id: string,
): void {
  const result = health?.(id);
  if (result && !result.healthy) {
    throw new PenglaiError("DSH_UNAVAILABLE", "PLUGIN_SERVICE_UNHEALTHY");
  }
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

/** Renderer-safe inventory projection. Loader errors, stack traces and paths are
 * deliberately not part of this contract.
 */
export function publicInventory(
  rows: ReturnType<typeof normalizeInventory>,
): { entries: Array<Record<string, unknown>> } {
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
      const version = publicPluginVersion(row.version);
      return {
        ...(id ? { id, moduleName: id } : {}),
        ...(version ? { version } : {}),
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

export class PenglaiCenterRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: CenterRemote,
  ) {
    super(ctx, "penglaiCenter");
  }

  @PenglaiRemote
  list() {
    return this.impl.list();
  }

  @PenglaiRemote
  enable(input: {
    id: string;
    actionId?: string;
    receipt?: string;
    capabilityId?: string;
  }) {
    return this.impl.enable(
      input.id,
      input.actionId && input.receipt
        ? { actionId: input.actionId, receipt: input.receipt }
        : input.capabilityId,
    );
  }

  @PenglaiRemote
  installEnable(input: {
    id: string;
    actionId?: string;
    receipt?: string;
    capabilityId?: string;
  }) {
    return this.impl.installEnable(
      input.id,
      input.actionId && input.receipt
        ? { actionId: input.actionId, receipt: input.receipt }
        : input.capabilityId,
    );
  }

  @PenglaiRemote
  disable(input: {
    id: string;
    actionId?: string;
    receipt?: string;
    capabilityId?: string;
  }) {
    return this.impl.disable(
      input.id,
      input.actionId && input.receipt
        ? { actionId: input.actionId, receipt: input.receipt }
        : input.capabilityId,
    );
  }

  @PenglaiRemote
  update(input: {
    id: string;
    actionId?: string;
    receipt?: string;
    capabilityId?: string;
  }) {
    return this.impl.update(
      input.id,
      input.actionId && input.receipt
        ? { actionId: input.actionId, receipt: input.receipt }
        : input.capabilityId,
    );
  }

  @PenglaiRemote
  rollback(input: {
    id: string;
    actionId?: string;
    receipt?: string;
    capabilityId?: string;
  }) {
    return this.impl.rollback(
      input.id,
      input.actionId && input.receipt
        ? { actionId: input.actionId, receipt: input.receipt }
        : input.capabilityId,
    );
  }

  @PenglaiRemote
  refreshRegistry() {
    return this.impl.refreshRegistry();
  }

  @PenglaiRemote
  download(input: { id: string }) {
    return this.impl.download(input.id);
  }

  @PenglaiRemote
  installDisabled(input: {
    id: string;
    actionId?: string;
    receipt?: string;
    capabilityId?: string;
  }) {
    return this.impl.installDisabled(
      input.id,
      input.actionId && input.receipt
        ? { actionId: input.actionId, receipt: input.receipt }
        : input.capabilityId,
    );
  }

  @PenglaiRemote
  exportDiagnostics() {
    return this.impl.exportDiagnostics();
  }

  @PenglaiRemote
  conversationUsage(input?: Record<string, unknown>) {
    return this.impl.conversationUsage(input);
  }
}
