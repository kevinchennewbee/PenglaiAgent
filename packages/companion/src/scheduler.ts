import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError } from "@penglai/contracts";
import {
  FRESH_COMPANION,
  type CompanionConfig,
  type CompanionDeliveryMode,
  type CompanionIntensity,
  type CompanionLocale,
  type CompanionSignal,
} from "./service.js";

export type CompanionDispatchState =
  "claimed" | "turn_running" | "suppressed" | "failed" | "outbox_queued" | "uncertain";

export interface CompanionScheduleRow {
  localId: string;
  officialId: string;
  triggerClass: CompanionSignal;
  policyRevision: number;
  state: "active" | "deleted";
}

export interface CompanionDispatchRow {
  triggerId: string;
  officialId: string;
  triggerClass: CompanionSignal;
  occurrenceAt: string;
  sessionId: string;
  turn: number;
  policyRevision: number;
  state: CompanionDispatchState;
  outcomeCode?: string;
  routeId?: string;
  day?: string;
  finalDigest?: string;
  outboxRefs: string[];
}

export interface CompanionEnableRecord {
  bindingId: string;
  workspaceId: string;
  boundSessionId: string;
  companionSessionId: string;
  provider: string;
  model: string;
  workspacePath: string;
  quietStartHour: number;
  quietEndHour: number;
  dailyCap: number;
  recentInteractionMinutes: number;
  intensity: CompanionIntensity;
  deliveryMode: CompanionDeliveryMode;
  locale: CompanionLocale;
  signals: CompanionSignal[];
}

function dayKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseSignals(value: string): CompanionSignal[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        !["periodic", "reminder", "idle", "emotion"].includes(String(item)),
    )
  ) {
    throw new PenglaiError("STORE_CORRUPT", "invalid companion signals");
  }
  return parsed as CompanionSignal[];
}

