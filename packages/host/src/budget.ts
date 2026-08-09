/**
 * Budget circuit breaker (成本熔断, 0.4.0 design §7 成本可见性).
 *
 * The durable usage ledger (product.db, per local day / mode / project) is
 * the source of truth. The owner configures token ceilings along two
 * dimensions (budget_config, single row):
 *
 *   day              — the whole identity's local day (chat + work, every
 *                      project; dimension key "day").
 *   project:<id>     — one project's local day (work episodes anchored to
 *                      it).
 *
 * After every recorded episode the service re-checks the live ratios:
 *
 *   ≥ BUDGET_WARN_RATIO (80%, policy.ts 待 owner 校准) — warn ONCE per
 *     dimension per day (broadcast `budget.warning`; CLI status shows it,
 *     the feishu channel forwards it to the owner).
 *   ≥ BUDGET_TRIP_RATIO (100%) — trip the breaker (durable budget_breakers
 *     row + broadcast `budget.tripped`) and degrade the dimension into
 *     approval mode:
 *       · task.start on a tripped dimension goes through a mandatory L3
 *         pre-flight approval (capability "l3:budget-override", never
 *         grantable; the run pauses at awaiting_approval before the kernel
 *         is even constructed);
 *       · chat prompts under a tripped day breaker are refused with
 *         budget_exceeded until the owner lifts the breaker
 *         (`penglai budget lift` — the L3-class human release, recorded
 *         with liftedAt/liftedBy/liftNote on the breaker row).
 *
 * Breaker rows are keyed by (dimension, local day): a new day starts clean
 * (yesterday's trip never leaks into today), and every row keeps the full
 * warn → trip → lift provenance for replay.
 */

import type {
  BudgetBreaker,
  BudgetConfig,
  BudgetDimensionStatus,
  BudgetStatus,
} from "@penglai/protocol";
import { BUDGET_TRIP_RATIO, BUDGET_WARN_RATIO } from "./policy.js";
import type { ProductStore } from "./storage/product-store.js";
import { localDay } from "./usage.js";

/** The identity-wide daily dimension key. */
export const BUDGET_DIMENSION_DAY = "day";

/** The per-project daily dimension key for a project id. */
export function projectDimension(projectId: string): string {
  return `project:${projectId}`;
}

export interface BudgetEvent {
  event: "budget.warning" | "budget.tripped" | "budget.lifted";
  dimension: string;
  day: string;
  usedTokens: number;
  limitTokens: number;
  ratio: number;
  /** Human-readable one-liner (Chinese, CLI/feishu broadcast). */
  message: string;
}

export interface BudgetGate {
  /** True when a tripped, unlifted breaker covers this scope. */
  tripped: boolean;
  dimension: string | null;
  day: string | null;
  message: string;
}

interface BudgetServiceOptions {
  publish?: (channelId: string, payload: unknown) => void;
  log?: (line: string) => void;
  now?: () => number;
  /** Local-day override (tests); defaults to the machine's local day. */
  day?: () => string;
}

/** Format a compact token count (1.2k / 340k). */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function dimensionLabel(dimension: string): string {
  return dimension === BUDGET_DIMENSION_DAY ? "全局日预算" : "项目日预算";
}

export class BudgetService {
  private readonly publish: (channelId: string, payload: unknown) => void;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly day: () => string;

  constructor(
    private readonly store: ProductStore,
    options: BudgetServiceOptions = {},
  ) {
    this.publish = options.publish ?? (() => {});
    this.log = options.log ?? (() => {});
    this.now = options.now ?? Date.now;
    this.day = options.day ?? (() => localDay());
  }

  // ── config ─────────────────────────────────────────────────────

  getConfig(): BudgetConfig {
    return this.store.getBudgetConfig();
  }

  setConfig(input: {
    dailyTokenLimit: number | null;
    projectDailyTokenLimit: number | null;
    updatedBy: string;
  }): BudgetConfig {
    for (const value of [input.dailyTokenLimit, input.projectDailyTokenLimit]) {
      if (value !== null && (!Number.isFinite(value) || value <= 0)) {
        throw new Error("budget limits must be positive integers (or null to clear)");
      }
    }
    return this.store.setBudgetConfig({
      dailyTokenLimit:
        input.dailyTokenLimit === null ? null : Math.trunc(input.dailyTokenLimit),
      projectDailyTokenLimit:
        input.projectDailyTokenLimit === null
          ? null
          : Math.trunc(input.projectDailyTokenLimit),
      updatedBy: input.updatedBy,
    });
  }

