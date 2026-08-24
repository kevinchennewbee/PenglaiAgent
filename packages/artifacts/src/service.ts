import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError, parseClosedEnum } from "@penglai/contracts";
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
  id: `sha256:${string}`;
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
  createdAt: number;
  expiresAt?: number | null;
}): ArtifactRefV1 {
  return {
    schema: 1,
    id: `sha256:${row.sha256}`,
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
        persist_action_id TEXT
      );
      CREATE INDEX IF NOT EXISTS artifacts_sha ON artifacts(sha256);
      CREATE INDEX IF NOT EXISTS artifacts_turn ON artifacts(turn_id);
      CREATE INDEX IF NOT EXISTS artifacts_exp ON artifacts(expires_at);
    `);
    this.now = opts?.now ?? Date.now;
    if (opts?.assertPersist) this.assertPersist = opts.assertPersist;
  }

  close(): void {
    this.db.close();
  }

  ingestBytes(bytes: Buffer, input: ArtifactIntake): ArtifactRefV1 {
    const name = displayName(input.name);
    const source = parseClosedEnum(input.source, ARTIFACT_SOURCES, "ARTIFACT_SOURCE", "SECURITY_POLICY");
    const scope = parseClosedEnum(input.scope ?? "turn", ARTIFACT_SCOPES, "ARTIFACT_SCOPE", "SECURITY_POLICY");
    if (scope !== "turn" && !input.workspaceId) fail("ARTIFACT_WORKSPACE");
    const classified = classifyArtifact(name, bytes);
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
    }));
  }

  ingestPath(absPath: string, input: ArtifactIntake): ArtifactRefV1 {
    if (!absPath || absPath.includes("\0")) fail("ARTIFACT_PATH");
    let fd: number | undefined;
    try {
      fd = openSync(absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const st = fstatSync(fd);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.isDirectory() ||
        st.isSocket() ||
        st.isFIFO() ||
        st.isBlockDevice() ||
        st.isCharacterDevice()
      ) {
        fail("ARTIFACT_HANDLE");
      }
      if (st.size > ARTIFACT_LIMITS.maxFileBytes) fail("ARTIFACT_SIZE");
      const bytes = readFileSync(fd);
      if (bytes.length !== st.size) fail("ARTIFACT_TOCTOU");
      return this.ingestBytes(bytes, input);
    } catch (error) {
      if (error instanceof PenglaiError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ELOOP" || code === "EPERM") fail("ARTIFACT_SYMLINK");
      throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
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
    this.assertPersist?.(proof.actionId);
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

  gc(now = this.now()): { removed: number; casRemoved: number } {
    const expired = this.db
      .prepare(`SELECT bind_id, sha256 FROM artifacts WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .all(now) as Array<{ bind_id: string; sha256: string }>;
    for (const row of expired) {
      this.db.prepare(`DELETE FROM artifacts WHERE bind_id = ?`).run(row.bind_id);
    }
    let casRemoved = 0;
    const leftovers = this.db.prepare(`SELECT DISTINCT sha256 FROM artifacts`).all() as Array<{ sha256: string }>;
    const live = new Set(leftovers.map((row) => row.sha256));
    const casRoot = join(this.root, "cas");
    if (existsSync(casRoot)) {
      for (const digest of this.listCasDigests()) {
        if (!live.has(digest)) {
          rmSync(this.casPath(digest), { force: true });
          casRemoved += 1;
        }
      }
    }
    rmSync(join(this.root, "staging"), { recursive: true, force: true });
    mkdirSync(join(this.root, "staging"), { recursive: true, mode: 0o700 });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { removed: expired.length, casRemoved };
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
  }): ArtifactRefV1 {
    const createdAt = this.now();
    const expiresAt = input.scope === "turn" ? createdAt + ARTIFACT_LIMITS.turnTtlMs : undefined;
    const bindId = randomUUID();
    this.db.prepare(
      `INSERT INTO artifacts(
        bind_id, sha256, kind, name, media_type, bytes, source, scope,
        workspace_id, session_id, turn_id, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
    return toRef({
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
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  private lookup(id: string) {
    const digest = id.replace(/^sha256:/, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) fail("ARTIFACT_ID");
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE sha256 = ? ORDER BY created_at DESC LIMIT 1`).get(digest) as
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
        }
      | undefined;
    if (!row) fail("ARTIFACT_MISSING");
    return {
      bindId: row.bind_id,
      sha256: row.sha256,
      kind: row.kind,
      name: row.name,
      mediaType: row.media_type,
      bytes: row.bytes,
      source: row.source,
      scope: row.scope,
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
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
