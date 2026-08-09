import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readPrivateTextFile } from "../security/private-file.js";

const LOCK_DIRECTORY_NAME = ".penglai-operation-lock";
const CLAIM_FILE_RE = /^claim-(\d+)-([0-9a-f]{32})\.json$/;
const INCOMPLETE_CLAIM_GRACE_MS = 30_000;

export type DataDirOperation = "runtime" | "migration-apply" | "migration-rollback";

interface DataDirIdentity {
  device: string;
  inode: string;
}

interface OperationClaim {
  version: 1;
  operation: DataDirOperation;
  pid: number;
  nonce: string;
  dataDir: string;
  dataDirIdentity: DataDirIdentity;
  createdAt: string;
}

export interface AcquireDataDirOperationLockOptions {
  /** Test seam for deterministic stale-claim fixtures. */
  clock?: () => Date;
  /** Test seam; production always uses process.pid. */
  pid?: number;
  /** Test seam; production always uses a cryptographically random nonce. */
  nonce?: string;
  /** Test seam for process-liveness classification. */
  processAlive?: (pid: number) => boolean;
}

export interface DataDirOperationLock {
  readonly dataDir: string;
  readonly claimFile: string;
  readonly operation: DataDirOperation;
  readonly pid: number;
  readonly nonce: string;
  release(): void;
}

function fsyncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !["EINVAL", "ENOTSUP", "EPERM", "EISDIR", "EBADF"].includes(code)) {
      throw error;
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function dataDirIdentity(directory: string): DataDirIdentity {
  const stat = fs.statSync(directory);
  return { device: String(stat.dev), inode: String(stat.ino) };
}

function sameIdentity(left: DataDirIdentity, right: DataDirIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another account. Only
    // ESRCH proves that the PID is no longer live.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function parseClaim(raw: unknown): OperationClaim | null {
  if (!raw || typeof raw !== "object") return null;
  const claim = raw as Partial<OperationClaim>;
  if (
    claim.version !== 1 ||
    !["runtime", "migration-apply", "migration-rollback"].includes(
      String(claim.operation),
    ) ||
    !Number.isInteger(claim.pid) ||
    Number(claim.pid) <= 0 ||
    typeof claim.nonce !== "string" ||
    !/^[0-9a-f]{32}$/.test(claim.nonce) ||
    typeof claim.dataDir !== "string" ||
    !path.isAbsolute(claim.dataDir) ||
    !claim.dataDirIdentity ||
    typeof claim.dataDirIdentity.device !== "string" ||
    typeof claim.dataDirIdentity.inode !== "string" ||
    typeof claim.createdAt !== "string" ||
    !Number.isFinite(Date.parse(claim.createdAt))
  ) {
    return null;
  }
  return claim as OperationClaim;
}

function readClaim(file: string): OperationClaim | null {
  try {
    return parseClaim(JSON.parse(readPrivateTextFile(file, 64 * 1024).text));
  } catch {
    return null;
  }
}

function durableWriteClaim(file: string, claim: OperationClaim): void {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(claim, null, 2)}\n`, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(file));
}

function removeExactClaim(file: string, expected: OperationClaim): void {
  const current = readClaim(file);
  if (
    !current ||
    current.pid !== expected.pid ||
    current.nonce !== expected.nonce ||
    current.dataDir !== expected.dataDir ||
    !sameIdentity(current.dataDirIdentity, expected.dataDirIdentity)
  ) {
    throw new Error(`operation lock ownership changed; refusing to unlink ${file}`);
  }
  fs.unlinkSync(file);
  fsyncDirectory(path.dirname(file));
}

/**
 * Acquire the single data-directory operation lane.
 *
 * Claims have unique immutable filenames. Every contender publishes its own
 * claim before enumerating peers, so two contenders can never both miss one
 * another: either one observes the other and fails, or the later contender
 * observes the already-running owner. Dead-PID claims are safely removable
 * because a nonce filename is never reused. A torn claim gets a short grace
 * period so a live creator is never mistaken for crash debris.
 */
export function acquireDataDirOperationLock(
  requestedDataDir: string,
  operation: DataDirOperation,
  options: AcquireDataDirOperationLockOptions = {},
): DataDirOperationLock {
  const requested = path.resolve(requestedDataDir);
  fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  const requestedStat = fs.lstatSync(requested);
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    throw new Error(`dataDir is not a real directory: ${requested}`);
  }
  const dataDir = fs.realpathSync.native(requested);
  const identity = dataDirIdentity(dataDir);
  const lockDirectory = path.join(dataDir, LOCK_DIRECTORY_NAME);
  fs.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const lockStat = fs.lstatSync(lockDirectory);
  if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
    throw new Error(`operation lock path is not a real directory: ${lockDirectory}`);
  }
  fs.chmodSync(lockDirectory, 0o700);

  const clock = options.clock ?? (() => new Date());
  const pid = options.pid ?? process.pid;
  const nonce = options.nonce ?? crypto.randomBytes(16).toString("hex");
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("operation lock pid is invalid");
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error("operation lock nonce is invalid");
  const claim: OperationClaim = {
    version: 1,
    operation,
    pid,
    nonce,
    dataDir,
    dataDirIdentity: identity,
    createdAt: clock().toISOString(),
  };
  const claimFile = path.join(lockDirectory, `claim-${pid}-${nonce}.json`);
  durableWriteClaim(claimFile, claim);

  const processAlive = options.processAlive ?? defaultProcessAlive;
  try {
    for (const name of fs.readdirSync(lockDirectory).sort()) {
      const candidate = path.join(lockDirectory, name);
      if (candidate === claimFile) continue;
      const match = name.match(CLAIM_FILE_RE);
      if (!match) {
        throw new Error(`operation lock directory contains an unknown entry: ${candidate}`);
      }
      const other = readClaim(candidate);
      if (!other) {
        const stat = fs.lstatSync(candidate);
        const ageMs = Math.max(0, clock().getTime() - stat.mtimeMs);
        if (ageMs < INCOMPLETE_CLAIM_GRACE_MS) {
          throw new Error(`operation lock claim is incomplete; retry later: ${candidate}`);
        }
        // The filename is a unique nonce. Removing this old torn file cannot
        // remove a replacement owner's claim because replacements use a new
        // filename rather than reusing this path.
        fs.unlinkSync(candidate);
        fsyncDirectory(lockDirectory);
        continue;
      }
      const sameDataDir =
        other.dataDir === dataDir && sameIdentity(other.dataDirIdentity, identity);
      if (processAlive(other.pid)) {
        throw new Error(
          `dataDir operation is already active: ${other.operation} pid=${other.pid} ` +
            `dataDir=${other.dataDir}${sameDataDir ? "" : " (identity mismatch)"}`,
        );
      }
      // A dead process cannot still own this nonce claim. The unique filename
      // makes stale recovery race-free even when several contenders arrive.
      fs.unlinkSync(candidate);
      fsyncDirectory(lockDirectory);
    }
  } catch (error) {
    try {
      removeExactClaim(claimFile, claim);
    } catch {
      // Preserve the acquisition failure; ownership mismatch is fail-closed
      // and deliberately leaves the unexpected claim untouched.
    }
    throw error;
  }

  let released = false;
  return {
    dataDir,
    claimFile,
    operation,
    pid,
    nonce,
    release(): void {
      if (released) return;
      removeExactClaim(claimFile, claim);
      released = true;
      try {
        fs.rmdirSync(lockDirectory);
        fsyncDirectory(dataDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOTEMPTY" && code !== "ENOENT") throw error;
      }
    },
  };
}
