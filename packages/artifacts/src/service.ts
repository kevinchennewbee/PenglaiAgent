import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError, parseClosedEnum, readExactRegularFile } from "@penglai/contracts";
import {
  ARTIFACT_KINDS,
  ARTIFACT_LIMITS,
  ARTIFACT_SCOPES,
  ARTIFACT_SOURCES,
  classifyArtifact,
  displayName,
  type ArtifactKind,
  type ArtifactScope,
  type ArtifactSource,
} from "./policy.js";

export interface ArtifactRefV1 {
  schema: 1;
  /** Opaque binding identity. Content identity remains in sha256. */
  id: `artifact:${string}`;
  kind: ArtifactKind;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: `sha256:${string}`;
  source: ArtifactSource;
  scope: ArtifactScope;
  workspaceId?: string;
  sessionId?: string;
  turnId?: string;
  parentArtifactId?: `artifact:${string}`;
  operationDigest?: `sha256:${string}`;
  createdAt: string;
  expiresAt?: string;
}

export interface ArtifactIntake {
  name: string;
  source: ArtifactSource;
  scope?: ArtifactScope;
  workspaceId?: string;
  sessionId?: string;
  turnId?: string;
  parentArtifactId?: string;
  operationDigest?: string;
}

export interface ArtifactReadScope {
  workspaceId?: string;
  sessionId?: string;
  turnId?: string;
}

function fail(message: string): never {
  throw new PenglaiError("SECURITY_POLICY", message);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toRef(row: {
  bindId: string;
  sha256: string;
  kind: string;
  name: string;
  mediaType: string;
  bytes: number;
  source: string;
  scope: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  parentArtifactId?: string | null;
  operationDigest?: string | null;
  createdAt: number;
  expiresAt?: number | null;
}): ArtifactRefV1 {
  return {
    schema: 1,
    id: `artifact:${row.bindId}`,
    kind: parseClosedEnum(row.kind, ARTIFACT_KINDS, "ARTIFACT_KIND", "SECURITY_POLICY"),
    name: row.name,
    mediaType: row.mediaType,
    bytes: row.bytes,
    sha256: `sha256:${row.sha256}`,
    source: parseClosedEnum(row.source, ARTIFACT_SOURCES, "ARTIFACT_SOURCE", "SECURITY_POLICY"),
    scope: parseClosedEnum(row.scope, ARTIFACT_SCOPES, "ARTIFACT_SCOPE", "SECURITY_POLICY"),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.turnId ? { turnId: row.turnId } : {}),
    ...(row.parentArtifactId ? { parentArtifactId: row.parentArtifactId as `artifact:${string}` } : {}),
    ...(row.operationDigest ? { operationDigest: `sha256:${row.operationDigest.replace(/^sha256:/, "")}` as `sha256:${string}` } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.expiresAt ? { expiresAt: new Date(row.expiresAt).toISOString() } : {}),
  };
}

function assertNoPath(ref: ArtifactRefV1): ArtifactRefV1 {
  const blob = JSON.stringify(ref);
  if (blob.includes("/Users/") || blob.includes("/home/") || blob.includes("\\\\") || blob.includes(":\\")) {
    fail("ARTIFACT_PATH_LEAK");
  }
  return ref;
}

