import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError, parseClosedEnum } from "@penglai/contracts";
import {
  CANDIDATE_KINDS,
  CANDIDATE_SENSITIVITIES,
  DEFAULT_MEMORY_MODE,
  MEMORY_MODES,
  candidateDedupKey,
  cannotAutoPersonalize,
  classifyMemoryText,
  estimateTokens,
  isEphemeralFact,
  isUntrustedInjection,
  refuseProhibitedCandidate,
  type CandidateKind,
  type MemoryMode,
} from "./governance.js";

export const CANDIDATE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const RECALL_MAX_ITEMS = 20;
export const RECALL_MAX_TOKENS = 2048;

export interface MemoryCandidateV1 {
  schema: 1;
  candidateId: string;
  workspaceId: string;
  sessionId: string;
  turnId: string;
  kind: CandidateKind;
  text: string;
  rationale: string;
  sensitivity: "normal" | "sensitive" | "prohibited";
  confidence: number;
  dedupKey: string;
  sourceDigest: string;
  status: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  createdAt: string;
  expiresAt: string;
}

export interface RecallItem {
  id: string;
  scope: "workspace" | "personal";
  text: string;
  sourceDigest: string;
}

export class MemoryV2Store {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(path: string, opts?: { now?: () => number }) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_mode (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL);
      INSERT OR IGNORE INTO memory_mode(id, mode) VALUES (1, '${DEFAULT_MEMORY_MODE}');
      CREATE TABLE IF NOT EXISTS candidates (
        candidate_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        rationale TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        confidence REAL NOT NULL,
        dedup_key TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        conflict INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS candidates_turn ON candidates(session_id, turn_id, source_digest, dedup_key);
      CREATE TABLE IF NOT EXISTS processed_turns (
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id, source_digest)
      );
      CREATE TABLE IF NOT EXISTS negatives (
        digest TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recalls (
        recall_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        used INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tombstones (
        id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        forgotten_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.now = opts?.now ?? Date.now;
  }

  close(): void {
    this.db.close();
  }

  mode(): MemoryMode {
    const row = this.db.prepare(`SELECT mode FROM memory_mode WHERE id = 1`).get() as { mode: string };
    return parseClosedEnum(row.mode, MEMORY_MODES, "MEMORY_MODE", "SECURITY_POLICY");
  }

  setMode(mode: string): MemoryMode {
    const next = parseClosedEnum(mode, MEMORY_MODES, "MEMORY_MODE", "SECURITY_POLICY");
    this.db.prepare(`UPDATE memory_mode SET mode = ? WHERE id = 1`).run(next);
    return next;
  }

  enqueue(input: {
    workspaceId: string;
    sessionId: string;
    turnId: string;
    kind: string;
    text: string;
    rationale: string;
    confidence: number;
    sourceDigest: string;
  }): MemoryCandidateV1 | { skipped: true; reason: string } {
    if (this.mode() === "off") return { skipped: true, reason: "MEMORY_MODE_OFF" };
    if (!input.workspaceId || !input.sessionId || !input.turnId) {
      throw new PenglaiError("INVALID_INPUT", "MEMORY_CANDIDATE_TURN");
    }
    const digest = input.sourceDigest.replace(/^sha256:/, "");
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new PenglaiError("SECURITY_POLICY", "MEMORY_SOURCE_DIGEST");
    const storedDigest = `sha256:${digest}`;
    const existing = this.db
      .prepare(
        `SELECT candidate_id FROM candidates WHERE session_id = ? AND turn_id = ? AND (source_digest = ? OR source_digest = ?) AND text = ?`,
      )
      .get(input.sessionId, input.turnId, digest, storedDigest, input.text.trim()) as { candidate_id: string } | undefined;
    if (existing) return { skipped: true, reason: "MEMORY_CANDIDATE_DUP_TURN" };
    if (isUntrustedInjection(input.text)) return { skipped: true, reason: "MEMORY_UNTRUSTED_SOURCE" };
    const sensitivity = classifyMemoryText(input.text);
    if (sensitivity === "prohibited") return { skipped: true, reason: "MEMORY_CANDIDATE_PROHIBITED" };
    const kind = parseClosedEnum(input.kind, CANDIDATE_KINDS, "MEMORY_KIND", "SECURITY_POLICY");
    parseClosedEnum(sensitivity, CANDIDATE_SENSITIVITIES, "MEMORY_SENSITIVITY", "SECURITY_POLICY");
    if (isEphemeralFact(input.text)) return { skipped: true, reason: "MEMORY_EPHEMERAL" };
    const negative = this.db
      .prepare(`SELECT digest FROM negatives WHERE digest = ? AND workspace_id = ? AND expires_at > ?`)
      .get(digest, input.workspaceId, this.now()) as { digest: string } | undefined;
    if (negative) return { skipped: true, reason: "MEMORY_NEGATIVE" };
    const createdAt = this.now();
    const row: MemoryCandidateV1 = {
      schema: 1,
      candidateId: randomUUID(),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      kind,
      text: input.text.trim(),
      rationale: input.rationale.trim().slice(0, 500),
      sensitivity,
      confidence: input.confidence,
      dedupKey: candidateDedupKey({
        workspaceId: input.workspaceId,
        kind,
        text: input.text,
        sourceDigest: digest,
      }),
      sourceDigest: `sha256:${digest}`,
      status: "pending",
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + CANDIDATE_TTL_MS).toISOString(),
    };
    this.db.prepare(
      `INSERT INTO candidates(
        candidate_id, workspace_id, session_id, turn_id, kind, text, rationale, sensitivity,
        confidence, dedup_key, source_digest, status, conflict, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      row.candidateId,
      row.workspaceId,
      row.sessionId,
      row.turnId,
      row.kind,
      row.text,
      row.rationale,
      row.sensitivity,
      row.confidence,
      row.dedupKey,
      row.sourceDigest,
      row.status,
      createdAt,
      createdAt + CANDIDATE_TTL_MS,
    );
    this.markConflicts(row.workspaceId, row.kind, row.candidateId);
    return row;
  }

  listCandidates(workspaceId: string): MemoryCandidateV1[] {
    this.expire();
    const rows = this.db
      .prepare(`SELECT * FROM candidates WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at DESC`)
      .all(workspaceId) as Array<Record<string, string | number>>;
    return rows.map((row) => this.map(row));
  }

  getCandidate(candidateId: string): MemoryCandidateV1 | undefined {
    this.expire();
    const raw = this.db.prepare(`SELECT * FROM candidates WHERE candidate_id = ?`).get(candidateId) as
      | Record<string, string | number>
      | undefined;
    return raw ? this.map(raw) : undefined;
  }

  decide(
    candidateId: string,
    status: "accepted" | "rejected",
    opts?: { personal?: boolean; actionId?: string },
  ): MemoryCandidateV1 {
    this.expire();
    const raw = this.db.prepare(`SELECT * FROM candidates WHERE candidate_id = ?`).get(candidateId) as
      | Record<string, string | number>
      | undefined;
    if (!raw) throw new PenglaiError("INVALID_INPUT", "MEMORY_CANDIDATE_MISSING");
    const row = this.map(raw);
    if (row.status !== "pending") throw new PenglaiError("SECURITY_POLICY", "MEMORY_CANDIDATE_STATE");
    if (status === "accepted") refuseProhibitedCandidate(row.text);
    if (opts?.personal) {
      if (!opts.actionId || !/^[0-9a-f-]{36}$/i.test(opts.actionId)) {
        throw new PenglaiError("SECURITY_POLICY", "MEMORY_PERSONAL_RECEIPT");
      }
      if (cannotAutoPersonalize(row.text)) {
        throw new PenglaiError("SECURITY_POLICY", "MEMORY_PERSONAL_NOT_INFERRED");
      }
    }
    this.db.prepare(`UPDATE candidates SET status = ? WHERE candidate_id = ?`).run(status, candidateId);
    if (status === "rejected") {
      this.db.prepare(`INSERT OR REPLACE INTO negatives(digest, workspace_id, expires_at) VALUES (?, ?, ?)`).run(
        row.sourceDigest.replace(/^sha256:/, ""),
        row.workspaceId,
        this.now() + CANDIDATE_TTL_MS,
      );
    }
    return { ...row, status };
  }

  autoAcceptEligible(workspaceId: string): MemoryCandidateV1[] {
    if (this.mode() !== "auto-workspace") return [];
    const accepted: MemoryCandidateV1[] = [];
    for (const row of this.listCandidates(workspaceId)) {
      if (classifyMemoryText(row.text) !== "normal") continue;
      if (row.sensitivity !== "normal") continue;
      if (cannotAutoPersonalize(row.text) || isEphemeralFact(row.text)) continue;
      accepted.push(this.decide(row.candidateId, "accepted"));
    }
    return accepted;
  }

  recallSet(input: { workspaceId: string; confirmed: RecallItem[] }): {
    items: RecallItem[];
    used: number;
    tokens: number;
  } {
    const items: RecallItem[] = [];
    let tokens = 0;
    for (const row of input.confirmed) {
      if (this.isTombstoned(row.id)) continue;
      const next = estimateTokens(row.text);
      if (items.length >= RECALL_MAX_ITEMS || tokens + next > RECALL_MAX_TOKENS) break;
      items.push(row);
      tokens += next;
    }
    this.db.prepare(`INSERT INTO recalls(recall_id, workspace_id, used, created_at) VALUES (?, ?, ?, ?)`).run(
      randomUUID(),
      input.workspaceId,
      items.length,
      this.now(),
    );
    return { items, used: items.length, tokens };
  }

  recordTombstone(id: string, digest: string): void {
    const hex = digest.replace(/^sha256:/, "");
    if (!id || !/^[0-9a-f]{64}$/.test(hex)) throw new PenglaiError("INVALID_INPUT", "MEMORY_TOMBSTONE");
    this.db.prepare(`INSERT OR REPLACE INTO tombstones(id, digest, forgotten_at) VALUES (?, ?, ?)`).run(
      id,
      hex,
      this.now(),
    );
    this.db.prepare(`UPDATE candidates SET status = 'expired' WHERE source_digest = ? OR source_digest = ?`).run(
      hex,
      `sha256:${hex}`,
    );
  }

  isTombstoned(id: string): boolean {
    const row = this.db.prepare(`SELECT id FROM tombstones WHERE id = ?`).get(id) as { id: string } | undefined;
    return Boolean(row);
  }

  listConflicts(workspaceId: string): MemoryCandidateV1[] {
    this.expire();
    const rows = this.db
      .prepare(`SELECT * FROM candidates WHERE workspace_id = ? AND status = 'pending' AND conflict = 1`)
      .all(workspaceId) as Array<Record<string, string | number>>;
    return rows.map((row) => this.map(row));
  }

  meta(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)`).run(key, value);
  }

  turnAlreadyProcessed(sessionId: string, turnId: string, sourceDigest: string): boolean {
    const digest = sourceDigest.replace(/^sha256:/, "");
    const row = this.db
      .prepare(`SELECT turn_id FROM processed_turns WHERE session_id = ? AND turn_id = ? AND source_digest = ?`)
      .get(sessionId, turnId, digest) as { turn_id: string } | undefined;
    return Boolean(row);
  }

  markTurnProcessed(sessionId: string, turnId: string, sourceDigest: string): void {
    const digest = sourceDigest.replace(/^sha256:/, "");
    this.db
      .prepare(`INSERT OR IGNORE INTO processed_turns(session_id, turn_id, source_digest) VALUES (?, ?, ?)`)
      .run(sessionId, turnId, digest);
  }

  lastRecallUsed(workspaceId: string): number {
    const row = this.db
      .prepare(`SELECT used FROM recalls WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(workspaceId) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  private markConflicts(workspaceId: string, kind: string, candidateId: string): void {
    const peers = this.db
      .prepare(
        `SELECT candidate_id FROM candidates WHERE workspace_id = ? AND kind = ? AND status = 'pending' AND candidate_id != ?`,
      )
      .all(workspaceId, kind, candidateId) as Array<{ candidate_id: string }>;
    if (!peers.length) return;
    this.db.prepare(`UPDATE candidates SET conflict = 1 WHERE candidate_id = ?`).run(candidateId);
    for (const peer of peers) {
      this.db.prepare(`UPDATE candidates SET conflict = 1 WHERE candidate_id = ?`).run(peer.candidate_id);
    }
  }

  private expire(): void {
    this.db.prepare(`UPDATE candidates SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).run(this.now());
  }

  private map(row: Record<string, string | number>): MemoryCandidateV1 {
    return {
      schema: 1,
      candidateId: String(row.candidate_id),
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      turnId: String(row.turn_id),
      kind: parseClosedEnum(row.kind, CANDIDATE_KINDS, "MEMORY_KIND", "SECURITY_POLICY"),
      text: String(row.text),
      rationale: String(row.rationale),
      sensitivity: parseClosedEnum(row.sensitivity, CANDIDATE_SENSITIVITIES, "MEMORY_SENSITIVITY", "SECURITY_POLICY"),
      confidence: Number(row.confidence),
      dedupKey: String(row.dedup_key),
      sourceDigest: String(row.source_digest),
      status: String(row.status) as MemoryCandidateV1["status"],
      createdAt: new Date(Number(row.created_at)).toISOString(),
      expiresAt: new Date(Number(row.expires_at)).toISOString(),
    };
  }
}
