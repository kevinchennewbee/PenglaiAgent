import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError } from "@penglai/contracts";
import { dayKey, type BudgetLimit, type TokenMeterFact } from "./service.js";

export interface LedgerEntry {
  id: number;
  day: string;
  tokens: number;
  source: string;
  at: string;
}

export type BudgetScope = "global" | "workspace" | "provider" | "model";

export interface BudgetIdentity {
  workspaceId?: string;
  provider: string;
  model: string;
}

export interface BudgetPolicy {
  scope: BudgetScope;
  key: string;
  hardTokens: number | null;
  warnRatio: number;
  revision: number;
}

export interface BudgetAdmission {
  reservationKey: string;
  estimatedTokens: number;
  identity: BudgetIdentity;
  enforcePolicies?: boolean;
}

interface UsageRow extends BudgetIdentity {
  tokens: number;
}

function assertTokens(tokens: number): void {
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new PenglaiError("INVALID_INPUT", "budget tokens must be a non-negative safe integer");
}

function matches(policy: BudgetPolicy, row: BudgetIdentity): boolean {
  if (policy.scope === "global") return true;
  if (policy.scope === "workspace") return row.workspaceId === policy.key;
  if (policy.scope === "provider") return row.provider === policy.key;
  return `${row.provider}/${row.model}` === policy.key;
}

