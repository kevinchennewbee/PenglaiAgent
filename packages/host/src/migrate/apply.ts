/**
 * 0.3 → 0.4 迁移执行（备份 → 写入 → 中文报告）与回滚。
 *
 * 铁律：
 *  - 写入前自动备份：既有目标文件复制到 <数据目录>/migrate-backup/<时间戳>/，
 *    新建文件与白名单新增行记进 manifest.json——每步可回滚
 *    （`penglai migrate rollback`）。
 *  - 幂等：计划层已把「已迁移，内容一致」判为 skip-unchanged；无写入动作
 *    时不创建备份目录。
 *  - 秘钥绝不进报告文本：渲染只用计划里预生成的掩码。
 *  - product.db 不做裸文件 copy：迁移前后均用 SQLite VACUUM INTO 生成
 *    一致性逻辑快照；未 checkpoint 的 WAL 也包含在快照事务视图内。
 *  - 白名单由 ProductStore 初始化完整 schema，但关闭 host 的 run 恢复副作用。
 */

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { savePersistedProfile } from "../profiles-store.js";
import { saveChannelConfig } from "../feishu/config.js";
import { MemoryStore, L1_FILE_NAME } from "../memory.js";
import { ProductStore } from "../storage/product-store.js";
import { acquireDataDirOperationLock } from "./operation-lock.js";
import {
  ARCHIVE_FACTS_NOTE,
  ARCHIVE_L1_NOTE,
  MIGRATION_PROVENANCE,
  MIGRATION_SECTION_TAG,
  planHasWrites,
  type MigrationPlan,
} from "./plan.js";

const MIGRATION_JOURNAL_VERSION = 1;
const MANIFEST_FILE_NAME = "manifest.json";
const JOURNAL_FILE_RE = /^journal-(\d{6,})\.json$/;

export type MigrationJournalState = "in_progress" | "committed" | "rolled_back";

export interface MigrationJournalStep {
  id: string;
  kind: "apply" | "artifact" | "rollback";
  status: "prepared" | "completed";
  targets: string[];
  preparedAt: string;
  completedAt?: string;
}

export interface MigrationBackupFile {
  path: string;
  backup: string;
  mode?: number;
  sha256?: string;
}

export interface MigrationWhitelistRecovery {
  databasePath: string;
  databaseExisted: boolean;
  tableExisted: boolean;
  intendedAdded: string[];
  /** Stable timestamp used by both the predicted and live deterministic mutation. */
  insertedAt: number;
  /** The complete logical database is restored from a consistent SQLite snapshot. */
  fullDatabaseRecovery: boolean;
}

export interface MigrationSqliteSnapshot {
  databasePath: string;
  databaseExisted: boolean;
  beforeFile: string | null;
  beforeSha256: string | null;
  beforeLogicalSha256: string | null;
  afterFile: string;
  afterSha256: string;
  afterLogicalSha256: string;
}

export interface MigrationTargetFingerprint {
  path: string;
  exists: boolean;
  sha256: string | null;
}

export interface MigrationJournal {
  journalVersion: typeof MIGRATION_JOURNAL_VERSION;
  sequence: number;
  /** True only for a v0 manifest upgraded in memory for compatible rollback. */
  legacyManifest: boolean;
  state: MigrationJournalState;
  phase: string;
  currentStep: string | null;
  createdAt: string;
  updatedAt: string;
  dataDir: string;
  sourceDir: string;
  filesBackedUp: MigrationBackupFile[];
  filesCreated: string[];
  directoriesCreated: string[];
  whitelistAdded: string[];
  whitelistRecovery: MigrationWhitelistRecovery | null;
  /** Consistent SQLite before/after images produced through VACUUM INTO. */
  sqliteSnapshots: MigrationSqliteSnapshot[];
  /** Durable post-mutation state; rollback refuses a third, externally changed state. */
  postApplyFiles: MigrationTargetFingerprint[];
  steps: MigrationJournalStep[];
}

interface LegacyBackupManifest {
  createdAt: string;
  dataDir: string;
  sourceDir: string;
  filesBackedUp: Array<{ path: string; backup: string }>;
  filesCreated: string[];
  whitelistAdded: string[];
}

export type MigrationFaultInjector = (point: string) => void;

export interface MigrationApplyOptions {
  dryRun?: boolean;
  clock?: () => Date;
  /** Test-only crash seam. Throwing simulates abrupt process termination. */
  faultInjection?: MigrationFaultInjector;
}

export interface MigrationRollbackOptions {
  clock?: () => Date;
  /** Test-only crash seam. Throwing leaves rollback replayable. */
  faultInjection?: MigrationFaultInjector;
}

function fsyncDirectory(dir: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A few Windows/filesystem combinations reject directory fsync. File
    // fsync remains mandatory; only that unsupported directory call degrades.
    if (!code || !["EINVAL", "ENOTSUP", "EPERM", "EISDIR", "EBADF"].includes(code)) {
      throw error;
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function fsyncFile(file: string): void {
  const fd = fs.openSync(file, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncTarget(target: string): void {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) fsyncFile(target);
  fsyncDirectory(path.dirname(target));
}

function fsyncSqliteFiles(databasePath: string): void {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) fsyncFile(candidate);
  }
  fsyncDirectory(path.dirname(databasePath));
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fingerprintTarget(dataDir: string, target: string): MigrationTargetFingerprint {
  const resolved = path.resolve(target);
  assertRecoveryTarget(dataDir, resolved);
  assertSafeTargetParents(dataDir, resolved);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, exists: false, sha256: null };
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`migration fingerprint target is not a regular file: ${resolved}`);
  }
  return { path: resolved, exists: true, sha256: sha256File(resolved) };
}

function sameFingerprint(
  left: MigrationTargetFingerprint,
  right: MigrationTargetFingerprint,
): boolean {
  return (
    left.path === right.path &&
    left.exists === right.exists &&
    left.sha256 === right.sha256
  );
}

function sqliteSnapshotForTarget(
  journal: MigrationJournal,
  target: string,
): MigrationSqliteSnapshot | undefined {
  const resolved = path.resolve(target);
  return journal.sqliteSnapshots.find(
    (snapshot) => path.resolve(snapshot.databasePath) === resolved,
  );
}

function recordPostApplyFingerprints(
  backupDir: string,
  journal: MigrationJournal,
  targets: string[],
): void {
  const byPath = new Map(journal.postApplyFiles.map((entry) => [path.resolve(entry.path), entry]));
  for (const target of uniquePaths(targets)) {
    const sqliteSnapshot = sqliteSnapshotForTarget(journal, target);
    const fingerprint = sqliteSnapshot
      ? logicalSqliteFingerprint(backupDir, journal.dataDir, target)
      : fingerprintTarget(journal.dataDir, target);
    if (
      sqliteSnapshot &&
      (!fingerprint.exists || fingerprint.sha256 !== sqliteSnapshot.afterLogicalSha256)
    ) {
      throw new Error(
        `SQLite migration output differs from the durable predicted snapshot: ${target}`,
      );
    }
    byPath.set(fingerprint.path, fingerprint);
  }
  journal.postApplyFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertRecoveryTarget(dataDir: string, target: string): void {
  if (!path.isAbsolute(target) || !isPathInside(dataDir, target) || path.resolve(target) === path.resolve(dataDir)) {
    throw new Error(`migration journal target escapes dataDir: ${target}`);
  }
}

function assertSafeTargetParents(dataDir: string, target: string): void {
  const root = path.resolve(dataDir);
  let current = path.dirname(path.resolve(target));
  while (current !== root) {
    if (!isPathInside(root, current)) {
      throw new Error(`migration target parent escapes dataDir: ${current}`);
    }
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`migration target parent is not a safe directory: ${current}`);
      }
    }
    current = path.dirname(current);
  }
}

function durableWriteNewFile(file: string, content: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "wx", mode);
  try {
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(file));
}

function durableRestoreFile(source: string, target: string, mode?: number): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.migrate-restore-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    if (mode !== undefined) fs.chmodSync(temporary, mode);
    fsyncFile(temporary);
    fs.renameSync(temporary, target);
    fsyncDirectory(path.dirname(target));
  } finally {
    try {
      fs.rmSync(temporary);
    } catch {
      /* rename consumed it, or copy failed before creation */
    }
  }
}

/**
 * Write one immutable journal snapshot. A partial crash tail is ignored on
 * recovery; target mutation begins only after this new file and its directory
 * have both been flushed.
 */
function writeJournalSnapshot(backupDir: string, journal: MigrationJournal): void {
  const filename =
    journal.sequence === 0
      ? MANIFEST_FILE_NAME
      : `journal-${String(journal.sequence).padStart(6, "0")}.json`;
  const file = path.join(backupDir, filename);
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(backupDir);
}

function snapshotSequence(entryName: string): number | null {
  if (entryName === MANIFEST_FILE_NAME) return 0;
  const match = entryName.match(JOURNAL_FILE_RE);
  return match ? Number(match[1]) : null;
}

function maxSnapshotSequence(backupDir: string): number {
  if (!fs.existsSync(backupDir)) return -1;
  return fs
    .readdirSync(backupDir)
    .map(snapshotSequence)
    .filter((value): value is number => value !== null)
    .reduce((max, value) => Math.max(max, value), -1);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`migration journal has an invalid ${field}`);
  }
  return [...value];
}

