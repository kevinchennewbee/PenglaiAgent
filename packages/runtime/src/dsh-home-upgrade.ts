import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PenglaiError, readExactRegularFile } from "@penglai/contracts";
import { writeFileAtomic } from "./permissions.js";

export const DSH_HOME_SOURCE_VERSION = "0.1.1-rc.2";
export const DSH_HOME_TARGET_VERSION = "0.1.2-alpha.1";
export const DSH_HOME_UPGRADE_ID = "dsh-home-0.1.1-rc.2-to-0.1.2-alpha.1";

const MANIFEST_NAME = ".penglai-dsh-home.json";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_RESERVE_BYTES = 256 * 1024 * 1024;
const WRITER_OWNER_NAME = "owner.json";

export interface DshHomeUpgradePaths {
  userRoot: string;
  sourceHome: string;
  homesRoot: string;
  targetHome: string;
  operationsRoot: string;
  activeManifest: string;
  lock: string;
}

export interface DshHomeSnapshot {
  files: number;
  directories: number;
  bytes: number;
  digest: string;
}

export interface DshHomeValidation {
  dshVersion: typeof DSH_HOME_TARGET_VERSION;
  officialDocument: true;
  dshHealthy: true;
  profileReady: true;
  requiredPluginsActive: string[];
  validatedAt: string;
}

export interface DshHomeUpgradeJournal {
  schema: 1;
  migrationId: typeof DSH_HOME_UPGRADE_ID;
  operationId: string;
  fromVersion: typeof DSH_HOME_SOURCE_VERSION;
  toVersion: typeof DSH_HOME_TARGET_VERSION;
  state: "prepared" | "active" | "rolled-back" | "rejected";
  sourceRelative: "dsh-home";
  targetRelative: string;
  sourceSnapshot: DshHomeSnapshot;
  preparedSnapshot: DshHomeSnapshot;
  credentialsCopiedToPrivateWorkingHome: boolean;
  preparedAt: string;
  validation?: DshHomeValidation;
  activeSnapshot?: DshHomeSnapshot;
  activatedAt?: string;
  rolledBackAt?: string;
  rollbackReason?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface ActiveDshHomeManifest {
  schema: 1;
  activeVersion:
    typeof DSH_HOME_SOURCE_VERSION | typeof DSH_HOME_TARGET_VERSION;
  homeRelative: string;
  operationId?: string;
  activatedAt: string;
  targetDigest?: string;
  rollbackReason?: string;
}

interface TreeEntry {
  relative: string;
  kind: "directory" | "file";
  size: number;
  ownerExecutable: boolean;
  digest?: string;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertOperationId(operationId: string): void {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "invalid DSH home upgrade operation id",
    );
  }
}

function assertVersion(version: string): void {
  if (
    version !== DSH_HOME_SOURCE_VERSION &&
    version !== DSH_HOME_TARGET_VERSION
  ) {
    throw new PenglaiError("INVALID_INPUT", "unsupported DSH home generation");
  }
}

export function resolveDshHomeUpgradePaths(
  userRoot: string,
): DshHomeUpgradePaths {
  if (!isAbsolute(userRoot)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "DSH home upgrade root must be absolute",
    );
  }
  const root = resolve(userRoot);
  return {
    userRoot: root,
    sourceHome: join(root, "dsh-home"),
    homesRoot: join(root, "dsh-homes"),
    targetHome: join(root, "dsh-homes", `dsh-v${DSH_HOME_TARGET_VERSION}`),
    operationsRoot: join(root, "dsh-home-migrations"),
    activeManifest: join(root, "dsh-home-active.json"),
    lock: join(root, "dsh-home-migrations", ".writer-lock"),
  };
}

