import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  DATABASE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type Approval,
  type ApprovalStatus,
  type BudgetBreaker,
  type BudgetConfig,
  type ChannelIdentity,
  type ChannelRoute,
  type DistillConfig,
  type Evidence,
  type EvidenceKind,
  type Mode,
  type PolicyGrant,
  type ProductEvent,
  type Project,
  type Run,
  type RunBudget,
  type RunCheckpoint,
  type Step,
  type StepStatus,
  type Task,
  type TaskStatus,
  type UsageReport,
  type UsageRow,
} from "@penglai/protocol";
import { redactSensitiveText, redactSensitiveValue } from "../security/redaction.js";

const APPLICATION_ID = 0x50474c34; // "PGL4"
const RUN_TRANSITIONS: Record<Run["status"], readonly Run["status"][]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["paused", "waiting_approval", "blocked", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  waiting_approval: ["running", "paused", "blocked", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};
const STEP_TRANSITIONS: Record<StepStatus, readonly StepStatus[]> = {
  pending: ["running", "skipped", "blocked"],
  running: ["completed", "failed", "blocked"],
  blocked: ["running", "failed", "skipped"],
  completed: [],
  failed: [],
  skipped: [],
};

export interface CreateProjectInput {
  name: string;
  rootPath: string;
  repositoryUrl?: string | null;
  repositoryBranch?: string | null;
  trusted?: boolean;
  defaultModelProfileId?: string | null;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  objective: string;
  acceptanceCriteria?: string[];
  status?: TaskStatus;
  sourceChannel?: Task["sourceChannel"];
}

export interface CreateRunInput {
  taskId: string;
  kernel?: string;
  modelProfileId: string;
  budget?: Partial<RunBudget>;
}

export interface CreateStepInput {
  runId: string;
  title: string;
  status?: StepStatus;
  summary?: string;
}

export interface AddEvidenceInput {
  taskId: string;
  runId?: string | null;
  stepId?: string | null;
  kind: EvidenceKind;
  title: string;
  summary?: string;
  uri?: string | null;
  sha256?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RequestApprovalInput {
  taskId: string;
  runId?: string | null;
  capability: string;
  action: string;
  reason: string;
  requestedBy: string;
}

export interface TaskBundle {
  task: Task;
  runs: Run[];
  steps: Step[];
  evidence: Evidence[];
  approvals: Approval[];
  /** Lightweight engine-session checkpoints, one per ended run. */
  checkpoints: RunCheckpoint[];
}

export interface RecordRunCheckpointInput {
  runId: string;
  taskId: string;
  sessionPath: string | null;
  taskTitle: string;
  taskObjective: string;
  status: Run["status"];
  turns: number;
  toolFailures: number;
  inputTokens: number;
  outputTokens: number;
  budget: RunBudget;
}

export interface ProductStoreOptions {
  /** Migration/schema tools must not rewrite live run state as a startup side effect. */
  recoverInterruptedRuns?: boolean;
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") throw new Error("database JSON column is not text");
  return JSON.parse(value) as T;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rowProject(row: Record<string, unknown>): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(row.id),
    name: String(row.name),
    rootPath: String(row.root_path),
    repositoryUrl: nullableString(row.repository_url),
    repositoryBranch: nullableString(row.repository_branch),
    status: row.status as Project["status"],
    trusted: Number(row.trusted) === 1,
    defaultModelProfileId: nullableString(row.default_model_profile_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowTask(row: Record<string, unknown>): Task {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    objective: String(row.objective),
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria_json),
    status: row.status as TaskStatus,
    sourceChannel: row.source_channel as Task["sourceChannel"],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
  };
}

function rowRun(row: Record<string, unknown>): Run {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(row.id),
    taskId: String(row.task_id),
    sequence: Number(row.sequence),
    status: row.status as Run["status"],
    kernel: String(row.kernel),
    modelProfileId: String(row.model_profile_id),
    budget: parseJson<RunBudget>(row.budget_json),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    error: nullableString(row.error),
  };
}

function rowStep(row: Record<string, unknown>): Step {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(row.id),
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    title: String(row.title),
    status: row.status as StepStatus,
    summary: String(row.summary),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowEvidence(row: Record<string, unknown>): Evidence {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(row.id),
    taskId: String(row.task_id),
    runId: nullableString(row.run_id),
    stepId: nullableString(row.step_id),
    kind: row.kind as EvidenceKind,
    title: String(row.title),
    summary: String(row.summary),
    uri: nullableString(row.uri),
    sha256: nullableString(row.sha256),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    createdAt: Number(row.created_at),
  };
}

function rowApproval(row: Record<string, unknown>): Approval {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(row.id),
    taskId: String(row.task_id),
    runId: nullableString(row.run_id),
    capability: String(row.capability),
    action: String(row.action),
    reason: String(row.reason),
    status: row.status as ApprovalStatus,
    requestedBy: String(row.requested_by),
    decidedBy: nullableString(row.decided_by),
    decisionNote: nullableString(row.decision_note),
    createdAt: Number(row.created_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at),
  };
}

function rowPolicyGrant(row: Record<string, unknown>): PolicyGrant {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: String(row.project_id),
    grantKey: String(row.grant_key),
    createdBy: String(row.created_by),
    note: nullableString(row.note),
    createdAt: Number(row.created_at),
  };
}

function rowChannelIdentity(row: Record<string, unknown>): ChannelIdentity {
  return {
    schemaVersion: SCHEMA_VERSION,
    channel: String(row.channel),
    channelUserId: String(row.channel_user_id),
    identity: String(row.identity),
    note: nullableString(row.note),
    createdAt: Number(row.created_at),
  };
}

function rowChannelRoute(row: Record<string, unknown>): ChannelRoute {
  return {
    schemaVersion: SCHEMA_VERSION,
    channel: String(row.channel),
    chatId: String(row.chat_id),
    conversationId: String(row.conversation_id),
    defaultProjectId: nullableString(row.default_project_id),
    updatedAt: Number(row.updated_at),
  };
}

function rowBudgetBreaker(row: Record<string, unknown>): BudgetBreaker {
  return {
    schemaVersion: SCHEMA_VERSION,
    dimension: String(row.dimension),
    day: String(row.day),
    limitTokens: Number(row.limit_tokens),
    warnedAt: row.warned_at === null ? null : Number(row.warned_at),
    trippedAt: row.tripped_at === null ? null : Number(row.tripped_at),
    tokensAtTrip: row.tokens_at_trip === null ? null : Number(row.tokens_at_trip),
    liftedAt: row.lifted_at === null ? null : Number(row.lifted_at),
    liftedBy: nullableString(row.lifted_by),
    liftNote: nullableString(row.lift_note),
  };
}

function rowRunCheckpoint(row: Record<string, unknown>): RunCheckpoint {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: String(row.run_id),
    taskId: String(row.task_id),
    sessionPath: nullableString(row.session_path),
    taskTitle: String(row.task_title),
    taskObjective: String(row.task_objective),
    status: row.status as Run["status"],
    turns: Number(row.turns),
    toolFailures: Number(row.tool_failures),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    budget: parseJson<RunBudget>(row.budget_json),
    createdAt: Number(row.created_at),
  };
}