function backupFiles(value: unknown): MigrationBackupFile[] {
  if (!Array.isArray(value)) throw new Error("migration journal has invalid filesBackedUp");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("migration journal has invalid backup metadata");
    }
    const entry = raw as Partial<MigrationBackupFile>;
    if (
      typeof entry.path !== "string" ||
      typeof entry.backup !== "string" ||
      path.basename(entry.backup) !== entry.backup ||
      (entry.mode !== undefined && (!Number.isInteger(entry.mode) || entry.mode < 0)) ||
      (entry.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(entry.sha256))
    ) {
      throw new Error("migration journal has invalid backup metadata");
    }
    return {
      path: entry.path,
      backup: entry.backup,
      ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
      ...(entry.sha256 !== undefined ? { sha256: entry.sha256 } : {}),
    };
  });
}

function journalSteps(value: unknown): MigrationJournalStep[] {
  if (!Array.isArray(value)) throw new Error("migration journal has invalid steps");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("migration journal has invalid step");
    const step = raw as Partial<MigrationJournalStep>;
    if (
      typeof step.id !== "string" ||
      !["apply", "artifact", "rollback"].includes(String(step.kind)) ||
      !["prepared", "completed"].includes(String(step.status)) ||
      typeof step.preparedAt !== "string"
    ) {
      throw new Error("migration journal has invalid step");
    }
    return {
      id: step.id,
      kind: step.kind as MigrationJournalStep["kind"],
      status: step.status as MigrationJournalStep["status"],
      targets: stringArray(step.targets, `targets for ${step.id}`),
      preparedAt: step.preparedAt,
      ...(typeof step.completedAt === "string" ? { completedAt: step.completedAt } : {}),
    };
  });
}

function targetFingerprints(value: unknown): MigrationTargetFingerprint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("migration journal has invalid postApplyFiles");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("migration journal has invalid post-apply fingerprint");
    }
    const entry = raw as Partial<MigrationTargetFingerprint>;
    if (
      typeof entry.path !== "string" ||
      typeof entry.exists !== "boolean" ||
      !(
        (entry.exists === false && entry.sha256 === null) ||
        (entry.exists === true && typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.sha256))
      )
    ) {
      throw new Error("migration journal has invalid post-apply fingerprint");
    }
    return { path: entry.path, exists: entry.exists, sha256: entry.sha256 };
  });
}

function whitelistRecovery(value: unknown): MigrationWhitelistRecovery | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") {
    throw new Error("migration journal has invalid whitelist recovery metadata");
  }
  const recovery = value as Partial<MigrationWhitelistRecovery>;
  if (
    typeof recovery.databasePath !== "string" ||
    typeof recovery.databaseExisted !== "boolean" ||
    typeof recovery.tableExisted !== "boolean"
  ) {
    throw new Error("migration journal has invalid whitelist recovery metadata");
  }
  return {
    databasePath: recovery.databasePath,
    databaseExisted: recovery.databaseExisted,
    tableExisted: recovery.tableExisted,
    intendedAdded: stringArray(recovery.intendedAdded, "whitelistRecovery.intendedAdded"),
    insertedAt:
      typeof recovery.insertedAt === "number" &&
      Number.isFinite(recovery.insertedAt) &&
      recovery.insertedAt >= 0
        ? recovery.insertedAt
        : 0,
    fullDatabaseRecovery: recovery.fullDatabaseRecovery === true,
  };
}

function sqliteSnapshots(value: unknown): MigrationSqliteSnapshot[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("migration journal has invalid sqliteSnapshots");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("migration journal has invalid SQLite snapshot metadata");
    }
    const snapshot = raw as Partial<MigrationSqliteSnapshot>;
    const beforePairValid =
      (snapshot.databaseExisted === false &&
        snapshot.beforeFile === null &&
        snapshot.beforeSha256 === null &&
        snapshot.beforeLogicalSha256 === null) ||
      (snapshot.databaseExisted === true &&
        typeof snapshot.beforeFile === "string" &&
        path.basename(snapshot.beforeFile) === snapshot.beforeFile &&
        typeof snapshot.beforeSha256 === "string" &&
        /^[0-9a-f]{64}$/.test(snapshot.beforeSha256) &&
        typeof snapshot.beforeLogicalSha256 === "string" &&
        /^[0-9a-f]{64}$/.test(snapshot.beforeLogicalSha256));
    if (
      typeof snapshot.databasePath !== "string" ||
      typeof snapshot.databaseExisted !== "boolean" ||
      !beforePairValid ||
      typeof snapshot.afterFile !== "string" ||
      path.basename(snapshot.afterFile) !== snapshot.afterFile ||
      typeof snapshot.afterSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(snapshot.afterSha256) ||
      typeof snapshot.afterLogicalSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(snapshot.afterLogicalSha256)
    ) {
      throw new Error("migration journal has invalid SQLite snapshot metadata");
    }
    return snapshot as MigrationSqliteSnapshot;
  });
}

function normalizeJournal(raw: unknown, sequence: number): MigrationJournal {
  if (!raw || typeof raw !== "object") throw new Error("migration journal is not an object");
  const row = raw as Partial<MigrationJournal> & Partial<LegacyBackupManifest>;
  if (
    typeof row.dataDir !== "string" ||
    !row.dataDir ||
    typeof row.sourceDir !== "string" ||
    !row.sourceDir ||
    typeof row.createdAt !== "string" ||
    !row.createdAt
  ) {
    throw new Error("migration journal is missing dataDir/sourceDir/createdAt");
  }
  const isLegacy =
    row.journalVersion === undefined &&
    row.state === undefined &&
    row.phase === undefined &&
    row.steps === undefined;
  if (isLegacy) {
    // Legacy manifests were written only after all mutations completed.
    return {
      journalVersion: MIGRATION_JOURNAL_VERSION,
      sequence,
      legacyManifest: true,
      state: "committed",
      phase: "legacy_committed",
      currentStep: null,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      dataDir: row.dataDir,
      sourceDir: row.sourceDir,
      filesBackedUp: backupFiles(row.filesBackedUp),
      filesCreated: stringArray(row.filesCreated, "filesCreated"),
      directoriesCreated: [],
      whitelistAdded: stringArray(row.whitelistAdded, "whitelistAdded"),
      whitelistRecovery: null,
      sqliteSnapshots: [],
      postApplyFiles: [],
      steps: [],
    };
  }
  if (row.journalVersion !== MIGRATION_JOURNAL_VERSION) {
    throw new Error(`unsupported migration journal version: ${String(row.journalVersion)}`);
  }
  if (row.sequence !== sequence) {
    throw new Error(`migration journal sequence mismatch: ${String(row.sequence)} != ${sequence}`);
  }
  if (!row.state || !["in_progress", "committed", "rolled_back"].includes(row.state)) {
    throw new Error("migration journal has an invalid state");
  }
  return {
    journalVersion: MIGRATION_JOURNAL_VERSION,
    sequence,
    legacyManifest: row.legacyManifest === true,
    state: row.state,
    phase: typeof row.phase === "string" ? row.phase : "unknown",
    currentStep: typeof row.currentStep === "string" ? row.currentStep : null,
    createdAt: row.createdAt,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.createdAt,
    dataDir: row.dataDir,
    sourceDir: row.sourceDir,
    filesBackedUp: backupFiles(row.filesBackedUp),
    filesCreated: stringArray(row.filesCreated, "filesCreated"),
    directoriesCreated:
      row.directoriesCreated === undefined
        ? []
        : stringArray(row.directoriesCreated, "directoriesCreated"),
    whitelistAdded: stringArray(row.whitelistAdded, "whitelistAdded"),
    whitelistRecovery: whitelistRecovery(row.whitelistRecovery),
    sqliteSnapshots: sqliteSnapshots(row.sqliteSnapshots),
    postApplyFiles: targetFingerprints(row.postApplyFiles),
    steps: journalSteps(row.steps),
  };
}