function assertRealDirectory(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      `${label} must be a real directory`,
    );
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function recoverDeadWriterLock(paths: DshHomeUpgradePaths): boolean {
  const stat = lstatSync(paths.lock);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "DSH home migration writer lock is not a real directory",
    );
  }
  let owner: unknown;
  try {
    owner = JSON.parse(
      readExactRegularFile(
        join(paths.lock, WRITER_OWNER_NAME),
        16 * 1024,
      ).toString("utf8"),
    );
  } catch {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "DSH home migration writer lock owner is unreadable",
    );
  }
  const value = owner as {
    schema?: unknown;
    pid?: unknown;
    nonce?: unknown;
    createdAt?: unknown;
  };
  if (
    value.schema !== 1 ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0 ||
    typeof value.nonce !== "string" ||
    !/^[0-9a-f]{32}$/.test(value.nonce) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "DSH home migration writer lock owner has invalid identity",
    );
  }
  if (processIsAlive(Number(value.pid))) return false;
  rmSync(paths.lock, { recursive: true, force: false, maxRetries: 0 });
  return true;
}

function withWriterLock<T>(paths: DshHomeUpgradePaths, fn: () => T): T {
  mkdirSync(paths.operationsRoot, { recursive: true, mode: 0o700 });
  assertRealDirectory(paths.operationsRoot, "DSH home migration root");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(paths.lock, { mode: 0o700 });
      try {
        writeJson(join(paths.lock, WRITER_OWNER_NAME), {
          schema: 1,
          pid: process.pid,
          nonce: randomBytes(16).toString("hex"),
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        rmSync(paths.lock, { recursive: true, force: false, maxRetries: 0 });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt === 0 && recoverDeadWriterLock(paths)) continue;
      throw new PenglaiError(
        "SECURITY_POLICY",
        "another DSH home migration writer is active",
      );
    }
  }
  try {
    return fn();
  } finally {
    rmSync(paths.lock, { recursive: true, force: false, maxRetries: 0 });
  }
}

function safeRelative(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "DSH home migration path escaped its generation",
    );
  }
}

function walkTree(
  root: string,
  options: { maxEntries: number; maxBytes: number },
): TreeEntry[] {
  assertRealDirectory(root, "DSH home");
  const canonicalRoot = realpathSync(root);
  const entries: TreeEntry[] = [];
  const pending = [canonicalRoot];
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (!inside(canonicalRoot, current)) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "DSH home walk escaped its generation",
      );
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "DSH home migration refuses symlink state",
      );
    }
    if (!inside(canonicalRoot, realpathSync(current))) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "DSH home migration resolved outside its generation",
      );
    }
    if (current !== canonicalRoot) {
      const rel = relative(canonicalRoot, current).replaceAll("\\", "/");
      safeRelative(rel);
      if (rel === MANIFEST_NAME) continue;
      if (stat.isDirectory()) {
        entries.push({
          relative: rel,
          kind: "directory",
          size: 0,
          ownerExecutable: true,
        });
      } else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > options.maxBytes) {
          throw new PenglaiError(
            "SECURITY_POLICY",
            "DSH home migration exceeded byte bound",
          );
        }
        entries.push({
          relative: rel,
          kind: "file",
          size: stat.size,
          ownerExecutable: Boolean(stat.mode & 0o100),
        });
      } else {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "DSH home migration refuses special filesystem state",
        );
      }
      if (entries.length > options.maxEntries) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "DSH home migration exceeded entry bound",
        );
      }
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(current).sort().reverse()) {
        safeRelative(name);
        pending.push(join(current, name));
      }
    }
  }
  return entries.sort((a, b) => a.relative.localeCompare(b.relative));
}

