import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { writeFileAtomic } from "./permissions.js";

export const RC8_TO_RC1_MIGRATION_ID = "penglai-0.5.1-rc8-to-rc1";
export const RC8_TO_RC1_MARKER = ".penglai-migrated-0.5.1-rc1";
export const BACKUP_SECRET_CLEANUP_MARKER = ".penglai-backup-secret-cleanup.json";

const BACKUP_SOURCES = ["dsh-home", "onboarding", "plugins/desired.json", "im"] as const;
const MAX_BACKUP_WALK = 10_000;
const MAX_SECRET_BYTES = 1024 * 1024;

export type SecretBackupCategory = "credentials-yaml" | "env-file" | "key-material";

export interface GenerationMigrateResult {
  migrated: boolean;
  already: boolean;
  backup?: string;
  marker: string;
  credentialsCopied: false;
  excludedCategories: SecretBackupCategory[];
  cleanup: BackupSecretCleanup;
}

export type BackupSecretCleanup =
  | { kind: "none"; removedDuplicates: 0 }
  | { kind: "removed-duplicate"; removedDuplicates: number }
  | { kind: "restore-proposal"; removedDuplicates: 0; backupRelative: string }
  | { kind: "conflict"; removedDuplicates: 0 }
  | { kind: "ambiguous"; removedDuplicates: 0 };

function markerPath(userRoot: string): string {
  return join(userRoot, RC8_TO_RC1_MARKER);
}

function cleanupMarkerPath(userRoot: string): string {
  return join(userRoot, BACKUP_SECRET_CLEANUP_MARKER);
}

function atomicJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function secretBackupCategory(name: string): SecretBackupCategory | undefined {
  const lower = name.toLowerCase();
  if (lower === ".credentials.yaml" || lower === "credentials.yaml" || lower === "credentials.json") {
    return "credentials-yaml";
  }
  if (lower === ".env" || lower === ".env.local") return "env-file";
  if (
    lower.endsWith(".pem") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx") ||
    lower === "id_rsa" ||
    lower === "id_ed25519"
  ) {
    return "key-material";
  }
  return undefined;
}

function copyNonSecretTree(
  source: string,
  destination: string,
  excluded: Set<SecretBackupCategory>,
  files: Array<{ path: string; sha256: string }>,
  userRoot: string,
): void {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "generation backup refuses symlink source");
  }
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    chmodSync(destination, 0o700);
    for (const name of readdirSync(source).sort()) {
      const category = secretBackupCategory(name);
      if (category) {
        excluded.add(category);
        continue;
      }
      copyNonSecretTree(join(source, name), join(destination, name), excluded, files, userRoot);
    }
    return;
  }
  if (!stat.isFile()) {
    throw new PenglaiError("SECURITY_POLICY", "generation backup refuses special filesystem object");
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  const bytes = readFileSync(destination);
  files.push({
    path: relative(userRoot, source).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function persistCleanup(userRoot: string, cleanup: BackupSecretCleanup, excluded: SecretBackupCategory[]): void {
  atomicJson(cleanupMarkerPath(userRoot), {
    schema: 1,
    at: new Date().toISOString(),
    kind: cleanup.kind,
    removedDuplicates: cleanup.removedDuplicates,
    excludedCategories: excluded,
    credentialsCopied: false,
    ...(cleanup.kind === "restore-proposal" ? { backupRelative: cleanup.backupRelative } : {}),
  });
}

function readCanonicalSecret(userRoot: string): { path: string; digest: string } | undefined {
  for (const rel of ["dsh-home/.credentials.yaml", ".credentials.yaml"]) {
    const path = join(userRoot, rel);
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_SECRET_BYTES) {
      throw new PenglaiError("SECURITY_POLICY", "canonical credential is not a bounded regular file");
    }
    return { path, digest: createHash("sha256").update(readFileSync(path)).digest("hex") };
  }
  return undefined;
}

function walkBackupSecrets(userRoot: string): Array<{ path: string; relative: string; digest: string }> {
  const backupRoot = join(userRoot, ".penglai-backup");
  if (!existsSync(backupRoot)) return [];
  const rootStat = lstatSync(backupRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new PenglaiError("SECURITY_POLICY", "generation backup root must be a real directory");
  }
  const found: Array<{ path: string; relative: string; digest: string }> = [];
  const stack = [backupRoot];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (!inside(backupRoot, current)) {
      throw new PenglaiError("SECURITY_POLICY", "generation backup walk escaped");
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "generation backup refuses symlink during secret cleanup");
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) {
        visited += 1;
        if (visited > MAX_BACKUP_WALK) {
          throw new PenglaiError("SECURITY_POLICY", "generation backup walk exceeded bound");
        }
        stack.push(join(current, name));
      }
      continue;
    }
    if (!stat.isFile()) continue;
    const category = secretBackupCategory(basename(current));
    if (!category || stat.size <= 0 || stat.size > MAX_SECRET_BYTES) continue;
    found.push({
      path: current,
      relative: relative(userRoot, current).replaceAll("\\", "/"),
      digest: createHash("sha256").update(readFileSync(current)).digest("hex"),
    });
  }
  return found;
}

