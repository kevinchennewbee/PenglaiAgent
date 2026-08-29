import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CONFIG,
  DEFAULT_BINDING_VOICE_POLICY,
  PenglaiError,
  ADAPTER_NAMES,
  SCHEMA_VERSION,
  parseClosedEnum,
  type Binding,
  type BindingVoicePolicy,
  type Inbound,
  type InboundState,
  type OutboxItem,
  type OutboxState,
  type Route,
  type TurnCorrelation,
} from "@penglai/contracts";

const ROUTE_ADAPTERS = ADAPTER_NAMES;
const ROUTE_STATUSES = ["pending", "active", "revoked"] as const;
const INBOUND_STATES = [
  "received",
  "rejected",
  "control_handled",
  "queued",
  "claimed",
  "running",
  "finished",
  "cancelled",
  "no_delivery",
  "outbox_pending",
  "delivered",
  "dead",
] as const;
const OUTBOX_STATES = ["pending", "claimed", "sending", "retryable", "uncertain", "delivered", "dead"] as const;
const BODY_KINDS = ["text", "voice", "control"] as const;
const PAYLOAD_KINDS = ["text", "voice", "text-and-voice"] as const;
const DISPATCH_MODES = ["followup", "steer"] as const;
const VOICE_ADAPTERS = ["weixin", "feishu"] as const;
const VOICE_JOB_STATES = ["claimed", "processing", "transcribed", "retryable", "failed"] as const;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE schema_meta (version INTEGER NOT NULL);
  INSERT INTO schema_meta(version) VALUES (1);
  CREATE TABLE routes (
    route_id TEXT PRIMARY KEY,
    adapter TEXT NOT NULL,
    account_ref TEXT NOT NULL,
    peer_ref TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE UNIQUE INDEX routes_adapter_peer ON routes(adapter, account_ref, peer_ref);
  CREATE TABLE bindings (
    route_id TEXT PRIMARY KEY,
    workspace_identity TEXT NOT NULL,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(route_id) REFERENCES routes(route_id)
  );
  CREATE UNIQUE INDEX bindings_active_session ON bindings(session_id) WHERE status = 'active';
  CREATE TABLE pairing_tokens (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    workspace_identity TEXT NOT NULL,
    adapter TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE inbounds (
    inbound_id TEXT PRIMARY KEY,
    adapter_message_key TEXT NOT NULL,
    route_id TEXT NOT NULL,
    binding_revision INTEGER NOT NULL,
    body_kind TEXT NOT NULL,
    redacted_digest TEXT NOT NULL,
    state TEXT NOT NULL,
    dsh_message_id TEXT,
    payload_text TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(route_id, adapter_message_key),
    FOREIGN KEY(route_id) REFERENCES routes(route_id)
  );
  CREATE TABLE correlations (
    inbound_id TEXT PRIMARY KEY,
    dsh_message_id TEXT NOT NULL UNIQUE,
    turn_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    binding_revision INTEGER NOT NULL,
    FOREIGN KEY(inbound_id) REFERENCES inbounds(inbound_id)
  );
  CREATE UNIQUE INDEX corr_turn ON correlations(session_id, turn_id);
  CREATE TABLE outbox (
    outbox_id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL,
    inbound_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    payload_kind TEXT NOT NULL,
    payload_ref TEXT NOT NULL,
    payload_text TEXT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    fragment_index INTEGER NOT NULL,
    fragment_count INTEGER NOT NULL,
    UNIQUE(route_id, sequence),
    UNIQUE(inbound_id, fragment_index),
    FOREIGN KEY(inbound_id) REFERENCES inbounds(inbound_id)
  );
  CREATE TABLE leases (
    session_id TEXT PRIMARY KEY,
    handle_id TEXT NOT NULL,
    ownership TEXT NOT NULL
  );
  CREATE TABLE audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    event TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE route_guards (
    route_id TEXT PRIMARY KEY,
    pairing_attempts INTEGER NOT NULL DEFAULT 0,
    pairing_locked_until INTEGER NOT NULL DEFAULT 0,
    rate_window_start INTEGER NOT NULL DEFAULT 0,
    rate_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(route_id) REFERENCES routes(route_id)
  );
  UPDATE schema_meta SET version = 2;
  `,
  `
  CREATE TABLE vendor_reply_targets (
    route_id TEXT PRIMARY KEY,
    vendor_target TEXT NOT NULL,
    FOREIGN KEY(route_id) REFERENCES routes(route_id)
  );
  CREATE TABLE adapter_configs (
    account_id TEXT PRIMARY KEY,
    adapter TEXT NOT NULL,
    json TEXT NOT NULL
  );
  UPDATE schema_meta SET version = 3;
  `,
  `
  CREATE TABLE adapter_cursors (
    account_id TEXT PRIMARY KEY,
    adapter TEXT NOT NULL,
    cursor TEXT NOT NULL
  );
  CREATE TABLE event_dedupe (
    adapter TEXT NOT NULL,
    event_key TEXT NOT NULL,
    tenant TEXT,
    app_id TEXT,
    PRIMARY KEY (adapter, event_key)
  );
  UPDATE schema_meta SET version = 4;
  `,
  `
  CREATE TABLE binding_voice_policies (
    route_id TEXT PRIMARY KEY,
    input_mode TEXT NOT NULL,
    reply_mode TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    failure_fallback TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(route_id) REFERENCES routes(route_id)
  );
  CREATE TABLE voice_jobs (
    inbound_id TEXT PRIMARY KEY,
    adapter TEXT NOT NULL,
    media_ref_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    expected_bytes INTEGER,
    state TEXT NOT NULL,
    audio_digest TEXT,
    error_class TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(inbound_id) REFERENCES inbounds(inbound_id)
  );
  CREATE INDEX voice_jobs_adapter_state ON voice_jobs(adapter, state);
  CREATE TABLE voice_delivery_receipts (
    outbox_id TEXT PRIMARY KEY,
    text_sent INTEGER NOT NULL DEFAULT 0,
    audio_sent INTEGER NOT NULL DEFAULT 0,
    fallback_used INTEGER NOT NULL DEFAULT 0,
    audio_digest TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(outbox_id) REFERENCES outbox(outbox_id)
  );
  UPDATE schema_meta SET version = 5;
  `,
  `
  ALTER TABLE inbounds ADD COLUMN dispatch_mode TEXT NOT NULL DEFAULT 'followup';
  UPDATE schema_meta SET version = 6;
  `,
  `
  DROP INDEX IF EXISTS bindings_active_session;
  UPDATE schema_meta SET version = 7;
  `,
  `
  CREATE TABLE pending_menus (
    route_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    locale TEXT NOT NULL,
    choices_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(route_id) REFERENCES routes(route_id)
  );
  UPDATE schema_meta SET version = 8;
  `,
  `
  ALTER TABLE voice_jobs ADD COLUMN asr_language TEXT;
  ALTER TABLE voice_jobs ADD COLUMN asr_emotion TEXT;
  UPDATE schema_meta SET version = 9;
  `,
  `
  ALTER TABLE outbox ADD COLUMN worker_id TEXT;
  ALTER TABLE outbox ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE outbox ADD COLUMN vendor_idempotency_key TEXT;
  UPDATE schema_meta SET version = 10;
  `,
  `
  ALTER TABLE outbox ADD COLUMN claim_token TEXT;
  UPDATE schema_meta SET version = 11;
  `,
  `
  CREATE TABLE IF NOT EXISTS inbound_operations (
    operation_id TEXT PRIMARY KEY,
    vendor_message_key TEXT NOT NULL,
    route_id TEXT NOT NULL,
    inbound_id TEXT,
    turn_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(vendor_message_key, route_id)
  );
  CREATE TABLE IF NOT EXISTS im_migration_journal (
    step TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS im_last_good (
    snapshot_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    note TEXT NOT NULL
  );
  INSERT OR IGNORE INTO im_last_good(snapshot_id, created_at, schema_version, note)
    VALUES ('v11-weixin-feishu', 0, 11, '0.5.6 weixin/feishu last-good marker');
  UPDATE schema_meta SET version = 12;
  `,
];

export const PENDING_MENU_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredPendingMenu {
  kind: "projects" | "sessions";
  locale: "zh" | "en";
  choices: Array<{ n: number; workspaceId: string; sessionId?: string; label: string }>;
  createdAt: number;
}

export type VoiceJobState = "claimed" | "processing" | "transcribed" | "retryable" | "failed";

export interface VoiceJob {
  inboundId: string;
  adapter: "weixin" | "feishu";
  mediaRefJson: string;
  durationMs: number;
  expectedBytes?: number;
  state: VoiceJobState;
  audioDigest?: string;
  errorClass?: string;
  asrLanguage?: string;
  asrEmotion?: string;
  updatedAt: number;
}

export interface VoiceDeliveryReceipt {
  outboxId: string;
  textSent: boolean;
  audioSent: boolean;
  fallbackUsed: boolean;
  audioDigest?: string;
  updatedAt: number;
}

export class Store {
  readonly db: DatabaseSync;
  private closed = false;
  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 3000;");
    this.migrate();
    this.quarantineUnsupportedRoutes();
  }

  migrate(): void {
    let version = 0;
    try {
      const row = this.db.prepare("SELECT version FROM schema_meta").get() as { version: number } | undefined;
      version = row?.version ?? 0;
    } catch {
      version = 0;
    }
    if (version > SCHEMA_VERSION) {
      throw new PenglaiError("STORE_CORRUPT", "database newer than binary");
    }
    if (version < SCHEMA_VERSION) {
      try {
        this.db.exec("BEGIN");
        for (let i = version; i < MIGRATIONS.length; i += 1) {
          this.db.exec(MIGRATIONS[i]!);
          this.db.prepare("UPDATE schema_meta SET version = ?").run(i + 1);
        }
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw new PenglaiError("STORE_CORRUPT", `migration failed: ${String(err)}`);
      }
    }
  }

  private quarantineUnsupportedRoutes(): void {
    const placeholders = ROUTE_ADAPTERS.map(() => "?").join(",");
    const routeIds = `SELECT route_id FROM routes WHERE adapter NOT IN (${placeholders})`;
    const updatedAt = new Date().toISOString();
    this.tx(() => {
      this.db
        .prepare(`UPDATE bindings SET status='revoked', updated_at=? WHERE status='active' AND route_id IN (${routeIds})`)
        .run(updatedAt, ...ROUTE_ADAPTERS);
      this.db
        .prepare(`UPDATE routes SET status='revoked' WHERE status!='revoked' AND adapter NOT IN (${placeholders})`)
        .run(...ROUTE_ADAPTERS);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  isClosed(): boolean {
    return this.closed;
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /**
   * One vendor message maps to at most one operation/Turn. Returns false when
   * the pair already exists so crash recovery can reuse the existing claim.
   */
  claimInboundOperation(input: {
    operationId: string;
    vendorMessageKey: string;
    routeId: string;
  }): { created: boolean; operationId: string; inboundId?: string; turnId?: string } {
    const existing = this.db
      .prepare(
        `SELECT operation_id, inbound_id, turn_id FROM inbound_operations
         WHERE vendor_message_key = ? AND route_id = ?`,
      )
      .get(input.vendorMessageKey, input.routeId) as
      | { operation_id: string; inbound_id?: string | null; turn_id?: string | null }
      | undefined;
    if (existing) {
      return {
        created: false,
        operationId: existing.operation_id,
        ...(existing.inbound_id ? { inboundId: existing.inbound_id } : {}),
        ...(existing.turn_id ? { turnId: existing.turn_id } : {}),
      };
    }
    this.db
      .prepare(
        `INSERT INTO inbound_operations(operation_id, vendor_message_key, route_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.operationId, input.vendorMessageKey, input.routeId, Date.now());
    return { created: true, operationId: input.operationId };
  }

  putVendorReplyTarget(routeId: string, vendorTarget: string): void {
    this.db
      .prepare(
        `INSERT INTO vendor_reply_targets(route_id, vendor_target) VALUES (?,?)
         ON CONFLICT(route_id) DO UPDATE SET vendor_target=excluded.vendor_target`,
      )
      .run(routeId, vendorTarget);
  }

  getVendorReplyTarget(routeId: string): string | undefined {
    const row = this.db.prepare("SELECT vendor_target FROM vendor_reply_targets WHERE route_id=?").get(routeId) as
      | { vendor_target?: string }
      | undefined;
    const value = row?.vendor_target;
    return value && value.length > 0 ? value : undefined;
  }

  putAdapterConfig(accountId: string, adapter: string, json: string): void {
    this.db
      .prepare(
        `INSERT INTO adapter_configs(account_id, adapter, json) VALUES (?,?,?)
         ON CONFLICT(account_id) DO UPDATE SET json=excluded.json, adapter=excluded.adapter`,
      )
      .run(accountId, adapter, json);
  }

  getAdapterConfig(accountId: string): string | undefined {
    const row = this.db.prepare("SELECT json FROM adapter_configs WHERE account_id=?").get(accountId) as
      | { json?: string }
      | undefined;
    return row?.json;
  }

  migrateLegacyAdapterAccount(channel: string, nextAccountId: string): boolean {
    if (!channel || !nextAccountId) throw new PenglaiError("INVALID_INPUT", "account migration ids");
    if (nextAccountId === `${channel}-default`) {
      throw new PenglaiError("INVALID_INPUT", "LEGACY_DEFAULT_ACCOUNT");
    }
    return this.tx(() => {
      const legacyId = `${channel}-default`;
      const raw = this.getAdapterConfig(legacyId);
      if (!raw) return false;
      if (this.getAdapterConfig(nextAccountId)) {
        throw new PenglaiError("STORE_CORRUPT", "LEGACY_ACCOUNT_COLLISION");
      }
      this.putAdapterConfig(nextAccountId, channel, raw);
      this.db.prepare("DELETE FROM adapter_configs WHERE account_id=?").run(legacyId);
      if (this.getAdapterConfig(legacyId) || this.getAdapterConfig(nextAccountId) !== raw) {
        throw new PenglaiError("STORE_CORRUPT", "LEGACY_ACCOUNT_MIGRATION");
      }
      return true;
    });
  }

  putPendingMenu(routeId: string, menu: StoredPendingMenu): void {
    this.db
      .prepare(
        `INSERT INTO pending_menus(route_id, kind, locale, choices_json, created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(route_id) DO UPDATE SET kind=excluded.kind, locale=excluded.locale, choices_json=excluded.choices_json, created_at=excluded.created_at`,
      )
      .run(routeId, menu.kind, menu.locale, JSON.stringify(menu.choices), menu.createdAt);
  }

  getPendingMenu(routeId: string, now: number, ttlMs = PENDING_MENU_TTL_MS): StoredPendingMenu | undefined {
    const row = this.db
      .prepare("SELECT kind, locale, choices_json, created_at FROM pending_menus WHERE route_id=?")
      .get(routeId) as { kind?: string; locale?: string; choices_json?: string; created_at?: number } | undefined;
    if (!row) return undefined;
    if (!Number.isFinite(Number(row.created_at)) || now - Number(row.created_at) > ttlMs) {
      this.deletePendingMenu(routeId);
      return undefined;
    }
    if (row.kind !== "projects" && row.kind !== "sessions") {
      this.deletePendingMenu(routeId);
      return undefined;
    }
    if (row.locale !== "zh" && row.locale !== "en") {
      this.deletePendingMenu(routeId);
      return undefined;
    }
    let choices: StoredPendingMenu["choices"] = [];
    try {
      const parsed = JSON.parse(String(row.choices_json ?? "[]")) as unknown;
      if (!Array.isArray(parsed)) {
        this.deletePendingMenu(routeId);
        return undefined;
      }
      choices = parsed.filter((item): item is StoredPendingMenu["choices"][number] => {
        if (!item || typeof item !== "object") return false;
        const rec = item as Record<string, unknown>;
        return typeof rec.n === "number" && typeof rec.workspaceId === "string" && typeof rec.label === "string";
      });
    } catch {
      this.deletePendingMenu(routeId);
      return undefined;
    }
    return { kind: row.kind, locale: row.locale, choices, createdAt: Number(row.created_at) };
  }

  deletePendingMenu(routeId: string): void {
    this.db.prepare("DELETE FROM pending_menus WHERE route_id=?").run(routeId);
  }

  expirePendingMenus(now: number, ttlMs = PENDING_MENU_TTL_MS): number {
    const result = this.db.prepare("DELETE FROM pending_menus WHERE ? - created_at > ?").run(now, ttlMs);
    return Number(result.changes ?? 0);
  }

  putCursor(accountId: string, adapter: string, cursor: string): void {
    this.db
      .prepare(
        `INSERT INTO adapter_cursors(account_id, adapter, cursor) VALUES (?,?,?)
         ON CONFLICT(account_id) DO UPDATE SET cursor=excluded.cursor, adapter=excluded.adapter`,
      )
      .run(accountId, adapter, cursor);
  }

  getCursor(accountId: string, adapter: string): string | undefined {
    const row = this.db.prepare("SELECT cursor FROM adapter_cursors WHERE account_id=? AND adapter=?").get(accountId, adapter) as
      | { cursor?: string }
      | undefined;
    return row?.cursor;
  }

  claimDedupe(adapter: string, eventKey: string, tenant?: string, appId?: string): boolean {
    const existing = this.db
      .prepare("SELECT tenant, app_id FROM event_dedupe WHERE adapter=? AND event_key=?")
      .get(adapter, eventKey) as { tenant?: string; app_id?: string } | undefined;
    if (existing) {
      if (tenant && existing.tenant && existing.tenant !== tenant) {
        throw new PenglaiError("SECURITY_POLICY", "tenant mismatch");
      }
      if (appId && existing.app_id && existing.app_id !== appId) {
        throw new PenglaiError("SECURITY_POLICY", "app identity mismatch");
      }
      return false;
    }
    this.db
      .prepare("INSERT INTO event_dedupe(adapter, event_key, tenant, app_id) VALUES (?,?,?,?)")
      .run(adapter, eventKey, tenant ?? "", appId ?? "");
    return true;
  }

  putBindingVoicePolicy(routeId: string, policy: BindingVoicePolicy): void {
    this.db
      .prepare(
        `INSERT INTO binding_voice_policies(route_id, input_mode, reply_mode, voice_id, failure_fallback, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(route_id) DO UPDATE SET
           input_mode=excluded.input_mode,
           reply_mode=excluded.reply_mode,
           voice_id=excluded.voice_id,
           failure_fallback=excluded.failure_fallback,
           updated_at=excluded.updated_at`,
      )
      .run(
        routeId,
        policy.inputMode,
        policy.replyMode,
        policy.voiceId,
        policy.failureFallback,
        policy.updatedAt,
      );
  }

  getBindingVoicePolicy(routeId: string): BindingVoicePolicy {
    const row = this.db.prepare("SELECT * FROM binding_voice_policies WHERE route_id=?").get(routeId) as
      | Record<string, string>
      | undefined;
    if (!row) return { ...DEFAULT_BINDING_VOICE_POLICY };
    return {
      inputMode: row.input_mode as BindingVoicePolicy["inputMode"],
      replyMode: row.reply_mode as BindingVoicePolicy["replyMode"],
      voiceId: String(row.voice_id),
      failureFallback: "text",
      updatedAt: String(row.updated_at),
    };
  }

  putVoiceJob(job: VoiceJob): void {
    this.db
      .prepare(
        `INSERT INTO voice_jobs(inbound_id, adapter, media_ref_json, duration_ms, expected_bytes, state, audio_digest, error_class, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        job.inboundId,
        job.adapter,
        job.mediaRefJson,
        job.durationMs,
        job.expectedBytes ?? null,
        job.state,
        job.audioDigest ?? null,
        job.errorClass ?? null,
        job.updatedAt,
      );
  }

  getVoiceJob(inboundId: string): VoiceJob | undefined {
    const row = this.db.prepare("SELECT * FROM voice_jobs WHERE inbound_id=?").get(inboundId) as
      | Record<string, string | number | null>
      | undefined;
    return row ? this.mapVoiceJob(row) : undefined;
  }

  pendingVoiceJobs(adapter: "weixin" | "feishu"): VoiceJob[] {
    const rows = this.db
      .prepare("SELECT * FROM voice_jobs WHERE adapter=? AND state IN ('claimed','processing','retryable') ORDER BY updated_at ASC")
      .all(adapter) as Record<string, string | number | null>[];
    return rows.map((row) => this.mapVoiceJob(row));
  }

  setVoiceJobState(
    inboundId: string,
    state: VoiceJobState,
    updatedAt: number,
    details: { audioDigest?: string; errorClass?: string; asrLanguage?: string; asrEmotion?: string } = {},
  ): void {
    this.db
      .prepare(
        `UPDATE voice_jobs SET state=?, updated_at=?,
         audio_digest=COALESCE(?, audio_digest), error_class=?,
         asr_language=COALESCE(?, asr_language), asr_emotion=COALESCE(?, asr_emotion)
         WHERE inbound_id=?`,
      )
      .run(
        state,
        updatedAt,
        details.audioDigest ?? null,
        details.errorClass ?? null,
        details.asrLanguage ?? null,
        details.asrEmotion ?? null,
        inboundId,
      );
  }

  getVoiceDeliveryReceipt(outboxId: string): VoiceDeliveryReceipt {
    const row = this.db.prepare("SELECT * FROM voice_delivery_receipts WHERE outbox_id=?").get(outboxId) as
      | Record<string, string | number | null>
      | undefined;
    if (!row) {
      return { outboxId, textSent: false, audioSent: false, fallbackUsed: false, updatedAt: 0 };
    }
    return {
      outboxId,
      textSent: Number(row.text_sent) === 1,
      audioSent: Number(row.audio_sent) === 1,
      fallbackUsed: Number(row.fallback_used) === 1,
      ...(row.audio_digest ? { audioDigest: String(row.audio_digest) } : {}),
      updatedAt: Number(row.updated_at),
    };
  }

  markVoiceDeliveryPart(
    outboxId: string,
    part: "text" | "audio" | "fallback",
    updatedAt: number,
    audioDigest?: string,
  ): VoiceDeliveryReceipt {
    this.db
      .prepare(
        `INSERT INTO voice_delivery_receipts(outbox_id, text_sent, audio_sent, fallback_used, audio_digest, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(outbox_id) DO UPDATE SET
           text_sent=MAX(text_sent, excluded.text_sent),
           audio_sent=MAX(audio_sent, excluded.audio_sent),
           fallback_used=MAX(fallback_used, excluded.fallback_used),
           audio_digest=COALESCE(excluded.audio_digest, audio_digest),
           updated_at=excluded.updated_at`,
      )
      .run(
        outboxId,
        part === "text" ? 1 : 0,
        part === "audio" ? 1 : 0,
        part === "fallback" ? 1 : 0,
        audioDigest ?? null,
        updatedAt,
      );
    return this.getVoiceDeliveryReceipt(outboxId);
  }

  upsertRoute(route: Route): void {
    this.db
      .prepare(
        `INSERT INTO routes(route_id, adapter, account_ref, peer_ref, status)
         VALUES (?,?,?,?,?)
         ON CONFLICT(adapter, account_ref, peer_ref) DO UPDATE SET status=excluded.status`,
      )
      .run(route.routeId, route.adapter, route.accountRef, route.peerRef, route.status);
  }

  findRoute(adapter: string, accountRef: string, peerRef: string): Route | undefined {
    const row = this.db
      .prepare("SELECT * FROM routes WHERE adapter=? AND account_ref=? AND peer_ref=?")
      .get(adapter, accountRef, peerRef) as Record<string, string> | undefined;
    if (!row) return undefined;
    return this.mapRoute(row);
  }

  getRoute(routeId: string): Route | undefined {
    const row = this.db.prepare("SELECT * FROM routes WHERE route_id=?").get(routeId) as Record<string, string> | undefined;
    if (!row) return undefined;
    return this.mapRoute(row);
  }

  activeBinding(routeId: string): Binding | undefined {
    const row = this.db
      .prepare("SELECT * FROM bindings WHERE route_id=? AND status='active'")
      .get(routeId) as Record<string, string | number> | undefined;
    if (!row) return undefined;
    return {
      routeId: String(row.route_id),
      workspaceIdentity: String(row.workspace_identity),
      sessionId: String(row.session_id),
      revision: Number(row.revision),
      status: "active",
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  ownerOfSession(sessionId: string): Binding | undefined {
    const row = this.db
      .prepare("SELECT * FROM bindings WHERE session_id=? AND status='active'")
      .get(sessionId) as Record<string, string | number> | undefined;
    if (!row) return undefined;
    return {
      routeId: String(row.route_id),
      workspaceIdentity: String(row.workspace_identity),
      sessionId: String(row.session_id),
      revision: Number(row.revision),
      status: "active",
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  putBinding(b: Binding): void {
    this.db
      .prepare(
        `INSERT INTO bindings(route_id, workspace_identity, session_id, revision, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(route_id) DO UPDATE SET
           workspace_identity=excluded.workspace_identity,
           session_id=excluded.session_id,
           revision=excluded.revision,
           status=excluded.status,
           updated_at=excluded.updated_at`,
      )
      .run(b.routeId, b.workspaceIdentity, b.sessionId, b.revision, b.status, b.createdAt, b.updatedAt);
  }

  revokeBinding(routeId: string, updatedAt: string): void {
    this.db.prepare("UPDATE bindings SET status='revoked', updated_at=? WHERE route_id=?").run(updatedAt, routeId);
  }

  putPairing(tokenHash: string, workspaceIdentity: string, sessionId: string, adapter: string, expiresAt: number): void {
    this.db
      .prepare(
        `INSERT INTO pairing_tokens(token_hash, session_id, workspace_identity, adapter, expires_at, consumed, attempts)
         VALUES (?,?,?,?,?,0,0)`,
      )
      .run(tokenHash, sessionId, workspaceIdentity, adapter, expiresAt);
  }

  getPairing(tokenHash: string): {
    tokenHash: string;
    sessionId: string;
    workspaceIdentity: string;
    adapter: string;
    expiresAt: number;
    consumed: number;
    attempts: number;
  } | undefined {
    const row = this.db.prepare("SELECT * FROM pairing_tokens WHERE token_hash=?").get(tokenHash) as
      | Record<string, string | number>
      | undefined;
    if (!row) return undefined;
    return {
      tokenHash: String(row.token_hash),
      sessionId: String(row.session_id),
      workspaceIdentity: String(row.workspace_identity),
      adapter: String(row.adapter),
      expiresAt: Number(row.expires_at),
      consumed: Number(row.consumed),
      attempts: Number(row.attempts),
    };
  }

  bumpPairingAttempt(tokenHash: string): void {
    this.db.prepare("UPDATE pairing_tokens SET attempts=attempts+1 WHERE token_hash=?").run(tokenHash);
  }

  consumePairing(tokenHash: string): void {
    this.db.prepare("UPDATE pairing_tokens SET consumed=1 WHERE token_hash=?").run(tokenHash);
  }

  findInboundByKey(routeId: string, key: string): Inbound | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbounds WHERE route_id=? AND adapter_message_key=?")
      .get(routeId, key) as Record<string, string | number | null> | undefined;
    return row ? this.mapInbound(row) : undefined;
  }

  insertInbound(i: Inbound, payloadText: string, createdAt: number): void {
    this.db
      .prepare(
        `INSERT INTO inbounds(inbound_id, adapter_message_key, route_id, binding_revision, body_kind, redacted_digest, state, dsh_message_id, payload_text, created_at, dispatch_mode)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        i.inboundId,
        i.adapterMessageKey,
        i.routeId,
        i.bindingRevision,
        i.bodyKind,
        i.redactedDigest,
        i.state,
        i.dshMessageId ?? null,
        payloadText,
        createdAt,
        i.dispatchMode ?? "followup",
      );
  }

  setInboundState(inboundId: string, state: InboundState, dshMessageId?: string): void {
    if (dshMessageId) {
      this.db.prepare("UPDATE inbounds SET state=?, dsh_message_id=? WHERE inbound_id=?").run(state, dshMessageId, inboundId);
    } else {
      this.db.prepare("UPDATE inbounds SET state=? WHERE inbound_id=?").run(state, inboundId);
    }
  }

  setInboundPayloadAndState(
    inboundId: string,
    payloadText: string,
    redactedDigest: string,
    state: InboundState,
    dshMessageId?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE inbounds SET payload_text=?, redacted_digest=?, state=?,
         dsh_message_id=COALESCE(?, dsh_message_id) WHERE inbound_id=?`,
      )
      .run(payloadText, redactedDigest, state, dshMessageId ?? null, inboundId);
  }

  getInbound(inboundId: string): Inbound | undefined {
    const row = this.db.prepare("SELECT * FROM inbounds WHERE inbound_id=?").get(inboundId) as
      | Record<string, string | number | null>
      | undefined;
    return row ? this.mapInbound(row) : undefined;
  }

  getInboundPayloadText(inboundId: string): string | undefined {
    const row = this.db.prepare("SELECT payload_text FROM inbounds WHERE inbound_id=?").get(inboundId) as
      | { payload_text: string | null }
      | undefined;
    return row?.payload_text ?? undefined;
  }

  inboundByDshMessage(dshMessageId: string): Inbound | undefined {
    const row = this.db.prepare("SELECT * FROM inbounds WHERE dsh_message_id=?").get(dshMessageId) as
      | Record<string, string | number | null>
      | undefined;
    return row ? this.mapInbound(row) : undefined;
  }

  queuedForRoute(routeId: string): Inbound[] {
    const rows = this.db
      .prepare("SELECT * FROM inbounds WHERE route_id=? AND state IN ('queued','claimed','running') ORDER BY created_at ASC")
      .all(routeId) as Record<string, string | number | null>[];
    return rows.map((r) => this.mapInbound(r));
  }

  queuedUnclaimed(routeId: string): Inbound[] {
    const rows = this.db
      .prepare("SELECT * FROM inbounds WHERE route_id=? AND state='queued' ORDER BY created_at ASC")
      .all(routeId) as Record<string, string | number | null>[];
    return rows.map((r) => this.mapInbound(r));
  }

  putCorrelation(c: TurnCorrelation): void {
    this.db
      .prepare(
        `INSERT INTO correlations(inbound_id, dsh_message_id, turn_id, session_id, route_id, binding_revision)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(c.inboundId, c.dshMessageId, c.turnId, c.sessionId, c.routeId, c.bindingRevision);
  }

  correlationByDshMessage(dshMessageId: string): TurnCorrelation | undefined {
    const row = this.db.prepare("SELECT * FROM correlations WHERE dsh_message_id=?").get(dshMessageId) as
      | Record<string, string | number>
      | undefined;
    return row ? this.mapCorr(row) : undefined;
  }

  correlationByTurn(sessionId: string, turnId: string): TurnCorrelation | undefined {
    const row = this.db
      .prepare("SELECT * FROM correlations WHERE session_id=? AND turn_id=?")
      .get(sessionId, turnId) as Record<string, string | number> | undefined;
    return row ? this.mapCorr(row) : undefined;
  }

  nextOutboxSeq(routeId: string): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS m FROM outbox WHERE route_id=?").get(routeId) as {
      m: number;
    };
    return Number(row.m) + 1;
  }

  insertOutbox(item: OutboxItem): void {
    this.db
      .prepare(
        `INSERT INTO outbox(outbox_id, route_id, inbound_id, turn_id, sequence, payload_kind, payload_ref, payload_text, state, attempts, next_attempt_at, fragment_index, fragment_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        item.outboxId,
        item.routeId,
        item.inboundId,
        item.turnId,
        item.sequence,
        item.payloadKind,
        item.payloadRef,
        item.payloadText,
        item.state,
        item.attempts,
        item.nextAttemptAt,
        item.fragmentIndex,
        item.fragmentCount,
      );
  }

  pendingOutbox(routeId: string): OutboxItem[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM outbox WHERE route_id=? AND state IN ('pending','retryable','claimed','sending','uncertain') ORDER BY sequence ASC",
      )
      .all(routeId) as Record<string, string | number>[];
    return rows.map((r) => this.mapOutbox(r));
  }

  claimOutbox(input: {
    outboxId: string;
    workerId: string;
    now: number;
    leaseMs?: number;
  }): OutboxItem | undefined {
    const existing = this.getOutbox(input.outboxId);
    if (
      existing?.state === "claimed" &&
      existing.workerId === input.workerId &&
      existing.claimToken &&
      (existing.leaseUntil ?? 0) > input.now
    ) {
      return existing;
    }
    const leaseUntil = input.now + (input.leaseMs ?? 15_000);
    const claimToken = randomBytes(16).toString("hex");
    const result = this.db
      .prepare(
        `UPDATE outbox
            SET state='claimed', worker_id=?, lease_until=?, claim_token=?
          WHERE outbox_id=?
            AND state IN ('pending','retryable','uncertain')
            AND (lease_until IS NULL OR lease_until=0 OR lease_until < ?)`,
      )
      .run(input.workerId, leaseUntil, claimToken, input.outboxId, input.now);
    if (!Number(result.changes)) return undefined;
    return this.getOutbox(input.outboxId);
  }

  setOutboxState(
    outboxId: string,
    state: OutboxState,
    attempts: number,
    nextAttemptAt: number,
    extra?: { workerId?: string; expectedStates?: readonly OutboxState[]; claimToken?: string },
  ): boolean {
    const current = this.getOutbox(outboxId);
    if (current?.state === "delivered" || current?.state === "dead") return false;
    const expected = extra?.expectedStates;
    if (extra?.claimToken) {
      const placeholders = (expected?.length ? expected : ["claimed", "sending", "uncertain"]).map(() => "?").join(",");
      const result = this.db
        .prepare(
          `UPDATE outbox SET state=?, attempts=?, next_attempt_at=?${
            extra.workerId ? ", worker_id=?" : ""
          } WHERE outbox_id=? AND claim_token=? AND state IN (${placeholders})`,
        )
        .run(
          ...(extra.workerId
            ? [state, attempts, nextAttemptAt, extra.workerId, outboxId, extra.claimToken, ...(expected ?? ["claimed", "sending", "uncertain"])]
            : [state, attempts, nextAttemptAt, outboxId, extra.claimToken, ...(expected ?? ["claimed", "sending", "uncertain"])]),
        );
      return Number(result.changes) > 0;
    }
    if (expected?.length) {
      const placeholders = expected.map(() => "?").join(",");
      const result = this.db
        .prepare(
          `UPDATE outbox SET state=?, attempts=?, next_attempt_at=?${
            extra?.workerId ? ", worker_id=?" : ""
          } WHERE outbox_id=? AND state IN (${placeholders})`,
        )
        .run(
          ...(extra?.workerId
            ? [state, attempts, nextAttemptAt, extra.workerId, outboxId, ...expected]
            : [state, attempts, nextAttemptAt, outboxId, ...expected]),
        );
      return Number(result.changes) > 0;
    }
    this.db
      .prepare("UPDATE outbox SET state=?, attempts=?, next_attempt_at=? WHERE outbox_id=?")
      .run(state, attempts, nextAttemptAt, outboxId);
    return true;
  }

  getOutbox(outboxId: string): OutboxItem | undefined {
    const row = this.db.prepare("SELECT * FROM outbox WHERE outbox_id=?").get(outboxId) as
      | Record<string, string | number>
      | undefined;
    return row ? this.mapOutbox(row) : undefined;
  }

  outboxForInbound(inboundId: string): OutboxItem[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM outbox WHERE inbound_id=? ORDER BY fragment_index ASC",
      )
      .all(inboundId) as Record<string, string | number>[];
    return rows.map((r) => this.mapOutbox(r));
  }

  latestUserInboundAt(routeId: string): number | undefined {
    const row = this.db
      .prepare(
        "SELECT MAX(created_at) AS at FROM inbounds WHERE route_id=? AND body_kind='text'",
      )
      .get(routeId) as { at: number | null };
    return row.at === null ? undefined : Number(row.at);
  }

  audit(event: string, payload: Record<string, unknown>, ts: number): void {
    this.db.prepare("INSERT INTO audit(ts, event, payload_json) VALUES (?,?,?)").run(ts, event, JSON.stringify(payload));
  }

  listAudit(): Array<{ event: string; payload: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT event, payload_json FROM audit ORDER BY ts ASC").all() as Array<{
      event: string;
      payload_json: string;
    }>;
    return rows.map((row) => ({
      event: row.event,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  getGuard(routeId: string): { pairingAttempts: number; pairingLockedUntil: number; rateWindowStart: number; rateCount: number } {
    const row = this.db.prepare("SELECT * FROM route_guards WHERE route_id=?").get(routeId) as
      | Record<string, number | string>
      | undefined;
    if (!row) {
      return { pairingAttempts: 0, pairingLockedUntil: 0, rateWindowStart: 0, rateCount: 0 };
    }
    return {
      pairingAttempts: Number(row.pairing_attempts),
      pairingLockedUntil: Number(row.pairing_locked_until),
      rateWindowStart: Number(row.rate_window_start),
      rateCount: Number(row.rate_count),
    };
  }

  putGuard(
    routeId: string,
    guard: { pairingAttempts: number; pairingLockedUntil: number; rateWindowStart: number; rateCount: number },
  ): void {
    this.db
      .prepare(
        `INSERT INTO route_guards(route_id, pairing_attempts, pairing_locked_until, rate_window_start, rate_count)
         VALUES (?,?,?,?,?)
         ON CONFLICT(route_id) DO UPDATE SET
           pairing_attempts=excluded.pairing_attempts,
           pairing_locked_until=excluded.pairing_locked_until,
           rate_window_start=excluded.rate_window_start,
           rate_count=excluded.rate_count`,
      )
      .run(routeId, guard.pairingAttempts, guard.pairingLockedUntil, guard.rateWindowStart, guard.rateCount);
  }

  recoverSendingToRetryable(): number {
    const res = this.db.prepare("UPDATE outbox SET state='retryable' WHERE state='sending'").run();
    return Number(res.changes ?? 0);
  }

  queuedWithoutDshId(): Inbound[] {
    const rows = this.db
      .prepare("SELECT * FROM inbounds WHERE state='queued' AND (dsh_message_id IS NULL OR dsh_message_id='')")
      .all() as Record<string, string | number | null>[];
    return rows.map((r) => this.mapInbound(r));
  }

  hasOutboxFor(inboundId: string): boolean {
    const row = this.db.prepare("SELECT 1 AS c FROM outbox WHERE inbound_id=? LIMIT 1").get(inboundId) as
      | { c: number }
      | undefined;
    return Boolean(row);
  }

  listRoutes(): Route[] {
    const rows = this.db.prepare("SELECT * FROM routes").all() as Record<string, string>[];
    return rows
      .filter((row) => (ROUTE_ADAPTERS as readonly string[]).includes(String(row.adapter)))
      .map((row) => this.mapRoute(row));
  }

  listActiveBindings(): Binding[] {
    const rows = this.db.prepare("SELECT * FROM bindings WHERE status='active'").all() as Record<string, string | number>[];
    return rows.map((row) => ({
      routeId: String(row.route_id),
      workspaceIdentity: String(row.workspace_identity),
      sessionId: String(row.session_id),
      revision: Number(row.revision),
      status: "active" as const,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  deadOutbox(): OutboxItem[] {
    const rows = this.db.prepare("SELECT * FROM outbox WHERE state='dead' ORDER BY sequence ASC").all() as Record<
      string,
      string | number
    >[];
    return rows.map((r) => this.mapOutbox(r));
  }

  schemaVersion(): number {
    const row = this.db.prepare("SELECT version FROM schema_meta").get() as { version: number };
    return Number(row.version);
  }

  private str(row: Record<string, string | number | null>, key: string): string {
    return String(row[key] ?? "");
  }

  redactExpiredPayloads(now = Date.now(), ttlMs = CONFIG.imBodyRetentionMs): { inbounds: number; outbox: number } {
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 0) {
      throw new PenglaiError("INVALID_INPUT", "retention window");
    }
    const cutoff = now - ttlMs;
    const inbound = this.db
      .prepare(
        `UPDATE inbounds SET payload_text=NULL
         WHERE created_at < ? AND payload_text IS NOT NULL AND payload_text != ''`,
      )
      .run(cutoff);
    const outbox = this.db
      .prepare(
        `UPDATE outbox SET payload_text=''
         WHERE payload_text != ''
           AND inbound_id IN (SELECT inbound_id FROM inbounds WHERE created_at < ?)`,
      )
      .run(cutoff);
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      /* :memory: and some volumes have no WAL to truncate */
    }
    return { inbounds: Number(inbound.changes ?? 0), outbox: Number(outbox.changes ?? 0) };
  }

  private mapRoute(row: Record<string, string>): Route {
    return {
      routeId: String(row.route_id ?? ""),
      adapter: parseClosedEnum(row.adapter, ROUTE_ADAPTERS, "ROUTE_ADAPTER"),
      accountRef: String(row.account_ref ?? ""),
      peerRef: String(row.peer_ref ?? ""),
      status: parseClosedEnum(row.status, ROUTE_STATUSES, "ROUTE_STATUS"),
    };
  }

  private mapInbound(row: Record<string, string | number | null>): Inbound {
    return {
      inboundId: this.str(row, "inbound_id"),
      adapterMessageKey: this.str(row, "adapter_message_key"),
      routeId: this.str(row, "route_id"),
      bindingRevision: Number(row.binding_revision ?? 0),
      bodyKind: parseClosedEnum(this.str(row, "body_kind"), BODY_KINDS, "BODY_KIND"),
      redactedDigest: this.str(row, "redacted_digest"),
      state: parseClosedEnum(this.str(row, "state"), INBOUND_STATES, "INBOUND_STATE"),
      ...(row.dsh_message_id ? { dshMessageId: String(row.dsh_message_id) } : {}),
      dispatchMode: parseClosedEnum(row.dispatch_mode ?? "followup", DISPATCH_MODES, "DISPATCH_MODE"),
    };
  }

  private mapCorr(row: Record<string, string | number>): TurnCorrelation {
    return {
      inboundId: String(row.inbound_id),
      dshMessageId: String(row.dsh_message_id),
      turnId: String(row.turn_id),
      sessionId: String(row.session_id),
      routeId: String(row.route_id),
      bindingRevision: Number(row.binding_revision),
    };
  }

  private mapOutbox(row: Record<string, string | number>): OutboxItem {
    return {
      outboxId: String(row.outbox_id),
      routeId: String(row.route_id),
      inboundId: String(row.inbound_id),
      turnId: String(row.turn_id),
      sequence: Number(row.sequence),
      payloadKind: parseClosedEnum(row.payload_kind, PAYLOAD_KINDS, "OUTBOX_PAYLOAD_KIND"),
      payloadRef: String(row.payload_ref),
      payloadText: String(row.payload_text),
      state: parseClosedEnum(row.state, OUTBOX_STATES, "OUTBOX_STATE"),
      attempts: Number(row.attempts),
      nextAttemptAt: Number(row.next_attempt_at),
      ...(row.worker_id ? { workerId: String(row.worker_id) } : {}),
      ...(row.lease_until !== undefined ? { leaseUntil: Number(row.lease_until) } : {}),
      ...(row.vendor_idempotency_key ? { vendorIdempotencyKey: String(row.vendor_idempotency_key) } : {}),
      ...(row.claim_token ? { claimToken: String(row.claim_token) } : {}),
      fragmentIndex: Number(row.fragment_index),
      fragmentCount: Number(row.fragment_count),
    };
  }

  private mapVoiceJob(row: Record<string, string | number | null>): VoiceJob {
    return {
      inboundId: this.str(row, "inbound_id"),
      adapter: parseClosedEnum(this.str(row, "adapter"), VOICE_ADAPTERS, "VOICE_ADAPTER"),
      mediaRefJson: this.str(row, "media_ref_json"),
      durationMs: Number(row.duration_ms),
      ...(row.expected_bytes === null ? {} : { expectedBytes: Number(row.expected_bytes) }),
      state: parseClosedEnum(this.str(row, "state"), VOICE_JOB_STATES, "VOICE_JOB_STATE"),
      ...(row.audio_digest ? { audioDigest: String(row.audio_digest) } : {}),
      ...(row.error_class ? { errorClass: String(row.error_class) } : {}),
      ...(row.asr_language ? { asrLanguage: String(row.asr_language) } : {}),
      ...(row.asr_emotion ? { asrEmotion: String(row.asr_emotion) } : {}),
      updatedAt: Number(row.updated_at),
    };
  }
}
