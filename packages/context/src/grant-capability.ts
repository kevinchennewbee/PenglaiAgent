import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";

const CAPABILITY_REF = /^ctxpick_[a-f0-9]{48}$/;

function assertInside(parent: string, child: string): void {
  const rel = relative(parent, child);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new PenglaiError("SECURITY_POLICY", "context grant capability escaped userData");
  }
}

export function consumeContextGrantCapability(userData: string, capabilityRef: string, now = Date.now()): string {
  if (!CAPABILITY_REF.test(capabilityRef)) throw new PenglaiError("INVALID_INPUT", "invalid context capability");
  const canonicalUserData = realpathSync(resolve(userData));
  const pending = resolve(canonicalUserData, "context", "pending-grants");
  if (!existsSync(pending) || lstatSync(pending).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "context capability directory unavailable");
  }
  const canonicalPending = realpathSync(pending);
  assertInside(canonicalUserData, canonicalPending);
  const source = join(canonicalPending, `${capabilityRef}.json`);
  const claimed = join(canonicalPending, `${capabilityRef}.claim`);
  assertInside(canonicalPending, source);
  if (!existsSync(source) || lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile()) {
    throw new PenglaiError("UNAUTHORIZED", "context capability missing or already used");
  }
  renameSync(source, claimed);
  try {
    const row = JSON.parse(readFileSync(claimed, "utf8")) as Record<string, unknown>;
    if (row.schema !== 1 || row.capabilityRef !== capabilityRef || typeof row.realPath !== "string") {
      throw new PenglaiError("STORE_CORRUPT", "context capability receipt invalid");
    }
    const expiresAt = Date.parse(String(row.expiresAt ?? ""));
    if (!Number.isFinite(expiresAt) || now > expiresAt) {
      throw new PenglaiError("UNAUTHORIZED", "context capability expired");
    }
    const selected = realpathSync(row.realPath);
    if (selected !== row.realPath || !lstatSync(selected).isDirectory()) {
      throw new PenglaiError("SECURITY_POLICY", "context capability path drift");
    }
    return selected;
  } finally {
    rmSync(claimed, { force: true });
  }
}