  // ── status ─────────────────────────────────────────────────────

  /**
   * Live status for the local day: the configured dimensions plus every
   * project that has usage or a breaker row today.
   */
  status(day: string = this.day()): BudgetStatus {
    const config = this.getConfig();
    const rows = this.store.getUsageReport().rows.filter((r) => r.day === day);
    const usedOf = (projectId: string | null): number =>
      rows
        .filter((r) => (projectId === null ? true : r.projectId === projectId))
        .reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
    const breakers = new Map(
      this.store.listBudgetBreakers(day).map((b) => [b.dimension, b]),
    );

    const dimensions: BudgetDimensionStatus[] = [];
    const push = (dimension: string, limit: number | null, used: number): void => {
      const breaker = breakers.get(dimension) ?? null;
      dimensions.push({
        dimension,
        day,
        limitTokens: limit,
        usedTokens: used,
        ratio:
          limit !== null && limit > 0 ? used / limit : null,
        warned: breaker?.warnedAt != null,
        tripped: breaker?.trippedAt != null,
        lifted: breaker?.liftedAt != null,
      });
    };

    push(BUDGET_DIMENSION_DAY, config.dailyTokenLimit, usedOf(null));
    const projectIds = new Set<string>();
    for (const r of rows) if (r.projectId) projectIds.add(r.projectId);
    for (const b of breakers.values()) {
      if (b.dimension.startsWith("project:")) {
        projectIds.add(b.dimension.slice("project:".length));
      }
    }
    for (const projectId of [...projectIds].sort()) {
      push(
        projectDimension(projectId),
        config.projectDailyTokenLimit,
        usedOf(projectId),
      );
    }
    return { day, config, dimensions };
  }

  // ── live check (the onUsage hook) ──────────────────────────────

  /**
   * Re-check both dimensions after one episode's usage landed in the ledger.
   * `channelId` is the surface the episode ran on (task id / conversation
   * id): warnings and trips are broadcast there AND on the global "budget"
   * channel so the CLI status view and the feishu channel both see them.
   */
  recordAndCheck(input: {
    mode: "chat" | "work";
    projectId: string;
    channelId?: string | null;
  }): void {
    const day = this.day();
    const status = this.status(day);
    const config = status.config;
    const checks: Array<{ dimension: string; limit: number | null }> = [
      { dimension: BUDGET_DIMENSION_DAY, limit: config.dailyTokenLimit },
    ];
    if (input.projectId) {
      checks.push({
        dimension: projectDimension(input.projectId),
        limit: config.projectDailyTokenLimit,
      });
    }
    for (const check of checks) {
      if (check.limit === null || check.limit <= 0) continue;
      const dim = status.dimensions.find((d) => d.dimension === check.dimension);
      const used = dim?.usedTokens ?? 0;
      const ratio = used / check.limit;
      this.store.ensureBudgetBreaker(check.dimension, day, check.limit);
      if (ratio >= BUDGET_TRIP_RATIO) {
        const before = this.store.getBudgetBreaker(check.dimension, day);
        this.store.tripBudgetBreaker(check.dimension, day, used);
        if (before && before.trippedAt === null) {
          this.emit("budget.tripped", check.dimension, day, used, check.limit,
            `⛔ ${dimensionLabel(check.dimension)}撞上限（${fmtTokens(used)}/${fmtTokens(check.limit)} tokens）：` +
              `该维度已降级为审批模式——task.start 需 L3 审批，chat 需 penglai budget lift 放行。`,
            input.channelId);
        }
      } else if (ratio >= BUDGET_WARN_RATIO) {
        const before = this.store.getBudgetBreaker(check.dimension, day);
        this.store.markBudgetWarned(check.dimension, day);
        if (before && before.warnedAt === null) {
          this.emit("budget.warning", check.dimension, day, used, check.limit,
            `⚠️ ${dimensionLabel(check.dimension)}已达 ${Math.round(ratio * 100)}%（${fmtTokens(used)}/${fmtTokens(check.limit)} tokens）。`,
            input.channelId);
        }
      }
    }
  }

  // ── gates (approval-mode degradation) ──────────────────────────

