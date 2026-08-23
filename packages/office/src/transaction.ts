import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { digestBytes } from "./jobs.js";

/**
 * Office commits follow the official `@deepseek-ai/dsh-atomic-write` protocol
 * (exclusive-create random-suffix sibling + rename) and add parent nofollow /
 * fsync required by the Penglai 0.5.5 file-transaction contract.
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

export function atomicCommitFile(destPath: string, bytes: Buffer, backupPath: string): { destDigest: string; backup: string } {
  const parent = dirname(destPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "office destination parent must not be a symlink");
  }
  if (existsSync(destPath) && lstatSync(destPath).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "office refuses a pre-existing symlink destination");
  }
  if (existsSync(destPath)) copyFileSync(destPath, backupPath);
  const tmp = `${destPath}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o600, flag: "wx" });
  fsyncPath(tmp);
  renameSync(tmp, destPath);
  try {
    const parentFd = openSync(parent, "r");
    try {
      fsyncSync(parentFd);
    } finally {
      closeSync(parentFd);
    }
  } catch {
    /* directory fsync is best-effort on some volumes */
  }
  return { destDigest: digestBytes(bytes), backup: backupPath };
}