export class ArtifactService {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly assertPersist?: (actionId: string) => void;
  private gcRunning = false;
  private maintenanceTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly root: string,
    opts?: { now?: () => number; assertPersist?: (actionId: string) => void },
  ) {
    mkdirSync(join(root, "cas"), { recursive: true, mode: 0o700 });
    mkdirSync(join(root, "staging"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, "artifacts.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        bind_id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        source TEXT NOT NULL,
        scope TEXT NOT NULL,
        workspace_id TEXT,
        session_id TEXT,
        turn_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        persist_action_id TEXT,
        parent_artifact_id TEXT,
        operation_digest TEXT
      );
      CREATE INDEX IF NOT EXISTS artifacts_sha ON artifacts(sha256);
      CREATE INDEX IF NOT EXISTS artifacts_turn ON artifacts(turn_id);
      CREATE INDEX IF NOT EXISTS artifacts_exp ON artifacts(expires_at);
    `);
    this.ensureColumn("parent_artifact_id", "TEXT");
    this.ensureColumn("operation_digest", "TEXT");
    this.now = opts?.now ?? Date.now;
    if (opts?.assertPersist) this.assertPersist = opts.assertPersist;
  }

  close(): void {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = undefined;
    this.db.close();
  }

  startMaintenance(intervalMs = 15 * 60_000): () => void {
    if (!this.maintenanceTimer) {
      const run = () => {
        try { this.gcBounded(); } catch { /* maintenance never blocks product startup */ }
      };
      const initial = setTimeout(run, 0);
      initial.unref?.();
      this.maintenanceTimer = setInterval(run, Math.max(60_000, intervalMs));
      this.maintenanceTimer.unref?.();
    }
    return () => {
      if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    };
  }

  ingestBytes(bytes: Buffer, input: ArtifactIntake): ArtifactRefV1 {
    const name = displayName(input.name);
    const source = parseClosedEnum(input.source, ARTIFACT_SOURCES, "ARTIFACT_SOURCE", "SECURITY_POLICY");
    const scope = parseClosedEnum(input.scope ?? "turn", ARTIFACT_SCOPES, "ARTIFACT_SCOPE", "SECURITY_POLICY");
    if (scope !== "turn" && !input.workspaceId) fail("ARTIFACT_WORKSPACE");
    const classified = classifyArtifact(name, bytes);
    let parentArtifactId: `artifact:${string}` | undefined;
    if (input.parentArtifactId) {
      const parent = this.ref(input.parentArtifactId);
      if ((parent.workspaceId ?? "") !== (input.workspaceId ?? "") || (parent.sessionId ?? "") !== (input.sessionId ?? "")) {
        fail("ARTIFACT_PARENT_SCOPE");
      }
      parentArtifactId = parent.id;
    }
    const operationDigest = input.operationDigest?.replace(/^sha256:/, "").toLowerCase();
    if (operationDigest !== undefined && !/^[0-9a-f]{64}$/.test(operationDigest)) fail("ARTIFACT_OPERATION_DIGEST");
    const digest = sha256Hex(bytes);
    this.assertTurnBudget(input.turnId, bytes.length);
    this.writeCas(digest, bytes);
    return assertNoPath(this.insertBinding({
      sha256: digest,
      kind: classified.kind,
      name,
      mediaType: classified.mediaType,
      bytes: bytes.length,
      source,
      scope,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(parentArtifactId ? { parentArtifactId } : {}),
      ...(operationDigest ? { operationDigest } : {}),
    }));
  }

  ingestPath(absPath: string, input: ArtifactIntake): ArtifactRefV1 {
    if (!absPath || absPath.includes("\0")) fail("ARTIFACT_PATH");
    try {
      const bytes = readExactRegularFile(absPath, ARTIFACT_LIMITS.maxFileBytes);
      return this.ingestBytes(bytes, input);
    } catch (error) {
      if (error instanceof PenglaiError) {
        if (/symlink source/i.test(error.message)) fail("ARTIFACT_SYMLINK");
        if (/byte limit/i.test(error.message)) fail("ARTIFACT_SIZE");
        if (/regular file/i.test(error.message)) fail("ARTIFACT_HANDLE");
        if (/changed/i.test(error.message)) fail("ARTIFACT_TOCTOU");
      }
      throw error;
    }
  }

  ref(id: string): ArtifactRefV1 {
    return assertNoPath(toRef(this.lookup(id)));
  }

  readControlled(id: string, scope: ArtifactReadScope): { name: string; mediaType: string; bytes: Buffer } {
    const row = this.lookup(id);
    if ((row.workspaceId ?? "") !== (scope.workspaceId ?? "")) fail("ARTIFACT_WORKSPACE_MISMATCH");
    if (row.sessionId && row.sessionId !== scope.sessionId) fail("ARTIFACT_SESSION_MISMATCH");
    if (row.turnId && scope.turnId && row.turnId !== scope.turnId) fail("ARTIFACT_TURN_MISMATCH");
    if (row.expiresAt && row.expiresAt <= this.now()) fail("ARTIFACT_EXPIRED");
    const bytes = this.readCas(row.sha256);
    if (sha256Hex(bytes) !== row.sha256) fail("ARTIFACT_CAS_TAMPER");
    return { name: row.name, mediaType: row.mediaType, bytes };
  }

  persist(id: string, scope: "workspace" | "memory-source", proof: { actionId: string }): ArtifactRefV1 {
    parseClosedEnum(scope, ["workspace", "memory-source"] as const, "ARTIFACT_SCOPE", "SECURITY_POLICY");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.actionId)) {
      fail("ARTIFACT_PERSIST_RECEIPT");
    }
    if (!this.assertPersist) fail("ARTIFACT_PERSIST_BROKER");
    this.assertPersist(proof.actionId);
    const row = this.lookup(id);
    if (!row.workspaceId) fail("ARTIFACT_WORKSPACE");
    this.db.prepare(
      `UPDATE artifacts SET scope = ?, expires_at = NULL, persist_action_id = ? WHERE bind_id = ?`,
    ).run(scope, proof.actionId, row.bindId);
    return this.ref(id);
  }

  bindComposerTurn(): never {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "DSH_NO_GENERIC_FILE_TURN_API");
  }

  deleteWorkspace(workspaceId: string): { removed: number; casRemoved: number } {
    if (!workspaceId) fail("ARTIFACT_WORKSPACE");
    const rows = this.db
      .prepare(`SELECT bind_id FROM artifacts WHERE workspace_id = ?`)
      .all(workspaceId) as Array<{ bind_id: string }>;
    for (const row of rows) {
      this.db.prepare(`DELETE FROM artifacts WHERE bind_id = ?`).run(row.bind_id);
    }
    const cleaned = this.gc();
    return { removed: rows.length, casRemoved: cleaned.casRemoved };
  }

  gc(now = this.now()): { removed: number; casRemoved: number } {
    return this.gcBounded({ now, maxBindings: 1_000_000, maxCas: 1_000_000, maxStaging: 1_000_000, budgetMs: 60_000 });
  }

  gcBounded(opts?: { now?: number; maxBindings?: number; maxCas?: number; maxStaging?: number; budgetMs?: number }): { removed: number; casRemoved: number; stagingRemoved: number; skipped: boolean } {
    if (this.gcRunning) return { removed: 0, casRemoved: 0, stagingRemoved: 0, skipped: true };
    this.gcRunning = true;
    const now = opts?.now ?? this.now();
    const deadline = Date.now() + (opts?.budgetMs ?? 50);
    const maxBindings = opts?.maxBindings ?? 128;
    const maxCas = opts?.maxCas ?? 128;
    const maxStaging = opts?.maxStaging ?? 64;
    try {
    const expired = this.db
      .prepare(`SELECT bind_id, sha256 FROM artifacts WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`)
      .all(now, maxBindings) as Array<{ bind_id: string; sha256: string }>;
    let removed = 0;
    for (const row of expired) {
      if (Date.now() > deadline) break;
      this.db.prepare(`DELETE FROM artifacts WHERE bind_id = ?`).run(row.bind_id);
      removed += 1;
    }
    let casRemoved = 0;
    const leftovers = this.db.prepare(`SELECT DISTINCT sha256 FROM artifacts`).all() as Array<{ sha256: string }>;
    const live = new Set(leftovers.map((row) => row.sha256));
    const casRoot = join(this.root, "cas");
    if (existsSync(casRoot)) {
      for (const digest of this.listCasDigests()) {
        if (casRemoved >= maxCas || Date.now() > deadline) break;
        if (!live.has(digest)) {
          rmSync(this.casPath(digest), { force: true });
          casRemoved += 1;
        }
      }
    }
    let stagingRemoved = 0;
    const stagingRoot = join(this.root, "staging");
    if (existsSync(stagingRoot)) {
      for (const entry of readdirSync(stagingRoot, { withFileTypes: true })) {
        if (stagingRemoved >= maxStaging || Date.now() > deadline) break;
        if (!entry.isFile()) continue;
        const target = join(stagingRoot, entry.name);
        try {
          if (now - statSync(target).mtimeMs < 60 * 60_000) continue;
          rmSync(target, { force: true });
          stagingRemoved += 1;
        } catch { /* a concurrent writer owns this path */ }
      }
    }
    return { removed, casRemoved, stagingRemoved, skipped: false };
    } finally {
      this.gcRunning = false;
    }
  }

  private insertBinding(input: {
    sha256: string;
    kind: ArtifactKind;
    name: string;
    mediaType: string;
    bytes: number;
    source: ArtifactSource;
    scope: ArtifactScope;
    workspaceId?: string;
    sessionId?: string;
    turnId?: string;
    parentArtifactId?: `artifact:${string}`;
    operationDigest?: string;
  }): ArtifactRefV1 {
    const createdAt = this.now();
    const expiresAt = input.scope === "turn" ? createdAt + ARTIFACT_LIMITS.turnTtlMs : undefined;
    const bindId = randomUUID();
    this.db.prepare(
      `INSERT INTO artifacts(
        bind_id, sha256, kind, name, media_type, bytes, source, scope,
        workspace_id, session_id, turn_id, created_at, expires_at,
        parent_artifact_id, operation_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bindId,
      input.sha256,
      input.kind,
      input.name,
      input.mediaType,
      input.bytes,
      input.source,
      input.scope,
      input.workspaceId ?? null,
      input.sessionId ?? null,
      input.turnId ?? null,
      createdAt,
      expiresAt ?? null,
      input.parentArtifactId ?? null,
      input.operationDigest ?? null,
    );
    return toRef({
      bindId,
      sha256: input.sha256,
      kind: input.kind,
      name: input.name,
      mediaType: input.mediaType,
      bytes: input.bytes,
      source: input.source,
      scope: input.scope,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.parentArtifactId ? { parentArtifactId: input.parentArtifactId } : {}),
      ...(input.operationDigest ? { operationDigest: input.operationDigest } : {}),
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  private lookup(id: string) {
    let row: Record<string, string | number | null> | undefined;
    if (/^artifact:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      row = this.db.prepare(`SELECT * FROM artifacts WHERE bind_id = ?`).get(id.slice("artifact:".length)) as
        | Record<string, string | number | null>
        | undefined;
    } else {
      // One local 0.5.7 development build exposed digest-shaped ids. Accept
      // them only when they resolve to exactly one binding; never guess across
      // Workspace/Session boundaries.
      const digest = id.replace(/^sha256:/, "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(digest)) fail("ARTIFACT_ID");
      const rows = this.db.prepare(`SELECT * FROM artifacts WHERE sha256 = ?`).all(digest) as Array<
        Record<string, string | number | null>
      >;
      if (rows.length > 1) fail("ARTIFACT_AMBIGUOUS_LEGACY_ID");
      row = rows[0];
    }
    const typed = row as
      | {
          bind_id: string;
          sha256: string;
          kind: string;
          name: string;
          media_type: string;
          bytes: number;
          source: string;
          scope: string;
          workspace_id: string | null;
          session_id: string | null;
          turn_id: string | null;
          created_at: number;
          expires_at: number | null;
          parent_artifact_id: string | null;
          operation_digest: string | null;
        }
      | undefined;
    if (!typed) fail("ARTIFACT_MISSING");
    return {
      bindId: typed.bind_id,
      sha256: typed.sha256,
      kind: typed.kind,
      name: typed.name,
      mediaType: typed.media_type,
      bytes: typed.bytes,
      source: typed.source,
      scope: typed.scope,
      workspaceId: typed.workspace_id,
      sessionId: typed.session_id,
      turnId: typed.turn_id,
      createdAt: typed.created_at,
      expiresAt: typed.expires_at,
      parentArtifactId: typed.parent_artifact_id,
      operationDigest: typed.operation_digest,
    };
  }

  private ensureColumn(name: "parent_artifact_id" | "operation_digest", type: "TEXT"): void {
    const columns = this.db.prepare(`PRAGMA table_info(artifacts)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE artifacts ADD COLUMN ${name} ${type}`);
  }

  private assertTurnBudget(turnId: string | undefined, extraBytes: number): void {
    if (!turnId) return;
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS total FROM artifacts WHERE turn_id = ?`)
      .get(turnId) as { n: number; total: number };
    if (row.n + 1 > ARTIFACT_LIMITS.maxTurnFiles) fail("ARTIFACT_TURN_COUNT");
    if (row.total + extraBytes > ARTIFACT_LIMITS.maxTurnBytes) fail("ARTIFACT_TURN_BYTES");
  }

  private casPath(digest: string): string {
    return join(this.root, "cas", digest.slice(0, 2), digest);
  }

  private writeCas(digest: string, bytes: Buffer): void {
    const dest = this.casPath(digest);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    if (existsSync(dest)) {
      if (sha256Hex(readFileSync(dest)) !== digest) fail("ARTIFACT_CAS_COLLISION");
      return;
    }
    const staging = join(this.root, "staging", `${process.pid}.${randomUUID()}`);
    mkdirSync(dirname(staging), { recursive: true, mode: 0o700 });
    writeFileSync(staging, bytes, { mode: 0o600, flag: "wx" });
    if (sha256Hex(readFileSync(staging)) !== digest) fail("ARTIFACT_CAS_TAMPER");
    renameSync(staging, dest);
  }

  private readCas(digest: string): Buffer {
    const dest = this.casPath(digest);
    if (!existsSync(dest)) fail("ARTIFACT_CAS_MISSING");
    return readFileSync(dest);
  }

  private listCasDigests(): string[] {
    const casRoot = join(this.root, "cas");
    const out: string[] = [];
    if (!existsSync(casRoot)) return out;
    for (const shard of readdirSync(casRoot, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue;
      for (const file of readdirSync(join(casRoot, shard.name), { withFileTypes: true })) {
        if (file.isFile() && /^[0-9a-f]{64}$/.test(file.name)) out.push(file.name);
      }
    }
    return out;
  }
}