export class CompanionStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
    } catch {
      /* Windows ACL is owned by the app-private userData boundary. */
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS companion_config(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        revision INTEGER NOT NULL,
        phase TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        binding_id TEXT,
        workspace_id TEXT,
        bound_session_id TEXT,
        companion_session_id TEXT,
        provider TEXT,
        model TEXT,
        workspace_path TEXT,
        quiet_start_hour INTEGER NOT NULL,
        quiet_end_hour INTEGER NOT NULL,
        daily_cap INTEGER NOT NULL,
        recent_interaction_minutes INTEGER NOT NULL,
        intensity TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        locale TEXT NOT NULL,
        signals_json TEXT NOT NULL,
        permission TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS companion_schedules(
        local_id TEXT PRIMARY KEY,
        official_id TEXT NOT NULL UNIQUE,
        trigger_class TEXT NOT NULL,
        policy_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS companion_dispatch(
        trigger_id TEXT PRIMARY KEY,
        official_id TEXT NOT NULL,
        trigger_class TEXT NOT NULL,
        occurrence_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_no INTEGER NOT NULL,
        policy_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        outcome_code TEXT,
        route_id TEXT,
        day TEXT,
        final_digest TEXT,
        outbox_refs_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(trigger_id)
      );
      CREATE TABLE IF NOT EXISTS companion_clock(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        last_day TEXT NOT NULL
      );
    `);
    let version: { version: number | null };
    try {
      version = this.db.prepare("SELECT MAX(version) AS version FROM schema_meta").get() as {
        version: number | null;
      };
    } catch {
      throw new PenglaiError("STORE_CORRUPT", "companion schema_meta unreadable");
    }
    if (version.version !== null && version.version > 3)
      throw new PenglaiError("STORE_CORRUPT", "newer companion schema");
    if (!version.version) this.db.exec("INSERT INTO schema_meta(version) VALUES (2)");
    const migrated = this.db.prepare("SELECT version FROM schema_meta WHERE version=3").get();
    if (version.version === 1) this.db.exec("INSERT INTO schema_meta(version) VALUES (2)");
    if (version.version === 2 && !migrated) {
      this.db.exec(`
        CREATE TABLE companion_dispatch_v3 (
          trigger_id TEXT PRIMARY KEY,
          official_id TEXT NOT NULL,
          trigger_class TEXT NOT NULL,
          occurrence_at TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_no INTEGER NOT NULL,
          policy_revision INTEGER NOT NULL,
          state TEXT NOT NULL,
          outcome_code TEXT,
          route_id TEXT,
          day TEXT,
          final_digest TEXT,
          outbox_refs_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO companion_dispatch_v3 SELECT
          trigger_id,official_id,trigger_class,occurrence_at,session_id,turn_no,policy_revision,state,outcome_code,route_id,day,final_digest,outbox_refs_json,updated_at
        FROM companion_dispatch;
        DROP TABLE companion_dispatch;
        ALTER TABLE companion_dispatch_v3 RENAME TO companion_dispatch;
        INSERT INTO schema_meta(version) VALUES (3);
      `);
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO companion_config(
          singleton,revision,phase,enabled,quiet_start_hour,quiet_end_hour,daily_cap,recent_interaction_minutes,
          intensity,delivery_mode,locale,signals_json,permission,updated_at
        ) VALUES (1,0,'disabled',0,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        FRESH_COMPANION.quietStartHour,
        FRESH_COMPANION.quietEndHour,
        FRESH_COMPANION.dailyCap,
        FRESH_COMPANION.recentInteractionMinutes,
        FRESH_COMPANION.intensity,
        FRESH_COMPANION.deliveryMode,
        FRESH_COMPANION.locale,
        JSON.stringify(FRESH_COMPANION.signals),
        FRESH_COMPANION.permission,
        Date.now(),
      );
  }

  tx<T>(operation: () => T): T {
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

  config(): CompanionConfig {
    const row = this.db
      .prepare("SELECT * FROM companion_config WHERE singleton=1")
      .get() as Record<string, unknown> | undefined;
    if (!row)
      throw new PenglaiError("STORE_CORRUPT", "companion config missing");
    return {
      revision: Number(row.revision),
      phase: String(row.phase) as CompanionConfig["phase"],
      enabled: Number(row.enabled) === 1,
      ...(row.binding_id ? { bindingId: String(row.binding_id) } : {}),
      ...(row.workspace_id ? { workspaceId: String(row.workspace_id) } : {}),
      ...(row.bound_session_id
        ? { boundSessionId: String(row.bound_session_id) }
        : {}),
      ...(row.companion_session_id
        ? { companionSessionId: String(row.companion_session_id) }
        : {}),
      ...(row.provider ? { provider: String(row.provider) } : {}),
      ...(row.model ? { model: String(row.model) } : {}),
      ...(row.workspace_path
        ? { workspacePath: String(row.workspace_path) }
        : {}),
      quietStartHour: Number(row.quiet_start_hour),
      quietEndHour: Number(row.quiet_end_hour),
      dailyCap: Number(row.daily_cap),
      recentInteractionMinutes: Number(row.recent_interaction_minutes),
      intensity: String(row.intensity) as CompanionIntensity,
      deliveryMode: String(row.delivery_mode) as CompanionDeliveryMode,
      locale: String(row.locale) as CompanionLocale,
      signals: parseSignals(String(row.signals_json)),
      permission: "plan/no-unattended-tools",
    };
  }

  beginEnable(input: CompanionEnableRecord, now: number): CompanionConfig {
    return this.tx(() => {
      const revision = this.config().revision + 1;
      this.db
        .prepare(
          `UPDATE companion_config SET revision=?,phase='enabling',enabled=0,binding_id=?,workspace_id=?,bound_session_id=?,
           companion_session_id=?,provider=?,model=?,workspace_path=?,quiet_start_hour=?,quiet_end_hour=?,daily_cap=?,
           recent_interaction_minutes=?,intensity=?,delivery_mode=?,locale=?,signals_json=?,permission=?,updated_at=? WHERE singleton=1`,
        )
        .run(
          revision,
          input.bindingId,
          input.workspaceId,
          input.boundSessionId,
          input.companionSessionId,
          input.provider,
          input.model,
          input.workspacePath,
          input.quietStartHour,
          input.quietEndHour,
          input.dailyCap,
          input.recentInteractionMinutes,
          input.intensity,
          input.deliveryMode,
          input.locale,
          JSON.stringify(input.signals),
          "plan/no-unattended-tools",
          now,
        );
      return this.config();
    });
  }

  commitEnable(now: number): CompanionConfig {
    this.db
      .prepare(
        "UPDATE companion_config SET phase='enabled',enabled=1,updated_at=? WHERE singleton=1",
      )
      .run(now);
    return this.config();
  }

  failEnable(_code: string, now: number): void {
    this.db
      .prepare(
        "UPDATE companion_config SET phase='failed',enabled=0,updated_at=? WHERE singleton=1",
      )
      .run(now);
  }

  disable(now: number): CompanionConfig {
    this.db
      .prepare(
        "UPDATE companion_config SET phase='disabled',enabled=0,revision=revision+1,updated_at=? WHERE singleton=1",
      )
      .run(now);
    return this.config();
  }

  addSchedule(row: CompanionScheduleRow, now: number): void {
    this.db
      .prepare(
        `INSERT INTO companion_schedules(local_id,official_id,trigger_class,policy_revision,state,created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        row.localId,
        row.officialId,
        row.triggerClass,
        row.policyRevision,
        row.state,
        now,
      );
  }

  schedules(activeOnly = false): CompanionScheduleRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM companion_schedules ${activeOnly ? "WHERE state='active'" : ""} ORDER BY created_at,local_id`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      localId: String(row.local_id),
      officialId: String(row.official_id),
      triggerClass: String(row.trigger_class) as CompanionSignal,
      policyRevision: Number(row.policy_revision),
      state: String(row.state) as CompanionScheduleRow["state"],
    }));
  }

  scheduleByOfficialId(officialId: string): CompanionScheduleRow | undefined {
    return this.schedules().find((row) => row.officialId === officialId);
  }

  markScheduleDeleted(officialId: string): void {
    this.db
      .prepare(
        "UPDATE companion_schedules SET state='deleted' WHERE official_id=?",
      )
      .run(officialId);
  }

  claimDispatch(
    row: Omit<CompanionDispatchRow, "state" | "outboxRefs">,
    now: number,
  ): CompanionDispatchRow {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO companion_dispatch(
          trigger_id,official_id,trigger_class,occurrence_at,session_id,turn_no,policy_revision,state,outbox_refs_json,updated_at
        ) VALUES (?,?,?,?,?,?,?,'claimed','[]',?)`,
      )
      .run(
        row.triggerId,
        row.officialId,
        row.triggerClass,
        row.occurrenceAt,
        row.sessionId,
        row.turn,
        row.policyRevision,
        now,
      );
    return (
      this.dispatchByTrigger(row.triggerId) ??
      this.dispatchByTurn(row.sessionId, row.turn)!
    );
  }

  dispatchByTurn(
    sessionId: string,
    turn: number,
  ): CompanionDispatchRow | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM companion_dispatch WHERE session_id=? AND turn_no=?",
      )
      .get(sessionId, turn) as Record<string, unknown> | undefined;
    return row ? this.mapDispatch(row) : undefined;
  }

  dispatchByTrigger(triggerId: string): CompanionDispatchRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM companion_dispatch WHERE trigger_id=?")
      .get(triggerId) as Record<string, unknown> | undefined;
    return row ? this.mapDispatch(row) : undefined;
  }

  markDispatch(
    triggerId: string,
    state: CompanionDispatchState,
    now: number,
    facts: {
      outcomeCode?: string;
      routeId?: string;
      finalDigest?: string;
      outboxRefs?: string[];
    } = {},
  ): CompanionDispatchRow {
    const effectiveDay = state === "outbox_queued" ? this.effectiveDay(now) : null;
    this.db
      .prepare(
        `UPDATE companion_dispatch SET state=?,outcome_code=?,route_id=?,day=?,final_digest=?,outbox_refs_json=?,updated_at=?
         WHERE trigger_id=?`,
      )
      .run(
        state,
        facts.outcomeCode ?? null,
        facts.routeId ?? null,
        effectiveDay,
        facts.finalDigest ?? null,
        JSON.stringify(facts.outboxRefs ?? []),
        now,
        triggerId,
      );
    const row = this.dispatchByTrigger(triggerId);
    if (!row)
      throw new PenglaiError("STORE_CORRUPT", "companion dispatch missing");
    return row;
  }

  sentOn(now: number): number {
    const effectiveDay = this.effectiveDay(now);
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM companion_dispatch WHERE day=? AND state='outbox_queued'",
      )
      .get(effectiveDay) as { count: number };
    return Number(row.count);
  }

  private effectiveDay(now: number): string {
    const observed = dayKey(now);
    const row = this.db
      .prepare("SELECT last_day AS lastDay FROM companion_clock WHERE singleton=1")
      .get() as { lastDay: string } | undefined;
    const effective = row && row.lastDay > observed ? row.lastDay : observed;
    this.db
      .prepare(
        "INSERT INTO companion_clock(singleton,last_day) VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET last_day=excluded.last_day",
      )
      .run(effective);
    return effective;
  }

  dispatches(): CompanionDispatchRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM companion_dispatch ORDER BY updated_at,trigger_id",
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.mapDispatch(row));
  }

  private mapDispatch(row: Record<string, unknown>): CompanionDispatchRow {
    return {
      triggerId: String(row.trigger_id),
      officialId: String(row.official_id),
      triggerClass: String(row.trigger_class) as CompanionSignal,
      occurrenceAt: String(row.occurrence_at),
      sessionId: String(row.session_id),
      turn: Number(row.turn_no),
      policyRevision: Number(row.policy_revision),
      state: String(row.state) as CompanionDispatchState,
      ...(row.outcome_code ? { outcomeCode: String(row.outcome_code) } : {}),
      ...(row.route_id ? { routeId: String(row.route_id) } : {}),
      ...(row.day ? { day: String(row.day) } : {}),
      ...(row.final_digest ? { finalDigest: String(row.final_digest) } : {}),
      outboxRefs: JSON.parse(String(row.outbox_refs_json)) as string[],
    };
  }

  close(): void {
    this.db.close();
  }
}
