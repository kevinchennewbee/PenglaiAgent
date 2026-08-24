import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { PenglaiError, readExactRegularFile } from "@penglai/contracts";
import { digestBytes } from "./jobs.js";

/**
 * Office commits follow the official `@deepseek-ai/dsh-atomic-write` protocol
 * (exclusive-create random-suffix sibling + rename) and add parent nofollow /
 * fsync required by the Penglai 0.5.6 file-transaction contract.
 */
export function assertTrustedWorkspacePath(path: string, workspaceRoot: string): string {
  if (!isAbsolute(path) || !isAbsolute(workspaceRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "office commit path must be absolute");
  }
  if (existsSync(workspaceRoot) && lstatSync(workspaceRoot).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "office workspace root must not be a symlink");
  }
  if (!existsSync(workspaceRoot) || !lstatSync(workspaceRoot).isDirectory()) {
    throw new PenglaiError("INVALID_INPUT", "office workspace root missing");
  }
  const root = resolve(workspaceRoot);
  const resolved = resolve(path);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel.includes("\0") || isAbsolute(rel)) {
    throw new PenglaiError("SECURITY_POLICY", "office destination escaped workspace");
  }
  const parts = rel.split(sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i += 1) {
    current = resolve(current, parts[i] ?? "");
    if (!existsSync(current)) {
      if (i === parts.length - 1) break;
      throw new PenglaiError("INVALID_INPUT", "office destination parent missing");
    }
    const st = lstatSync(current);
    if (st.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "office path must not traverse a symlink");
    }
    if (i < parts.length - 1 && !st.isDirectory()) {
      throw new PenglaiError("SECURITY_POLICY", "office parent is not a directory");
    }
    if (i === parts.length - 1 && st.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "office refuses a pre-existing symlink destination");
    }
  }
  return resolved;
}

export function assertPathInWorkspace(path: string, workspaceRoot: string): string {
  return assertTrustedWorkspacePath(path, workspaceRoot);
}

export function safeWorkspaceFilename(name: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}\.(docx|xlsx|pptx|pdf)$/.test(name)) {
    throw new PenglaiError("INVALID_INPUT", "office filename must be a bounded workspace basename");
  }
  return name;
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readExistingRegularFile(path: string): Buffer | undefined {
  try {
    return readExactRegularFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

function openParentDirectoryNoFollow(parent: string): number | undefined {
  // Windows cannot fsync a directory handle through node:fs. The workspace
  // traversal gate still rejects reparse/symlink components there; POSIX keeps
  // the exact no-follow directory open through backup, write and rename.
  if (process.platform === "win32") return undefined;
  let fd: number;
  try {
    fd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new PenglaiError("SECURITY_POLICY", "office destination parent must not be a symlink");
    }
    throw error;
  }
  if (!fstatSync(fd).isDirectory()) {
    closeSync(fd);
    throw new PenglaiError("SECURITY_POLICY", "office destination parent must be a directory");
  }
  return fd;
}

export function atomicCommitFile(destPath: string, bytes: Buffer, backupPath: string): { destDigest: string; backup: string } {
  const parent = dirname(destPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentFd = openParentDirectoryNoFollow(parent);
  try {
    const previous = readExistingRegularFile(destPath);
    if (previous !== undefined) {
      writeFileSync(backupPath, previous, { mode: 0o600, flag: "wx" });
      fsyncPath(backupPath);
    }
    const tmp = `${destPath}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600, flag: "wx" });
    fsyncPath(tmp);
    renameSync(tmp, destPath);
    if (parentFd !== undefined) {
      try {
        fsyncSync(parentFd);
      } catch {
        /* directory fsync is best-effort on some volumes */
      }
    }
  } finally {
    if (parentFd !== undefined) closeSync(parentFd);
  }
  return { destDigest: digestBytes(bytes), backup: backupPath };
}