export class BudgetLedger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS budget_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        source TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS budget_usage_day ON budget_usage(day);
      CREATE TABLE IF NOT EXISTS budget_actual (
        reservation_key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        workspace_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        source TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS budget_actual_day ON budget_actual(day);
      CREATE TABLE IF NOT EXISTS budget_releases (
        reservation_key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        workspace_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        released_at TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budget_reservations (
        reservation_key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        workspace_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS budget_reservations_day ON budget_reservations(day);
      CREATE TABLE IF NOT EXISTS budget_limits (
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        hard_tokens INTEGER,
        warn_ratio REAL NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(scope, scope_key)
      );
      CREATE TABLE IF NOT EXISTS budget_clock (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        last_day TEXT NOT NULL
      );
    `);
    const row = this.db.prepare("SELECT MAX(version) AS v FROM schema_meta").get() as { v: number | null };
    if (!row?.v) this.db.exec("INSERT INTO schema_meta(version) VALUES (2)");
    if (row?.v && row.v > 2) throw new PenglaiError("STORE_CORRUPT", "newer budget schema");
    if (row?.v === 1) this.db.exec("INSERT INTO schema_meta(version) VALUES (2)");
  }

  private inTransaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private effectiveDay(now: number): string {
    const observed = dayKey(now);
    const row = this.db.prepare("SELECT last_day AS lastDay FROM budget_clock WHERE singleton=1").get() as
      | { lastDay: string }
      | undefined;
    const effective = row && row.lastDay > observed ? row.lastDay : observed;
    this.db
      .prepare(
        "INSERT INTO budget_clock(singleton,last_day) VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET last_day=excluded.last_day",
      )
      .run(effective);
    return effective;
  }

  usedOn(day: string): number {
    const legacy = this.db.prepare("SELECT COALESCE(SUM(tokens), 0) AS s FROM budget_usage WHERE day = ?").get(day) as {
      s: number;
    };
    const actual = this.db.prepare("SELECT COALESCE(SUM(tokens), 0) AS s FROM budget_actual WHERE day = ?").get(day) as {
      s: number;
    };
    return Number(legacy.s) + Number(actual.s);
  }

  record(meter: TokenMeterFact, now: number, source = "token-meter"): { warn: boolean; used: number } {
    assertTokens(meter.tokens);
    return this.inTransaction(() => {
      const day = this.effectiveDay(now);
      const used = this.usedOn(day) + meter.tokens;
      this.db
        .prepare("INSERT INTO budget_usage(day, tokens, source, at) VALUES (?, ?, ?, ?)")
        .run(day, meter.tokens, source, new Date(now).toISOString());
      return { warn: false, used };
    });
  }

  reserve(limit: BudgetLimit, meter: TokenMeterFact, now: number, source = "token-meter"): { warn: boolean; used: number } {
    assertTokens(meter.tokens);
    return this.inTransaction(() => {
      const day = this.effectiveDay(now);
      const next = this.usedOn(day) + meter.tokens;
      if (limit.hardTokens !== null && next > limit.hardTokens) {
        throw new PenglaiError("SECURITY_POLICY", "budget hard block before model");
      }
      this.db
        .prepare("INSERT INTO budget_usage(day, tokens, source, at) VALUES (?, ?, ?, ?)")
        .run(day, meter.tokens, source, new Date(now).toISOString());
      const warnAt = limit.hardTokens === null ? Number.POSITIVE_INFINITY : limit.hardTokens * (limit.warnRatio ?? 0.8);
      return { warn: next >= warnAt, used: next };
    });
  }

  setPolicy(input: {
    scope: BudgetScope;
    key: string;
    hardTokens: number | null;
    warnRatio?: number;
    ownerConfirmed: boolean;
  }): BudgetPolicy {
    if (!input.ownerConfirmed) throw new PenglaiError("SECURITY_POLICY", "budget change requires Owner confirmation");
    if (!input.key.trim()) throw new PenglaiError("INVALID_INPUT", "budget scope key required");
    if (input.hardTokens !== null && (!Number.isSafeInteger(input.hardTokens) || input.hardTokens <= 0)) {
      throw new PenglaiError("INVALID_INPUT", "budget hardTokens must be positive or null for unlimited");
    }
    const warnRatio = input.warnRatio ?? 0.8;
    if (!Number.isFinite(warnRatio) || warnRatio <= 0 || warnRatio >= 1) {
      throw new PenglaiError("INVALID_INPUT", "budget warnRatio must be between zero and one");
    }
    return this.inTransaction(() => {
      const current = this.db
        .prepare("SELECT revision FROM budget_limits WHERE scope=? AND scope_key=?")
        .get(input.scope, input.key) as { revision: number } | undefined;
      const revision = (current?.revision ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO budget_limits(scope,scope_key,hard_tokens,warn_ratio,revision,updated_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(scope,scope_key) DO UPDATE SET hard_tokens=excluded.hard_tokens,warn_ratio=excluded.warn_ratio,
             revision=excluded.revision,updated_at=excluded.updated_at`,
        )
        .run(input.scope, input.key, input.hardTokens, warnRatio, revision, new Date().toISOString());
      return { scope: input.scope, key: input.key, hardTokens: input.hardTokens, warnRatio, revision };
    });
  }

  policies(): BudgetPolicy[] {
    return this.db
      .prepare(
        "SELECT scope, scope_key AS key, hard_tokens AS hardTokens, warn_ratio AS warnRatio, revision FROM budget_limits ORDER BY scope,key",
      )
      .all() as unknown as BudgetPolicy[];
  }

  admit(input: BudgetAdmission, now: number): { warn: boolean; unlimited: boolean; day: string } {
    assertTokens(input.estimatedTokens);
    if (!input.reservationKey.trim()) throw new PenglaiError("INVALID_INPUT", "budget reservation key required");
    if (!input.identity.provider || !input.identity.model) throw new PenglaiError("INVALID_INPUT", "budget model identity required");
    return this.inTransaction(() => {
      const day = this.effectiveDay(now);
      const existing = this.db
        .prepare("SELECT 1 FROM budget_reservations WHERE reservation_key=?")
        .get(input.reservationKey);
      const settled = this.db.prepare("SELECT 1 FROM budget_actual WHERE reservation_key=?").get(input.reservationKey);
      if (existing || settled) return { warn: false, unlimited: this.policies().every((policy) => policy.hardTokens === null), day };
      this.assertWithinBudgetLocked(input.estimatedTokens, input.identity, input.enforcePolicies, day);
      this.db
        .prepare(
          `INSERT INTO budget_reservations(reservation_key,day,workspace_id,provider,model,estimated_tokens,at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          input.reservationKey,
          day,
          input.identity.workspaceId ?? null,
          input.identity.provider,
          input.identity.model,
          input.estimatedTokens,
          new Date(now).toISOString(),
        );
      return { warn: this.warnForLocked(input.estimatedTokens, input.identity, input.enforcePolicies, day), unlimited: this.policies().length === 0 || this.policies().every((policy) => policy.hardTokens === null), day };
    });
  }

  /**
   * Read-only hard-limit pre-check. Does not reserve anything; used when the
   * caller knows the model route before an operation (e.g. the agent's own
   * declared options) and must block a new Turn *before* that operation runs.
   */
  assertWithinBudget(input: { estimatedTokens: number; identity: BudgetIdentity; enforcePolicies?: boolean }, now: number): void {
    assertTokens(input.estimatedTokens);
    if (!input.identity.provider || !input.identity.model) throw new PenglaiError("INVALID_INPUT", "budget model identity required");
    this.inTransaction(() => {
      const day = this.effectiveDay(now);
      this.assertWithinBudgetLocked(input.estimatedTokens, input.identity, input.enforcePolicies, day);
    });
  }

  private assertWithinBudgetLocked(estimatedTokens: number, identity: BudgetIdentity, enforcePolicies: boolean | undefined, day: string): void {
    const policies = this.policies().filter((policy) => matches(policy, identity));
    const actual = this.db
      .prepare("SELECT workspace_id AS workspaceId,provider,model,tokens FROM budget_actual WHERE day=?")
      .all(day) as unknown as UsageRow[];
    const reserved = this.db
      .prepare(
        "SELECT workspace_id AS workspaceId,provider,model,estimated_tokens AS tokens FROM budget_reservations WHERE day=?",
      )
      .all(day) as unknown as UsageRow[];
    for (const policy of enforcePolicies === false ? [] : policies) {
      if (policy.hardTokens === null) continue;
      const used = [...actual, ...reserved]
        .filter((row) => matches(policy, row))
        .reduce((sum, row) => sum + row.tokens, 0);
      const next = used + estimatedTokens;
      if (next > policy.hardTokens) throw new PenglaiError("SECURITY_POLICY", "budget hard block before model");
    }
  }

  private warnForLocked(estimatedTokens: number, identity: BudgetIdentity, enforcePolicies: boolean | undefined, day: string): boolean {
    const policies = this.policies().filter((policy) => matches(policy, identity));
    const actual = this.db
      .prepare("SELECT workspace_id AS workspaceId,provider,model,tokens FROM budget_actual WHERE day=?")
      .all(day) as unknown as UsageRow[];
    const reserved = this.db
      .prepare(
        "SELECT workspace_id AS workspaceId,provider,model,estimated_tokens AS tokens FROM budget_reservations WHERE day=?",
      )
      .all(day) as unknown as UsageRow[];
    let warn = false;
    for (const policy of enforcePolicies === false ? [] : policies) {
      if (policy.hardTokens === null) continue;
      const used = [...actual, ...reserved]
        .filter((row) => matches(policy, row))
        .reduce((sum, row) => sum + row.tokens, 0);
      const next = used + estimatedTokens;
      if (next >= policy.hardTokens * policy.warnRatio) warn = true;
    }
    return warn;
  }

  settle(
    reservationKey: string,
    meter: TokenMeterFact,
    now: number,
    source = "official-token-meter",
    actualIdentity?: BudgetIdentity,
  ): boolean {
    assertTokens(meter.tokens);
    return this.inTransaction(() => {
      const reservation = this.db
        .prepare(
          `SELECT day,workspace_id AS workspaceId,provider,model FROM budget_reservations WHERE reservation_key=?`,
        )
        .get(reservationKey) as ({ day: string } & BudgetIdentity) | undefined;
      const existing = this.db
        .prepare("SELECT workspace_id AS workspaceId,provider,model FROM budget_actual WHERE reservation_key=?")
        .get(reservationKey) as BudgetIdentity | undefined;
      if (!reservation && !existing) return false;
      if (reservation) {
        const identity = actualIdentity
          ? { ...actualIdentity, workspaceId: actualIdentity.workspaceId ?? reservation.workspaceId }
          : reservation;
        this.db
          .prepare(
            `INSERT INTO budget_actual(reservation_key,day,workspace_id,provider,model,tokens,source,at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(reservation_key) DO UPDATE SET tokens=excluded.tokens,source=excluded.source,at=excluded.at`,
          )
          .run(
            reservationKey,
            reservation.day,
            identity.workspaceId ?? null,
            identity.provider,
            identity.model,
            meter.tokens,
            source,
            new Date(now).toISOString(),
          );
        this.db.prepare("DELETE FROM budget_reservations WHERE reservation_key=?").run(reservationKey);
      } else {
        const settledIdentity = existing!;
        const identity = actualIdentity
          ? { ...actualIdentity, workspaceId: actualIdentity.workspaceId ?? settledIdentity.workspaceId }
          : settledIdentity;
        this.db
          .prepare("UPDATE budget_actual SET workspace_id=?,provider=?,model=?,tokens=?,source=?,at=? WHERE reservation_key=?")
          .run(
            identity.workspaceId ?? null,
            identity.provider,
            identity.model,
            meter.tokens,
            source,
            new Date(now).toISOString(),
            reservationKey,
          );
      }
      return true;
    });
  }

  releaseReservation(reservationKey: string, reason: string): boolean {
    if (!reservationKey.trim() || !/^[a-z0-9:@._-]{1,200}$/i.test(reason)) {
      throw new PenglaiError("INVALID_INPUT", "budget reservation release identity invalid");
    }
    return this.inTransaction(() => {
      const row = this.db
        .prepare(
          `SELECT reservation_key AS reservationKey,day,workspace_id AS workspaceId,provider,model,estimated_tokens AS estimatedTokens
           FROM budget_reservations WHERE reservation_key=?`,
        )
        .get(reservationKey) as {
        reservationKey: string;
        day: string;
        workspaceId: string | null;
        provider: string;
        model: string;
        estimatedTokens: number;
      } | undefined;
      if (!row) return false;
      this.db.prepare(
        `INSERT OR IGNORE INTO budget_releases(reservation_key,day,workspace_id,provider,model,estimated_tokens,released_at,reason)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        row.reservationKey,
        row.day,
        row.workspaceId,
        row.provider,
        row.model,
        row.estimatedTokens,
        new Date().toISOString(),
        reason,
      );
      this.db.prepare("DELETE FROM budget_reservations WHERE reservation_key=?").run(reservationKey);
      return true;
    });
  }

  releaseTurn(sessionId: string, turn: number, reason = "turn-end"): number {
    const prefix = `${sessionId}:${turn}:`;
    return this.inTransaction(() => {
      const rows = this.db
        .prepare(
          "SELECT reservation_key AS reservationKey, day, workspace_id AS workspaceId, provider, model, estimated_tokens AS estimatedTokens FROM budget_reservations WHERE substr(reservation_key,1,?)=?",
        )
        .all(prefix.length, prefix) as Array<{
        reservationKey: string;
        day: string;
        workspaceId: string | null;
        provider: string;
        model: string;
        estimatedTokens: number;
      }>;
      const now = new Date().toISOString();
      for (const row of rows) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO budget_releases(reservation_key,day,workspace_id,provider,model,estimated_tokens,released_at,reason)
             VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(row.reservationKey, row.day, row.workspaceId, row.provider, row.model, row.estimatedTokens, now, reason);
        this.db.prepare("DELETE FROM budget_reservations WHERE reservation_key=?").run(row.reservationKey);
      }
      return rows.length;
    });
  }

  status(now: number): {
    day: string;
    tokens: number;
    reservedTokens: number;
    priceTrusted: false;
    money: null;
    policies: BudgetPolicy[];
  } {
    return this.inTransaction(() => {
      const day = this.effectiveDay(now);
      const actual = this.db.prepare("SELECT COALESCE(SUM(tokens),0) AS tokens FROM budget_actual WHERE day=?").get(day) as {
        tokens: number;
      };
      const reserved = this.db
        .prepare("SELECT COALESCE(SUM(estimated_tokens),0) AS tokens FROM budget_reservations WHERE day=?")
        .get(day) as { tokens: number };
      return {
        day,
        tokens: Number(actual.tokens),
        reservedTokens: Number(reserved.tokens),
        priceTrusted: false,
        money: null,
        policies: this.policies(),
      };
    });
  }

  close(): void {
    this.db.close();
  }
}