function readMigrationJournalWithSequence(backupDir: string): MigrationJournal {
  if (!fs.existsSync(backupDir)) throw new Error(`迁移备份目录不存在：${backupDir}`);
  const snapshots = fs
    .readdirSync(backupDir)
    .map((name) => ({ name, sequence: snapshotSequence(name) }))
    .filter((entry): entry is { name: string; sequence: number } => entry.sequence !== null)
    .sort((a, b) => b.sequence - a.sequence);
  const errors: string[] = [];
  for (const snapshot of snapshots) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(backupDir, snapshot.name), "utf-8"));
      return normalizeJournal(raw, snapshot.sequence);
    } catch (error) {
      errors.push(`${snapshot.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `备份目录没有可恢复的完整 journal：${backupDir}` +
      (errors.length > 0 ? `（${errors.join("；")}）` : ""),
  );
}

/** Read the latest complete manifest/journal snapshot. */
export function readMigrationJournal(backupDir: string): MigrationJournal {
  return readMigrationJournalWithSequence(backupDir);
}

class JournalWriter {
  constructor(
    readonly backupDir: string,
    readonly journal: MigrationJournal,
    readonly clock: () => Date = () => new Date(),
  ) {}

  persist(): void {
    this.journal.sequence = maxSnapshotSequence(this.backupDir) + 1;
    this.journal.updatedAt = this.clock().toISOString();
    writeJournalSnapshot(this.backupDir, this.journal);
  }
}

// ── 白名单（product.db 裸连接，绝不走 ProductStore 构造） ────────

function productDbPath(dataDir: string): string {
  return path.join(dataDir, "product.db");
}

function sqliteBundlePaths(databasePath: string): string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

function assertHealthySqliteFile(file: string): void {
  if (!fs.existsSync(file)) throw new Error(`SQLite snapshot is missing: ${file}`);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`SQLite snapshot is not a regular file: ${file}`);
  }
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    if (
      rows.length !== 1 ||
      Object.values(rows[0]).length !== 1 ||
      Object.values(rows[0])[0] !== "ok"
    ) {
      throw new Error(`SQLite quick_check failed for ${file}`);
    }
  } finally {
    database.close();
  }
}

function sqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function hashToken(hash: crypto.Hash, value: unknown): void {
  const bytes = Buffer.from(String(value), "utf-8");
  hash.update(String(bytes.length));
  hash.update(":");
  hash.update(bytes);
}

/**
 * Hash schema plus every SQLite value in deterministic encoded order.
 * Artifact SHA protects the snapshot file itself; this logical digest ignores
 * page numbers/change counters so two VACUUM images of the same database
 * compare equal even when their physical headers differ.
 */
function sqliteLogicalDigest(file: string): string {
  assertHealthySqliteFile(file);
  const database = new DatabaseSync(file, { readOnly: true });
  const hash = crypto.createHash("sha256");
  try {
    for (const pragma of ["application_id", "user_version"] as const) {
      const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown>;
      hashToken(hash, `pragma:${pragma}`);
      hashToken(hash, Object.values(row)[0]);
    }

    const schema = database
      .prepare(
        `SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY type, name, tbl_name`,
      )
      .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
    for (const row of schema) {
      hashToken(hash, "schema");
      hashToken(hash, row.type);
      hashToken(hash, row.name);
      hashToken(hash, row.tbl_name);
      hashToken(hash, row.sql ?? "<null>");
    }

    const tables = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const columns = database
        .prepare(`PRAGMA table_xinfo(${sqliteString(name)})`)
        .all() as Array<{ name: string }>;
      hashToken(hash, `table:${name}`);
      for (const column of columns) hashToken(hash, `column:${column.name}`);
      if (columns.length === 0) continue;
      const expressions = columns.map(({ name: column }) => {
        const quoted = sqliteIdentifier(column);
        return (
          `CASE typeof(${quoted}) ` +
          `WHEN 'null' THEN 'n' ` +
          `WHEN 'integer' THEN 'i:' || CAST(${quoted} AS TEXT) ` +
          `WHEN 'real' THEN 'r:' || printf('%!.17g', ${quoted}) ` +
          `WHEN 'text' THEN 't:' || hex(${quoted}) ` +
          `WHEN 'blob' THEN 'b:' || hex(${quoted}) END`
        );
      });
      const statement = database.prepare(
        `SELECT ${expressions.join(", ")} FROM ${sqliteIdentifier(name)} ` +
          `ORDER BY ${expressions.map((_, index) => index + 1).join(", ")}`,
      );
      statement.setReturnArrays(true);
      for (const row of statement.iterate() as Iterable<unknown[]>) {
        hashToken(hash, "row");
        for (const value of row) hashToken(hash, value);
      }
    }
  } finally {
    database.close();
  }
  return hash.digest("hex");
}

/** Create one transactionally consistent, standalone SQLite image. */
function createSqliteLogicalSnapshot(source: string, destination: string): string {
  if (!fs.existsSync(source)) throw new Error(`SQLite source is missing: ${source}`);
  if (fs.existsSync(destination)) {
    throw new Error(`SQLite snapshot destination already exists: ${destination}`);
  }
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error(`SQLite source is not a regular file: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.prepare("VACUUM INTO ?").run(destination);
  } catch (error) {
    try {
      fs.rmSync(destination);
    } catch {
      /* preserve the snapshot failure */
    }
    throw error;
  } finally {
    database.close();
  }
  fs.chmodSync(destination, 0o600);
  assertHealthySqliteFile(destination);
  fsyncFile(destination);
  fsyncDirectory(path.dirname(destination));
  return sha256File(destination);
}

function removeSqliteBundle(databasePath: string): void {
  for (const candidate of sqliteBundlePaths(databasePath).reverse()) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`SQLite bundle member is not a regular file: ${candidate}`);
    }
    fs.rmSync(candidate);
  }
  fsyncDirectory(path.dirname(databasePath));
}

/** Fold committed WAL content into the main file before an atomic restore/delete. */
function checkpointSqlite(databasePath: string): void {
  if (!fs.existsSync(databasePath)) return;
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    const row = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as
      | { busy?: number }
      | undefined;
    if (Number(row?.busy ?? 0) !== 0) {
      throw new Error(`SQLite database is busy; refusing recovery: ${databasePath}`);
    }
  } finally {
    database.close();
  }
  fsyncSqliteFiles(databasePath);
}

function sqliteSnapshotFile(backupDir: string, name: string): string {
  if (path.basename(name) !== name) {
    throw new Error(`SQLite snapshot filename escapes backupDir: ${name}`);
  }
  const file = path.join(backupDir, name);
  if (!isPathInside(backupDir, file)) {
    throw new Error(`SQLite snapshot path escapes backupDir: ${name}`);
  }
  return file;
}

function whitelistTableExistsIn(db: DatabaseSync): boolean {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_identities'")
      .get(),
  );
}

function whitelistTableExistsInFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const db = new DatabaseSync(file);
  try {
    return whitelistTableExistsIn(db);
  } finally {
    db.close();
  }
}

function whitelistTableExists(dataDir: string): boolean {
  return whitelistTableExistsInFile(productDbPath(dataDir));
}

/** 读取现有飞书白名单 open_id 集（db 不存在/表不存在 → 空集）。 */
export function readExistingWhitelist(dataDir: string): Set<string> {
  const file = productDbPath(dataDir);
  if (!fs.existsSync(file)) return new Set();
  const db = new DatabaseSync(file);
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_identities'")
      .get();
    if (!table) return new Set();
    const rows = db
      .prepare("SELECT channel_user_id FROM channel_identities WHERE channel = 'feishu'")
      .all() as Array<{ channel_user_id: string }>;
    return new Set(rows.map((row) => row.channel_user_id));
  } finally {
    db.close();
  }
}

function captureWhitelistRecovery(
  dataDir: string,
  intendedAdded: string[],
  insertedAt: number,
): MigrationWhitelistRecovery | null {
  if (intendedAdded.length === 0) return null;
  const databasePath = productDbPath(dataDir);
  const databaseExisted = fs.existsSync(databasePath);
  const tableExisted = databaseExisted && whitelistTableExists(dataDir);
  const existing = readExistingWhitelist(dataDir);
  const stale = intendedAdded.filter((openId) => existing.has(openId));
  if (stale.length > 0) {
    throw new Error(`迁移计划已过期：白名单已存在 ${stale.join(" / ")}，请重新预览后执行`);
  }
  return {
    databasePath,
    databaseExisted,
    tableExisted,
    intendedAdded: [...intendedAdded],
    insertedAt,
    fullDatabaseRecovery: true,
  };
}

/** 建表与全部白名单行在同一个 IMMEDIATE transaction 内原子提交。 */
function applyWhitelistMutation(
  recovery: MigrationWhitelistRecovery,
  faultInjection?: MigrationFaultInjector,
): void {
  const file = recovery.databasePath;
  if (fs.existsSync(file) !== recovery.databaseExisted) {
    throw new Error("迁移计划已过期：product.db 的存在状态已变化，请重新预览后执行");
  }
  if (recovery.databaseExisted && whitelistTableExistsInFile(file) !== recovery.tableExisted) {
    throw new Error("迁移计划已过期：channel_identities 表状态已变化，请重新预览后执行");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const productStore = new ProductStore(file, { recoverInterruptedRuns: false });
  const db = productStore.database;
  let transactionOpen = false;
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    if (!whitelistTableExistsIn(db)) {
      throw new Error("ProductStore schema initializer did not create channel_identities");
    }
    const exists = db.prepare(
      "SELECT 1 AS present FROM channel_identities WHERE channel = 'feishu' AND channel_user_id = ?",
    );
    const insert = db.prepare(
      `INSERT INTO channel_identities
         (channel, channel_user_id, identity, note, created_at)
       VALUES ('feishu', ?, ?, ?, ?)`,
    );
    for (const [index, openId] of recovery.intendedAdded.entries()) {
      if (exists.get(openId)) {
        throw new Error(`迁移计划已过期：白名单已存在 ${openId}，事务已取消`);
      }
      insert.run(
        openId,
        `…${openId.slice(-6)}`,
        "0.3 迁移（penglai migrate）",
        recovery.insertedAt,
      );
      faultInjection?.(`during:whitelist:${index + 1}`);
    }
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original mutation failure */
      }
    }
    throw error;
  } finally {
    productStore.close();
    if (fs.existsSync(file)) fsyncSqliteFiles(file);
  }
}