export function cleanupHistoricalBackupSecrets(userRoot: string): BackupSecretCleanup {
  const excluded: SecretBackupCategory[] = [];
  const secrets = walkBackupSecrets(userRoot);
  if (secrets.length === 0) {
    const none = { kind: "none" as const, removedDuplicates: 0 as const };
    persistCleanup(userRoot, none, excluded);
    return none;
  }
  excluded.push("credentials-yaml");
  const canonical = readCanonicalSecret(userRoot);
  const distinct = [...new Set(secrets.map((row) => row.digest))];
  if (canonical && distinct.length === 1 && distinct[0] === canonical.digest) {
    for (const row of secrets) unlinkSync(row.path);
    const cleaned = { kind: "removed-duplicate" as const, removedDuplicates: secrets.length };
    persistCleanup(userRoot, cleaned, excluded);
    return cleaned;
  }
  if (canonical) {
    const conflict = { kind: "conflict" as const, removedDuplicates: 0 as const };
    persistCleanup(userRoot, conflict, excluded);
    return conflict;
  }
  if (distinct.length !== 1 || secrets.length === 0) {
    const ambiguous = { kind: "ambiguous" as const, removedDuplicates: 0 as const };
    persistCleanup(userRoot, ambiguous, excluded);
    return ambiguous;
  }
  const first = secrets[0];
  if (!first) {
    const none = { kind: "none" as const, removedDuplicates: 0 as const };
    persistCleanup(userRoot, none, excluded);
    return none;
  }
  const proposal = { kind: "restore-proposal" as const, removedDuplicates: 0 as const, backupRelative: first.relative };
  persistCleanup(userRoot, proposal, excluded);
  return proposal;
}

export function restoreCanonicalCredentialFromBackup(input: { userRoot: string; backupRelative: string }): void {
  if (input.backupRelative.includes("..") || isAbsolute(input.backupRelative) || !input.backupRelative.startsWith(".penglai-backup/")) {
    throw new PenglaiError("SECURITY_POLICY", "credential restore path escaped backup root");
  }
  if (secretBackupCategory(input.backupRelative.split("/").pop() ?? "") !== "credentials-yaml") {
    throw new PenglaiError("SECURITY_POLICY", "credential restore is only for credential files");
  }
  if (readCanonicalSecret(input.userRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "canonical credential already exists");
  }
  const source = join(input.userRoot, input.backupRelative);
  if (!inside(join(input.userRoot, ".penglai-backup"), source)) {
    throw new PenglaiError("SECURITY_POLICY", "credential restore escaped backup root");
  }
  const stat = lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_SECRET_BYTES) {
    throw new PenglaiError("SECURITY_POLICY", "backup credential is not a bounded regular file");
  }
  const dest = join(input.userRoot, "dsh-home", ".credentials.yaml");
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  writeFileAtomic(dest, readFileSync(source), 0o600);
  unlinkSync(source);
}