function hashFile(path: string): string {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const length = readSync(descriptor, buffer, 0, buffer.length, null);
      if (length === 0) break;
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function snapshotTree(
  root: string,
  options: { maxEntries: number; maxBytes: number },
): DshHomeSnapshot {
  const entries = walkTree(root, options);
  for (const entry of entries) {
    if (entry.kind === "file")
      entry.digest = hashFile(join(root, entry.relative));
  }
  const digest = createHash("sha256")
    .update(
      entries
        .map(
          (entry) =>
            `${entry.kind}:${entry.relative}:${entry.size}:${entry.ownerExecutable ? 1 : 0}:${entry.digest ?? ""}`,
        )
        .join("\n"),
    )
    .digest("hex");
  return {
    files: entries.filter((entry) => entry.kind === "file").length,
    directories: entries.filter((entry) => entry.kind === "directory").length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    digest,
  };
}

function copyTree(
  source: string,
  destination: string,
  options: { maxEntries: number; maxBytes: number },
): void {
  const entries = walkTree(source, options);
  mkdirSync(destination, { mode: 0o700 });
  for (const entry of entries) {
    const from = join(source, entry.relative);
    const to = join(destination, entry.relative);
    if (entry.kind === "directory") {
      mkdirSync(to, { recursive: true, mode: 0o700 });
      chmodSync(to, 0o700);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    copyFileSync(from, to);
    chmodSync(to, entry.ownerExecutable ? 0o700 : 0o600);
  }
}

function operationPath(
  paths: DshHomeUpgradePaths,
  operationId: string,
): string {
  assertOperationId(operationId);
  return join(paths.operationsRoot, `${operationId}.json`);
}

function writeJson(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

function readJournal(
  paths: DshHomeUpgradePaths,
  operationId: string,
): DshHomeUpgradeJournal {
  const path = operationPath(paths, operationId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readExactRegularFile(path, MAX_MANIFEST_BYTES).toString("utf8"),
    );
  } catch {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "DSH home migration journal is unreadable",
    );
  }
  const value = parsed as Partial<DshHomeUpgradeJournal>;
  if (
    value.schema !== 1 ||
    value.migrationId !== DSH_HOME_UPGRADE_ID ||
    value.operationId !== operationId ||
    value.fromVersion !== DSH_HOME_SOURCE_VERSION ||
    value.toVersion !== DSH_HOME_TARGET_VERSION ||
    !["prepared", "active", "rolled-back", "rejected"].includes(
      String(value.state),
    ) ||
    value.sourceRelative !== "dsh-home" ||
    value.targetRelative !== `dsh-homes/dsh-v${DSH_HOME_TARGET_VERSION}` ||
    !value.sourceSnapshot ||
    !value.preparedSnapshot
  ) {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "DSH home migration journal has invalid identity",
    );
  }
  return value as DshHomeUpgradeJournal;
}