function prepareSqliteSnapshotPair(
  backupDir: string,
  recovery: MigrationWhitelistRecovery,
): MigrationSqliteSnapshot {
  const beforeFile = recovery.databaseExisted ? "sqlite-product-before.db" : null;
  const afterFile = "sqlite-product-after.db";
  let beforeSha256: string | null = null;
  let beforeLogicalSha256: string | null = null;
  if (beforeFile) {
    const beforePath = sqliteSnapshotFile(backupDir, beforeFile);
    beforeSha256 = createSqliteLogicalSnapshot(
      recovery.databasePath,
      beforePath,
    );
    beforeLogicalSha256 = sqliteLogicalDigest(beforePath);
  }

  const work = sqliteSnapshotFile(
    backupDir,
    `.sqlite-product-predict-${process.pid}-${crypto.randomUUID()}.db`,
  );
  try {
    if (beforeFile) {
      durableRestoreFile(sqliteSnapshotFile(backupDir, beforeFile), work, 0o600);
    }
    applyWhitelistMutation({ ...recovery, databasePath: work });
    const afterPath = sqliteSnapshotFile(backupDir, afterFile);
    const afterSha256 = createSqliteLogicalSnapshot(
      work,
      afterPath,
    );
    return {
      databasePath: recovery.databasePath,
      databaseExisted: recovery.databaseExisted,
      beforeFile,
      beforeSha256,
      beforeLogicalSha256,
      afterFile,
      afterSha256,
      afterLogicalSha256: sqliteLogicalDigest(afterPath),
    };
  } finally {
    removeSqliteBundle(work);
  }
}

function logicalSqliteFingerprint(
  backupDir: string,
  dataDir: string,
  databasePath: string,
): MigrationTargetFingerprint {
  const resolved = path.resolve(databasePath);
  assertRecoveryTarget(dataDir, resolved);
  assertSafeTargetParents(dataDir, resolved);
  if (!fs.existsSync(resolved)) return { path: resolved, exists: false, sha256: null };
  const probe = sqliteSnapshotFile(
    backupDir,
    `.sqlite-probe-${process.pid}-${crypto.randomUUID()}.db`,
  );
  try {
    createSqliteLogicalSnapshot(resolved, probe);
    return {
      path: resolved,
      exists: true,
      sha256: sqliteLogicalDigest(probe),
    };
  } finally {
    removeSqliteBundle(probe);
  }
}

function restoreSqliteLogicalSnapshot(
  backupDir: string,
  snapshot: MigrationSqliteSnapshot,
  faultInjection?: MigrationFaultInjector,
): void {
  const databasePath = snapshot.databasePath;
  checkpointSqlite(databasePath);
  faultInjection?.("during:rollback:sqlite:checkpointed");

  for (const sidecar of [`${databasePath}-shm`, `${databasePath}-wal`]) {
    if (!fs.existsSync(sidecar)) continue;
    const stat = fs.lstatSync(sidecar);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`SQLite sidecar is not a regular file: ${sidecar}`);
    }
    fs.rmSync(sidecar);
  }
  fsyncDirectory(path.dirname(databasePath));
  faultInjection?.("during:rollback:sqlite:sidecars-removed");

  if (!snapshot.databaseExisted) {
    if (fs.existsSync(databasePath)) fs.rmSync(databasePath);
    fsyncDirectory(path.dirname(databasePath));
  } else {
    const before = sqliteSnapshotFile(backupDir, snapshot.beforeFile!);
    durableRestoreFile(before, databasePath, 0o600);
  }
  faultInjection?.("during:rollback:sqlite:restored");
}

/** Legacy manifests know only the inserted rows; keep their rollback transactional. */
function removeWhitelistRows(dataDir: string, openIds: string[]): void {
  const file = productDbPath(dataDir);
  if (openIds.length === 0 || !fs.existsSync(file)) return;
  const db = new DatabaseSync(file);
  let transactionOpen = false;
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    if (whitelistTableExistsIn(db)) {
      const remove = db.prepare(
        "DELETE FROM channel_identities WHERE channel = 'feishu' AND channel_user_id = ?",
      );
      for (const openId of openIds) remove.run(openId);
    }
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original rollback failure */
      }
    }
    throw error;
  } finally {
    db.close();
    fsyncSqliteFiles(file);
  }
}

function restoreWhitelistMutation(recovery: MigrationWhitelistRecovery): void {
  const file = recovery.databasePath;
  if (!recovery.databaseExisted) {
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      if (fs.existsSync(candidate)) fs.rmSync(candidate);
    }
    fsyncDirectory(path.dirname(file));
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(`product.db 缺失，无法恢复迁移前白名单：${file}`);
  }
  const db = new DatabaseSync(file);
  let transactionOpen = false;
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const tableNow = whitelistTableExistsIn(db);
    if (recovery.tableExisted) {
      if (!tableNow) throw new Error("channel_identities 表缺失，无法恢复迁移前白名单");
      const remove = db.prepare(
        "DELETE FROM channel_identities WHERE channel = 'feishu' AND channel_user_id = ?",
      );
      for (const openId of recovery.intendedAdded) remove.run(openId);
    } else if (tableNow) {
      db.exec("DROP TABLE channel_identities");
    }
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original rollback failure */
      }
    }
    throw error;
  } finally {
    db.close();
    fsyncSqliteFiles(file);
  }
}

