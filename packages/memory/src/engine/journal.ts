import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type JournalStatus = "prepared" | "committed" | "forgotten" | "superseded";

export interface JournalRow {
  id: string;
  scope: "personal" | "workspace";
  workspaceId: string | null;
  content: string;
  contentDigest: string;
  status: JournalStatus;
  source: string;
  tags: string;
  createdAt: string;
  supersededBy: string | null;
}

export function digestContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class MemoryJournal {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_journal (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace_id TEXT,
        content TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        superseded_by TEXT
      );
      CREATE INDEX IF NOT EXISTS memory_journal_scope ON memory_journal(scope, workspace_id, status);
    `);
  }

  upsert(row: JournalRow): void {
    this.db.prepare(
      `INSERT INTO memory_journal(id, scope, workspace_id, content, content_digest, status, source, tags, created_at, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content=excluded.content,
         content_digest=excluded.content_digest,
         status=excluded.status,
         tags=excluded.tags,
         superseded_by=excluded.superseded_by`,
    ).run(
      row.id,
      row.scope,
      row.workspaceId,
      row.content,
      row.contentDigest,
      row.status,
      row.source,
      row.tags,
      row.createdAt,
      row.supersededBy,
    );
  }

  get(id: string): JournalRow | undefined {
    const row = this.db.prepare("SELECT * FROM memory_journal WHERE id = ?").get(id) as
      | Record<string, string | null>
      | undefined;
    return row ? this.map(row) : undefined;
  }

  countActive(scope: "personal" | "workspace", workspaceId?: string): number {
    return this.listActive(scope, workspaceId).length;
  }

  countCommitted(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM memory_journal WHERE status = 'committed'").get() as { n: number }).n;
  }

  listPage(
    scope: "personal" | "workspace",
    workspaceId?: string,
    limit = 50,
    offset = 0,
  ): JournalRow[] {
    const rows = this.listActive(scope, workspaceId);
    return rows.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(200, Math.max(1, limit)));
  }

  queryLibrary(input: {
    q?: string;
    scope?: "personal" | "workspace";
    workspaceId?: string;
    includeForgotten?: boolean;
    limit?: number;
    offset?: number;
  }): { total: number; offset: number; limit: number; rows: JournalRow[] } {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);
    const needle = (input.q ?? "").trim().toLowerCase();
    const statuses = input.includeForgotten ? ["committed", "forgotten", "superseded"] : ["committed"];
    let sql = `SELECT * FROM memory_journal WHERE status IN (${statuses.map(() => "?").join(",")})`;
    const params: Array<string | number> = [...statuses];
    if (input.scope) {
      sql += ` AND scope = ?`;
      params.push(input.scope);
      if (input.scope === "workspace") {
        sql += ` AND workspace_id = ?`;
        params.push(input.workspaceId ?? "");
      }
    } else if (input.workspaceId) {
      sql += ` AND ((scope = 'workspace' AND workspace_id = ?) OR scope = 'personal')`;
      params.push(input.workspaceId);
    }
    const all = (this.db.prepare(sql).all(...params) as Record<string, string | null>[])
      .map((row) => this.map(row))
      .filter((row) => !needle || row.content.toLowerCase().includes(needle) || row.source.toLowerCase().includes(needle) || row.tags.toLowerCase().includes(needle))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { total: all.length, offset, limit, rows: all.slice(offset, offset + limit) };
  }

  listActive(scope: "personal" | "workspace", workspaceId?: string): JournalRow[] {
    if (scope === "personal") {
      return (this.db.prepare("SELECT * FROM memory_journal WHERE scope = 'personal' AND status = 'committed'").all() as Record<string, string | null>[]).map((row) => this.map(row));
    }
    return (
      this.db
        .prepare("SELECT * FROM memory_journal WHERE scope = 'workspace' AND workspace_id = ? AND status = 'committed'")
        .all(workspaceId ?? "") as Record<string, string | null>[]
    ).map((row) => this.map(row));
  }

  mark(id: string, status: JournalStatus, supersededBy?: string): void {
    this.db.prepare("UPDATE memory_journal SET status = ?, superseded_by = COALESCE(?, superseded_by) WHERE id = ?").run(status, supersededBy ?? null, id);
  }

  forgetTombstone(id: string, supersededBy?: string): void {
    this.db
      .prepare(
        "UPDATE memory_journal SET status = 'forgotten', content = '', tags = '', superseded_by = COALESCE(?, superseded_by) WHERE id = ?",
      )
      .run(supersededBy ?? null, id);
  }

  close(): void {
    this.db.close();
  }

  private map(row: Record<string, string | null>): JournalRow {
    return {
      id: String(row.id),
      scope: row.scope === "workspace" ? "workspace" : "personal",
      workspaceId: row.workspace_id ?? null,
      content: String(row.content),
      contentDigest: String(row.content_digest),
      status: row.status as JournalStatus,
      source: String(row.source ?? "user"),
      tags: String(row.tags ?? ""),
      createdAt: String(row.created_at),
      supersededBy: row.superseded_by ?? null,
    };
  }
}