function availableBytes(path: string): number {
  const stats = statfsSync(path, { bigint: true });
  const value = stats.bavail * stats.bsize;
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

export function prepareDshHomeUpgrade(input: {
  userRoot: string;
  operationId: string;
  now?: Date;
  maxEntries?: number;
  maxBytes?: number;
  reserveBytes?: number;
  availableBytes?: number;
}): DshHomeUpgradeJournal {
  assertOperationId(input.operationId);
  const paths = resolveDshHomeUpgradePaths(input.userRoot);
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const reserveBytes = input.reserveBytes ?? DEFAULT_RESERVE_BYTES;
  if (
    ![
      maxEntries,
      maxBytes,
      reserveBytes,
      ...(input.availableBytes === undefined ? [] : [input.availableBytes]),
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "invalid DSH home migration resource bound",
    );
  }
  mkdirSync(paths.userRoot, { recursive: true, mode: 0o700 });
  assertRealDirectory(paths.userRoot, "Penglai user root");
  return withWriterLock(paths, () => {
    assertRealDirectory(paths.sourceHome, "0.5.7 DSH home");
    mkdirSync(paths.homesRoot, { recursive: true, mode: 0o700 });
    assertRealDirectory(paths.homesRoot, "DSH home generations root");
    if (
      existsSync(paths.targetHome) ||
      existsSync(operationPath(paths, input.operationId))
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "DSH home target generation already exists",
      );
    }
    const staging = join(
      paths.homesRoot,
      `.${input.operationId}.${randomBytes(8).toString("hex")}.staging`,
    );
    const sourceSnapshot = snapshotTree(paths.sourceHome, {
      maxEntries,
      maxBytes,
    });
    const free = input.availableBytes ?? availableBytes(paths.userRoot);
    if (
      free < sourceSnapshot.bytes ||
      reserveBytes > free - sourceSnapshot.bytes
    ) {
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "insufficient disk space for isolated DSH home migration",
      );
    }
    try {
      copyTree(paths.sourceHome, staging, { maxEntries, maxBytes });
      const preparedSnapshot = snapshotTree(staging, { maxEntries, maxBytes });
      const sourceAfterCopy = snapshotTree(paths.sourceHome, {
        maxEntries,
        maxBytes,
      });
      if (
        preparedSnapshot.digest !== sourceSnapshot.digest ||
        sourceAfterCopy.digest !== sourceSnapshot.digest
      ) {
        throw new PenglaiError(
          "STORE_CORRUPT",
          "DSH home changed while its isolated generation was prepared",
        );
      }
      renameSync(staging, paths.targetHome);
      const journal: DshHomeUpgradeJournal = {
        schema: 1,
        migrationId: DSH_HOME_UPGRADE_ID,
        operationId: input.operationId,
        fromVersion: DSH_HOME_SOURCE_VERSION,
        toVersion: DSH_HOME_TARGET_VERSION,
        state: "prepared",
        sourceRelative: "dsh-home",
        targetRelative: `dsh-homes/dsh-v${DSH_HOME_TARGET_VERSION}`,
        sourceSnapshot,
        preparedSnapshot,
        credentialsCopiedToPrivateWorkingHome: existsSync(
          join(paths.targetHome, ".credentials.yaml"),
        ),
        preparedAt: (input.now ?? new Date()).toISOString(),
      };
      writeJson(join(paths.targetHome, MANIFEST_NAME), journal);
      writeJson(operationPath(paths, input.operationId), journal);
      return journal;
    } catch (error) {
      if (existsSync(staging))
        rmSync(staging, { recursive: true, force: false, maxRetries: 0 });
      if (existsSync(paths.targetHome))
        rmSync(paths.targetHome, {
          recursive: true,
          force: false,
          maxRetries: 0,
        });
      throw error;
    }
  });
}

function assertValidation(validation: DshHomeValidation): void {
  const time = Date.parse(validation.validatedAt);
  if (
    validation.dshVersion !== DSH_HOME_TARGET_VERSION ||
    validation.officialDocument !== true ||
    validation.dshHealthy !== true ||
    validation.profileReady !== true ||
    !Number.isFinite(time) ||
    validation.requiredPluginsActive.length < 2 ||
    !validation.requiredPluginsActive.includes("@penglai/office") ||
    !validation.requiredPluginsActive.includes("@penglai/memory") ||
    validation.requiredPluginsActive.some(
      (id) => typeof id !== "string" || !id.startsWith("@"),
    )
  ) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "DSH home activation requires exact healthy alpha validation",
    );
  }
}

export function activateDshHomeUpgrade(input: {
  userRoot: string;
  operationId: string;
  validation: DshHomeValidation;
  now?: Date;
  maxEntries?: number;
  maxBytes?: number;
}): ActiveDshHomeManifest {
  assertValidation(input.validation);
  const paths = resolveDshHomeUpgradePaths(input.userRoot);
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  return withWriterLock(paths, () => {
    const journal = readJournal(paths, input.operationId);
    if (journal.state !== "prepared") {
      throw new PenglaiError(
        "INVALID_INPUT",
        "DSH home generation is not prepared for activation",
      );
    }
    assertRealDirectory(paths.sourceHome, "0.5.7 DSH home");
    assertRealDirectory(paths.targetHome, "alpha DSH home");
    const sourceNow = snapshotTree(paths.sourceHome, { maxEntries, maxBytes });
    if (sourceNow.digest !== journal.sourceSnapshot.digest) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "0.5.7 DSH home changed during alpha validation",
      );
    }
    const activeSnapshot = snapshotTree(paths.targetHome, {
      maxEntries,
      maxBytes,
    });
    const activatedAt = (input.now ?? new Date()).toISOString();
    const active: ActiveDshHomeManifest = {
      schema: 1,
      activeVersion: DSH_HOME_TARGET_VERSION,
      homeRelative: journal.targetRelative,
      operationId: input.operationId,
      activatedAt,
      targetDigest: activeSnapshot.digest,
    };
    const next: DshHomeUpgradeJournal = {
      ...journal,
      state: "active",
      validation: input.validation,
      activeSnapshot,
      activatedAt,
    };
    writeJson(operationPath(paths, input.operationId), next);
    writeJson(join(paths.targetHome, MANIFEST_NAME), next);
    // The active pointer is the commit record and is written last. A crash
    // before this rename leaves the old home selected; recovery never infers
    // activation from a prepared or partially updated journal.
    writeJson(paths.activeManifest, active);
    return active;
  });
}