function verifyWhitelistRestored(recovery: MigrationWhitelistRecovery): void {
  const file = recovery.databasePath;
  if (!recovery.databaseExisted) {
    if ([file, `${file}-wal`, `${file}-shm`].some((candidate) => fs.existsSync(candidate))) {
      throw new Error("rollback verification failed: newly created product.db still exists");
    }
    return;
  }
  if (!fs.existsSync(file)) throw new Error("rollback verification failed: product.db is missing");
  const db = new DatabaseSync(file);
  try {
    const tableNow = whitelistTableExistsIn(db);
    if (tableNow !== recovery.tableExisted) {
      throw new Error("rollback verification failed: channel_identities schema differs");
    }
    if (tableNow) {
      const exists = db.prepare(
        "SELECT 1 AS present FROM channel_identities WHERE channel = 'feishu' AND channel_user_id = ?",
      );
      if (recovery.intendedAdded.some((openId) => Boolean(exists.get(openId)))) {
        throw new Error("rollback verification failed: migrated whitelist rows remain");
      }
    }
  } finally {
    db.close();
  }
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function allocateBackupDir(dataDir: string, now: Date): string {
  const root = path.join(dataDir, "migrate-backup");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const base = timestampSlug(now);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const name = suffix === 0 ? base : `${base}-${String(suffix).padStart(2, "0")}`;
    const candidate = path.join(root, name);
    try {
      fs.mkdirSync(candidate, { mode: 0o700 });
      fsyncDirectory(root);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`无法为 ${base} 分配唯一迁移备份目录`);
}

function listBackupDirs(dataDir: string): string[] {
  const root = path.join(dataDir, "migrate-backup");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort()
    .reverse();
}

function findUnfinishedMigration(dataDir: string): { backupDir: string; detail: string } | null {
  for (const backupDir of listBackupDirs(dataDir)) {
    const manifestPath = path.join(backupDir, MANIFEST_FILE_NAME);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const journal = readMigrationJournalWithSequence(backupDir);
      if (journal.state === "in_progress") {
        return {
          backupDir,
          detail: `${journal.phase}${journal.currentStep ? ` / ${journal.currentStep}` : ""}`,
        };
      }
    } catch (error) {
      // An unreadable journal cannot be proven committed. Refuse a second
      // migration until the owner explicitly resolves the recovery directory.
      return {
        backupDir,
        detail: `journal unreadable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return null;
}

// ── 执行 ───────────────────────────────────────────────────────

interface PlannedMigrationMutation {
  id: string;
  journalTargets: string[];
  recoveryTargets: string[];
  syncTargets: string[];
  mutate: () => void;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((entry) => path.resolve(entry)))];
}

function recoveryFilesForTargets(
  dataDir: string,
  targets: string[],
): { filesBackedUp: MigrationBackupFile[]; filesCreated: string[] } {
  const filesBackedUp: MigrationBackupFile[] = [];
  const filesCreated: string[] = [];
  for (const [index, target] of uniquePaths(targets).entries()) {
    assertRecoveryTarget(dataDir, target);
    if (!fs.existsSync(target)) {
      filesCreated.push(target);
      continue;
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`迁移目标不是普通文件，保守拒绝覆盖：${target}`);
    }
    filesBackedUp.push({
      path: target,
      backup: `file-${String(index + 1).padStart(4, "0")}-${path.basename(target)}`,
      mode: stat.mode & 0o777,
      sha256: sha256File(target),
    });
  }
  return { filesBackedUp, filesCreated };
}

function missingDirectoriesForTargets(dataDir: string, targets: string[]): string[] {
  const root = path.resolve(dataDir);
  const missing = new Set<string>();
  for (const target of uniquePaths(targets)) {
    assertRecoveryTarget(root, target);
    assertSafeTargetParents(root, target);
    let current = path.dirname(target);
    while (current !== root) {
      if (!isPathInside(root, current)) {
        throw new Error(`migration directory escapes dataDir: ${current}`);
      }
      if (fs.existsSync(current)) {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error(`迁移目标父路径不是普通目录，保守拒绝写入：${current}`);
        }
      } else {
        missing.add(current);
      }
      current = path.dirname(current);
    }
  }
  return [...missing].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function copyRecoveryBackups(backupDir: string, journal: MigrationJournal): void {
  for (const entry of journal.filesBackedUp) {
    if (!fs.existsSync(entry.path) || sha256File(entry.path) !== entry.sha256) {
      throw new Error(`迁移目标在备份前发生变化，保守中止：${entry.path}`);
    }
    const destination = path.join(backupDir, entry.backup);
    fs.copyFileSync(entry.path, destination, fs.constants.COPYFILE_EXCL);
    fsyncFile(destination);
    if (entry.sha256 && sha256File(destination) !== entry.sha256) {
      throw new Error(`迁移备份校验失败：${destination}`);
    }
  }
  fsyncDirectory(backupDir);
}

function prepareJournalStep(
  writer: JournalWriter,
  kind: MigrationJournalStep["kind"],
  id: string,
  targets: string[],
): MigrationJournalStep {
  const now = writer.clock().toISOString();
  let step = writer.journal.steps.find((candidate) => candidate.kind === kind && candidate.id === id);
  if (!step) {
    step = { id, kind, status: "prepared", targets: [...targets], preparedAt: now };
    writer.journal.steps.push(step);
  } else {
    step.status = "prepared";
    step.targets = [...targets];
    step.preparedAt = now;
    delete step.completedAt;
  }
  writer.journal.phase = `${kind}:${id}:prepared`;
  writer.journal.currentStep = id;
  writer.persist();
  return step;
}

function completeJournalStep(writer: JournalWriter, step: MigrationJournalStep): void {
  step.status = "completed";
  step.completedAt = writer.clock().toISOString();
  writer.journal.phase = `${step.kind}:${step.id}:completed`;
  writer.journal.currentStep = null;
  writer.persist();
}

function runJournaledMutation(
  writer: JournalWriter,
  mutation: PlannedMigrationMutation,
  faultInjection?: MigrationFaultInjector,
): void {
  const step = prepareJournalStep(writer, "apply", mutation.id, mutation.journalTargets);
  faultInjection?.(`before:${mutation.id}`);
  mutation.mutate();
  for (const target of mutation.syncTargets) fsyncTarget(target);
  // Persist the exact postimage before exposing the after-mutation crash
  // seam. Rollback later accepts only this state or the original preimage.
  recordPostApplyFingerprints(writer.backupDir, writer.journal, mutation.journalTargets);
  writer.journal.phase = `apply:${mutation.id}:postimage-recorded`;
  writer.persist();
  faultInjection?.(`after:${mutation.id}`);
  completeJournalStep(writer, step);
}

function assertTargetsStillMatchBackup(
  backupDir: string,
  journal: MigrationJournal,
  targets: string[],
  previouslyTouched: Set<string>,
): void {
  const backedUp = new Map(journal.filesBackedUp.map((entry) => [entry.path, entry]));
  const created = new Set(journal.filesCreated);
  for (const target of uniquePaths(targets)) {
    if (previouslyTouched.has(target)) continue;
    assertSafeTargetParents(journal.dataDir, target);
    const sqliteSnapshot = sqliteSnapshotForTarget(journal, target);
    if (sqliteSnapshot) {
      const current = logicalSqliteFingerprint(backupDir, journal.dataDir, target);
      const expected: MigrationTargetFingerprint = sqliteSnapshot.databaseExisted
        ? {
            path: path.resolve(target),
            exists: true,
            sha256: sqliteSnapshot.beforeLogicalSha256,
          }
        : { path: path.resolve(target), exists: false, sha256: null };
      if (!sameFingerprint(current, expected)) {
        throw new Error(`SQLite 迁移目标在计划后发生变化，保守中止：${target}`);
      }
      continue;
    }
    const backup = backedUp.get(target);
    if (backup) {
      if (!fs.existsSync(target) || (backup.sha256 && sha256File(target) !== backup.sha256)) {
        throw new Error(`迁移目标在计划后发生变化，保守中止：${target}`);
      }
    } else if (created.has(target) && fs.existsSync(target)) {
      throw new Error(`迁移目标在计划后被新建，保守中止：${target}`);
    }
  }
}

export interface MigrationResult {
  /** 是否发生了写入（false = 全部幂等跳过）。 */
  wrote: boolean;
  backupDir: string | null;
  report: string;
}

/**
 * 执行迁移计划。dryRun=true 时只渲染报告、零写入零备份。
 * clock 可注入（测试确定性）；报告与备份目录共用同一时刻。
 */
export function applyMigration(
  plan: MigrationPlan,
  options: MigrationApplyOptions = {},
): MigrationResult {
  if (options.dryRun === true) return applyMigrationUnderLock(plan, options);
  const operationLock = acquireDataDirOperationLock(plan.dataDir, "migration-apply");
  try {
    return applyMigrationUnderLock(plan, options);
  } finally {
    operationLock.release();
  }
}

function applyMigrationUnderLock(
  plan: MigrationPlan,
  options: MigrationApplyOptions = {},
): MigrationResult {
  const dryRun = options.dryRun === true;
  const clock = options.clock ?? (() => new Date());
  const now = clock();
  const dataDir = plan.dataDir;

  if (dryRun) {
    return {
      wrote: false,
      backupDir: null,
      report: renderReport(plan, { dryRun, wrote: false, backupDir: null, now }),
    };
  }

  const unfinished = findUnfinishedMigration(dataDir);
  if (unfinished) {
    throw new Error(
      `检测到未完成迁移：${unfinished.backupDir}（${unfinished.detail}）。` +
        "请先执行 `penglai migrate rollback --backup <目录>` 恢复，禁止覆盖式重跑。",
    );
  }

  if (!planHasWrites(plan)) {
    return {
      wrote: false,
      backupDir: null,
      report: renderReport(plan, { dryRun: false, wrote: false, backupDir: null, now }),
    };
  }

  const globalRoot = path.join(dataDir, "memory", "global");
  const memory = new MemoryStore(globalRoot);
  const l1File = path.join(globalRoot, L1_FILE_NAME);
  const profilesToWrite = plan.profiles.filter((profile) => profile.action === "create");
  const whitelistToAdd = plan.whitelist
    .filter((entry) => entry.action === "create")
    .map((entry) => entry.openId);
  const plantedSops = plan.memory.sops.filter((sop) => sop.action === "plant");

  // A stale/untrusted SOP body would make MemoryStore quarantine to a random
  // filename. Refuse it here so every possible migration target stays known
  // and journalled before the first write.
  for (const sop of plantedSops) {
    const body = path.join(globalRoot, "sop", `${sop.name}.md`);
    const receipt = memory.sopReceiptFile(sop.name);
    if (fs.existsSync(body) || fs.existsSync(receipt)) {
      throw new Error(`迁移计划已过期：SOP ${sop.name} 的目标文件已存在，请重新预览后执行`);
    }
  }

  const mutations: PlannedMigrationMutation[] = [];
  if (profilesToWrite.length > 0) {
    const target = path.join(dataDir, "profiles.json");
    mutations.push({
      id: "profiles",
      journalTargets: [target],
      recoveryTargets: [target],
      syncTargets: [target],
      mutate: () => {
        for (const profile of profilesToWrite) {
          savePersistedProfile(dataDir, {
            id: profile.id,
            label: profile.label,
            provider: profile.provider,
            baseUrl: profile.baseUrl,
            model: profile.model,
            apiKeyEnv: "",
            apiKey: profile.apiKey,
          });
        }
      },
    });
  }
  if (plan.channel.action === "create") {
    const target = path.join(dataDir, "channels.json");
    mutations.push({
      id: "channel",
      journalTargets: [target],
      recoveryTargets: [target],
      syncTargets: [target],
      mutate: () => {
        saveChannelConfig(dataDir, {
          appId: plan.channel.appId,
          appSecret: plan.channel.appSecret,
          enabled: true,
        });
      },
    });
  }

  const whitelistPlan = captureWhitelistRecovery(dataDir, whitelistToAdd, now.getTime());
  if (whitelistPlan) {
    const databaseBundle = sqliteBundlePaths(whitelistPlan.databasePath);
    mutations.push({
      id: "whitelist",
      journalTargets: [whitelistPlan.databasePath],
      recoveryTargets: [whitelistPlan.databasePath],
      syncTargets: databaseBundle,
      mutate: () => applyWhitelistMutation(whitelistPlan, options.faultInjection),
    });
  }

  const willTouchL1 =
    plan.memory.insightAction === "l1-section" ||
    plan.memory.insightAction === "l1-section-truncated";
  if (willTouchL1) {
    mutations.push({
      id: "memory-l1",
      journalTargets: [l1File],
      recoveryTargets: [l1File],
      syncTargets: [l1File],
      mutate: () => {
        if (!memory.writeManagedSection(MIGRATION_SECTION_TAG, plan.memory.insightLines)) {
          throw new Error("L1 迁移区写入被铁律拒绝；目标状态已变化，请回滚后重新预览");
        }
      },
    });
  }

  const archiveWrites: Array<{ path: string; name: string; content: string }> = [];
  if (
    plan.memory.insightAction === "l1-section-truncated" ||
    plan.memory.insightAction === "archive-only"
  ) {
    archiveWrites.push({
      path: path.join(globalRoot, `${ARCHIVE_L1_NOTE}.md`),
      name: ARCHIVE_L1_NOTE,
      content:
        `# 0.3 L1 索引全文归档（global_mem_insight.txt）\n\n` +
        `> 来源：${path.join(plan.sourceDir, "memory", "global_mem_insight.txt")}；` +
        `因 ≤30 行铁律未全量进 L1，penglai migrate 全文归档于此。\n\n` +
        plan.memory.insightFull.join("\n") +
        "\n",
    });
  }
  if (plan.memory.factsAction === "archive" || plan.memory.factsAction === "archive-update") {
    archiveWrites.push({
      path: path.join(globalRoot, `${ARCHIVE_FACTS_NOTE}.md`),
      name: ARCHIVE_FACTS_NOTE,
      content: plan.memory.factsContent,
    });
  }
  for (const sop of plan.memory.sops) {
    if (sop.action === "archive" && sop.archiveName && sop.archiveContent) {
      archiveWrites.push({
        path: path.join(globalRoot, `${sop.archiveName}.md`),
        name: sop.archiveName,
        content: sop.archiveContent,
      });
    }
  }
  if (archiveWrites.length > 0) {
    const targets = archiveWrites.map((entry) => entry.path);
    mutations.push({
      id: "memory-archives",
      journalTargets: targets,
      recoveryTargets: targets,
      syncTargets: targets,
      mutate: () => {
        for (const archive of archiveWrites) {
          memory.writeGlobalArchive(archive.name, archive.content);
        }
      },
    });
  }

  if (plantedSops.length > 0) {
    const targets = [l1File, memory.sopMigrationAuthorityFile()];
    for (const sop of plantedSops) {
      targets.push(path.join(globalRoot, "sop", `${sop.name}.md`));
      targets.push(memory.sopReceiptFile(sop.name));
    }
    mutations.push({
      id: "memory-sops",
      journalTargets: uniquePaths(targets),
      recoveryTargets: uniquePaths(targets),
      syncTargets: uniquePaths(targets),
      mutate: () => {
        for (const sop of plantedSops) {
          memory.writeGlobalSop(sop.name, sop.content, MIGRATION_PROVENANCE);
        }
      },
    });
  }

  const recoveryTargets = uniquePaths(mutations.flatMap((mutation) => mutation.recoveryTargets));
  const logicalSqliteTargets = new Set(
    whitelistPlan ? [path.resolve(whitelistPlan.databasePath)] : [],
  );
  const recoveryFiles = recoveryFilesForTargets(
    dataDir,
    recoveryTargets.filter((target) => !logicalSqliteTargets.has(path.resolve(target))),
  );
  const backupDir = allocateBackupDir(dataDir, now);
  const journal: MigrationJournal = {
    journalVersion: MIGRATION_JOURNAL_VERSION,
    sequence: 0,
    legacyManifest: false,
    state: "in_progress",
    phase: "preparing_backups",
    currentStep: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dataDir,
    sourceDir: plan.sourceDir,
    filesBackedUp: recoveryFiles.filesBackedUp,
    filesCreated: recoveryFiles.filesCreated,
    directoriesCreated: missingDirectoriesForTargets(dataDir, recoveryTargets),
    whitelistAdded: [...whitelistToAdd],
    whitelistRecovery: whitelistPlan,
    sqliteSnapshots: [],
    postApplyFiles: [],
    steps: [],
  };
  const writer = new JournalWriter(backupDir, journal, clock);
  // This fsynced manifest is the write-ahead barrier: no migration target is
  // touched until the full recovery set is durable.
  writer.persist();
  options.faultInjection?.("before:backups");
  copyRecoveryBackups(backupDir, journal);
  if (whitelistPlan) {
    options.faultInjection?.("before:sqlite-snapshots");
    const sqliteSnapshot = prepareSqliteSnapshotPair(backupDir, whitelistPlan);
    journal.sqliteSnapshots = [sqliteSnapshot];
    // The expected logical postimage is derived before the live transaction,
    // closing the crash window between SQLite COMMIT and journal persistence.
    journal.postApplyFiles.push({
      path: path.resolve(sqliteSnapshot.databasePath),
      exists: true,
      sha256: sqliteSnapshot.afterLogicalSha256,
    });
    journal.phase = "sqlite_snapshots_ready";
    writer.persist();
    options.faultInjection?.("after:sqlite-snapshots");
  }
  options.faultInjection?.("after:backups");
  journal.phase = "backups_ready";
  writer.persist();

  const touched = new Set<string>();
  for (const mutation of mutations) {
    assertTargetsStillMatchBackup(backupDir, journal, mutation.recoveryTargets, touched);
    runJournaledMutation(writer, mutation, options.faultInjection);
    for (const target of mutation.recoveryTargets) touched.add(path.resolve(target));
  }

  const report = renderReport(plan, { dryRun: false, wrote: true, backupDir, now });
  const reportPath = path.join(backupDir, "report.md");
  const reportStep = prepareJournalStep(writer, "artifact", "report", [reportPath]);
  options.faultInjection?.("before:report");
  durableWriteNewFile(reportPath, `${report}\n`);
  options.faultInjection?.("after:report");
  completeJournalStep(writer, reportStep);

  journal.phase = "commit_prepared";
  journal.currentStep = "commit";
  writer.persist();
  options.faultInjection?.("before:commit");
  journal.state = "committed";
  journal.phase = "committed";
  journal.currentStep = null;
  writer.persist();
  options.faultInjection?.("after:commit");

  return { wrote: true, backupDir, report };
}

