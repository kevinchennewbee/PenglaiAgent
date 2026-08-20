import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError } from "@penglai/contracts";
import { walkGrant } from "./ingest.js";

export type SourceStatus = "current" | "stale" | "revoked" | "unavailable";

export interface ContextGrant {
  scope: "global" | "workspace";
  workspaceId?: string;
  requestedPath: string;
  realPath: string;
}

export interface SourceCard {
  path: string;
  root: string;
  digest: string;
  indexRevision: number;
  status: SourceStatus;
}

export interface ContextSearchHit extends SourceCard {
  excerpt: string;
}

export interface ContextReadResult extends SourceCard {
  content: string;
  trust: "untrusted-user-authorized-source";
}

const SENSITIVE = [
  /\/\.ssh\b/,
  /\/\.aws\b/,
  /\/\.gnupg\b/,
  /\/\.config\/credentials\b/,
  /\/Library\/Application Support\/Penglai\b/,
  /\/Library\/Keychains\b/,
  /(^|\/)etc\//,
  /(^|[\/\\])credentials([\/\\]|$)/i,
  /\\AppData\\/i,
];

export function assertGrant(grant: ContextGrant): void {
  if (!grant.requestedPath || !grant.realPath) throw new PenglaiError("INVALID_INPUT", "context grant required");
  if (grant.requestedPath !== grant.realPath) throw new PenglaiError("SECURITY_POLICY", "context grant must be realpath");
  if (grant.requestedPath.includes("..") || grant.requestedPath.includes("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "context path escape");
  }
  if (SENSITIVE.some((re) => re.test(grant.realPath))) {
    throw new PenglaiError("SECURITY_POLICY", "context rejects sensitive root");
  }
  if (grant.scope === "workspace" && !grant.workspaceId) {
    throw new PenglaiError("INVALID_INPUT", "workspace grant needs workspaceId");
  }
}

export function hostSourceStatus(opts: {
  granted: boolean;
  exists: boolean;
  digest: string;
  indexedDigest?: string | undefined;
}): SourceStatus {
  if (!opts.granted) return "revoked";
  if (!opts.exists) return "unavailable";
  if (!opts.indexedDigest || opts.indexedDigest !== opts.digest) return "stale";
  return "current";
}

export function revokeDerived(indexExists: boolean): { deletedDerived: boolean; sourceUntouched: true } {
  return { deletedDerived: indexExists, sourceUntouched: true };
}

export interface GrantRow {
  root: string;
  scope: "global" | "workspace";
  workspaceId: string | null;
  revision: number;
}

export interface DocumentRow {
  path: string;
  root: string;
  digest: string;
  body: string;
  revision: number;
}

function currentDigest(path: string): { exists: boolean; digest: string } {
  if (!existsSync(path)) return { exists: false, digest: "" };
  try {
    const info = statSync(path);
    if (!info.isFile()) return { exists: false, digest: "" };
    return { exists: true, digest: createHash("sha256").update(readFileSync(path)).digest("hex") };
  } catch {
    return { exists: false, digest: "" };
  }
}

/**
 * Wrap a user query for FTS5 as quoted phrase literals. FTS5 query syntax
 * (`AND`/`OR`/`NOT`, `*`, `NEAR`, column filters, etc.) is inert inside double
 * quotes, so this prevents FTS query-language injection and forces a plain
 * literal term match.
 */
export function ftsLiteral(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`);
  if (!terms.length) throw new PenglaiError("INVALID_INPUT", "context search query required");
  return terms.join(" ");
}

export class ContextIndex {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_schema (version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS context_grants (
        root TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK(scope IN ('global','workspace')),
        workspace_id TEXT,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        CHECK((scope='global' AND workspace_id IS NULL) OR (scope='workspace' AND length(workspace_id)>0))
      );
      CREATE TABLE IF NOT EXISTS context_documents (
        path TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        digest TEXT NOT NULL,
        body TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        indexed_at TEXT NOT NULL,
        FOREIGN KEY(root) REFERENCES context_grants(root) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS context_documents_root ON context_documents(root);
      CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(path UNINDEXED, root UNINDEXED, body);
    `);
    const version = this.db.prepare("SELECT MAX(version) AS version FROM context_schema").get() as
      | { version: number | null }
      | undefined;
    if (!version?.version) this.db.exec("INSERT INTO context_schema(version) VALUES (1)");
    if (version?.version && version.version > 1) throw new PenglaiError("STORE_CORRUPT", "newer context schema");
  }

  private grantForPath(path: string, workspaceId?: string): GrantRow | undefined {
    // Literal prefix matching instead of `LIKE root || '/%'`, so `%` and `_`
    // inside a grant root cannot act as wildcards and over-match other roots.
    return this.db
      .prepare(
        `SELECT root, scope, workspace_id AS workspaceId, revision
           FROM context_grants
          WHERE (? = root
                 OR (length(?) > length(root)
                     AND substr(?, 1, length(root)) = root
                     AND (substr(?, length(root) + 1, 1) = '/' OR substr(?, length(root) + 1, 1) = '\\')))
            AND (scope = 'global' OR (scope = 'workspace' AND workspace_id = ?))
          ORDER BY length(root) DESC LIMIT 1`,
      )
      .get(path, path, path, path, path, workspaceId ?? null) as GrantRow | undefined;
  }

  putGrant(path: string, digest: string): void {
    assertGrant({ scope: "global", requestedPath: path, realPath: path });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO context_grants(root, scope, workspace_id, revision, created_at)
         VALUES (?, 'global', NULL, 1, ?)
         ON CONFLICT(root) DO UPDATE SET revision=context_grants.revision+1`,
      )
      .run(path, now);
    const revision = (this.db.prepare("SELECT revision FROM context_grants WHERE root=?").get(path) as { revision: number }).revision;
    this.db
      .prepare(
        `INSERT INTO context_documents(path, root, digest, body, bytes, revision, indexed_at)
         VALUES (?, ?, ?, '', 0, ?, ?)
         ON CONFLICT(path) DO UPDATE SET digest=excluded.digest, revision=excluded.revision, indexed_at=excluded.indexed_at`,
      )
      .run(path, path, digest, revision, now);
  }

  indexText(path: string, body: string, digest: string): void {
    const grant = this.grantForPath(path);
    if (!grant) throw new PenglaiError("UNAUTHORIZED", "context index without grant");
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM context_fts WHERE path = ?").run(path);
      this.db
        .prepare(
          `INSERT INTO context_documents(path, root, digest, body, bytes, revision, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET root=excluded.root, digest=excluded.digest, body=excluded.body,
             bytes=excluded.bytes, revision=excluded.revision, indexed_at=excluded.indexed_at`,
        )
        .run(path, grant.root, digest, body, Buffer.byteLength(body), grant.revision, now);
      this.db.prepare("INSERT INTO context_fts(path, root, body) VALUES (?, ?, ?)").run(path, grant.root, body);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  search(query: string, workspaceId?: string): Array<{ path: string }> {
    return this.searchDetailed(query, workspaceId).map((row) => ({ path: row.path }));
  }

  searchDetailed(query: string, workspaceId?: string): ContextSearchHit[] {
    if (!query.trim()) throw new PenglaiError("INVALID_INPUT", "context search query required");
    const match = ftsLiteral(query);
    const rows = this.db
      .prepare(
        `SELECT d.path, d.root, d.digest, d.revision AS indexRevision,
                snippet(context_fts, 2, '', '', ' … ', 24) AS excerpt
           FROM context_fts
           JOIN context_documents d ON d.path = context_fts.path
           JOIN context_grants g ON g.root = d.root
          WHERE context_fts MATCH ?
            AND (g.scope='global' OR (g.scope='workspace' AND g.workspace_id=?))
          ORDER BY rank LIMIT 20`,
      )
      .all(match, workspaceId ?? null) as unknown as Array<{
      path: string;
      root: string;
      digest: string;
      indexRevision: number;
      excerpt: string;
    }>;
    return rows.map((row) => {
      const live = currentDigest(row.path);
      return {
        ...row,
        status: hostSourceStatus({ granted: true, exists: live.exists, digest: live.digest, indexedDigest: row.digest }),
      };
    });
  }

  read(path: string, workspaceId?: string): ContextReadResult {
    const grant = this.grantForPath(path, workspaceId);
    if (!grant) throw new PenglaiError("UNAUTHORIZED", "context read without matching grant");
    const row = this.db
      .prepare("SELECT path, root, digest, body, revision FROM context_documents WHERE path=? AND root=?")
      .get(path, grant.root) as DocumentRow | undefined;
    if (!row) throw new PenglaiError("INVALID_INPUT", "context document not indexed");
    const live = currentDigest(row.path);
    return {
      path: row.path,
      root: row.root,
      digest: row.digest,
      indexRevision: row.revision,
      status: hostSourceStatus({ granted: true, exists: live.exists, digest: live.digest, indexedDigest: row.digest }),
      content: row.body,
      trust: "untrusted-user-authorized-source",
    };
  }

  revoke(path: string): { deletedDerived: boolean; sourceUntouched: true } {
    const grant = this.db.prepare("SELECT root FROM context_grants WHERE root = ?").get(path) as { root: string } | undefined;
    if (grant) return this.revokeRoot(grant.root);
    const had = Boolean(this.db.prepare("SELECT 1 FROM context_documents WHERE path = ?").get(path));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM context_fts WHERE path = ?").run(path);
      this.db.prepare("DELETE FROM context_documents WHERE path = ?").run(path);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return revokeDerived(had);
  }

  card(path: string, fileDigest: string, exists: boolean): SourceStatus {
    const row = this.db
      .prepare("SELECT d.digest FROM context_documents d JOIN context_grants g ON g.root=d.root WHERE d.path=?")
      .get(path) as { digest?: string } | undefined;
    return hostSourceStatus({ granted: Boolean(row), exists, digest: fileDigest, indexedDigest: row?.digest });
  }

  ingestGrant(grant: ContextGrant): { scanned: number; indexed: number; failed: number; skipped: number } {
    const report = walkGrant(grant);
    const previous = this.db.prepare("SELECT revision FROM context_grants WHERE root=?").get(grant.realPath) as
      | { revision: number }
      | undefined;
    const revision = (previous?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO context_grants(root, scope, workspace_id, revision, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(root) DO UPDATE SET scope=excluded.scope, workspace_id=excluded.workspace_id, revision=excluded.revision`,
        )
        .run(grant.realPath, grant.scope, grant.scope === "workspace" ? grant.workspaceId ?? null : null, revision, now);
      this.db.prepare("DELETE FROM context_fts WHERE root=?").run(grant.realPath);
      this.db.prepare("DELETE FROM context_documents WHERE root=?").run(grant.realPath);
      for (const doc of report.docs) {
        this.db
          .prepare(
            "INSERT INTO context_documents(path, root, digest, body, bytes, revision, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(doc.path, grant.realPath, doc.digest, doc.body, doc.bytes, revision, now);
        this.db.prepare("INSERT INTO context_fts(path, root, body) VALUES (?, ?, ?)").run(doc.path, grant.realPath, doc.body);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { scanned: report.scanned, indexed: report.indexed, failed: report.failed, skipped: report.skipped };
  }

  revokeRoot(root: string): { deletedDerived: boolean; sourceUntouched: true } {
    const had = Boolean(this.db.prepare("SELECT 1 FROM context_grants WHERE root=?").get(root));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM context_fts WHERE root=?").run(root);
      this.db.prepare("DELETE FROM context_documents WHERE root=?").run(root);
      this.db.prepare("DELETE FROM context_grants WHERE root=?").run(root);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return revokeDerived(had);
  }

  exportMetadata(): { schema: 1; grants: GrantRow[]; documents: Array<Omit<DocumentRow, "body">> } {
    const grants = this.db
      .prepare("SELECT root, scope, workspace_id AS workspaceId, revision FROM context_grants ORDER BY root")
      .all() as unknown as GrantRow[];
    const documents = this.db
      .prepare("SELECT path, root, digest, revision FROM context_documents ORDER BY path")
      .all() as unknown as Array<Omit<DocumentRow, "body">>;
    return { schema: 1, grants, documents };
  }

  close(): void {
    this.db.close();
  }
}
