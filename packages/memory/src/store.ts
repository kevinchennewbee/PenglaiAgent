import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import {
  GLOBAL_L1_MAX_ROWS,
  GLOBAL_L1_MAX_BYTES,
  type MemoryScope,
  type MemoryWrite,
} from "./service.js";

export interface MemoryRow {
  id: number;
  scope: MemoryScope;
  workspaceId: string | null;
  text: string;
  createdAt: string;
}

export interface MemoryAuditRow {
  id: number;
  action: string;
  scope: string;
  workspaceId: string | null;
  receipt: string;
  at: string;
}

const SCHEMA_MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: [
      "CREATE TABLE memory_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, workspace_id TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE INDEX memory_rows_scope ON memory_rows(scope, workspace_id)",
      "CREATE TABLE memory_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, scope TEXT NOT NULL, workspace_id TEXT, receipt TEXT NOT NULL, at TEXT NOT NULL)",
      "INSERT INTO schema_meta(version) VALUES (1)",
    ].join(";\n"),
  },
];

export class MemoryStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)");
    const row = this.db.prepare("SELECT MAX(version) AS v FROM schema_meta").get() as { v: number | null };
    let current = row?.v ?? 0;
    for (const step of SCHEMA_MIGRATIONS) {
      if (step.version <= current) continue;
      this.db.exec(step.sql);
      current = step.version;
    }
  }

  private checkGlobalBudget(addText: string): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS n FROM memory_rows WHERE scope = 'global'").get() as { n: number }
    ).n;
    if (count >= GLOBAL_L1_MAX_ROWS) {
      throw new PenglaiError("INVALID_INPUT", "global L1 row budget");
    }
    const size = (
      this.db.prepare("SELECT COALESCE(SUM(LENGTH(text)), 0) AS s FROM memory_rows WHERE scope = 'global'").get() as {
        s: number;
      }
    ).s;
    if (size + Buffer.byteLength(addText, "utf8") > GLOBAL_L1_MAX_BYTES) {
      throw new PenglaiError("INVALID_INPUT", "global L1 byte budget");
    }
  }

  write(input: MemoryWrite, receipt: string): { ok: true; id: number; viaOfficialSkill?: boolean } {
    if (input.scope === "global" || input.officialSkill) {
      if (!input.ownerConfirmed || !input.visibleDiff) {
        throw new PenglaiError("SECURITY_POLICY", "global/SOP write requires visible diff and Owner confirm");
      }
      if (input.scope === "global") {
        this.checkGlobalBudget(input.text);
      }
    }
    if (input.scope === "workspace" && !input.workspaceId) {
      throw new PenglaiError("INVALID_INPUT", "workspace memory needs workspaceId");
    }
    const at = new Date().toISOString();
    const res = this.db
      .prepare("INSERT INTO memory_rows (scope, workspace_id, text, created_at) VALUES (?, ?, ?, ?)")
      .run(input.scope, input.scope === "workspace" ? input.workspaceId ?? null : null, input.text, at);
    this.audit("write", input.scope, input.scope === "workspace" ? input.workspaceId ?? null : null, receipt, at);
    return { ok: true, id: Number(res.lastInsertRowid), ...(input.officialSkill ? { viaOfficialSkill: true } : {}) };
  }

  list(scope: MemoryScope, workspaceId?: string): MemoryRow[] {
    if (scope === "workspace") {
      if (!workspaceId) throw new PenglaiError("INVALID_INPUT", "workspace memory needs workspaceId");
      return (
        this.db
          .prepare("SELECT id, scope, workspace_id AS workspaceId, text, created_at AS createdAt FROM memory_rows WHERE scope = 'workspace' AND workspace_id = ? ORDER BY id")
          .all(workspaceId) as unknown as MemoryRow[]
      );
    }
    return this.db
      .prepare("SELECT id, scope, workspace_id AS workspaceId, text, created_at AS createdAt FROM memory_rows WHERE scope = ? ORDER BY id")
      .all(scope) as unknown as MemoryRow[];
  }

  readForSession(workspaceId: string | undefined): { global: MemoryRow[]; workspace: MemoryRow[] } {
    const globalRows = this.list("global");
    const workspaceRows = workspaceId ? this.list("workspace", workspaceId) : [];
    return { global: globalRows, workspace: workspaceRows };
  }

  candidates(workspaceId?: string): MemoryRow[] {
    if (workspaceId) {
      return this.db
        .prepare("SELECT id, scope, workspace_id AS workspaceId, text, created_at AS createdAt FROM memory_rows WHERE scope = 'candidate' AND workspace_id = ? ORDER BY id")
        .all(workspaceId) as unknown as MemoryRow[];
    }
    return this.db
      .prepare("SELECT id, scope, workspace_id AS workspaceId, text, created_at AS createdAt FROM memory_rows WHERE scope = 'candidate' ORDER BY id")
      .all() as unknown as MemoryRow[];
  }

  audit(action: string, scope: string, workspaceId: string | null, receipt: string, at = new Date().toISOString()): void {
    this.db
      .prepare("INSERT INTO memory_audit (action, scope, workspace_id, receipt, at) VALUES (?, ?, ?, ?, ?)")
      .run(action, scope, workspaceId, receipt, at);
  }

  get(id: number): MemoryRow | undefined {
    return this.db
      .prepare("SELECT id, scope, workspace_id AS workspaceId, text, created_at AS createdAt FROM memory_rows WHERE id = ?")
      .get(id) as MemoryRow | undefined;
  }

  deleteId(id: number, workspaceId?: string): number {
    const row = this.get(id);
    if (!row) return 0;
    if (row.scope === "workspace" && workspaceId && row.workspaceId !== workspaceId) {
      throw new PenglaiError("SECURITY_POLICY", "memory workspace scope isolation");
    }
    const res = this.db.prepare("DELETE FROM memory_rows WHERE id = ?").run(id);
    this.audit("forget", row.scope, row.workspaceId, `id=${id}`);
    return Number(res.changes);
  }

  deleteScope(scope: MemoryScope, workspaceId?: string): number {
    if (scope === "workspace" && !workspaceId) {
      throw new PenglaiError("INVALID_INPUT", "workspace delete needs workspaceId");
    }
    const res =
      scope === "workspace"
        ? this.db.prepare("DELETE FROM memory_rows WHERE scope = 'workspace' AND workspace_id = ?").run(workspaceId ?? "")
        : this.db.prepare("DELETE FROM memory_rows WHERE scope = ?").run(scope);
    this.audit("delete", scope, scope === "workspace" ? workspaceId ?? null : null, `rows=${Number(res.changes)}`);
    return Number(res.changes);
  }

  close(): void {
    this.db.close();
  }
}
