import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupComplete,
  backupIntegrity,
  extraFilesNotInSource,
  injectBackupIntegrityFailure,
  mixedGenerationResidue,
  nsisUpgradeTransactionContract,
  restoreVerified,
  runCopyFallbackTransaction,
} from "./windows-upgrade-transaction.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("upgrade copy fallback must reject mixed-generation trees and unverified restore", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-upgrade-tx-"));
  try {
    const live = join(dir, "live");
    const pending = join(dir, "pending");
    const previous = join(dir, "previous");
    mkdirSync(join(live, "old-generation"), { recursive: true });
    mkdirSync(pending, { recursive: true });
    writeFileSync(join(live, "Penglai.exe"), "old");
    writeFileSync(join(live, "old-generation", "stale.dll"), "stale");
    writeFileSync(join(pending, "Penglai.exe"), "new");
    writeFileSync(join(pending, "fresh.dll"), "fresh");
    const mixed = mixedGenerationResidue(live, pending);
    assert.equal(mixed.ok, false);
    assert.ok(mixed.extra.some((name) => name.includes("stale.dll")));
    assert.deepEqual(extraFilesNotInSource(["Penglai.exe", "old-generation/stale.dll"], ["Penglai.exe", "fresh.dll"]), [
      "old-generation/stale.dll",
    ]);
    assert.equal(backupComplete(previous), false);
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(previous, "Penglai.exe"), "old");
    assert.equal(backupComplete(previous), true);
    assert.equal(restoreVerified(live), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backup integrity failure injection refuses a missing or truncated previous tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-backup-inject-"));
  try {
    const previous = join(dir, "previous");
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(previous, "Penglai.exe"), "old-payload");
    assert.equal(backupIntegrity(previous).ok, true);
    assert.equal(injectBackupIntegrityFailure(previous, "truncated").ok, false);
    assert.equal(backupIntegrity(previous).ok, false);
    assert.match(backupIntegrity(previous).reason, /truncated/);
    writeFileSync(join(previous, "Penglai.exe"), "old-payload");
    assert.equal(injectBackupIntegrityFailure(previous, "missing-exe").ok, false);
    assert.equal(backupComplete(previous), false);
    assert.equal(backupIntegrity(previous).ok, false);
    assert.match(nsisUpgradeTransactionContract(readFileSync(join(root, "scripts/nsis/Penglai.nsi"), "utf8")).join(""), /^$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copy-fallback transaction injects disk-full, lock, partial, interrupt, and activation failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-upgrade-inject-"));
  try {
    const live = join(dir, "live");
    const pending = join(dir, "pending");
    const previous = join(dir, "previous");
    mkdirSync(join(live, "old-generation"), { recursive: true });
    mkdirSync(pending, { recursive: true });
    writeFileSync(join(live, "Penglai.exe"), "old-bytes");
    writeFileSync(join(live, "old-generation", "stale.dll"), "stale");
    writeFileSync(join(pending, "Penglai.exe"), "new-bytes");
    writeFileSync(join(pending, "fresh.dll"), "fresh");
    assert.equal(runCopyFallbackTransaction({ liveRoot: live, pendingRoot: pending, previousRoot: join(dir, "disk"), inject: "disk-full" }).phase, "backup-failed");
    assert.equal(runCopyFallbackTransaction({ liveRoot: live, pendingRoot: pending, previousRoot: join(dir, "lock"), inject: "lock" }).phase, "backup-failed");
    assert.equal(runCopyFallbackTransaction({ liveRoot: live, pendingRoot: pending, previousRoot: join(dir, "partial"), inject: "partial" }).phase, "backup-failed");
    assert.equal(runCopyFallbackTransaction({ liveRoot: live, pendingRoot: pending, previousRoot: join(dir, "interrupt"), inject: "interrupt" }).phase, "backup-failed");
    mkdirSync(join(dir, "live-activate"), { recursive: true });
    mkdirSync(join(dir, "pending-empty"), { recursive: true });
    writeFileSync(join(dir, "live-activate", "Penglai.exe"), "old-bytes");
    const failed = runCopyFallbackTransaction({
      liveRoot: join(dir, "live-activate"),
      pendingRoot: join(dir, "pending-empty"),
      previousRoot: join(dir, "previous-activate"),
      inject: "activate-failed",
    });
    assert.equal(failed.ok, false);
    assert.match(failed.phase, /activate-failed-restored|restore-failed/);
    assert.equal(readFileSync(join(dir, "live-activate", "Penglai.exe"), "utf8"), "old-bytes");
    const ok = runCopyFallbackTransaction({ liveRoot: live, pendingRoot: pending, previousRoot: previous });
    assert.equal(ok.ok, true);
    assert.equal(ok.phase, "activated");
    assert.equal(readFileSync(join(live, "Penglai.exe"), "utf8"), "new-bytes");
    assert.equal(restoreVerified(live), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NSIS upgrade script has checked backup, purge, and restore verification", () => {
  const nsis = readFileSync(join(root, "scripts/nsis/Penglai.nsi"), "utf8");
  const errors = nsisUpgradeTransactionContract(nsis);
  assert.equal(errors.length, 0, errors.join("; "));
  assert.match(nsis, /\/PURGE/);
  assert.match(nsis, /upgrade_backup_failed/);
  assert.match(nsis, /upgrade_restore_failed/);
  assert.doesNotMatch(nsis, /\/IM Penglai\.exe/);
});
