import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { composeEntries, readProfilePatches, type ProfileContext } from "@deepseek-ai/dsh-app-boot";
import PluginManager from "@deepseek-ai/dsh-plugin-manager";
import { PenglaiError } from "@penglai/contracts";
import {
  OwnerApprovalBroker,
  createHostOwnerDialog,
  evaluateInventory,
  pluginPermissionDigest,
  refuseRequiredPluginDisable,
  type PluginCatalogEntry,
} from "@penglai/runtime/plugin-host";
import { normalizeInventory, rowMatches } from "./inventory.js";
import { buildResourcePressure } from "./resource-pressure.js";
import { exportRedactedCenterDiagnostics } from "./diagnostics-export.js";
import { projectOfficialUsage } from "./usage-projection.js";
import { publicInventory, type CenterHostLike, type CenterOwnerProof, type CenterRemote, type ResourceProbe } from "./remotes.js";

/** The exact upstream class owns both the public Remote and all operations.
 * Mount it on Center's context so upstream's self-protection covers Center too.
 * The standalone profile manager row is disabled to avoid a second instance.
 */
export function createOfficialPluginManager(ctx: Context): PluginManager {
  const invocation = ctx.profileContext.packageManager;
  if (!invocation || !isAbsolute(invocation.command) || invocation.args.length !== 2 || !isAbsolute(invocation.args[0] ?? "") || invocation.args[1] !== "--pm-on-fail=error") {
    throw new PenglaiError("DSH_UNAVAILABLE", "application-owned package manager invocation required");
  }
  return new PluginManager(ctx, {
    pnpmCommand: "__penglai_bundled_package_manager_required__",
    outputBytes: 16_384,
    lockWaitMs: 120_000,
    inspectTimeoutMs: 20_000,
  });
}

/**
 * Outcomes the official plugin manager can report for a bundle change.
 *
 * Read from the pinned upstream type rather than inferred from the call sites —
 * `@deepseek-ai/dsh-plugin-manager/lib/types/types.d.ts`:
 *
 *     application: 'applied' | 'restart-required' | 'overridden'
 *                | 'failed' | 'cancelled';
 *
 * The list is closed on purpose. The previous check tested for the three failure
 * values and treated everything else as success, so a value upstream added later
 * would have been reported to the user as a completed change. "The toggle saved"
 * is not evidence that the change is live, and this is a security-adjacent claim:
 * it decides whether the owner approval is completed or failed.
 *
 * `applied` is also weaker than it reads. From DSH 0.1.6-alpha.1 the config
 * hot-reload path no longer rolls back transactionally — a parse failure keeps
 * the previous config and a plugin activation failure may take effect partially.
 * So `applied` must never be presented as proof of a live, complete activation,
 * which is what `OPEN_PLUGIN_MANAGEMENT.md` requires: `restart-required`, failed,
 * cancelled and applied are four different things to report.
 */
export const PLUGIN_APPLICATIONS = [
  "applied",
  "restart-required",
  "overridden",
  "failed",
  "cancelled",
] as const;

export type PluginApplication = (typeof PLUGIN_APPLICATIONS)[number];

/** Outcomes that mean the requested change did not take effect. */
const PLUGIN_APPLICATION_FAILURES: readonly PluginApplication[] = ["failed", "cancelled", "overridden"];

export function isKnownPluginApplication(value: unknown): value is PluginApplication {
  return typeof value === "string" && (PLUGIN_APPLICATIONS as readonly string[]).includes(value);
}

/** Read the same effective patch composition as the official manager.
 * No parallel desired.json state participates in the current product policy.
 */
export function officialBuiltinDesired(profile: ProfileContext, catalog: readonly PluginCatalogEntry[]): Record<string, boolean> {
  const rows = composeEntries([readProfilePatches("dsh", profile)]);
  return Object.fromEntries(catalog.map((entry) => {
    const matches = rows.filter((row) => row.name === entry.id || row.id === entry.id.replace("@penglai/", "penglai-"));
    if (matches.length !== 1) throw new PenglaiError("STORE_CORRUPT", "builtin profile entry is missing or ambiguous");
    return [entry.id, matches[0]?.disabled !== true];
  }));
}

/** Product feature presentation only. Package installation, removal, approval
 * and cancellation are exposed by the official manager, not reimplemented here.
 */