  /**
   * task.start pre-flight: a tripped, unlifted breaker on the day dimension
   * OR on the task's project dimension forces the L3 budget-override
   * approval before the kernel is constructed.
   */
  gateForTaskStart(projectId: string): BudgetGate {
    const day = this.day();
    for (const dimension of [BUDGET_DIMENSION_DAY, projectDimension(projectId)]) {
      const breaker = this.activeTrip(dimension, day);
      if (breaker) {
        return {
          tripped: true,
          dimension,
          day,
          message:
            `budget_exceeded: ${dimensionLabel(dimension)}已撞上限 ` +
            `(${fmtTokens(breaker.tokensAtTrip ?? 0)}/${fmtTokens(breaker.limitTokens)} tokens, ${day})，` +
            `本次开工需 owner L3 审批（l3:budget-override）`,
        };
      }
    }
    return { tripped: false, dimension: null, day: null, message: "" };
  }

  /**
   * Chat gate: a tripped, unlifted DAY breaker refuses chat prompts with
   * budget_exceeded until the owner lifts the breaker (chat has no
   * task-scoped approval surface; the recorded lift IS the human release).
   * A project-anchored conversation additionally passes the PROJECT breaker:
   * anchoring a jail must not let a tripped project dimension keep burning
   * tokens through the chat surface (the old gap where the project daily
   * limit was not a hard ceiling for anchored chats).
   */
  gateForChat(projectId: string | null = null): BudgetGate {
    const day = this.day();
    const dimensions = [BUDGET_DIMENSION_DAY];
    if (projectId) dimensions.push(projectDimension(projectId));
    for (const dimension of dimensions) {
      const breaker = this.activeTrip(dimension, day);
      if (breaker) {
        const label = dimensionLabel(dimension);
        return {
          tripped: true,
          dimension,
          day,
          message:
            `budget_exceeded: ${label}已撞上限 ` +
            `(${fmtTokens(breaker.tokensAtTrip ?? 0)}/${fmtTokens(breaker.limitTokens)} tokens, ${day})，` +
            `chat 已暂停——owner 用 \`penglai budget lift\` 放行后恢复`,
        };
      }
    }
    return { tripped: false, dimension: null, day: null, message: "" };
  }

  /** A tripped AND unlifted breaker row, or null. */
  private activeTrip(dimension: string, day: string): BudgetBreaker | null {
    const breaker = this.store.getBudgetBreaker(dimension, day);
    if (breaker && breaker.trippedAt !== null && breaker.liftedAt === null) {
      return breaker;
    }
    return null;
  }

  // ── lift (owner release) ───────────────────────────────────────

  /**
   * Lift tripped breakers for the local day: one dimension, or every
   * tripped dimension ("all"). Returns the lifted rows. Each lift is the
   * owner's L3-class release decision, recorded on the row.
   */
  lift(input: {
    dimension: string | "all";
    liftedBy: string;
    note?: string | null;
  }): BudgetBreaker[] {
    const day = this.day();
    const candidates = this.store
      .listBudgetBreakers(day)
      .filter(
        (b) =>
          b.trippedAt !== null &&
          b.liftedAt === null &&
          (input.dimension === "all" || b.dimension === input.dimension),
      );
    const lifted: BudgetBreaker[] = [];
    for (const breaker of candidates) {
      if (
        this.store.liftBudgetBreaker(
          breaker.dimension,
          day,
          input.liftedBy,
          input.note ?? null,
        )
      ) {
        const row = this.store.getBudgetBreaker(breaker.dimension, day);
        if (row) lifted.push(row);
        this.emit("budget.lifted", breaker.dimension, day,
          breaker.tokensAtTrip ?? 0, breaker.limitTokens,
          `✅ ${dimensionLabel(breaker.dimension)}已由 ${input.liftedBy} 放行（${day} 剩余时间恢复自主）。`,
          null);
      }
    }
    return lifted;
  }

  private emit(
    kind: BudgetEvent["event"],
    dimension: string,
    day: string,
    usedTokens: number,
    limitTokens: number,
    message: string,
    channelId: string | null | undefined,
  ): void {
    const event: BudgetEvent = {
      event: kind,
      dimension,
      day,
      usedTokens,
      limitTokens,
      ratio: limitTokens > 0 ? usedTokens / limitTokens : 0,
      message,
    };
    this.log(`[budget] ${kind} ${dimension} ${day}: ${message}`);
    this.publish("budget", event);
    if (channelId) this.publish(channelId, event);
  }
}
