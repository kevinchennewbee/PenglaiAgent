import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export const CONTEXT_PICK_TTL_MS = 5 * 60_000;

function assertInside(parent: string, child: string): void {
  const rel = relative(parent, child);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new PenglaiError("SECURITY_POLICY", "context grant receipt escaped userData");
  }
}

export function createContextGrantReceipt(userData: string, selectedPath: string, now = Date.now()): {
  capabilityRef: string;
  displayName: string;
  expiresAt: string;
} {
  const root = realpathSync(resolve(userData));
  const selected = realpathSync(selectedPath);
  if (!lstatSync(selected).isDirectory()) throw new PenglaiError("INVALID_INPUT", "context selection must be a directory");
  const pending = join(root, "context", "pending-grants");
  if (existsSync(pending) && lstatSync(pending).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "context grant directory must not be a symlink");
  }
  mkdirSync(pending, { recursive: true, mode: 0o700 });
  chmodSync(pending, 0o700);
  const canonicalPending = realpathSync(pending);
  assertInside(root, canonicalPending);
  const capabilityRef = `ctxpick_${randomBytes(24).toString("hex")}`;
  const expiresAt = new Date(now + CONTEXT_PICK_TTL_MS).toISOString();
  const target = join(canonicalPending, `${capabilityRef}.json`);
  assertInside(canonicalPending, target);
  const temp = join(canonicalPending, `.${capabilityRef}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(
    temp,
    JSON.stringify({ schema: 1, capabilityRef, realPath: selected, createdAt: new Date(now).toISOString(), expiresAt }),
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  renameSync(temp, target);
  chmodSync(target, 0o600);
  return { capabilityRef, displayName: basename(selected) || dirname(selected), expiresAt };
}
