/**
 * Personal Context V1 store — Host-private SQLite + FTS5.
 * Derived index only; never modifies Owner source files.
 * R2/R3: verified refs are durable rows with lifecycle status.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ContextDocument,
  ContextHit,
  ContextLocation,
  ContextMintRefInput,
  ContextReadResult,
  ContextRefStatus,
  ContextSource,
  ContextSourceStatus,
} from "./types.js";

const CONTEXT_SCHEMA_VERSION = 3;

export interface ContextStoreOptions {
  /** Absolute path to context.db, or ":memory:" for tests. */
  filename: string;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function rowSource(row: Record<string, unknown>): ContextSource {
  return {
    id: String(row.id),
    scopeType: row.scope_type as ContextSource["scopeType"],
    projectId: (row.project_id as string | null) ?? null,
    displayName: String(row.display_name),
    rootPath: String(row.root_path),
    status: row.status as ContextSourceStatus,
    generation: Number(row.generation),
    fileCount: Number(row.file_count ?? 0),
    successCount: Number(row.success_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
    lastError: (row.last_error as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    indexedAt: row.indexed_at == null ? null : Number(row.indexed_at),
  };
}

function parseLocation(raw: string | null | undefined): ContextLocation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ContextLocation;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export class ContextStore {
  private readonly database: DatabaseSync;
  private readonly filename: string;
  private ftsTokenizer: "trigram" | "unicode61" = "trigram";

  constructor(options: ContextStoreOptions) {
    this.filename = options.filename;
    if (options.filename !== ":memory:") {
      const dir = path.dirname(options.filename);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        /* best effort */
      }
    }
    this.database = new DatabaseSync(options.filename);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (options.filename !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = NORMAL");
    }
    this.migrate();
    if (options.filename !== ":memory:") {
      try {
        fs.chmodSync(options.filename, 0o600);
      } catch {
        /* best effort */
      }
    }
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    const current = Number(
      (this.database.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    );
    if (current > CONTEXT_SCHEMA_VERSION) {
      throw new Error(
        `context schema ${current} is newer than supported ${CONTEXT_SCHEMA_VERSION}`,
      );
    }
    if (current === CONTEXT_SCHEMA_VERSION) {
      this.detectFts();
      return;
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (current < 1) {
        this.database.exec(`
          CREATE TABLE context_sources (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project')),
            project_id TEXT,
            display_name TEXT NOT NULL,
            root_path TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            generation INTEGER NOT NULL DEFAULT 0,
            file_count INTEGER NOT NULL DEFAULT 0,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            indexed_at INTEGER
          ) STRICT;
          CREATE TABLE context_documents (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
            generation INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            canonical_path TEXT NOT NULL,
            media_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            title TEXT NOT NULL,
            parse_status TEXT NOT NULL,
            error_code TEXT,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            UNIQUE(source_id, generation, relative_path)
          ) STRICT;
          CREATE TABLE context_chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES context_documents(id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            generation INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            heading_path TEXT,
            text TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            token_estimate INTEGER NOT NULL,
            location_json TEXT,
            UNIQUE(document_id, ordinal)
          ) STRICT;
          CREATE INDEX idx_context_docs_source ON context_documents(source_id, generation);
          CREATE INDEX idx_context_chunks_source ON context_chunks(source_id, generation);
        `);
        this.createFts();
      }
      if (current < 2) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS context_refs (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            title TEXT NOT NULL,
            document_sha256 TEXT NOT NULL,
            chunk_sha256 TEXT NOT NULL,
            location_json TEXT,
            heading_path TEXT,
            episode_id TEXT,
            conversation_id TEXT,
            run_id TEXT,
            created_at INTEGER NOT NULL,
            revoked_at INTEGER
          ) STRICT;
          CREATE INDEX IF NOT EXISTS idx_context_refs_source ON context_refs(source_id);
          CREATE INDEX IF NOT EXISTS idx_context_refs_path ON context_refs(source_id, relative_path);
        `);
      }
      if (current < 3) {
        // R12: structured chunk locations (heading/sheet/row/key path/offset).
        const cols = (
          this.database.prepare("PRAGMA table_info(context_chunks)").all() as Array<{ name: string }>
        ).map((c) => c.name);
        if (!cols.includes("location_json")) {
          this.database.exec(
            `ALTER TABLE context_chunks ADD COLUMN location_json TEXT`,
          );
        }
      }
      this.database.exec(`PRAGMA user_version = ${CONTEXT_SCHEMA_VERSION}`);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.detectFts();
  }

  private createFts(): void {
    try {
      this.database.exec(`
        CREATE VIRTUAL TABLE context_fts USING fts5(
          title,
          relative_path,
          heading_path,
          text,
          chunk_id UNINDEXED,
          document_id UNINDEXED,
          source_id UNINDEXED,
          tokenize='trigram'
        );
      `);
      this.ftsTokenizer = "trigram";
    } catch {
      this.database.exec(`
        CREATE VIRTUAL TABLE context_fts USING fts5(
          title,
          relative_path,
          heading_path,
          text,
          chunk_id UNINDEXED,
          document_id UNINDEXED,
          source_id UNINDEXED,
          tokenize='unicode61'
        );
      `);
      this.ftsTokenizer = "unicode61";
    }
  }

  private detectFts(): void {
    try {
      const row = this.database
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='context_fts'`,
        )
        .get() as { sql?: string } | undefined;
      if (row?.sql?.includes("trigram")) this.ftsTokenizer = "trigram";
      else this.ftsTokenizer = "unicode61";
    } catch {
      this.ftsTokenizer = "unicode61";
    }
  }

  ftsMode(): "trigram" | "unicode61" {
    return this.ftsTokenizer;
  }

  listSources(filter: {
    scopeType?: "global" | "project";
    projectId?: string | null;
  } = {}): ContextSource[] {
    let sql = `SELECT * FROM context_sources WHERE status != 'removed'`;
    const params: string[] = [];
    if (filter.scopeType === "global") {
      sql += ` AND scope_type = 'global'`;
    } else if (filter.projectId) {
      sql += ` AND ((scope_type = 'project' AND project_id = ?) OR scope_type = 'global')`;
      params.push(filter.projectId);
    } else if (filter.scopeType === "project") {
      sql += ` AND scope_type = 'project'`;
    }
    sql += ` ORDER BY created_at ASC`;
    const rows = this.database.prepare(sql).all(...params) as Array<
      Record<string, unknown>
    >;
    return rows.map(rowSource);
  }

  getSource(id: string): ContextSource | null {
    const row = this.database
      .prepare(`SELECT * FROM context_sources WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowSource(row) : null;
  }

  /** Tombstone lookup that includes soft-removed rows (purge/readd path). */
  findRemovedSourceByRoot(rootPath: string): ContextSource | null {
    const row = this.database
      .prepare(
        `SELECT * FROM context_sources WHERE root_path = ? AND status = 'removed' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(rootPath) as Record<string, unknown> | undefined;
    return row ? rowSource(row) : null;
  }

  insertSource(input: {
    scopeType: "global" | "project";
    projectId: string | null;
    displayName: string;
    rootPath: string;
  }): ContextSource {
    const now = Date.now();
    const id = newId("ctxsrc");
    this.database
      .prepare(
        `INSERT INTO context_sources (
          id, scope_type, project_id, display_name, root_path, status,
          generation, file_count, success_count, failure_count, last_error,
          created_at, updated_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, 'indexing', 0, 0, 0, 0, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.scopeType,
        input.projectId,
        input.displayName,
        input.rootPath,
        now,
        now,
      );
    return this.getSource(id)!;
  }

  markIndexing(sourceId: string): void {
    const now = Date.now();
    this.database
      .prepare(
        `UPDATE context_sources SET status = 'indexing', updated_at = ?, last_error = NULL WHERE id = ?`,
      )
      .run(now, sourceId);
  }

  /**
   * Atomically install a new generation of documents/chunks for a source and
   * rebuild FTS rows. Previous generation rows for the source are deleted.
   * Durable context_refs remain and resolve via path/hash identity.
   */
  commitGeneration(input: {
    sourceId: string;
    generation: number;
    documents: Array<{
      id: string;
      relativePath: string;
      canonicalPath: string;
      mediaType: string;
      sizeBytes: number;
      mtimeMs: number;
      sha256: string;
      title: string;
      parseStatus: "ok" | "skipped" | "error";
      errorCode: string | null;
      chunks: Array<{
        id: string;
        ordinal: number;
        headingPath: string | null;
        text: string;
        contentHash: string;
        tokenEstimate: number;
        location?: {
          headingPath?: string | null;
          sheet?: string | null;
          rowStart?: number | null;
          rowEnd?: number | null;
          keyPath?: string | null;
          offsetStart?: number | null;
          offsetEnd?: number | null;
        } | null;
      }>;
    }>;
    fileCount: number;
    successCount: number;
    failureCount: number;
    lastError: string | null;
  }): ContextSource {
    const now = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const oldDocs = this.database
        .prepare(
          `SELECT id FROM context_documents WHERE source_id = ? AND generation != ?`,
        )
        .all(input.sourceId, input.generation) as Array<{ id: string }>;
      for (const doc of oldDocs) {
        this.database
          .prepare(`DELETE FROM context_fts WHERE document_id = ?`)
          .run(doc.id);
      }
      this.database
        .prepare(
          `DELETE FROM context_chunks WHERE source_id = ? AND generation != ?`,
        )
        .run(input.sourceId, input.generation);
      this.database
        .prepare(
          `DELETE FROM context_documents WHERE source_id = ? AND generation != ?`,
        )
        .run(input.sourceId, input.generation);

      for (const doc of input.documents) {
        this.database
          .prepare(
            `INSERT OR REPLACE INTO context_documents (
              id, source_id, generation, relative_path, canonical_path, media_type,
              size_bytes, mtime_ms, sha256, title, parse_status, error_code, chunk_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            doc.id,
            input.sourceId,
            input.generation,
            doc.relativePath,
            doc.canonicalPath,
            doc.mediaType,
            doc.sizeBytes,
            doc.mtimeMs,
            doc.sha256,
            doc.title,
            doc.parseStatus,
            doc.errorCode,
            doc.chunks.length,
          );
        for (const chunk of doc.chunks) {
          this.database
            .prepare(
              `INSERT OR REPLACE INTO context_chunks (
                id, document_id, source_id, generation, ordinal, heading_path,
                text, content_hash, token_estimate, location_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              chunk.id,
              doc.id,
              input.sourceId,
              input.generation,
              chunk.ordinal,
              chunk.headingPath,
              chunk.text,
              chunk.contentHash,
              chunk.tokenEstimate,
              chunk.location ? JSON.stringify(chunk.location) : null,
            );
          this.database
            .prepare(`DELETE FROM context_fts WHERE chunk_id = ?`)
            .run(chunk.id);
          this.database
            .prepare(
              `INSERT INTO context_fts (
                title, relative_path, heading_path, text, chunk_id, document_id, source_id
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              doc.title,
              doc.relativePath,
              chunk.headingPath ?? "",
              chunk.text,
              chunk.id,
              doc.id,
              input.sourceId,
            );
        }
      }

      const status: ContextSourceStatus =
        input.successCount > 0 ? "ready" : input.failureCount > 0 ? "error" : "ready";
      this.database
        .prepare(
          `UPDATE context_sources SET
            status = ?, generation = ?, file_count = ?, success_count = ?,
            failure_count = ?, last_error = ?, updated_at = ?, indexed_at = ?
           WHERE id = ?`,
        )
        .run(
          status,
          input.generation,
          input.fileCount,
          input.successCount,
          input.failureCount,
          input.lastError,
          now,
          now,
          input.sourceId,
        );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getSource(input.sourceId)!;
  }

  /**
   * Soft-remove source: drop derived index/FTS but keep source tombstone and
   * ref rows so resolve can return revoked without body text.
   */
  removeSource(sourceId: string): { removed: boolean; rootPath: string | null } {
    const source = this.getSource(sourceId);
    if (!source || source.status === "removed") {
      return { removed: false, rootPath: source?.rootPath ?? null };
    }
    const now = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`DELETE FROM context_fts WHERE source_id = ?`)
        .run(sourceId);
      this.database
        .prepare(`DELETE FROM context_chunks WHERE source_id = ?`)
        .run(sourceId);
      this.database
        .prepare(`DELETE FROM context_documents WHERE source_id = ?`)
        .run(sourceId);
      this.database
        .prepare(
          `UPDATE context_sources SET status = 'removed', updated_at = ?,
            file_count = 0, success_count = 0, failure_count = 0, last_error = NULL
           WHERE id = ?`,
        )
        .run(now, sourceId);
      this.database
        .prepare(
          `UPDATE context_refs SET revoked_at = COALESCE(revoked_at, ?) WHERE source_id = ?`,
        )
        .run(now, sourceId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { removed: true, rootPath: source.rootPath };
  }

  /**
   * Permanently delete a removed tombstone (no docs/chunks remain after soft
   * remove). Only callable on removed rows; refuses to purge active sources.
   */
  purgeSource(sourceId: string): void {
    const source = this.getSource(sourceId);
    if (!source || source.status !== "removed") {
      throw new Error(`only removed sources can be purged: ${sourceId}`);
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`DELETE FROM context_refs WHERE source_id = ?`)
        .run(sourceId);
      this.database
        .prepare(`DELETE FROM context_sources WHERE id = ?`)
        .run(sourceId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private buildMatchQuery(raw: string): string | null {
    const q = raw.trim();
    if (!q) return null;
    if (this.ftsTokenizer === "trigram") {
      return `"${q.replace(/"/g, '""')}"`;
    }
    const parts: string[] = [];
    const latin = q.match(/[A-Za-z0-9_]+/g) ?? [];
    for (const w of latin) {
      if (w.length >= 2) parts.push(`"${w.replace(/"/g, '""')}"`);
    }
    const cjk = q.replace(/[A-Za-z0-9_\s]+/g, "");
    for (let i = 0; i < cjk.length - 1; i += 1) {
      const bigram = cjk.slice(i, i + 2);
      parts.push(`"${bigram.replace(/"/g, '""')}"`);
    }
    if (parts.length === 0 && q.length === 1) {
      parts.push(`"${q.replace(/"/g, '""')}"`);
    }
    if (parts.length === 0) return null;
    return parts.join(" ");
  }

  search(input: {
    query: string;
    sourceIds: string[];
    limit: number;
  }): ContextHit[] {
    const match = this.buildMatchQuery(input.query);
    if (!match || input.sourceIds.length === 0) return [];
    const rewritten = `
      SELECT
        f.chunk_id AS chunk_id,
        f.document_id AS document_id,
        f.source_id AS source_id,
        f.title AS title,
        f.relative_path AS relative_path,
        f.heading_path AS heading_path,
        f.text AS text,
        c.location_json AS location_json,
        bm25(context_fts, 4.0, 3.0, 2.0, 1.0) AS score,
        d.sha256 AS sha256,
        c.content_hash AS content_hash,
        s.scope_type AS scope_type,
        s.project_id AS project_id
      FROM context_fts f
      JOIN context_documents d ON d.id = f.document_id
      JOIN context_chunks c ON c.id = f.chunk_id
      JOIN context_sources s ON s.id = f.source_id
      WHERE context_fts MATCH ?
        AND f.source_id IN (${input.sourceIds.map(() => "?").join(",")})
        AND s.status != 'removed'
      ORDER BY score
      LIMIT ?
    `;
    let rows: Array<Record<string, unknown>>;
    try {
      rows = this.database
        .prepare(rewritten)
        .all(match, ...input.sourceIds, input.limit) as Array<
        Record<string, unknown>
      >;
    } catch {
      return [];
    }
    return rows.map((row) => {
      const headingPath = (row.heading_path as string) || null;
      const location: ContextLocation | null =
        parseLocation(row.location_json as string | null) ??
        (headingPath ? { headingPath } : null);
      const contextRef = this.mintRef({
        sourceId: String(row.source_id),
        documentId: String(row.document_id),
        chunkId: String(row.chunk_id),
        documentSha256: String(row.sha256),
        chunkSha256: String(row.content_hash),
        relativePath: String(row.relative_path),
        headingPath,
        title: String(row.title),
        location,
      });
      const text = String(row.text ?? "");
      const snippet = text.length > 240 ? `${text.slice(0, 240)}…` : text;
      return {
        contextRef,
        sourceId: String(row.source_id),
        documentId: String(row.document_id),
        chunkId: String(row.chunk_id),
        relativePath: String(row.relative_path),
        title: String(row.title),
        headingPath,
        snippet,
        score: Number(row.score),
        documentSha256: String(row.sha256),
        chunkSha256: String(row.content_hash),
        scopeType: row.scope_type as ContextHit["scopeType"],
        projectId: (row.project_id as string | null) ?? null,
        location,
      };
    });
  }

  mintRef(parts: ContextMintRefInput): string {
    const contextRef = newId("ctxref");
    const now = Date.now();
    const locationJson = parts.location
      ? JSON.stringify(parts.location)
      : parts.headingPath
        ? JSON.stringify({ headingPath: parts.headingPath })
        : null;
    this.database
      .prepare(
        `INSERT INTO context_refs (
          id, source_id, document_id, chunk_id, relative_path, title,
          document_sha256, chunk_sha256, location_json, heading_path,
          episode_id, conversation_id, run_id, created_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        contextRef,
        parts.sourceId,
        parts.documentId,
        parts.chunkId,
        parts.relativePath,
        parts.title,
        parts.documentSha256,
        parts.chunkSha256,
        locationJson,
        parts.headingPath,
        parts.episodeId ?? null,
        parts.conversationId ?? null,
        parts.runId ?? null,
        now,
      );
    return contextRef;
  }

  /**
   * F6: batch lifecycle status for many durable refs (no N+1).
   * Returns a status for every input id; unknown ids map to "unknown".
   */
  resolveRefStatuses(contextRefs: string[]): Map<string, ContextRefStatus> {
    const result = new Map<string, ContextRefStatus>();
    const unique = [
      ...new Set(
        contextRefs.filter((id) => typeof id === "string" && id.length > 0),
      ),
    ];
    for (const id of unique) result.set(id, "unknown");
    if (unique.length === 0) return result;

    const placeholders = unique.map(() => "?").join(",");
    const refRows = this.database
      .prepare(`SELECT * FROM context_refs WHERE id IN (${placeholders})`)
      .all(...unique) as Array<Record<string, unknown>>;
    if (refRows.length === 0) return result;

    const sourceIds = [
      ...new Set(refRows.map((row) => String(row.source_id))),
    ];
    const sourcePlaceholders = sourceIds.map(() => "?").join(",");
    const sourceRows = this.database
      .prepare(
        `SELECT id, status FROM context_sources WHERE id IN (${sourcePlaceholders})`,
      )
      .all(...sourceIds) as Array<Record<string, unknown>>;
    const sourceStatus = new Map(
      sourceRows.map((row) => [String(row.id), String(row.status)]),
    );

    const docRows = this.database
      .prepare(
        `SELECT d.id AS document_id, d.source_id AS source_id,
                d.relative_path AS relative_path, d.sha256 AS sha256
         FROM context_documents d
         JOIN context_sources s ON s.id = d.source_id AND d.generation = s.generation
         WHERE d.source_id IN (${sourcePlaceholders})`,
      )
      .all(...sourceIds) as Array<Record<string, unknown>>;
    const docsByKey = new Map<
      string,
      { documentId: string; sha256: string }
    >();
    for (const row of docRows) {
      docsByKey.set(`${String(row.source_id)}\0${String(row.relative_path)}`, {
        documentId: String(row.document_id),
        sha256: String(row.sha256),
      });
    }

    const documentIds = [...new Set(docRows.map((row) => String(row.document_id)))];
    const chunkHashesByDoc = new Map<string, Set<string>>();
    if (documentIds.length > 0) {
      const docPlaceholders = documentIds.map(() => "?").join(",");
      const chunkRows = this.database
        .prepare(
          `SELECT document_id, content_hash FROM context_chunks
           WHERE document_id IN (${docPlaceholders})`,
        )
        .all(...documentIds) as Array<Record<string, unknown>>;
      for (const row of chunkRows) {
        const docId = String(row.document_id);
        let set = chunkHashesByDoc.get(docId);
        if (!set) {
          set = new Set();
          chunkHashesByDoc.set(docId, set);
        }
        set.add(String(row.content_hash));
      }
    }

    for (const row of refRows) {
      const id = String(row.id);
      if (row.revoked_at != null) {
        result.set(id, "revoked");
        continue;
      }
      const sourceId = String(row.source_id);
      const status = sourceStatus.get(sourceId);
      if (!status || status === "removed") {
        result.set(id, "revoked");
        continue;
      }
      const doc = docsByKey.get(
        `${sourceId}\0${String(row.relative_path)}`,
      );
      if (!doc) {
        result.set(id, "unavailable");
        continue;
      }
      if (doc.sha256 !== String(row.document_sha256)) {
        result.set(id, "stale");
        continue;
      }
      const hashes = chunkHashesByDoc.get(doc.documentId);
      result.set(
        id,
        hashes?.has(String(row.chunk_sha256)) ? "current" : "stale",
      );
    }
    return result;
  }

  /**
   * Resolve a durable ref into lifecycle-aware read result.
   * unknown: no row; revoked: source removed or ref revoked; unavailable: index
   * missing/unreadable; stale: content hash changed; current: match.
   */
  resolveRef(contextRef: string): ContextReadResult | null {
    const ref = this.database
      .prepare(`SELECT * FROM context_refs WHERE id = ?`)
      .get(contextRef) as Record<string, unknown> | undefined;
    if (!ref) return null;

    const sourceId = String(ref.source_id);
    const relativePath = String(ref.relative_path);
    const title = String(ref.title);
    const documentSha256AtMint = String(ref.document_sha256);
    const chunkSha256AtMint = String(ref.chunk_sha256);
    const headingPath = (ref.heading_path as string) || null;
    const location = parseLocation(ref.location_json as string | null) ??
      (headingPath ? { headingPath } : null);
    const documentId = String(ref.document_id);
    const chunkId = String(ref.chunk_id);

    const base = {
      contextRef,
      sourceId,
      documentId,
      chunkId,
      relativePath,
      title,
      headingPath,
      documentSha256: documentSha256AtMint,
      chunkSha256: chunkSha256AtMint,
      location,
    };

    if (ref.revoked_at != null) {
      return {
        ...base,
        text: "",
        status: "revoked" as ContextRefStatus,
        stale: true,
      };
    }

    const source = this.getSource(sourceId);
    if (!source || source.status === "removed") {
      return {
        ...base,
        text: "",
        status: "revoked" as ContextRefStatus,
        stale: true,
      };
    }

    // Prefer exact chunk id if still present in current generation.
    let chunk = this.database
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id AS document_id, c.text AS text,
                c.content_hash AS content_hash, c.heading_path AS heading_path,
                d.sha256 AS sha256, d.title AS title, d.relative_path AS relative_path
         FROM context_chunks c
         JOIN context_documents d ON d.id = c.document_id
         WHERE c.id = ?`,
      )
      .get(chunkId) as Record<string, unknown> | undefined;

    // Stable reindex remap: same source + relative path + (chunk hash or heading).
    if (!chunk) {
      chunk = this.database
        .prepare(
          `SELECT c.id AS chunk_id, c.document_id AS document_id, c.text AS text,
                  c.content_hash AS content_hash, c.heading_path AS heading_path,
                  d.sha256 AS sha256, d.title AS title, d.relative_path AS relative_path
           FROM context_chunks c
           JOIN context_documents d ON d.id = c.document_id
           JOIN context_sources s ON s.id = d.source_id
           WHERE d.source_id = ?
             AND d.relative_path = ?
             AND d.generation = s.generation
             AND c.content_hash = ?
           ORDER BY c.ordinal ASC
           LIMIT 1`,
        )
        .get(sourceId, relativePath, chunkSha256AtMint) as
        | Record<string, unknown>
        | undefined;
    }
    if (!chunk) {
      chunk = this.database
        .prepare(
          `SELECT c.id AS chunk_id, c.document_id AS document_id, c.text AS text,
                  c.content_hash AS content_hash, c.heading_path AS heading_path,
                  d.sha256 AS sha256, d.title AS title, d.relative_path AS relative_path
           FROM context_chunks c
           JOIN context_documents d ON d.id = c.document_id
           JOIN context_sources s ON s.id = d.source_id
           WHERE d.source_id = ?
             AND d.relative_path = ?
             AND d.generation = s.generation
             AND COALESCE(c.heading_path, '') = COALESCE(?, '')
           ORDER BY c.ordinal ASC
           LIMIT 1`,
        )
        .get(sourceId, relativePath, headingPath) as
        | Record<string, unknown>
        | undefined;
    }
    if (!chunk) {
      // Document still exists under path? mark unavailable if gone entirely.
      const doc = this.database
        .prepare(
          `SELECT d.sha256 AS sha256 FROM context_documents d
           JOIN context_sources s ON s.id = d.source_id
           WHERE d.source_id = ? AND d.relative_path = ? AND d.generation = s.generation
           LIMIT 1`,
        )
        .get(sourceId, relativePath) as Record<string, unknown> | undefined;
      if (!doc) {
        return {
          ...base,
          text: "",
          status: "unavailable" as ContextRefStatus,
          stale: true,
        };
      }
      return {
        ...base,
        text: "",
        documentSha256: String(doc.sha256),
        status: "stale" as ContextRefStatus,
        stale: true,
      };
    }

    const currentDocSha = String(chunk.sha256);
    const currentChunkSha = String(chunk.content_hash);
    const text = String(chunk.text ?? "");
    const status: ContextRefStatus =
      currentDocSha === documentSha256AtMint &&
      currentChunkSha === chunkSha256AtMint
        ? "current"
        : "stale";

    return {
      contextRef,
      sourceId,
      documentId: String(chunk.document_id),
      chunkId: String(chunk.chunk_id),
      relativePath: String(chunk.relative_path),
      title: String(chunk.title),
      headingPath: (chunk.heading_path as string) || null,
      text,
      documentSha256: currentDocSha,
      chunkSha256: currentChunkSha,
      location:
        parseLocation(ref.location_json as string | null) ??
        ((chunk.heading_path as string)
          ? { headingPath: String(chunk.heading_path) }
          : null),
      status,
      stale: status === "stale",
    };
  }

  listDocuments(sourceId: string): ContextDocument[] {
    const source = this.getSource(sourceId);
    if (!source) return [];
    const rows = this.database
      .prepare(
        `SELECT * FROM context_documents WHERE source_id = ? AND generation = ? ORDER BY relative_path`,
      )
      .all(sourceId, source.generation) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      sourceId: String(row.source_id),
      relativePath: String(row.relative_path),
      mediaType: String(row.media_type),
      sizeBytes: Number(row.size_bytes),
      mtimeMs: Number(row.mtime_ms),
      sha256: String(row.sha256),
      title: String(row.title),
      parseStatus: row.parse_status as ContextDocument["parseStatus"],
      errorCode: (row.error_code as string | null) ?? null,
      chunkCount: Number(row.chunk_count),
    }));
  }

  /** Test helper — hash util re-export. */
  static hashText(text: string): string {
    return sha256Text(text);
  }

  static newEntityId(prefix: string): string {
    return newId(prefix);
  }
}
