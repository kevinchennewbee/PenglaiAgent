import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";

const BACKUP_SOURCES = [
  "schema.json",
  "onboarding",
  "plugins/desired.json",
  "profiles/transactions",
  "profiles/center-tx",
  "dsh-home/settings.yaml",
  "dsh-home/cordis.patch.yml",
  "dsh-home/skills",
  "dsh-home/profiles/web/package.json",
  "dsh-home/profiles/web/cordis.yml",
  "dsh-home/profiles/web/cordis.patch.yml",
  "im",
  "voice/settings.json",
  "voice/model-inventory.json",
  "voice/local-voices/consent.json",
  "context",
  "memory",
  "budget",
  "companion",
] as const;

const FORBIDDEN_BACKUP_NAMES = new Set([
  ".credentials.yaml",
  ".env",
  ".env.local",
  "credentials.yaml",
  "credentials.json",
]);

export interface SchemaBackupManifest {
  schema: 1;
  generation: "penglai-dsh-v0.5";
  operationId: string;
  fromVersion: string;
  toVersion: string;
  createdAt: string;
  files: Array<{ path: string; sha256: string; size: number }>;
  credentialsCopied: false;
  workspaceCopied: false;
  localVoiceAudioCopied: false;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertSafeRelative(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new PenglaiError("SECURITY_POLICY", "update backup relative path escaped");
  }
  for (const segment of path.split(/[\\/]/)) {
    if (FORBIDDEN_BACKUP_NAMES.has(segment.toLowerCase())) {
      throw new PenglaiError("SECURITY_POLICY", "credential material is forbidden from update backup");
    }
  }
}

function copyTree(
  userData: string,
  source: string,
  staging: string,
  files: SchemaBackupManifest["files"],
  byteBudget: { remaining: number },
): void {
  const sourceStat = lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "update backup refuses symlink source");
  }
  const canonical = realpathSync(source);
  if (!inside(realpathSync(userData), canonical)) {
    throw new PenglaiError("SECURITY_POLICY", "update backup source escaped userData");
  }
  const rel = relative(userData, source);
  assertSafeRelative(rel);
  const destination = join(staging, rel);
  if (sourceStat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(source).sort()) {
      assertSafeRelative(name);
      copyTree(userData, join(source, name), staging, files, byteBudget);
    }
    return;
  }
  if (!sourceStat.isFile()) {
    throw new PenglaiError("SECURITY_POLICY", "update backup refuses special filesystem object");
  }
  if (sourceStat.size > byteBudget.remaining) {
    throw new PenglaiError("SECURITY_POLICY", "update backup exceeded bounded size");
  }
  byteBudget.remaining -= sourceStat.size;
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  const bytes = readFileSync(destination);
  files.push({
    path: rel.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  });
}

export function createSchemaBackup(input: {
  userData: string;
  backupRoot: string;
  operationId: string;
  fromVersion: string;
  toVersion: string;
  maxBytes?: number;
}): { path: string; manifest: SchemaBackupManifest } {
  if (!isAbsolute(input.userData) || !isAbsolute(input.backupRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "update backup roots must be absolute");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)) {
    throw new PenglaiError("INVALID_INPUT", "invalid update backup operation id");
  }
  const userData = resolve(input.userData);
  const backupRoot = resolve(input.backupRoot);
  if (!inside(userData, backupRoot) || backupRoot === userData) {
    throw new PenglaiError("SECURITY_POLICY", "update backup root must be app-private userData child");
  }
  if (existsSync(backupRoot) && lstatSync(backupRoot).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "update backup root must not be a symlink");
  }
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const destination = join(backupRoot, input.operationId);
  const staging = join(backupRoot, `.${input.operationId}.${randomBytes(8).toString("hex")}.staging`);
  if (existsSync(destination) || existsSync(staging)) {
    throw new PenglaiError("SECURITY_POLICY", "update backup operation already exists");
  }
  mkdirSync(staging, { mode: 0o700 });
  try {
    const files: SchemaBackupManifest["files"] = [];
    const byteBudget = { remaining: input.maxBytes ?? 2 * 1024 * 1024 * 1024 };
    for (const rel of BACKUP_SOURCES) {
      assertSafeRelative(rel);
      const source = join(userData, rel);
      if (existsSync(source)) copyTree(userData, source, staging, files, byteBudget);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest: SchemaBackupManifest = {
      schema: 1,
      generation: "penglai-dsh-v0.5",
      operationId: input.operationId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      createdAt: new Date().toISOString(),
      files,
      credentialsCopied: false,
      workspaceCopied: false,
      localVoiceAudioCopied: false,
    };
    writeFileSync(join(staging, "backup-manifest.json"), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(staging, destination);
    return { path: destination, manifest };
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: false, maxRetries: 0 });
    throw error;
  }
}