/**
 * Same-generation rc.8 → rc.1 user-data migrate for Penglai/0.5.
 * Copies non-secret workspace, sessions, settings, and plugin desired state
 * into a versioned backup, then writes an idempotent marker. Secrets stay in
 * the canonical credential file only.
 */
export function migrateRc8UserData(userRoot: string, now = new Date()): GenerationMigrateResult {
  const marker = markerPath(userRoot);
  if (existsSync(marker)) {
    const cleanup = cleanupHistoricalBackupSecrets(userRoot);
    return { migrated: false, already: true, marker, credentialsCopied: false, excludedCategories: ["credentials-yaml"], cleanup };
  }
  const dshHome = join(userRoot, "dsh-home");
  if (!existsSync(dshHome) && !existsSync(join(userRoot, "onboarding"))) {
    atomicJson(marker, {
      id: RC8_TO_RC1_MIGRATION_ID,
      at: now.toISOString(),
      from: "0.1.0-rc.8",
      to: "0.1.1-rc.1",
      empty: true,
      credentialsCopied: false,
    });
    const cleanup = cleanupHistoricalBackupSecrets(userRoot);
    return { migrated: false, already: false, marker, credentialsCopied: false, excludedCategories: [], cleanup };
  }
  const stamp = now.toISOString().replaceAll(":", "").replaceAll(".", "");
  const backupRoot = join(userRoot, ".penglai-backup");
  const backup = join(backupRoot, `${RC8_TO_RC1_MIGRATION_ID}-${stamp}`);
  const excluded = new Set<SecretBackupCategory>();
  try {
    if (existsSync(backupRoot) && (lstatSync(backupRoot).isSymbolicLink() || !lstatSync(backupRoot).isDirectory())) {
      throw new PenglaiError("SECURITY_POLICY", "generation backup root must be a real directory");
    }
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    chmodSync(backupRoot, 0o700);
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    chmodSync(backup, 0o700);
    const files: Array<{ path: string; sha256: string }> = [];
    for (const rel of BACKUP_SOURCES) {
      const src = join(userRoot, rel);
      if (!existsSync(src)) continue;
      if (secretBackupCategory(rel.split("/").pop() ?? "")) {
        excluded.add("credentials-yaml");
        continue;
      }
      copyNonSecretTree(src, join(backup, rel), excluded, files, userRoot);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const nonSecretDigest = createHash("sha256")
      .update(files.map((file) => `${file.path}:${file.sha256}`).join("\n"))
      .digest("hex");
    atomicJson(marker, {
      id: RC8_TO_RC1_MIGRATION_ID,
      at: now.toISOString(),
      from: "0.1.0-rc.8",
      to: "0.1.1-rc.1",
      backupId: `${RC8_TO_RC1_MIGRATION_ID}-${stamp}`,
      credentialsCopied: false,
      excludedCategories: [...excluded],
      nonSecretDigest,
      preserved: ["workspace", "session", "settings", "plugin-desired"],
    });
    const cleanup = cleanupHistoricalBackupSecrets(userRoot);
    return {
      migrated: true,
      already: false,
      backup,
      marker,
      credentialsCopied: false,
      excludedCategories: [...excluded],
      cleanup,
    };
  } catch (error) {
    try {
      if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
      rmSync(marker, { force: true });
    } catch {
      /* remove incomplete backup only; never overlay live data */
    }
    throw new PenglaiError(
      "STORE_CORRUPT",
      `rc.8→rc.1 user-data migrate failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readMigrationMarker(userRoot: string): { id: string; from?: string; to?: string; credentialsCopied?: false } | undefined {
  const path = markerPath(userRoot);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      id?: string;
      from?: string;
      to?: string;
      credentialsCopied?: unknown;
    };
    if (raw.id !== RC8_TO_RC1_MIGRATION_ID) return undefined;
    return {
      id: raw.id,
      ...(raw.from ? { from: raw.from } : {}),
      ...(raw.to ? { to: raw.to } : {}),
      ...(raw.credentialsCopied === false ? { credentialsCopied: false } : {}),
    };
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "rc.8→rc.1 migration marker unreadable");
  }
}