export function rollbackDshHomeUpgrade(input: {
  userRoot: string;
  operationId: string;
  reason: string;
  now?: Date;
}): ActiveDshHomeManifest {
  if (!input.reason.trim() || input.reason.length > 512) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "DSH home rollback requires a bounded reason",
    );
  }
  const paths = resolveDshHomeUpgradePaths(input.userRoot);
  return withWriterLock(paths, () => {
    const journal = readJournal(paths, input.operationId);
    if (journal.state !== "active") {
      throw new PenglaiError(
        "INVALID_INPUT",
        "only an active DSH home generation can roll back",
      );
    }
    assertRealDirectory(paths.sourceHome, "0.5.7 DSH home");
    const sourceNow = snapshotTree(paths.sourceHome, {
      maxEntries: DEFAULT_MAX_ENTRIES,
      maxBytes: DEFAULT_MAX_BYTES,
    });
    if (sourceNow.digest !== journal.sourceSnapshot.digest) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "0.5.7 DSH home changed before rollback",
      );
    }
    const rolledBackAt = (input.now ?? new Date()).toISOString();
    const active: ActiveDshHomeManifest = {
      schema: 1,
      activeVersion: DSH_HOME_SOURCE_VERSION,
      homeRelative: "dsh-home",
      activatedAt: rolledBackAt,
      rollbackReason: input.reason.trim(),
    };
    const next: DshHomeUpgradeJournal = {
      ...journal,
      state: "rolled-back",
      rolledBackAt,
      rollbackReason: input.reason.trim(),
    };
    writeJson(paths.activeManifest, active);
    writeJson(operationPath(paths, input.operationId), next);
    writeJson(join(paths.targetHome, MANIFEST_NAME), next);
    return active;
  });
}

export function rejectPreparedDshHomeUpgrade(input: {
  userRoot: string;
  operationId: string;
  reason: string;
  now?: Date;
}): DshHomeUpgradeJournal {
  if (!input.reason.trim() || input.reason.length > 512) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "DSH home rejection requires a bounded reason",
    );
  }
  const paths = resolveDshHomeUpgradePaths(input.userRoot);
  return withWriterLock(paths, () => {
    const journal = readJournal(paths, input.operationId);
    if (journal.state !== "prepared") {
      throw new PenglaiError(
        "INVALID_INPUT",
        "only a prepared DSH home generation can be rejected",
      );
    }
    const rejected: DshHomeUpgradeJournal = {
      ...journal,
      state: "rejected",
      rejectedAt: (input.now ?? new Date()).toISOString(),
      rejectionReason: input.reason.trim(),
    };
    writeJson(operationPath(paths, input.operationId), rejected);
    if (existsSync(paths.targetHome)) {
      assertRealDirectory(paths.targetHome, "rejected alpha DSH home");
      rmSync(paths.targetHome, {
        recursive: true,
        force: false,
        maxRetries: 0,
      });
    }
    return rejected;
  });
}