export function createOfficialCenterRemote(opts: {
  manager: Pick<PluginManager, "listPlugins" | "setPluginEnabled">;
  host: CenterHostLike;
  inventory: { list(): unknown; refresh?(): Promise<void> };
  catalog: readonly PluginCatalogEntry[];
  userDataRoot: string;
  txDir: string;
  resourceProbe: (id: string) => ResourceProbe | undefined;
  ownerBroker?: OwnerApprovalBroker;
}): CenterRemote {
  const owner = opts.ownerBroker ?? new OwnerApprovalBroker(opts.userDataRoot, {
    dialog: createHostOwnerDialog(opts.userDataRoot),
  });
  const toggle = async (id: string, enabled: boolean, proof: CenterOwnerProof | string | undefined) => {
    if (!enabled) refuseRequiredPluginDisable(id);
    const entry = opts.catalog.find((row) => row.id === id && row.userVisible);
    if (!entry) throw new PenglaiError("INVALID_INPUT", "bundled feature required");
    if (enabled && !entry.platforms.includes(entry.target)) throw new PenglaiError("INVALID_INPUT", "feature unavailable on this platform");
    if (!proof || typeof proof === "string" || !proof.actionId || !proof.receipt) {
      throw new PenglaiError("SECURITY_POLICY", "native owner capability is required");
    }
    const intent = owner.inspect(proof.actionId);
    const permissionDigest = pluginPermissionDigest({
      permissions: entry.permissions,
      ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
      ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
      nativeCode: entry.nativeCode === true,
    });
    if (intent.pluginId !== id || intent.objectId !== id || intent.action !== (enabled ? "plugin.enable" : "plugin.disable") ||
        intent.sourceDigest !== `sha256:${entry.sha256}` || intent.permissionDigest !== `sha256:${permissionDigest}`) {
      throw new PenglaiError("SECURITY_POLICY", "plugin broker intent mismatch");
    }
    const rows = (await opts.manager.listPlugins()).filter((row) => rowMatches(row, id));
    if (rows.length !== 1 || !rows[0] || !("patchId" in rows[0])) {
      throw new PenglaiError("DSH_UNAVAILABLE", "official manager cannot address this feature");
    }
    const reservation = owner.consumeApproval({ receipt: proof.receipt, intentDigest: intent.intentDigest, actionId: proof.actionId });
    let result: Awaited<ReturnType<PluginManager["setPluginEnabled"]>>;
    try {
      result = await opts.manager.setPluginEnabled(rows[0].entryId, enabled);
    } catch (error) {
      const failureClass = error instanceof PenglaiError
        ? error.errorClass
        : error instanceof Error
          ? error.name
          : "unknown";
      owner.failApproval({
        actionId: proof.actionId,
        reservationId: reservation.reservationId,
        resultDigest: createHash("sha256").update(JSON.stringify({ failureClass })).digest("hex"),
      });
      throw error;
    }
    const resultDigest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    // Fail closed on an outcome this build does not recognise. Upstream owns this
    // enum and has already extended it once, with `overridden`. Before this
    // check existed, an unknown value fell through to the success path below and
    // the owner approval was completed for a change whose state was unknown.
    if (!isKnownPluginApplication(result.application)) {
      owner.failApproval({
        actionId: proof.actionId,
        reservationId: reservation.reservationId,
        resultDigest,
      });
      throw new PenglaiError("DSH_UNAVAILABLE", "official plugin manager returned an unrecognised outcome");
    }
    if (PLUGIN_APPLICATION_FAILURES.includes(result.application)) {
      // The specific outcome is carried in the message so diagnostics can tell a
      // cancellation from a refusal. They were collapsed into one string before.
      owner.failApproval({
        actionId: proof.actionId,
        reservationId: reservation.reservationId,
        resultDigest,
      });
      throw new PenglaiError("DSH_UNAVAILABLE", `official plugin change was not applied: ${result.application}`);
    }
    owner.completeApproval({
      actionId: proof.actionId,
      reservationId: reservation.reservationId,
      resultDigest,
    });
    await opts.inventory.refresh?.();
    // `applied` is not proof of a live, complete activation: upstream's config
    // hot-reload no longer rolls back transactionally, so a parse failure keeps
    // the previous config and an activation failure may take effect partially.
    // Only `restart-required` is reported as needing a restart; `applied` is
    // reported as applied-and-not-verified, never as verified active.
    return { ...result, restartRequired: result.application === "restart-required" };
  };
  const officialPackagesOnly = async (): Promise<never> => {
    throw new PenglaiError("INVALID_INPUT", "use the official Plugins panel; bundled features update with the application");
  };
  return {
    list() {
      const rows = normalizeInventory(opts.inventory.list());
      const proof = evaluateInventory({ entries: rows });
      return {
        inventory: publicInventory(rows),
        catalog: opts.host.reconcile(),
        remote: [],
        required: {
          credentials: proof.credentials, "plugin-center": proof.pluginCenter,
          memory: proof.memory, im: proof.im, smokeDisabled: proof.smokeDisabled,
        },
        degraded: !proof.ok,
        resourcePressure: buildResourcePressure(opts.catalog.map((entry) => entry.id), opts.resourceProbe),
        latestTransaction: null,
      };
    },
    enable: (id, proof) => toggle(id, true, proof),
    installEnable: (id, proof) => toggle(id, true, proof),
    disable: (id, proof) => toggle(id, false, proof),
    update: officialPackagesOnly,
    rollback: officialPackagesOnly,
    download: officialPackagesOnly,
    installDisabled: officialPackagesOnly,
    async refreshRegistry() {
      await opts.inventory.refresh?.();
      return { source: "official-dsh-plugin-manager", sandbox: false };
    },
    exportDiagnostics: () => exportRedactedCenterDiagnostics({ catalog: opts.host.reconcile(), txDir: opts.txDir }),
    conversationUsage: (input) => projectOfficialUsage(input ?? {}),
  };
}