// ── 回滚 ───────────────────────────────────────────────────────

/** 最近一次备份目录（migrate-backup 下时间戳最大者）。 */
export function latestBackupDir(dataDir: string): string | null {
  const root = path.join(dataDir, "migrate-backup");
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((entry) => fs.existsSync(path.join(root, entry, MANIFEST_FILE_NAME)))
    .sort();
  return dirs.length > 0 ? path.join(root, dirs[dirs.length - 1]) : null;
}

function validateRecoveryJournal(backupDir: string, journal: MigrationJournal): void {
  const classified = new Set<string>();
  for (const entry of journal.filesBackedUp) {
    assertRecoveryTarget(journal.dataDir, entry.path);
    if (classified.has(entry.path)) throw new Error(`journal target is duplicated: ${entry.path}`);
    classified.add(entry.path);
    const backupFile = path.join(backupDir, entry.backup);
    if (!isPathInside(backupDir, backupFile)) {
      throw new Error(`journal backup escapes backupDir: ${entry.backup}`);
    }
  }
  for (const target of journal.filesCreated) {
    assertRecoveryTarget(journal.dataDir, target);
    if (classified.has(target)) throw new Error(`journal target is duplicated: ${target}`);
    classified.add(target);
  }
  for (const directory of journal.directoriesCreated) {
    assertRecoveryTarget(journal.dataDir, directory);
  }
  const sqliteClassified = new Set<string>();
  for (const snapshot of journal.sqliteSnapshots) {
    const databasePath = path.resolve(snapshot.databasePath);
    assertRecoveryTarget(journal.dataDir, databasePath);
    if (classified.has(databasePath) || sqliteClassified.has(databasePath)) {
      throw new Error(`journal SQLite target is duplicated: ${databasePath}`);
    }
    sqliteClassified.add(databasePath);
    const snapshotFiles = [snapshot.afterFile];
    if (snapshot.beforeFile) snapshotFiles.push(snapshot.beforeFile);
    for (const name of snapshotFiles) sqliteSnapshotFile(backupDir, name);
  }
  const fingerprinted = new Set<string>();
  for (const entry of journal.postApplyFiles) {
    const resolved = path.resolve(entry.path);
    assertRecoveryTarget(journal.dataDir, resolved);
    if (fingerprinted.has(resolved)) {
      throw new Error(`journal post-apply target is duplicated: ${resolved}`);
    }
    fingerprinted.add(resolved);
  }
  if (journal.whitelistRecovery) {
    assertRecoveryTarget(journal.dataDir, journal.whitelistRecovery.databasePath);
    if (path.resolve(journal.whitelistRecovery.databasePath) !== path.resolve(productDbPath(journal.dataDir))) {
      throw new Error("journal whitelist database path is not product.db");
    }
    const whitelistMayHaveMutated =
      journal.state === "committed" ||
      journal.steps.some(
        (step) =>
          step.kind === "apply" &&
          step.targets.some(
            (target) =>
              path.resolve(target) ===
              path.resolve(journal.whitelistRecovery!.databasePath),
          ),
      );
    if (
      journal.whitelistRecovery.fullDatabaseRecovery &&
      whitelistMayHaveMutated &&
      !sqliteClassified.has(path.resolve(journal.whitelistRecovery.databasePath)) &&
      sqliteBundlePaths(journal.whitelistRecovery.databasePath).some(
        (target) => !classified.has(path.resolve(target)),
      )
    ) {
      throw new Error("journal full SQLite recovery bundle is incomplete");
    }
  }
}

function targetsThatMayHaveMutated(journal: MigrationJournal): Set<string> {
  if (journal.state === "committed" || journal.legacyManifest) {
    return new Set([
      ...journal.filesBackedUp.map((entry) => path.resolve(entry.path)),
      ...journal.filesCreated.map((entry) => path.resolve(entry)),
      ...(journal.whitelistRecovery ? [path.resolve(journal.whitelistRecovery.databasePath)] : []),
    ]);
  }
  return new Set(
    journal.steps
      .filter((step) => step.kind === "apply")
      .flatMap((step) => step.targets)
      .map((target) => path.resolve(target)),
  );
}

