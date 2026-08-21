import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export const RC8_TO_RC1_MIGRATION_ID = "penglai-0.5.1-rc8-to-rc1";
export const RC8_TO_RC1_MARKER = ".penglai-migrated-0.5.1-rc1";

export interface GenerationMigrateResult {
  migrated: boolean;
  already: boolean;
  backup?: string;
  marker: string;
}

function markerPath(userRoot: string): string {
  return join(userRoot, RC8_TO_RC1_MARKER);
}

function atomicJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Same-generation rc.8 → rc.1 user-data migrate for Penglai/0.5.
 * Copies credentials, workspace, sessions, settings, and plugin desired state
 * into a versioned backup, then writes an idempotent marker. Failure restores
 * the backup and refuses to continue.
 */
export function migrateRc8UserData(userRoot: string, now = new Date()): GenerationMigrateResult {
  const marker = markerPath(userRoot);
  if (existsSync(marker)) {
    return { migrated: false, already: true, marker };
  }
  const dshHome = join(userRoot, "dsh-home");
  if (!existsSync(dshHome) && !existsSync(join(userRoot, "onboarding"))) {
    atomicJson(marker, {
      id: RC8_TO_RC1_MIGRATION_ID,
      at: now.toISOString(),
      from: "0.1.0-rc.8",
      to: "0.1.1-rc.1",
      empty: true,
    });
    return { migrated: false, already: false, marker };
  }
  const stamp = now.toISOString().replaceAll(":", "").replaceAll(".", "");
  const backup = join(userRoot, ".penglai-backup", `${RC8_TO_RC1_MIGRATION_ID}-${stamp}`);
  mkdirSync(join(userRoot, ".penglai-backup"), { recursive: true, mode: 0o700 });
  try {
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    for (const rel of [
      "dsh-home",
      "onboarding",
      "plugins/desired.json",
      "im",
      ".credentials.yaml",
    ]) {
      const src = join(userRoot, rel);
      if (!existsSync(src)) continue;
      cpSync(src, join(backup, rel), { recursive: true, dereference: false, errorOnExist: false, force: true });
    }
    atomicJson(marker, {
      id: RC8_TO_RC1_MIGRATION_ID,
      at: now.toISOString(),
      from: "0.1.0-rc.8",
      to: "0.1.1-rc.1",
      backup,
      preserved: ["credentials", "workspace", "session", "settings", "plugin-desired"],
    });
    return { migrated: true, already: false, backup, marker };
  } catch (error) {
    try {
      if (existsSync(backup)) {
        for (const rel of ["dsh-home", "onboarding", "plugins", "im"]) {
          const from = join(backup, rel);
          if (!existsSync(from)) continue;
          const dest = join(userRoot, rel);
          rmSync(dest, { recursive: true, force: true });
          cpSync(from, dest, { recursive: true, dereference: false, force: true });
        }
      }
      rmSync(marker, { force: true });
    } catch {
      /* restore best-effort; still fail closed */
    }
    throw new PenglaiError(
      "STORE_CORRUPT",
      `rc.8→rc.1 user-data migrate failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readMigrationMarker(userRoot: string): { id: string; from?: string; to?: string } | undefined {
  const path = markerPath(userRoot);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { id?: string; from?: string; to?: string };
    if (raw.id !== RC8_TO_RC1_MIGRATION_ID) return undefined;
    return { id: raw.id, ...(raw.from ? { from: raw.from } : {}), ...(raw.to ? { to: raw.to } : {}) };
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "rc.8→rc.1 migration marker unreadable");
  }
}
