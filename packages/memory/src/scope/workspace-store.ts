import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import type { MemoryRecord, MemoryScopeRef, MemoryStatus, MemoryType } from "../engine/protocol.js";
import { GRAPH_NODE_CAP, SEARCH_RESULT_CAP } from "../engine/protocol.js";

export function workspaceHash(workspaceId: string): string {
  return createHash("sha256").update(`penglai-workspace:${workspaceId}`).digest("hex");
}

export function personalDbPath(root: string): string {
  return join(root, "memory", "personal", "mnemon.db");
}

export function workspaceDbPath(root: string, workspaceId: string): string {
  return join(root, "memory", "workspaces", workspaceHash(workspaceId), "mnemon.db");
}

export function ledgerPath(root: string): string {
  return join(root, "memory", "state", "governance-ledger.sqlite3");
}

export function runtimeUserPath(root: string): string {
  return join(root, "memory", "runtime", "USER.md");
}

export function runtimeWorkspacePath(root: string, workspaceId: string): string {
  return join(root, "memory", "runtime", "workspaces", workspaceHash(workspaceId), "MEMORY.md");
}

function toRecord(row: Record<string, unknown>): MemoryRecord {
  const scopeKind = String(row.scope_kind);
  return {
    id: String(row.record_id),
    rowId: Number(row.id),
    type: String(row.type) as MemoryType,
    scope:
      scopeKind === "workspace"
        ? { kind: "workspace", workspaceId: String(row.workspace_id) }
        : { kind: "personal" },
    status: String(row.status) as MemoryStatus,
    text: String(row.text),
    source: {
      kind: String(row.source_kind) as MemoryRecord["source"]["kind"],
      locator: String(row.source_locator),
      digest: String(row.source_digest),
    },
    observedAt: String(row.observed_at),
    ...(row.valid_from ? { validFrom: String(row.valid_from) } : {}),
    ...(row.valid_to ? { validTo: String(row.valid_to) } : {}),
    ...(row.supersedes_id ? { supersedesId: String(row.supersedes_id) } : {}),
    authority: String(row.authority) as MemoryRecord["authority"],
    sensitivity: String(row.sensitivity) as MemoryRecord["sensitivity"],
  };
}

export class IsolatedRecordStore {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        scope_kind TEXT NOT NULL,
        workspace_id TEXT,
        status TEXT NOT NULL,
        text TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        supersedes_id TEXT,
        authority TEXT NOT NULL,
        sensitivity TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_records_status ON memory_records(status);
    `);
  }

  insert(input: Omit<MemoryRecord, "rowId">): MemoryRecord {
    const res = this.db
      .prepare(
        `INSERT INTO memory_records (
          record_id, type, scope_kind, workspace_id, status, text,
          source_kind, source_locator, source_digest, observed_at,
          valid_from, valid_to, supersedes_id, authority, sensitivity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.type,
        input.scope.kind,
        input.scope.kind === "workspace" ? input.scope.workspaceId : null,
        input.status,
        input.text,
        input.source.kind,
        input.source.locator,
        input.source.digest,
        input.observedAt,
        input.validFrom ?? null,
        input.validTo ?? null,
        input.supersedesId ?? null,
        input.authority,
        input.sensitivity,
      );
    return { ...input, rowId: Number(res.lastInsertRowid) };
  }

  getByRecordId(id: string): MemoryRecord | undefined {
    const row = this.db.prepare("SELECT * FROM memory_records WHERE record_id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toRecord(row) : undefined;
  }

  getByRowId(id: number): MemoryRecord | undefined {
    const row = this.db.prepare("SELECT * FROM memory_records WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toRecord(row) : undefined;
  }

  setStatus(id: string, status: MemoryStatus): void {
    const res = this.db.prepare("UPDATE memory_records SET status = ? WHERE record_id = ?").run(status, id);
    if (!res.changes) throw new PenglaiError("INVALID_INPUT", "memory not found");
  }

  activeSearch(query: string): MemoryRecord[] {
    const q = `%${query.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_records WHERE status = 'active' AND lower(text) LIKE ? ORDER BY id LIMIT ${SEARCH_RESULT_CAP}`,
      )
      .all(q) as Record<string, unknown>[];
    return rows.map(toRecord);
  }

  listActive(limit = GRAPH_NODE_CAP): MemoryRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM memory_records WHERE status = 'active' ORDER BY id LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(toRecord);
  }

  listAll(limit = GRAPH_NODE_CAP): MemoryRecord[] {
    const rows = this.db.prepare(`SELECT * FROM memory_records ORDER BY id LIMIT ?`).all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map(toRecord);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM memory_records").get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}

export function newRecordId(): string {
  return `mem_${randomUUID()}`;
}
