import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";

export interface WindowsAclSubject {
  id: string;
  allow: boolean;
}

export interface WindowsAclPlan {
  owner: "current-user";
  allow: Array<"current-user" | "SYSTEM" | "Administrators">;
  deny: Array<"Users" | "Everyone">;
}

export function posixCredentialModes(): { dir: number; file: number } {
  return { dir: 0o700, file: 0o600 };
}

export function windowsCredentialAcl(): WindowsAclPlan {
  return {
    owner: "current-user",
    allow: ["current-user", "SYSTEM", "Administrators"],
    deny: ["Users", "Everyone"],
  };
}

export function assertWindowsAclHonest(subjects: WindowsAclSubject[]): void {
  const denied = windowsCredentialAcl().deny;
  for (const s of subjects) {
    if (denied.includes(s.id as "Users" | "Everyone") && s.allow) {
      throw new PenglaiError("SECURITY_POLICY", `Windows ACL must not allow ${s.id} read`);
    }
  }
}

export function writeFileAtomic(path: string, data: string | Buffer, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, path);
  chmodSync(path, mode);
}

export function applyPosixTreeModes(root: string, filePaths: string[]): void {
  chmodSync(root, 0o700);
  for (const p of filePaths) chmodSync(p, 0o600);
}
