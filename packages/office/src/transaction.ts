import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { digestBytes } from "./jobs.js";

export function assertPathInWorkspace(path: string, workspaceRoot: string): string {
  if (!isAbsolute(path) || !isAbsolute(workspaceRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "office commit path must be absolute");
  }
  const root = realpathSync(workspaceRoot);
  const resolved = resolve(path);
  const parent = dirname(resolved);
  if (!existsSync(parent)) throw new PenglaiError("INVALID_INPUT", "office destination parent missing");
  const realParent = realpathSync(parent);
  const rel = relative(root, realParent);
  if (rel.startsWith("..") || rel.includes("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "office destination escaped workspace");
  }
  return resolve(realParent, resolved.slice(parent.length + 1) || resolved.split("/").pop() || "document");
}

export function atomicCommitFile(destPath: string, bytes: Buffer, backupPath: string): { destDigest: string; backup: string } {
  mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
  if (existsSync(destPath)) copyFileSync(destPath, backupPath);
  const tmp = `${destPath}.${process.pid}.penglai-stage`;
  writeFileSync(tmp, bytes, { mode: 0o600, flag: "w" });
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, destPath);
  return { destDigest: digestBytes(bytes), backup: backupPath };
}
