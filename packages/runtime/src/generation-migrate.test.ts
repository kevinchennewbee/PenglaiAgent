import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanupHistoricalBackupSecrets,
  migrateRc8UserData,
  restoreCanonicalCredentialFromBackup,
} from "./generation-migrate.js";

const FIXTURE_KEY = "penglai-test-fixture-key-not-real";
const OTHER_FIXTURE_KEY = "penglai-test-other-fixture-key-not-real";

function writeCanonical(root: string, body = `DEEPSEEK_API_KEY: ${FIXTURE_KEY}\n`): string {
  mkdirSync(join(root, "dsh-home"), { recursive: true, mode: 0o700 });
  const path = join(root, "dsh-home", ".credentials.yaml");
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

function writeBackupSecret(root: string, stamp: string, body: string): string {
  const dir = join(root, ".penglai-backup", stamp, "dsh-home");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, ".credentials.yaml");
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

test("R56-SEC-001 generation backup never copies registered secret files", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-gen-backup-"));
  writeCanonical(root);
  writeFileSync(join(root, "dsh-home", "settings.yaml"), "locale: zh\n", { mode: 0o600 });
  const result = migrateRc8UserData(root);
  assert.equal(result.migrated, true);
  assert.equal(result.credentialsCopied, false);
  assert.equal(existsSync(join(root, "dsh-home", ".credentials.yaml")), true);
  assert.equal(existsSync(join(result.backup ?? "", "dsh-home", ".credentials.yaml")), false);
  assert.equal(existsSync(join(result.backup ?? "", "dsh-home", "settings.yaml")), true);
  assert.equal(readFileSync(join(root, "dsh-home", ".credentials.yaml"), "utf8").includes(FIXTURE_KEY), true);
  assert.match(JSON.stringify(result.excludedCategories), /credentials-yaml/);
});

test("R56-SEC-001 migrate failure does not overwrite live credentials from a partial backup", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-gen-fail-"));
  const canonical = writeCanonical(root);
  writeFileSync(join(root, ".penglai-backup"), "not-a-directory\n", { mode: 0o600 });
  assert.throws(() => migrateRc8UserData(root), /migrate failed/);
  assert.equal(readFileSync(canonical, "utf8").includes(FIXTURE_KEY), true);
});

test("R56-SEC-002 identical historical backup secret is removed and canonical is kept", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-gen-dup-"));
  writeCanonical(root);
  const backup = writeBackupSecret(root, "hist-dup", `DEEPSEEK_API_KEY: ${FIXTURE_KEY}\n`);
  writeFileSync(join(root, ".penglai-backup", "hist-dup", "dsh-home", "settings.yaml"), "locale: zh\n", { mode: 0o600 });
  const cleanup = cleanupHistoricalBackupSecrets(root);
  assert.equal(cleanup.kind, "removed-duplicate");
  assert.equal(cleanup.removedDuplicates, 1);
  assert.equal(existsSync(backup), false);
  assert.equal(existsSync(join(root, ".penglai-backup", "hist-dup", "dsh-home", "settings.yaml")), true);
  assert.equal(readFileSync(join(root, "dsh-home", ".credentials.yaml"), "utf8").includes(FIXTURE_KEY), true);
});

test("R56-SEC-002 unique backup secret becomes a restore proposal and is not auto-applied", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-gen-unique-"));
  mkdirSync(join(root, "dsh-home"), { recursive: true, mode: 0o700 });
  writeBackupSecret(root, "hist-unique", `DEEPSEEK_API_KEY: ${FIXTURE_KEY}\n`);
  const cleanup = cleanupHistoricalBackupSecrets(root);
  assert.equal(cleanup.kind, "restore-proposal");
  assert.equal(existsSync(join(root, "dsh-home", ".credentials.yaml")), false);
  assert.equal(existsSync(join(root, ".penglai-backup", "hist-unique", "dsh-home", ".credentials.yaml")), true);
  if (cleanup.kind !== "restore-proposal") throw new Error("expected restore-proposal");
  restoreCanonicalCredentialFromBackup({ userRoot: root, backupRelative: cleanup.backupRelative });
  assert.equal(readFileSync(join(root, "dsh-home", ".credentials.yaml"), "utf8").includes(FIXTURE_KEY), true);
  assert.equal(existsSync(join(root, ".penglai-backup", "hist-unique", "dsh-home", ".credentials.yaml")), false);
});

test("R56-SEC-002 conflicting canonical and backup secrets fail closed and keep both", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-gen-conflict-"));
  writeCanonical(root, `DEEPSEEK_API_KEY: ${FIXTURE_KEY}\n`);
  const backup = writeBackupSecret(root, "hist-conflict", `DEEPSEEK_API_KEY: ${OTHER_FIXTURE_KEY}\n`);
  const cleanup = cleanupHistoricalBackupSecrets(root);
  assert.equal(cleanup.kind, "conflict");
  assert.equal(existsSync(join(root, "dsh-home", ".credentials.yaml")), true);
  assert.equal(existsSync(backup), true);
  assert.equal(readFileSync(join(root, "dsh-home", ".credentials.yaml"), "utf8").includes(FIXTURE_KEY), true);
  assert.equal(readFileSync(backup, "utf8").includes(OTHER_FIXTURE_KEY), true);
});

test("R56-SEC-002 multiple distinct backup secrets are not auto-chosen", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-gen-multi-"));
  mkdirSync(join(root, "dsh-home"), { recursive: true, mode: 0o700 });
  writeBackupSecret(root, "hist-a", `DEEPSEEK_API_KEY: ${FIXTURE_KEY}\n`);
  writeBackupSecret(root, "hist-b", `DEEPSEEK_API_KEY: ${OTHER_FIXTURE_KEY}\n`);
  const cleanup = cleanupHistoricalBackupSecrets(root);
  assert.equal(cleanup.kind, "ambiguous");
  assert.equal(existsSync(join(root, ".penglai-backup", "hist-a", "dsh-home", ".credentials.yaml")), true);
  assert.equal(existsSync(join(root, ".penglai-backup", "hist-b", "dsh-home", ".credentials.yaml")), true);
});