function validateRollbackAssets(
  backupDir: string,
  journal: MigrationJournal,
  mutatedTargets: Set<string>,
): void {
  for (const entry of journal.filesBackedUp) {
    if (!mutatedTargets.has(path.resolve(entry.path))) continue;
    const backupFile = path.join(backupDir, entry.backup);
    if (!fs.existsSync(backupFile)) throw new Error(`备份副本缺失，拒绝部分回滚：${backupFile}`);
    const stat = fs.lstatSync(backupFile);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`备份副本不是普通文件，拒绝回滚：${backupFile}`);
    }
    if (entry.sha256 && sha256File(backupFile) !== entry.sha256) {
      throw new Error(`备份副本校验失败，拒绝回滚：${backupFile}`);
    }
  }
  for (const snapshot of journal.sqliteSnapshots) {
    if (!mutatedTargets.has(path.resolve(snapshot.databasePath))) continue;
    const assets: Array<{ name: string; sha256: string }> = [
      { name: snapshot.afterFile, sha256: snapshot.afterSha256 },
    ];
    if (snapshot.databaseExisted) {
      assets.push({ name: snapshot.beforeFile!, sha256: snapshot.beforeSha256! });
    }
    for (const asset of assets) {
      const file = sqliteSnapshotFile(backupDir, asset.name);
      if (!fs.existsSync(file)) throw new Error(`SQLite 逻辑快照缺失，拒绝回滚：${file}`);
      if (sha256File(file) !== asset.sha256) {
        throw new Error(`SQLite 逻辑快照校验失败，拒绝回滚：${file}`);
      }
      assertHealthySqliteFile(file);
    }
  }
}

function preimageFingerprint(
  backupDir: string,
  journal: MigrationJournal,
  target: string,
): MigrationTargetFingerprint | null {
  const resolved = path.resolve(target);
  const sqliteSnapshot = sqliteSnapshotForTarget(journal, resolved);
  if (sqliteSnapshot) {
    return sqliteSnapshot.databaseExisted
      ? {
          path: resolved,
          exists: true,
          sha256: sqliteSnapshot.beforeLogicalSha256,
        }
      : { path: resolved, exists: false, sha256: null };
  }
  const backup = journal.filesBackedUp.find((entry) => path.resolve(entry.path) === resolved);
  if (backup) {
    return {
      path: resolved,
      exists: true,
      sha256: backup.sha256 ?? sha256File(path.join(backupDir, backup.backup)),
    };
  }
  if (journal.filesCreated.some((entry) => path.resolve(entry) === resolved)) {
    return { path: resolved, exists: false, sha256: null };
  }
  return null;
}

function assertRollbackTargetsUnchanged(
  backupDir: string,
  journal: MigrationJournal,
  mutatedTargets: Set<string>,
): void {
  const postimages = new Map(
    journal.postApplyFiles.map((entry) => [path.resolve(entry.path), entry]),
  );
  for (const target of mutatedTargets) {
    const current = sqliteSnapshotForTarget(journal, target)
      ? logicalSqliteFingerprint(backupDir, journal.dataDir, target)
      : fingerprintTarget(journal.dataDir, target);
    const preimage = preimageFingerprint(backupDir, journal, target);
    if (preimage && sameFingerprint(current, preimage)) continue;
    const postimage = postimages.get(path.resolve(target));
    if (postimage && sameFingerprint(current, postimage)) continue;
    if (!postimage) {
      throw new Error(
        `迁移 journal 缺少 post-apply 指纹，拒绝破坏性自动回滚：${target}；` +
          "请保留备份并手工恢复",
      );
    }
    throw new Error(
      `迁移完成后目标已被外部修改，拒绝覆盖/删除 owner 数据：${target}`,
    );
  }
}

function runRollbackMutation(
  writer: JournalWriter,
  id: string,
  targets: string[],
  mutate: () => void,
  faultInjection?: MigrationFaultInjector,
): void {
  const step = prepareJournalStep(writer, "rollback", id, targets);
  faultInjection?.(`before:${id}`);
  mutate();
  faultInjection?.(`after:${id}`);
  completeJournalStep(writer, step);
}

/**
 * 回滚一次迁移：恢复被覆盖的文件、删除本次新建的文件、移除白名单新增行。
 * 幂等：已恢复过的备份再次回滚只报告现状，不报错。
 */
export function rollbackMigration(
  backupDir: string,
  options: MigrationRollbackOptions = {},
): string[] {
  const resolvedBackupDir = path.resolve(backupDir);
  const backupRoot = path.dirname(resolvedBackupDir);
  if (path.basename(backupRoot) !== "migrate-backup") {
    throw new Error(`备份目录不在 dataDir/migrate-backup 下：${backupDir}`);
  }
  const inferredDataDir = path.dirname(backupRoot);
  const operationLock = acquireDataDirOperationLock(
    inferredDataDir,
    "migration-rollback",
  );
  try {
    return rollbackMigrationUnderLock(resolvedBackupDir, operationLock.dataDir, options);
  } finally {
    operationLock.release();
  }
}

function rollbackMigrationUnderLock(
  backupDir: string,
  inferredDataDir: string,
  options: MigrationRollbackOptions = {},
): string[] {
  const lines: string[] = [];
  if (!fs.existsSync(path.join(backupDir, MANIFEST_FILE_NAME))) {
    throw new Error(`备份目录缺 manifest.json，无法回滚：${backupDir}`);
  }
  const journal = readMigrationJournalWithSequence(backupDir);
  const journalDataDir = fs.realpathSync.native(path.resolve(journal.dataDir));
  if (journalDataDir !== inferredDataDir) {
    throw new Error("迁移 journal 的 dataDir 与备份目录身份不一致，拒绝回滚");
  }
  validateRecoveryJournal(backupDir, journal);
  if (journal.state === "rolled_back") {
    return [`  ○ 该迁移已回滚（${backupDir}）`];
  }
  const mutatedTargets = targetsThatMayHaveMutated(journal);
  const wasLegacy = journal.legacyManifest;
  validateRollbackAssets(backupDir, journal, mutatedTargets);
  if (wasLegacy && journal.whitelistAdded.length > 0) {
    throw new Error(
      "旧版迁移 journal 没有白名单 post-apply 指纹，拒绝破坏性自动回滚；请保留备份并手工恢复",
    );
  }
  assertRollbackTargetsUnchanged(backupDir, journal, mutatedTargets);

  const clock = options.clock ?? (() => new Date());
  const writer = new JournalWriter(backupDir, journal, clock);
  journal.state = "in_progress";
  journal.phase = "rollback_started";
  journal.currentStep = null;
  writer.persist();
  options.faultInjection?.("before:rollback");

  const whitelistMutated =
    wasLegacy ||
    (journal.whitelistRecovery !== null &&
      mutatedTargets.has(path.resolve(journal.whitelistRecovery.databasePath)));
  if (
    journal.whitelistRecovery &&
    whitelistMutated &&
    !journal.whitelistRecovery.fullDatabaseRecovery
  ) {
    runRollbackMutation(
      writer,
      "rollback:whitelist",
      [journal.whitelistRecovery.databasePath],
      () => restoreWhitelistMutation(journal.whitelistRecovery!),
      options.faultInjection,
    );
    lines.push(
      `  ✓ 恢复白名单（撤销 ${journal.whitelistRecovery.intendedAdded.length} 行及本次 schema/file 创建）`,
    );
  } else if (wasLegacy && journal.whitelistAdded.length > 0) {
    runRollbackMutation(
      writer,
      "rollback:legacy-whitelist",
      [productDbPath(journal.dataDir)],
      () => removeWhitelistRows(journal.dataDir, journal.whitelistAdded),
      options.faultInjection,
    );
    lines.push(`  ✓ 白名单移除 ${journal.whitelistAdded.length} 行（${journal.whitelistAdded.join(" / ")}）`);
  } else if (
    journal.whitelistRecovery?.fullDatabaseRecovery &&
    whitelistMutated &&
    journal.sqliteSnapshots.length === 0
  ) {
    lines.push("  ✓ 白名单由旧版完整 SQLite bundle 的 preimage 恢复");
  }

  const sqliteToRestore = journal.sqliteSnapshots.filter((snapshot) =>
    mutatedTargets.has(path.resolve(snapshot.databasePath)),
  );
  for (const [index, snapshot] of sqliteToRestore.entries()) {
    runRollbackMutation(
      writer,
      `rollback:restore-sqlite:${String(index + 1).padStart(4, "0")}`,
      [snapshot.databasePath],
      () => restoreSqliteLogicalSnapshot(backupDir, snapshot, options.faultInjection),
      options.faultInjection,
    );
    lines.push(
      snapshot.databaseExisted
        ? `  ✓ 从一致性逻辑快照恢复 ${snapshot.databasePath}`
        : `  ✓ 恢复迁移前状态：删除新建的 SQLite 数据库 ${snapshot.databasePath}`,
    );
  }

  const createdToRemove = [...journal.filesCreated]
    .filter((target) => mutatedTargets.has(path.resolve(target)))
    .reverse();
  for (const [index, created] of createdToRemove.entries()) {
    runRollbackMutation(
      writer,
      `rollback:delete-created:${String(index + 1).padStart(4, "0")}`,
      [created],
      () => {
        assertSafeTargetParents(journal.dataDir, created);
        if (fs.existsSync(created)) {
          const stat = fs.lstatSync(created);
          if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error(`回滚目标不是普通文件，拒绝删除：${created}`);
          }
          fs.rmSync(created);
          fsyncDirectory(path.dirname(created));
          lines.push(`  ✓ 删除新建文件 ${created}`);
        } else {
          lines.push(`  ○ 新建文件已不在（无需删除）${created}`);
        }
      },
      options.faultInjection,
    );
  }

  const backedUpToRestore = [...journal.filesBackedUp]
    .filter((entry) => mutatedTargets.has(path.resolve(entry.path)))
    .reverse();
  for (const [index, entry] of backedUpToRestore.entries()) {
    const backupFile = path.join(backupDir, entry.backup);
    runRollbackMutation(
      writer,
      `rollback:restore-file:${String(index + 1).padStart(4, "0")}`,
      [entry.path],
      () => {
        assertSafeTargetParents(journal.dataDir, entry.path);
        if (fs.existsSync(entry.path)) {
          const stat = fs.lstatSync(entry.path);
          if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error(`回滚目标不是普通文件，拒绝覆盖：${entry.path}`);
          }
        }
        durableRestoreFile(backupFile, entry.path, entry.mode);
        lines.push(`  ✓ 恢复 ${entry.path}`);
      },
      options.faultInjection,
    );
  }

  if (mutatedTargets.size > 0) {
    const directories = [...journal.directoriesCreated].sort(
      (a, b) => b.length - a.length || b.localeCompare(a),
    );
    for (const [index, directory] of directories.entries()) {
      runRollbackMutation(
        writer,
        `rollback:remove-directory:${String(index + 1).padStart(4, "0")}`,
        [directory],
        () => {
          if (!fs.existsSync(directory)) return;
          const stat = fs.lstatSync(directory);
          if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`回滚目录目标已改变，拒绝删除：${directory}`);
          }
          if (fs.readdirSync(directory).length === 0) {
            fs.rmdirSync(directory);
            fsyncDirectory(path.dirname(directory));
          }
        },
        options.faultInjection,
      );
    }
  }

  journal.phase = "rollback_verifying";
  journal.currentStep = null;
  writer.persist();
  for (const entry of backedUpToRestore) {
    if (!fs.existsSync(entry.path)) throw new Error(`rollback verification failed: ${entry.path} missing`);
    const expected = entry.sha256 ?? sha256File(path.join(backupDir, entry.backup));
    if (sha256File(entry.path) !== expected) {
      throw new Error(`rollback verification failed: ${entry.path} differs from backup`);
    }
  }
  for (const target of createdToRemove) {
    if (fs.existsSync(target)) throw new Error(`rollback verification failed: ${target} still exists`);
  }
  for (const snapshot of sqliteToRestore) {
    const current = logicalSqliteFingerprint(
      backupDir,
      journal.dataDir,
      snapshot.databasePath,
    );
    const expected: MigrationTargetFingerprint = snapshot.databaseExisted
      ? {
          path: path.resolve(snapshot.databasePath),
          exists: true,
          sha256: snapshot.beforeLogicalSha256,
        }
      : { path: path.resolve(snapshot.databasePath), exists: false, sha256: null };
    if (!sameFingerprint(current, expected)) {
      throw new Error(`rollback verification failed: SQLite differs from logical preimage`);
    }
  }
  if (journal.whitelistRecovery && whitelistMutated) verifyWhitelistRestored(journal.whitelistRecovery);
  if (wasLegacy && journal.whitelistAdded.length > 0) {
    const remaining = readExistingWhitelist(journal.dataDir);
    if (journal.whitelistAdded.some((openId) => remaining.has(openId))) {
      throw new Error("rollback verification failed: legacy whitelist rows remain");
    }
  }

  options.faultInjection?.("before:rollback:complete");
  journal.state = "rolled_back";
  journal.phase = "rolled_back";
  journal.currentStep = null;
  writer.persist();
  options.faultInjection?.("after:rollback:complete");
  if (lines.length === 0) lines.push("  ○ 该备份无需回滚项");
  return lines;
}