export function readActiveDshHome(
  userRoot: string,
): ActiveDshHomeManifest | undefined {
  const paths = resolveDshHomeUpgradePaths(userRoot);
  if (!existsSync(paths.activeManifest)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readExactRegularFile(paths.activeManifest, MAX_MANIFEST_BYTES).toString(
        "utf8",
      ),
    );
  } catch {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "active DSH home manifest is unreadable",
    );
  }
  const value = parsed as Partial<ActiveDshHomeManifest>;
  if (
    value.schema !== 1 ||
    (value.activeVersion !== DSH_HOME_SOURCE_VERSION &&
      value.activeVersion !== DSH_HOME_TARGET_VERSION) ||
    typeof value.homeRelative !== "string" ||
    isAbsolute(value.homeRelative) ||
    value.homeRelative.split(/[\\/]/).includes("..") ||
    typeof value.activatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.activatedAt))
  ) {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "active DSH home manifest has invalid identity",
    );
  }
  const expected =
    value.activeVersion === DSH_HOME_SOURCE_VERSION
      ? "dsh-home"
      : `dsh-homes/dsh-v${DSH_HOME_TARGET_VERSION}`;
  if (value.homeRelative.replaceAll("\\", "/") !== expected) {
    throw new PenglaiError(
      "STORE_CORRUPT",
      "active DSH home manifest path disagrees with version",
    );
  }
  const home = resolve(paths.userRoot, value.homeRelative);
  if (!inside(paths.userRoot, home)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "active DSH home escaped Penglai user data",
    );
  }
  if (value.activeVersion === DSH_HOME_TARGET_VERSION) {
    assertRealDirectory(paths.homesRoot, "DSH home generations root");
  }
  assertRealDirectory(home, "active DSH home");
  if (!inside(realpathSync(paths.userRoot), realpathSync(home))) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "active DSH home resolved outside Penglai user data",
    );
  }
  if (value.activeVersion === DSH_HOME_TARGET_VERSION) {
    if (
      typeof value.operationId !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(value.operationId) ||
      typeof value.targetDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.targetDigest)
    ) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "active alpha DSH home lacks activation evidence",
      );
    }
    const journal = readJournal(paths, value.operationId);
    if (
      journal.state !== "active" ||
      journal.activeSnapshot?.digest !== value.targetDigest ||
      journal.activatedAt !== value.activatedAt
    ) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "active alpha DSH home disagrees with its journal",
      );
    }
  }
  return value as ActiveDshHomeManifest;
}

export function resolveDshHomeForVersion(
  userRoot: string,
  version: string,
): string {
  assertVersion(version);
  const paths = resolveDshHomeUpgradePaths(userRoot);
  if (version === DSH_HOME_SOURCE_VERSION) {
    assertRealDirectory(paths.sourceHome, "0.5.7 DSH home");
    return paths.sourceHome;
  }
  const active = readActiveDshHome(userRoot);
  if (active?.activeVersion !== DSH_HOME_TARGET_VERSION) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "alpha DSH home has not passed activation",
    );
  }
  return paths.targetHome;
}

export function removeAbandonedDshHomeStaging(userRoot: string): number {
  const paths = resolveDshHomeUpgradePaths(userRoot);
  if (!existsSync(paths.homesRoot)) return 0;
  return withWriterLock(paths, () => {
    assertRealDirectory(paths.homesRoot, "DSH home generations root");
    let removed = 0;
    for (const name of readdirSync(paths.homesRoot)) {
      if (!/^\.[A-Za-z0-9_-]{8,128}\.[0-9a-f]{16}\.staging$/.test(name))
        continue;
      const candidate = join(paths.homesRoot, name);
      if (!inside(paths.homesRoot, candidate)) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "abandoned DSH home staging escaped its root",
        );
      }
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "abandoned DSH home staging is not a real directory",
        );
      }
      rmSync(candidate, { recursive: true, force: false, maxRetries: 0 });
      removed += 1;
    }
    return removed;
  });
}