function rows<T>(
  database: DatabaseSync,
  sql: string,
  mapper: (row: Record<string, unknown>) => T,
  ...params: SQLInputValue[]
): T[] {
  return database
    .prepare(sql)
    .all(...params)
    .map((row) => mapper(row as Record<string, unknown>));
}

export class ProductStore {
  readonly database: DatabaseSync;

  constructor(
    readonly filename: string,
    options: ProductStoreOptions = {},
  ) {
    if (filename !== ":memory:") {
      const resolved = path.resolve(filename);
      const directory = path.dirname(resolved);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const directoryStat = fs.lstatSync(directory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error(`Product data directory must be a regular directory: ${directory}`);
      }
      if (typeof process.getuid === "function" && directoryStat.uid !== process.getuid()) {
        throw new Error(`Product data directory is not owned by the current user: ${directory}`);
      }
      fs.chmodSync(directory, 0o700);
      if (fs.existsSync(resolved)) {
        const databaseStat = fs.lstatSync(resolved);
        if (databaseStat.isSymbolicLink() || !databaseStat.isFile()) {
          throw new Error(`Product database must be a regular file, not a symlink: ${resolved}`);
        }
        if (typeof process.getuid === "function" && databaseStat.uid !== process.getuid()) {
          throw new Error(`Product database is not owned by the current user: ${resolved}`);
        }
      }
    }
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);
    this.migrate();
    if (options.recoverInterruptedRuns !== false) this.recoverInterruptedRuns();
    if (filename !== ":memory:") fs.chmodSync(filename, 0o600);
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    const current = Number(
      (this.database.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    );
    if (current > DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `database schema ${current} is newer than supported ${DATABASE_SCHEMA_VERSION}`,
      );
    }
    if (current === DATABASE_SCHEMA_VERSION) return;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (current < 1) {
        this.database.exec(`
          CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL UNIQUE,
            repository_url TEXT,
            repository_branch TEXT,
            status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
            trusted INTEGER NOT NULL CHECK (trusted IN (0, 1)),
            default_model_profile_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          ) STRICT;
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
            title TEXT NOT NULL,
            objective TEXT NOT NULL,
            acceptance_criteria_json TEXT NOT NULL CHECK (
              json_valid(acceptance_criteria_json)
              AND json_type(acceptance_criteria_json) = 'array'
            ),
            status TEXT NOT NULL CHECK (status IN (
              'draft', 'ready', 'running', 'waiting_approval', 'blocked',
              'completed', 'failed', 'cancelled', 'archived'
            )),
            source_channel TEXT NOT NULL CHECK (source_channel IN (
              'desktop', 'feishu', 'wechat', 'schedule', 'api'
            )),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER
          ) STRICT;
          CREATE INDEX tasks_project_updated ON tasks(project_id, updated_at DESC);
          CREATE TABLE runs (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
            sequence INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (status IN (
              'queued', 'running', 'paused', 'waiting_approval', 'blocked',
              'completed', 'failed', 'cancelled'
            )),
            kernel TEXT NOT NULL,
            model_profile_id TEXT NOT NULL,
            budget_json TEXT NOT NULL CHECK (json_valid(budget_json)),
            started_at INTEGER,
            finished_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            error TEXT,
            UNIQUE(task_id, sequence)
          ) STRICT;
          CREATE INDEX runs_task_sequence ON runs(task_id, sequence);
          CREATE TABLE steps (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
            sequence INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN (
              'pending', 'running', 'completed', 'failed', 'skipped', 'blocked'
            )),
            summary TEXT NOT NULL,
            started_at INTEGER,
            finished_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(run_id, sequence)
          ) STRICT;
          CREATE INDEX steps_run_sequence ON steps(run_id, sequence);
          CREATE TABLE evidence (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
            run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
            step_id TEXT REFERENCES steps(id) ON DELETE RESTRICT,
            kind TEXT NOT NULL CHECK (kind IN (
              'diff', 'command', 'test', 'artifact', 'screenshot', 'file',
              'source', 'external_response', 'log'
            )),
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            uri TEXT,
            sha256 TEXT,
            metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
            created_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX evidence_task_created ON evidence(task_id, created_at);
          CREATE INDEX evidence_run_created ON evidence(run_id, created_at);
          CREATE TABLE approvals (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
            run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
            capability TEXT NOT NULL,
            action TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN (
              'pending', 'approved', 'denied', 'expired'
            )),
            requested_by TEXT NOT NULL,
            decided_by TEXT,
            decision_note TEXT,
            created_at INTEGER NOT NULL,
            decided_at INTEGER
          ) STRICT;
          CREATE INDEX approvals_task_status ON approvals(task_id, status);
          CREATE TABLE product_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aggregate_type TEXT NOT NULL CHECK (aggregate_type IN (
              'project', 'task', 'run', 'step', 'evidence', 'approval'
            )),
            aggregate_id TEXT NOT NULL,
            type TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            created_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX product_events_aggregate
            ON product_events(aggregate_type, aggregate_id, id);
          CREATE TRIGGER product_events_no_update
            BEFORE UPDATE ON product_events
            BEGIN
              SELECT RAISE(ABORT, 'product events are append-only');
            END;
          CREATE TRIGGER product_events_no_delete
            BEFORE DELETE ON product_events
            BEGIN
              SELECT RAISE(ABORT, 'product events are append-only');
            END;
          CREATE TRIGGER evidence_relationships
            BEFORE INSERT ON evidence
            WHEN
              (NEW.run_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM runs
                WHERE runs.id = NEW.run_id AND runs.task_id = NEW.task_id
              ))
              OR
              (NEW.step_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM steps
                JOIN runs ON runs.id = steps.run_id
                WHERE steps.id = NEW.step_id
                  AND steps.run_id = NEW.run_id
                  AND runs.task_id = NEW.task_id
              ))
            BEGIN
              SELECT RAISE(ABORT, 'evidence task/run/step relationship is invalid');
            END;
          CREATE TRIGGER approval_relationships
            BEFORE INSERT ON approvals
            WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM runs
              WHERE runs.id = NEW.run_id AND runs.task_id = NEW.task_id
            )
            BEGIN
              SELECT RAISE(ABORT, 'approval task/run relationship is invalid');
            END;
        `);
      }
      if (current < 2) {
        // v2: durable token-usage ledger (design §7 成本可见性), aggregated by
        // (day, mode, project). project_id "" = unanchored chat-mode usage.
        this.database.exec(`
          CREATE TABLE usage_counters (
            day TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('chat', 'work')),
            project_id TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            requests INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (day, mode, project_id)
          ) STRICT;
        `);
      }
      if (current < 3) {
        // v3: lightweight run checkpoints (the worldline replacement). Each
        // finished run indexes its engine session transcript (Pi session
        // JSONL) plus the task summary and the episode's budget usage.
        this.database.exec(`
          CREATE TABLE run_checkpoints (
            run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE RESTRICT,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
            session_path TEXT,
            task_title TEXT NOT NULL,
            task_objective TEXT NOT NULL,
            status TEXT NOT NULL,
            turns INTEGER NOT NULL,
            tool_failures INTEGER NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            budget_json TEXT NOT NULL CHECK (json_valid(budget_json)),
            created_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX run_checkpoints_task ON run_checkpoints(task_id, created_at);
        `);
      }
      if (current < 4) {
        // v4: the approval four-level system (审批四级制). Per-project L2
        // grants (同类免问) persist the owner's "don't ask again for this
        // kind" decisions; L3 is never grantable. The adjudication table in
        // policy.ts stays the default; these rows are the durable override.
        this.database.exec(`
          CREATE TABLE policy_grants (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
            grant_key TEXT NOT NULL,
            created_by TEXT NOT NULL,
            note TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (project_id, grant_key)
          ) STRICT;
        `);
      }
      if (current < 5) {
        // v5: IM 渠道（飞书先行，设计存档 §5 IM behavior）。白名单身份
        // （默认拒绝一切未白名单用户）、会话→Conversation/项目路由持久化
        // （重启不丢）、任务→会话路由（进度播报落点）、事件幂等去重。
        this.database.exec(`
          CREATE TABLE channel_identities (
            channel TEXT NOT NULL,
            channel_user_id TEXT NOT NULL,
            identity TEXT NOT NULL,
            note TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (channel, channel_user_id)
          ) STRICT;
          CREATE TABLE channel_routes (
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            default_project_id TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (channel, chat_id)
          ) STRICT;
          CREATE TABLE channel_task_routes (
            channel TEXT NOT NULL,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
            chat_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (channel, task_id)
          ) STRICT;
          CREATE TABLE channel_events (
            channel TEXT NOT NULL,
            event_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (channel, event_id)
          ) STRICT;
        `);
      }
      if (current < 6) {
        // v6: 成本熔断 + 蒸馏环（设计 §7 成本可见性、§6 蒸馏环）。
        // budget_config 单行：owner 的日/项目日 token 上限；
        // budget_breakers 按（维度, 本地日）记录 80% 预警/撞线/人工放行
        // 全周期 provenance；distill_config 单行：蒸馏环开关与复盘/审计
        // 模型档位（审计位预留给「与执行不同的 provider」）。
        this.database.exec(`
          CREATE TABLE budget_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            daily_token_limit INTEGER,
            project_daily_token_limit INTEGER,
            updated_at INTEGER NOT NULL,
            updated_by TEXT NOT NULL
          ) STRICT;
          CREATE TABLE budget_breakers (
            dimension TEXT NOT NULL,
            day TEXT NOT NULL,
            limit_tokens INTEGER NOT NULL,
            warned_at INTEGER,
            tripped_at INTEGER,
            tokens_at_trip INTEGER,
            lifted_at INTEGER,
            lifted_by TEXT,
            lift_note TEXT,
            PRIMARY KEY (dimension, day)
          ) STRICT;
          CREATE TABLE distill_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            review_profile_id TEXT,
            audit_profile_id TEXT,
            updated_at INTEGER NOT NULL,
            updated_by TEXT NOT NULL
          ) STRICT;
        `);
      }
      if (current < 7) {
        // v7: single conversation surface — drop mode from usage_counters PK.
        // Merge chat+work rows for the same (day, project_id) by summing.
        this.database.exec(`
          CREATE TABLE usage_counters_v7 (
            day TEXT NOT NULL,
            project_id TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            requests INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (day, project_id)
          ) STRICT;
          INSERT INTO usage_counters_v7 (day, project_id, input_tokens, output_tokens, requests, updated_at)
            SELECT day, project_id,
                   SUM(input_tokens), SUM(output_tokens), SUM(requests), MAX(updated_at)
            FROM usage_counters
            GROUP BY day, project_id;
          DROP TABLE usage_counters;
          ALTER TABLE usage_counters_v7 RENAME TO usage_counters;
        `);
      }
      this.database.exec(`
        PRAGMA application_id = ${APPLICATION_ID};
        PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
        COMMIT;
      `);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * A new Host process cannot safely resume an in-memory Pi/tool episode.
   * Closing non-terminal rows at startup avoids permanently "running" tasks
   * and gives the owner a clean, auditable retry path.
   */
  private recoverInterruptedRuns(): void {
    // C6: Host restart must not rewrite Owner intent.
    // - running / waiting_approval / queued → failed/interrupted (process gone)
    // - paused / blocked → keep status (user paused or budget-blocked)
    // - completed / failed / cancelled → unchanged
    const interrupted = this.database
      .prepare(
        `SELECT id, task_id
         FROM runs
         WHERE status IN ('queued', 'running', 'waiting_approval')`,
      )
      .all() as Array<{ id: string; task_id: string }>;
    if (interrupted.length === 0) {
      // No interrupted runs, but orphaned pending approvals still expire.
      this.expireOrphanedApprovals();
      return;
    }

    const timestamp = Date.now();
    const reason = "Interrupted by previous Host shutdown";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const run of interrupted) {
        this.database
          .prepare(
            `UPDATE steps
             SET status = 'failed', summary = ?, finished_at = ?, updated_at = ?
             WHERE run_id = ? AND status IN ('pending', 'running', 'blocked')`,
          )
          .run(reason, timestamp, timestamp, run.id);
        this.database
          .prepare(
            `UPDATE runs
             SET status = 'failed', finished_at = ?, updated_at = ?, error = ?
             WHERE id = ?`,
          )
          .run(timestamp, timestamp, reason, run.id);
        this.database
          .prepare(
            `UPDATE tasks
             SET status = 'failed', updated_at = ?, completed_at = NULL
             WHERE id = ?`,
          )
          .run(timestamp, run.task_id);
        this.event(
          "run",
          run.id,
          "run.recovered_as_failed",
          { taskId: run.task_id, reason },
          timestamp,
        );
        this.event(
          "task",
          run.task_id,
          "task.status_changed",
          { sourceRunId: run.id, status: "failed", reason },
          timestamp,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.expireOrphanedApprovals();
  }

  /**
   * Pending approvals are served by in-memory kernel gates; a host (re)start
   * means every waiter from the previous process is dead. Expire them so
   * `approval list` never shows undecidable rows (审批留痕: the rows stay,
   * the status moves to expired, an append-only event is emitted).
   */
  private expireOrphanedApprovals(): void {
    const pending = this.database
      .prepare("SELECT id FROM approvals WHERE status = 'pending'")
      .all() as Array<{ id: string }>;
    if (pending.length === 0) return;
    const timestamp = Date.now();
    const note = "Expired: host restarted while the approval was pending";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of pending) {
        this.database
          .prepare(
            `UPDATE approvals
             SET status = 'expired', decision_note = ?, decided_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(note, timestamp, row.id);
        this.event(
          "approval",
          row.id,
          "approval.expired",
          { reason: note },
          timestamp,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private event(
    aggregateType: ProductEvent["aggregateType"],
    aggregateId: string,
    type: string,
    payload: Record<string, unknown>,
    createdAt: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO product_events
          (aggregate_type, aggregate_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(aggregateType, aggregateId, type, JSON.stringify(payload), createdAt);
  }

  createProject(input: CreateProjectInput): Project {
    const timestamp = Date.now();
    const project: Project = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      name: input.name.trim(),
      rootPath: path.resolve(input.rootPath),
      repositoryUrl: input.repositoryUrl ?? null,
      repositoryBranch: input.repositoryBranch ?? null,
      status: "active",
      trusted: input.trusted ?? false,
      defaultModelProfileId: input.defaultModelProfileId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!project.name) throw new Error("project name is required");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO projects
            (id, name, root_path, repository_url, repository_branch, status,
             trusted, default_model_profile_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project.id,
          project.name,
          project.rootPath,
          project.repositoryUrl,
          project.repositoryBranch,
          project.status,
          project.trusted ? 1 : 0,
          project.defaultModelProfileId,
          project.createdAt,
          project.updatedAt,
        );
      this.event("project", project.id, "project.created", { project }, timestamp);
      this.database.exec("COMMIT");
      return project;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listProjects(includeArchived = false): Project[] {
    return rows(
      this.database,
      includeArchived
        ? "SELECT * FROM projects ORDER BY updated_at DESC"
        : "SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC",
      rowProject,
    );
  }

  getProject(projectId: string): Project | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    return row ? rowProject(row as Record<string, unknown>) : null;
  }

  getProjectByRootPath(rootPath: string): Project | null {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE root_path = ?")
      .get(path.resolve(rootPath));
    return row ? rowProject(row as Record<string, unknown>) : null;
  }

  setProjectTrusted(projectId: string, trusted: boolean): Project {
    const timestamp = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare("UPDATE projects SET trusted = ?, updated_at = ? WHERE id = ?")
        .run(trusted ? 1 : 0, timestamp, projectId);
      if (Number(result.changes) !== 1) throw new Error("project not found");
      const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
      const project = rowProject(row as Record<string, unknown>);
      this.event(
        "project",
        projectId,
        trusted ? "project.trusted" : "project.untrusted",
        { project },
        timestamp,
      );
      this.database.exec("COMMIT");
      return project;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createTask(input: CreateTaskInput): Task {
    if (!this.getProject(input.projectId)) throw new Error("project not found");
    const timestamp = Date.now();
    const task: Task = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      projectId: input.projectId,
      title: input.title.trim(),
      objective: input.objective.trim(),
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      status: input.status ?? "ready",
      sourceChannel: input.sourceChannel ?? "desktop",
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    if (!task.title || !task.objective) throw new Error("task title and objective are required");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO tasks
            (id, project_id, title, objective, acceptance_criteria_json, status,
             source_channel, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id, task.projectId, task.title, task.objective,
          JSON.stringify(task.acceptanceCriteria), task.status, task.sourceChannel,
          task.createdAt, task.updatedAt, task.completedAt,
        );
      this.event("task", task.id, "task.created", { task }, timestamp);
      this.database.exec("COMMIT");
      return task;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listTasks(projectId: string): Task[] {
    return rows(
      this.database,
      "SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC",
      rowTask,
      projectId,
    );
  }

  getTask(taskId: string): Task | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    return row ? rowTask(row as Record<string, unknown>) : null;
  }

  /**
   * Resolve a task by full id or an unambiguous id prefix (IM/CLI users type
   * short prefixes). Returns null when nothing matches; throws when a prefix
   * matches more than one row.
   */
  resolveTask(idOrPrefix: string): Task | null {
    const exact = this.getTask(idOrPrefix);
    if (exact) return exact;
    const matches = rows(
      this.database,
      "SELECT * FROM tasks WHERE id LIKE ? ORDER BY updated_at DESC",
      rowTask,
      `${idOrPrefix}%`,
    );
    if (matches.length > 1) {
      throw new Error(
        `task id prefix '${idOrPrefix}' matches ${matches.length} tasks; use a longer prefix`,
      );
    }
    return matches[0] ?? null;
  }

  /**
   * Direct task status transition (no run involved). Used by the mode-switch
   * loop (mode.exitWork completing/pausing the anchored task) and other host
   * flows that move a task outside an active Run. Emits task.status_changed.
   */
  setTaskStatus(taskId: string, status: TaskStatus): Task {
    const timestamp = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare(
          `UPDATE tasks
           SET status = ?, updated_at = ?,
               completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
           WHERE id = ?`,
        )
        .run(status, timestamp, status, timestamp, taskId);
      if (Number(result.changes) !== 1) throw new Error("task not found");
      const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
      const task = rowTask(row as Record<string, unknown>);
      this.event("task", taskId, "task.status_changed", { status, task }, timestamp);
      this.database.exec("COMMIT");
      return task;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createRun(input: CreateRunInput): Run {
    if (!this.database.prepare("SELECT id FROM tasks WHERE id = ?").get(input.taskId)) {
      throw new Error("task not found");
    }
    const timestamp = Date.now();
    const run: Run = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      taskId: input.taskId,
      sequence: 0, // filled inside the transaction below
      status: "queued",
      kernel: input.kernel ?? "pi-agent-core@0.83.0",
      modelProfileId: input.modelProfileId,
      budget: {
        maxDurationMs: input.budget?.maxDurationMs ?? null,
        maxTokens: input.budget?.maxTokens ?? null,
        maxToolFailures: input.budget?.maxToolFailures ?? 3,
        maxTurns: input.budget?.maxTurns ?? null,
      },
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      error: null,
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Sequence allocation lives INSIDE the write transaction: under
      // concurrency (two processes sharing one db), SELECT outside the
      // transaction can compute the same MAX+1 and trip the UNIQUE
      // (task_id, sequence) constraint with a spurious error.
      const sequence = Number(
        (this.database
          .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM runs WHERE task_id = ?")
          .get(input.taskId) as { value: number }).value,
      );
      run.sequence = sequence;
      this.database
        .prepare(
          `INSERT INTO runs
            (id, task_id, sequence, status, kernel, model_profile_id, budget_json,
             started_at, finished_at, created_at, updated_at, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id, run.taskId, run.sequence, run.status, run.kernel, run.modelProfileId,
          JSON.stringify(run.budget), run.startedAt, run.finishedAt, run.createdAt,
          run.updatedAt, run.error,
        );
      this.event("run", run.id, "run.created", { run }, timestamp);
      this.database.exec("COMMIT");
      return run;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getRun(runId: string): Run | null {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    return row ? rowRun(row as Record<string, unknown>) : null;
  }

  transitionRun(runId: string, status: Run["status"], error: string | null = null): Run {
    const timestamp = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
      if (!existingRow) throw new Error("run not found");
      const existing = rowRun(existingRow as Record<string, unknown>);
      if (!RUN_TRANSITIONS[existing.status].includes(status)) {
        throw new Error(`invalid run transition: ${existing.status} -> ${status}`);
      }
      const isTerminal = ["completed", "failed", "cancelled"].includes(status);
      this.database
        .prepare(
          `UPDATE runs
           SET status = ?,
               started_at = CASE
                 WHEN ? = 'running' THEN COALESCE(started_at, ?)
                 ELSE started_at
               END,
               finished_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
               updated_at = ?,
               error = ?
           WHERE id = ?`,
        )
        .run(
          status, status, timestamp, isTerminal ? 1 : 0, timestamp,
          timestamp, error, runId,
        );

      const taskStatus: TaskStatus =
        status === "paused" ? "blocked"
        : status === "waiting_approval" ? "waiting_approval"
        : status === "queued" ? "ready"
        : status;
      // Keep the FIRST terminal timestamp (same semantics as setTaskStatus):
      // a later run on an already-completed task must not clear the original
      // completion record.
      this.database
        .prepare(
          `UPDATE tasks
           SET status = ?, updated_at = ?,
               completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END
           WHERE id = ?`,
        )
        .run(taskStatus, timestamp, taskStatus, timestamp, existing.taskId);
      const updatedRow = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
      const updated = rowRun(updatedRow as Record<string, unknown>);
      this.event(
        "run",
        runId,
        `run.${status}`,
        { from: existing.status, run: updated },
        timestamp,
      );
      this.event(
        "task",
        existing.taskId,
        "task.status_changed",
        { sourceRunId: runId, status: taskStatus },
        timestamp,
      );
      this.database.exec("COMMIT");
      return updated;
    } catch (transitionError) {
      this.database.exec("ROLLBACK");
      throw transitionError;
    }
  }

  createStep(input: CreateStepInput): Step {
    if (!this.database.prepare("SELECT id FROM runs WHERE id = ?").get(input.runId)) {
      throw new Error("run not found");
    }
    const timestamp = Date.now();
    const step: Step = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      runId: input.runId,
      sequence: 0, // filled inside the transaction below
      title: input.title.trim(),
      status: input.status ?? "pending",
      summary: input.summary ?? "",
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!step.title) throw new Error("step title is required");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Sequence allocation inside the write transaction (same rationale as
      // createRun: concurrent writers must not allocate duplicate sequences).
      const sequence = Number(
        (this.database
          .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM steps WHERE run_id = ?")
          .get(input.runId) as { value: number }).value,
      );
      step.sequence = sequence;
      this.database
        .prepare(
          `INSERT INTO steps
            (id, run_id, sequence, title, status, summary, started_at, finished_at,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          step.id, step.runId, step.sequence, step.title, step.status, step.summary,
          step.startedAt, step.finishedAt, step.createdAt, step.updatedAt,
        );
      this.event("step", step.id, "step.created", { step }, timestamp);
      this.database.exec("COMMIT");
      return step;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getStep(stepId: string): Step | null {
    const row = this.database.prepare("SELECT * FROM steps WHERE id = ?").get(stepId);
    return row ? rowStep(row as Record<string, unknown>) : null;
  }

  transitionStep(
    stepId: string,
    status: StepStatus,
    summary?: string,
  ): Step {
    const timestamp = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = this.database.prepare("SELECT * FROM steps WHERE id = ?").get(stepId);
      if (!existingRow) throw new Error("step not found");
      const existing = rowStep(existingRow as Record<string, unknown>);
      if (!STEP_TRANSITIONS[existing.status].includes(status)) {
        throw new Error(`invalid step transition: ${existing.status} -> ${status}`);
      }
      const isTerminal = ["completed", "failed", "skipped"].includes(status);
      this.database
        .prepare(
          `UPDATE steps
           SET status = ?,
               summary = COALESCE(?, summary),
               started_at = CASE
                 WHEN ? = 'running' THEN COALESCE(started_at, ?)
                 ELSE started_at
               END,
               finished_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          status, summary ?? null, status, timestamp,
          isTerminal ? 1 : 0, timestamp, timestamp, stepId,
        );
      const updatedRow = this.database.prepare("SELECT * FROM steps WHERE id = ?").get(stepId);
      const updated = rowStep(updatedRow as Record<string, unknown>);
      this.event(
        "step",
        stepId,
        `step.${status}`,
        { from: existing.status, step: updated },
        timestamp,
      );
      this.database.exec("COMMIT");
      return updated;
    } catch (transitionError) {
      this.database.exec("ROLLBACK");
      throw transitionError;
    }
  }

  addEvidence(input: AddEvidenceInput): Evidence {
    const timestamp = Date.now();
    const evidence: Evidence = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId ?? null,
      stepId: input.stepId ?? null,
      kind: input.kind,
      title: redactSensitiveText(input.title.trim()).text,
      summary: redactSensitiveText(input.summary ?? "").text,
      uri: input.uri ? redactSensitiveText(input.uri).text : null,
      sha256: input.sha256 ?? null,
      metadata: redactSensitiveValue(input.metadata ?? {}),
      createdAt: timestamp,
    };
    if (!evidence.title) throw new Error("evidence title is required");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO evidence
            (id, task_id, run_id, step_id, kind, title, summary, uri, sha256,
             metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          evidence.id, evidence.taskId, evidence.runId, evidence.stepId, evidence.kind,
          evidence.title, evidence.summary, evidence.uri, evidence.sha256,
          JSON.stringify(evidence.metadata), evidence.createdAt,
        );
      this.event("evidence", evidence.id, "evidence.added", { evidence }, timestamp);
      this.database.exec("COMMIT");
      return evidence;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  requestApproval(input: RequestApprovalInput): Approval {
    const timestamp = Date.now();
    const approval: Approval = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId ?? null,
      capability: redactSensitiveText(input.capability).text,
      action: redactSensitiveText(input.action).text,
      reason: redactSensitiveText(input.reason).text,
      status: "pending",
      requestedBy: redactSensitiveText(input.requestedBy).text,
      decidedBy: null,
      decisionNote: null,
      createdAt: timestamp,
      decidedAt: null,
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO approvals
            (id, task_id, run_id, capability, action, reason, status,
             requested_by, decided_by, decision_note, created_at, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          approval.id, approval.taskId, approval.runId, approval.capability,
          approval.action, approval.reason, approval.status, approval.requestedBy,
          approval.decidedBy, approval.decisionNote, approval.createdAt, approval.decidedAt,
        );
      this.event("approval", approval.id, "approval.requested", { approval }, timestamp);
      this.database.exec("COMMIT");
      return approval;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  decideApproval(
    approvalId: string,
    status: Extract<ApprovalStatus, "approved" | "denied">,
    decidedBy: string,
    decisionNote: string | null = null,
  ): Approval {
    const timestamp = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare(
          `UPDATE approvals
             SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          status,
          redactSensitiveText(decidedBy).text,
          decisionNote ? redactSensitiveText(decisionNote).text : null,
          timestamp,
          approvalId,
        );
      if (Number(result.changes) !== 1) {
        throw new Error("approval not found or already decided");
      }
      const row = this.database.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
      const approval = rowApproval(row as Record<string, unknown>);
      this.event("approval", approval.id, `approval.${status}`, { approval }, timestamp);
      this.database.exec("COMMIT");
      return approval;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getApproval(approvalId: string): Approval | null {
    const row = this.database
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(approvalId);
    return row ? rowApproval(row as Record<string, unknown>) : null;
  }

  /**
   * Resolve an approval by full id or an unambiguous id prefix (CLI users
   * type short prefixes). Returns null when nothing matches; throws when a
   * prefix matches more than one row.
   */
  resolveApproval(idOrPrefix: string): Approval | null {
    const exact = this.getApproval(idOrPrefix);
    if (exact) return exact;
    const matches = rows(
      this.database,
      "SELECT * FROM approvals WHERE id LIKE ? ORDER BY created_at DESC",
      rowApproval,
      `${idOrPrefix}%`,
    );
    if (matches.length > 1) {
      throw new Error(
        `approval id prefix '${idOrPrefix}' matches ${matches.length} approvals; use a longer prefix`,
      );
    }
    return matches[0] ?? null;
  }

  /** Approvals (optionally only pending), enriched with task display data. */
  listApprovals(
    filter: { status?: "pending" | "all"; projectId?: string } = {},
  ): Array<Approval & { taskTitle: string; projectId: string }> {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.status !== "all") {
      clauses.push("approvals.status = 'pending'");
    }
    if (filter.projectId) {
      clauses.push("tasks.project_id = ?");
      params.push(filter.projectId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(
      this.database,
      `SELECT approvals.*, tasks.title AS task_title, tasks.project_id AS project_id
       FROM approvals JOIN tasks ON tasks.id = approvals.task_id
       ${where}
       ORDER BY approvals.created_at DESC, approvals.id`,
      (row) => ({
        ...rowApproval(row),
        taskTitle: String(row.task_title),
        projectId: String(row.project_id),
      }),
      ...params,
    );
  }

  // ── policy grants (per-project L2 同类免问) ─────────────────

  /** Upsert a per-project grant; emits an append-only project event. */
  addPolicyGrant(input: {
    projectId: string;
    grantKey: string;
    createdBy: string;
    note?: string | null;
  }): PolicyGrant {
    // Defense in depth: only reversible L2 decisions may become durable
    // per-project grants. L3/L4 capabilities always require a fresh human
    // decision, even if a caller bypasses ApprovalService validation.
    if (!input.grantKey.startsWith("l2:")) {
      throw new Error("only l2 policy grants may be persisted");
    }
    const timestamp = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO policy_grants
             (project_id, grant_key, created_by, note, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (project_id, grant_key) DO UPDATE SET
             created_by = excluded.created_by,
             note = excluded.note,
             created_at = excluded.created_at`,
        )
        .run(
          input.projectId,
          input.grantKey,
          input.createdBy,
          input.note ?? null,
          timestamp,
        );
      const grant = this.getPolicyGrant(input.projectId, input.grantKey)!;
      this.event(
        "project",
        input.projectId,
        "project.policy_grant.added",
        { grant },
        timestamp,
      );
      this.database.exec("COMMIT");
      return grant;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getPolicyGrant(projectId: string, grantKey: string): PolicyGrant | null {
    const row = this.database
      .prepare(
        "SELECT * FROM policy_grants WHERE project_id = ? AND grant_key = ?",
      )
      .get(projectId, grantKey);
    return row ? rowPolicyGrant(row as Record<string, unknown>) : null;
  }

  hasPolicyGrant(projectId: string, grantKey: string): boolean {
    if (!grantKey.startsWith("l2:")) return false;
    return this.getPolicyGrant(projectId, grantKey) !== null;
  }

  listPolicyGrants(projectId?: string): PolicyGrant[] {
    return projectId
      ? rows(
          this.database,
          "SELECT * FROM policy_grants WHERE project_id = ? ORDER BY created_at",
          rowPolicyGrant,
          projectId,
        )
      : rows(
          this.database,
          "SELECT * FROM policy_grants ORDER BY created_at",
          rowPolicyGrant,
        );
  }

  // ── IM 渠道（白名单 / 路由 / 幂等，设计存档 §5） ──────────────

  /** 白名单放行（upsert）：飞书 open_id → Penglai 身份。 */
  allowChannelIdentity(input: {
    channel: string;
    channelUserId: string;
    identity: string;
    note?: string | null;
  }): ChannelIdentity {
    const timestamp = Date.now();
    this.database
      .prepare(
        `INSERT INTO channel_identities
           (channel, channel_user_id, identity, note, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel, channel_user_id) DO UPDATE SET
           identity = excluded.identity,
           note = excluded.note`,
      )
      .run(
        input.channel,
        input.channelUserId,
        input.identity,
        input.note ?? null,
        timestamp,
      );
    return this.getChannelIdentity(input.channel, input.channelUserId)!;
  }

  /** 白名单移除；返回是否真的删掉了行。 */
  denyChannelIdentity(channel: string, channelUserId: string): boolean {
    const result = this.database
      .prepare(
        "DELETE FROM channel_identities WHERE channel = ? AND channel_user_id = ?",
      )
      .run(channel, channelUserId);
    return Number(result.changes) === 1;
  }

  getChannelIdentity(channel: string, channelUserId: string): ChannelIdentity | null {
    const row = this.database
      .prepare(
        "SELECT * FROM channel_identities WHERE channel = ? AND channel_user_id = ?",
      )
      .get(channel, channelUserId);
    return row ? rowChannelIdentity(row as Record<string, unknown>) : null;
  }

  listChannelIdentities(channel: string): ChannelIdentity[] {
    return rows(
      this.database,
      "SELECT * FROM channel_identities WHERE channel = ? ORDER BY created_at",
      rowChannelIdentity,
      channel,
    );
  }

  /** 会话路由查询（chat_id → Conversation/默认项目）。 */
  getChannelRoute(channel: string, chatId: string): ChannelRoute | null {
    const row = this.database
      .prepare("SELECT * FROM channel_routes WHERE channel = ? AND chat_id = ?")
      .get(channel, chatId);
    return row ? rowChannelRoute(row as Record<string, unknown>) : null;
  }

  /**
   * 会话路由写入（upsert）：未提供的字段保留旧值（路由持久化，重启水合）。
   */
  upsertChannelRoute(
    channel: string,
    chatId: string,
    patch: { conversationId?: string; defaultProjectId?: string | null },
  ): ChannelRoute {
    const existing = this.getChannelRoute(channel, chatId);
    const conversationId = patch.conversationId ?? existing?.conversationId;
    if (!conversationId) {
      throw new Error("channel route needs a conversationId on first write");
    }
    const defaultProjectId =
      patch.defaultProjectId !== undefined
        ? patch.defaultProjectId
        : (existing?.defaultProjectId ?? null);
    const timestamp = Date.now();
    this.database
      .prepare(
        `INSERT INTO channel_routes
           (channel, chat_id, conversation_id, default_project_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel, chat_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           default_project_id = excluded.default_project_id,
           updated_at = excluded.updated_at`,
      )
      .run(channel, chatId, conversationId, defaultProjectId, timestamp);
    return this.getChannelRoute(channel, chatId)!;
  }

  listChannelRoutes(channel: string): ChannelRoute[] {
    return rows(
      this.database,
      "SELECT * FROM channel_routes WHERE channel = ? ORDER BY updated_at DESC",
      rowChannelRoute,
      channel,
    );
  }

  /** 任务→会话路由（进度播报/审批卡片的落点会话）。 */
  putChannelTaskRoute(channel: string, taskId: string, chatId: string): void {
    this.database
      .prepare(
        `INSERT INTO channel_task_routes (channel, task_id, chat_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (channel, task_id) DO UPDATE SET chat_id = excluded.chat_id`,
      )
      .run(channel, taskId, chatId, Date.now());
  }

  /** 任务路由到的会话 id；未路由返回 null。 */
  getChannelTaskChat(channel: string, taskId: string): string | null {
    const row = this.database
      .prepare(
        "SELECT chat_id FROM channel_task_routes WHERE channel = ? AND task_id = ?",
      )
      .get(channel, taskId);
    return row ? String((row as Record<string, unknown>).chat_id) : null;
  }

  /**
   * 事件幂等去重（设计存档 §5：event_id 幂等）：首次见到返回 true 并落行；
   * 重复事件返回 false（调用方跳过处理）。INSERT OR IGNORE 原子语义，
   * 并发重投安全。
   */
  recordChannelEvent(channel: string, eventId: string): boolean {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO channel_events (channel, event_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(channel, eventId, Date.now());
    return Number(result.changes) === 1;
  }

  /** 去重表剪枝（启动时清掉老旧行，防无限增长）；返回删除行数。 */
  pruneChannelEvents(olderThanMs: number): number {
    const result = this.database
      .prepare("DELETE FROM channel_events WHERE created_at < ?")
      .run(Date.now() - olderThanMs);
    return Number(result.changes);
  }

  /**
   * Roll back a dedup key after a FAILED event so Feishu's redelivery (triggered
   * by our NACK) can retry the event instead of silently dropping it. Without
   * this, any one-shot processing failure is permanently lost (the redelivered
   * event hits the dedup key and is skipped).
   */
  forgetChannelEvent(channel: string, eventId: string): void {
    this.database
      .prepare("DELETE FROM channel_events WHERE channel = ? AND event_id = ?")
      .run(channel, eventId);
  }

  getTaskBundle(taskId: string): TaskBundle | null {
    const taskRow = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!taskRow) return null;
    const taskRuns = rows(
      this.database,
      "SELECT * FROM runs WHERE task_id = ? ORDER BY sequence",
      rowRun,
      taskId,
    );
    return {
      task: rowTask(taskRow as Record<string, unknown>),
      runs: taskRuns,
      steps: rows(
        this.database,
        `SELECT steps.* FROM steps
         JOIN runs ON runs.id = steps.run_id
         WHERE runs.task_id = ?
         ORDER BY runs.sequence, steps.sequence`,
        rowStep,
        taskId,
      ),
      evidence: rows(
        this.database,
        "SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at, rowid",
        rowEvidence,
        taskId,
      ),
      approvals: rows(
        this.database,
        "SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at, id",
        rowApproval,
        taskId,
      ),
      checkpoints: this.listRunCheckpoints(taskId),
    };
  }

  // ── run checkpoints (lightweight; the worldline replacement) ─

  /**
   * Record (or replace) the checkpoint for a finished run. Idempotent per
   * run: the TaskRunner's settle path and the startup crash-recovery sweep
   * may both index the same run.
   */
  recordRunCheckpoint(input: RecordRunCheckpointInput): RunCheckpoint {
    const timestamp = Date.now();
    this.database
      .prepare(
        `INSERT INTO run_checkpoints
           (run_id, task_id, session_path, task_title, task_objective, status,
            turns, tool_failures, input_tokens, output_tokens, budget_json,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET
           session_path = excluded.session_path,
           status = excluded.status,
           turns = excluded.turns,
           tool_failures = excluded.tool_failures,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           budget_json = excluded.budget_json`,
      )
      .run(
        input.runId,
        input.taskId,
        input.sessionPath,
        input.taskTitle,
        input.taskObjective,
        input.status,
        input.turns,
        input.toolFailures,
        input.inputTokens,
        input.outputTokens,
        JSON.stringify(input.budget),
        timestamp,
      );
    return this.getRunCheckpoint(input.runId)!;
  }

  getRunCheckpoint(runId: string): RunCheckpoint | null {
    const row = this.database
      .prepare("SELECT * FROM run_checkpoints WHERE run_id = ?")
      .get(runId);
    return row ? rowRunCheckpoint(row as Record<string, unknown>) : null;
  }

  listRunCheckpoints(taskId: string): RunCheckpoint[] {
    return rows(
      this.database,
      "SELECT * FROM run_checkpoints WHERE task_id = ? ORDER BY created_at, run_id",
      rowRunCheckpoint,
      taskId,
    );
  }

  /**
   * Runs that reached a stopped state but have no checkpoint row yet — the
   * crash-recovery sweep targets these (the engine session file may still be
   * on disk even though the host died before the settle path ran).
   */
  listRunsMissingCheckpoint(): Run[] {
    return rows(
      this.database,
      `SELECT runs.* FROM runs
       LEFT JOIN run_checkpoints ON run_checkpoints.run_id = runs.id
       WHERE run_checkpoints.run_id IS NULL
         AND runs.status IN ('paused', 'blocked', 'completed', 'failed', 'cancelled')
       ORDER BY runs.created_at`,
      rowRun,
    );
  }

  listEvents(
    aggregateType: ProductEvent["aggregateType"],
    aggregateId: string,
  ): ProductEvent[] {
    return this.database
      .prepare(
        `SELECT * FROM product_events
         WHERE aggregate_type = ? AND aggregate_id = ?
         ORDER BY id`,
      )
      .all(aggregateType, aggregateId)
      .map((row) => {
        const value = row as Record<string, unknown>;
        return {
          schemaVersion: SCHEMA_VERSION,
          id: Number(value.id),
          aggregateType: value.aggregate_type as ProductEvent["aggregateType"],
          aggregateId: String(value.aggregate_id),
          type: String(value.type),
          payload: parseJson<Record<string, unknown>>(value.payload_json),
          createdAt: Number(value.created_at),
        };
      });
  }

  // ── usage ledger (design §7 成本可见性) ─────────────────────

  /**
   * Add one episode's usage to the durable (day, mode, project) bucket.
   * Token counts are provider-reported and may be 0 (provider silent); the
   * request itself is always counted. The bucket row is upserted additively.
   */
  recordUsage(input: {
    day: string;
    /** @deprecated ignored after schema v7 (single surface). */
    mode?: Mode;
    projectId: string;
    inputTokens: number;
    outputTokens: number;
    requests?: number;
  }): void {
    const timestamp = Date.now();
    this.database
      .prepare(
        `INSERT INTO usage_counters
           (day, project_id, input_tokens, output_tokens, requests, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, project_id) DO UPDATE SET
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           requests = requests + excluded.requests,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.day,
        input.projectId,
        Math.max(0, Math.trunc(input.inputTokens)),
        Math.max(0, Math.trunc(input.outputTokens)),
        Math.max(0, Math.trunc(input.requests ?? 1)),
        timestamp,
      );
  }

  /** All-time totals plus every aggregated bucket row, newest first. */
  getUsageReport(): UsageReport {
    const buckets: UsageRow[] = rows(
      this.database,
      `SELECT * FROM usage_counters ORDER BY day DESC, updated_at DESC`,
      (row) => ({
        day: String(row.day),
        mode: (row.mode as Mode | undefined) ?? (String(row.project_id) ? "work" : "chat"),
        projectId: String(row.project_id),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        requests: Number(row.requests),
        updatedAt: Number(row.updated_at),
      }),
    );
    let inputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    for (const bucket of buckets) {
      inputTokens += bucket.inputTokens;
      outputTokens += bucket.outputTokens;
      requests += bucket.requests;
    }
    return {
      totalTokens: inputTokens + outputTokens,
      totalRequests: requests,
      inputTokens,
      outputTokens,
      rows: buckets,
    };
  }

  // ── budget circuit breaker (成本熔断, design §7) ──────────────

  /** The owner's budget config; sane defaults (unbounded) when unset. */
  getBudgetConfig(): BudgetConfig {
    const row = this.database
      .prepare("SELECT * FROM budget_config WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    if (!row) {
      return {
        schemaVersion: SCHEMA_VERSION,
        dailyTokenLimit: null,
        projectDailyTokenLimit: null,
        updatedAt: 0,
        updatedBy: "",
      };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      dailyTokenLimit:
        row.daily_token_limit === null ? null : Number(row.daily_token_limit),
      projectDailyTokenLimit:
        row.project_daily_token_limit === null
          ? null
          : Number(row.project_daily_token_limit),
      updatedAt: Number(row.updated_at),
      updatedBy: String(row.updated_by),
    };
  }

  /** Upsert the budget config (single row). Null clears a dimension. */
  setBudgetConfig(input: {
    dailyTokenLimit: number | null;
    projectDailyTokenLimit: number | null;
    updatedBy: string;
  }): BudgetConfig {
    const timestamp = Date.now();
    this.database
      .prepare(
        `INSERT INTO budget_config
           (id, daily_token_limit, project_daily_token_limit, updated_at, updated_by)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           daily_token_limit = excluded.daily_token_limit,
           project_daily_token_limit = excluded.project_daily_token_limit,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run(
        input.dailyTokenLimit,
        input.projectDailyTokenLimit,
        timestamp,
        input.updatedBy,
      );
    return this.getBudgetConfig();
  }

  /** One breaker row, or null when the dimension has none for that day. */
  getBudgetBreaker(dimension: string, day: string): BudgetBreaker | null {
    const row = this.database
      .prepare(
        "SELECT * FROM budget_breakers WHERE dimension = ? AND day = ?",
      )
      .get(dimension, day);
    return row ? rowBudgetBreaker(row as Record<string, unknown>) : null;
  }

  /** Every breaker row for a local day (status views / lift-all). */
  listBudgetBreakers(day: string): BudgetBreaker[] {
    return rows(
      this.database,
      "SELECT * FROM budget_breakers WHERE day = ? ORDER BY dimension",
      rowBudgetBreaker,
      day,
    );
  }

  /**
   * Ensure a breaker row exists for (dimension, day) at the CURRENT limit;
   * returns the row. Used by the budget service before marking warn/trip.
   */
  ensureBudgetBreaker(dimension: string, day: string, limitTokens: number): BudgetBreaker {
    this.database
      .prepare(
        `INSERT INTO budget_breakers (dimension, day, limit_tokens)
         VALUES (?, ?, ?)
         ON CONFLICT (dimension, day) DO NOTHING`,
      )
      .run(dimension, day, limitTokens);
    return this.getBudgetBreaker(dimension, day)!;
  }

  /** Record that the 80% warning fired (once per dimension per day). */
  markBudgetWarned(dimension: string, day: string): void {
    this.database
      .prepare(
        `UPDATE budget_breakers SET warned_at = ?
         WHERE dimension = ? AND day = ? AND warned_at IS NULL`,
      )
      .run(Date.now(), dimension, day);
  }

  /** Trip the breaker (100% crossed); keeps the first trip's provenance. */
  tripBudgetBreaker(dimension: string, day: string, tokensAtTrip: number): void {
    this.database
      .prepare(
        `UPDATE budget_breakers SET tripped_at = ?, tokens_at_trip = ?
         WHERE dimension = ? AND day = ? AND tripped_at IS NULL`,
      )
      .run(Date.now(), tokensAtTrip, dimension, day);
  }

  /**
   * Owner lift (release) of a tripped breaker — the L3-class human decision
   * that re-arms the dimension for the rest of the day. Provenance lands on
   * the row itself (lifted_at/by/note); returns false when nothing was
   * tripped (or already lifted).
   */
  liftBudgetBreaker(
    dimension: string,
    day: string,
    liftedBy: string,
    note: string | null,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE budget_breakers
         SET lifted_at = ?, lifted_by = ?, lift_note = ?
         WHERE dimension = ? AND day = ?
           AND tripped_at IS NOT NULL AND lifted_at IS NULL`,
      )
      .run(Date.now(), liftedBy, note, dimension, day);
    return Number(result.changes) === 1;
  }

  // ── distillation loop config (蒸馏环, design §6) ──────────────

  /** The distillation config; defaults (enabled, run's own profile) unset. */
  getDistillConfig(): DistillConfig {
    const row = this.database
      .prepare("SELECT * FROM distill_config WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    if (!row) {
      return {
        schemaVersion: SCHEMA_VERSION,
        enabled: true,
        reviewProfileId: null,
        auditProfileId: null,
        updatedAt: 0,
        updatedBy: "",
      };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: Number(row.enabled) === 1,
      reviewProfileId: nullableString(row.review_profile_id),
      auditProfileId: nullableString(row.audit_profile_id),
      updatedAt: Number(row.updated_at),
      updatedBy: String(row.updated_by),
    };
  }

  /** Upsert the distillation config (single row). */
  setDistillConfig(input: {
    enabled: boolean;
    reviewProfileId: string | null;
    auditProfileId: string | null;
    updatedBy: string;
  }): DistillConfig {
    const timestamp = Date.now();
    this.database
      .prepare(
        `INSERT INTO distill_config
           (id, enabled, review_profile_id, audit_profile_id, updated_at, updated_by)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           enabled = excluded.enabled,
           review_profile_id = excluded.review_profile_id,
           audit_profile_id = excluded.audit_profile_id,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run(
        input.enabled ? 1 : 0,
        input.reviewProfileId,
        input.auditProfileId,
        timestamp,
        input.updatedBy,
      );
    return this.getDistillConfig();
  }
}