// ── 中文报告 ───────────────────────────────────────────────────

function renderReport(
  plan: MigrationPlan,
  result: { dryRun: boolean; wrote: boolean; backupDir: string | null; now: Date },
): string {
  const lines: string[] = [];
  const stamp = `${result.now.getFullYear()}-${String(result.now.getMonth() + 1).padStart(2, "0")}-${String(result.now.getDate()).padStart(2, "0")} ${String(result.now.getHours()).padStart(2, "0")}:${String(result.now.getMinutes()).padStart(2, "0")}`;
  lines.push(`蓬莱 0.3 → 0.4 迁移报告（${stamp}）`);
  lines.push(`来源：${plan.sourceDir}`);
  lines.push(`目标：${plan.dataDir}`);
  lines.push(
    result.dryRun
      ? "模式：干跑（--dry-run）——未写入任何内容，以下仅为计划"
      : result.wrote
        ? "模式：执行——以下改动已落盘并备份"
        : "模式：执行——所有项均已迁移过（幂等跳过），本次零写入",
  );

  lines.push("", "模型档案");
  if (plan.profiles.length === 0) lines.push("  ○ 0.3 无可迁移的模型配置");
  for (const profile of plan.profiles) {
    if (profile.action === "create") {
      lines.push(
        `  ✓ ${profile.id}（${profile.model} @ ${profile.baseUrl}，供应商 ${profile.provider}）· key ${profile.maskedKey} — 新建（源 ${profile.sourceVar}）`,
      );
    } else {
      lines.push(`  ○ ${profile.id} — ${profile.reason}`);
    }
  }

  lines.push("", "记忆");
  const memory = plan.memory;
  switch (memory.insightAction) {
    case "l1-section":
      lines.push(`  ✓ 0.3 L1 索引 → L1.md 迁移区（${memory.insightLines.length - 1} 行${memory.insightReason ? `，${memory.insightReason}` : ""}）`);
      break;
    case "l1-section-truncated":
      lines.push(
        `  ✓ 0.3 L1 索引 → L1.md 迁移区（裁剪入 ${memory.insightLines.length - 2} 行）＋ 全文归档 ${ARCHIVE_L1_NOTE}（≤30 行铁律）`,
      );
      break;
    case "archive-only":
      lines.push(`  ✓ 0.3 L1 索引 → 全文归档 ${ARCHIVE_L1_NOTE}（${memory.insightReason}）`);
      break;
    case "skip-unchanged":
      lines.push(`  ○ 0.3 L1 索引 — ${memory.insightReason}`);
      break;
    default:
      lines.push("  ○ 0.3 L1 索引为空或缺失，跳过");
  }
  switch (memory.factsAction) {
    case "archive":
      lines.push(`  ✓ 全局事实库 → 归档笔记 ${ARCHIVE_FACTS_NOTE}`);
      break;
    case "archive-update":
      lines.push(`  ✓ 全局事实库 → 更新归档笔记 ${ARCHIVE_FACTS_NOTE}（${memory.factsReason}）`);
      break;
    case "skip-unchanged":
      lines.push(`  ○ 全局事实库 — ${memory.factsReason}`);
      break;
    default:
      lines.push("  ○ 全局事实库为空或缺失，跳过");
  }
  for (const sop of memory.sops) {
    if (sop.action === "plant") {
      lines.push(`  ✓ SOP ${sop.name} — 审计通过，入技能树（源 0.3 memory/${sop.name}.md）`);
    } else if (sop.action === "archive") {
      lines.push(`  ○ SOP ${sop.name} — ${sop.reason}`);
    } else {
      lines.push(`  ○ SOP ${sop.name} — ${sop.reason}`);
    }
  }
  lines.push(`  ○ 项目记忆 — ${memory.projectNote}`);

  lines.push("", "渠道");
  if (plan.channel.action === "create") {
    lines.push(`  ✓ 飞书 app ${plan.channel.maskedAppId} · secret ${plan.channel.maskedSecret} — 写入 channels.json（0600，enabled）`);
  } else if (plan.channel.action === "none") {
    lines.push(`  ○ ${plan.channel.reason}`);
  } else {
    lines.push(`  ○ 飞书 — ${plan.channel.reason}`);
  }
  for (const entry of plan.whitelist) {
    lines.push(
      entry.action === "create"
        ? `  ✓ 白名单 + ${entry.openId}`
        : `  ○ 白名单 ${entry.openId} — 已在列`,
    );
  }

  if (plan.skips.length > 0) {
    lines.push("", "跳过及原因");
    for (const skip of plan.skips) {
      lines.push(`  ○ [${skip.area}] ${skip.item} — ${skip.reason}`);
    }
  }

  lines.push("", "备份与回滚");
  if (result.dryRun) {
    lines.push("  （干跑未产生备份；正式执行时会先备份再写入）");
  } else if (result.wrote && result.backupDir) {
    lines.push(`  备份：${result.backupDir}`);
    lines.push("  回滚：penglai migrate rollback");
  } else {
    lines.push("  （本次零写入，未产生备份）");
  }
  lines.push("");
  lines.push("提示：profiles/channels 由 host 启动时加载——若 host 正在运行，重启后生效；记忆即时生效。");
  return lines.join("\n");
}
