import { cpSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** Testable Windows upgrade activation / rollback policy. NSIS must match. */

export function listRelativeFiles(root) {
  const out = [];
  function walk(dir) {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join("/"));
    }
  }
  walk(root);
  return out.sort();
}

export function treeHasPayload(root, marker = "Penglai.exe") {
  try {
    return statSync(join(root, marker)).isFile();
  } catch {
    return false;
  }
}

export function extraFilesNotInSource(liveFiles, pendingFiles) {
  const pending = new Set(pendingFiles);
  return liveFiles.filter((name) => !pending.has(name));
}

export function mixedGenerationResidue(liveRoot, pendingRoot) {
  if (!treeHasPayload(pendingRoot)) {
    return { ok: false, reason: "pending payload incomplete" };
  }
  const extra = extraFilesNotInSource(listRelativeFiles(liveRoot), listRelativeFiles(pendingRoot));
  return { ok: extra.length === 0, extra };
}

export function treeBytes(root) {
  return listRelativeFiles(root).reduce((sum, name) => {
    try {
      return sum + statSync(join(root, ...name.split("/"))).size;
    } catch {
      return sum;
    }
  }, 0);
}

export function backupComplete(previousRoot, liveRoot) {
  if (!treeHasPayload(previousRoot)) return false;
  if (!liveRoot) return true;
  const previousFiles = listRelativeFiles(previousRoot);
  const liveFiles = listRelativeFiles(liveRoot);
  if (previousFiles.length !== liveFiles.length) return false;
  return treeBytes(previousRoot) === treeBytes(liveRoot);
}

export function copyTreePurged(sourceRoot, destRoot) {
  mkdirSync(destRoot, { recursive: true });
  const wanted = new Set(listRelativeFiles(sourceRoot));
  for (const name of listRelativeFiles(destRoot)) {
    if (!wanted.has(name)) {
      unlinkSync(join(destRoot, ...name.split("/")));
    }
  }
  for (const name of wanted) {
    const dest = join(destRoot, ...name.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(sourceRoot, ...name.split("/")), dest);
  }
}

export function runCopyFallbackTransaction({ liveRoot, pendingRoot, previousRoot, inject } = {}) {
  const phase = { backup: false, activate: false, restored: false, reason: "" };
  try {
    if (inject === "disk-full") {
      phase.reason = "disk full";
      return { ok: false, phase: "backup-failed", ...phase };
    }
    if (inject === "interrupt") {
      phase.reason = "interrupted";
      return { ok: false, phase: "backup-failed", ...phase };
    }
    mkdirSync(previousRoot, { recursive: true });
    if (inject === "lock") {
      phase.reason = "file lock";
      return { ok: false, phase: "backup-failed", ...phase };
    }
    copyTreePurged(liveRoot, previousRoot);
    if (inject === "partial") {
      const extra = listRelativeFiles(liveRoot).find((name) => name !== "Penglai.exe");
      if (extra) unlinkSync(join(previousRoot, ...extra.split("/")));
      phase.reason = "partial copy";
      return { ok: false, phase: "backup-failed", ...phase };
    }
    if (!backupComplete(previousRoot, liveRoot) || !backupIntegrity(previousRoot).ok) {
      phase.reason = "backup incomplete";
      return { ok: false, phase: "backup-failed", ...phase };
    }
    phase.backup = true;
    if (inject === "activate-failed" || !treeHasPayload(pendingRoot)) {
      rmSync(liveRoot, { recursive: true, force: true });
      mkdirSync(liveRoot, { recursive: true });
      copyTreePurged(previousRoot, liveRoot);
      phase.restored = restoreVerified(liveRoot);
      phase.reason = "activation failed";
      return { ok: false, phase: phase.restored ? "activate-failed-restored" : "restore-failed", ...phase };
    }
    copyTreePurged(pendingRoot, liveRoot);
    const mixed = mixedGenerationResidue(liveRoot, pendingRoot);
    if (!mixed.ok || !treeHasPayload(liveRoot)) {
      rmSync(liveRoot, { recursive: true, force: true });
      mkdirSync(liveRoot, { recursive: true });
      copyTreePurged(previousRoot, liveRoot);
      phase.restored = restoreVerified(liveRoot);
      phase.reason = mixed.ok ? "activate missing payload" : "mixed generation";
      return { ok: false, phase: phase.restored ? "activate-failed-restored" : "restore-failed", ...phase };
    }
    phase.activate = true;
    return { ok: true, phase: "activated", ...phase };
  } catch (error) {
    phase.reason = error instanceof Error ? error.message : String(error);
    return { ok: false, phase: "failed", ...phase };
  }
}

/** Inject a backup that looks present but is not restorable. */
export function injectBackupIntegrityFailure(previousRoot, kind = "missing-exe") {
  const exe = join(previousRoot, "Penglai.exe");
  if (kind === "missing-exe") {
    try {
      unlinkSync(exe);
    } catch {
      // already missing
    }
    return { ok: false, reason: "backup Penglai.exe missing" };
  }
  if (kind === "truncated") {
    writeFileSync(exe, "");
    return { ok: false, reason: "backup Penglai.exe truncated" };
  }
  throw new Error(`unknown backup integrity failure ${kind}`);
}

export function backupIntegrity(previousRoot) {
  if (!treeHasPayload(previousRoot)) {
    return { ok: false, reason: "backup Penglai.exe missing" };
  }
  try {
    if (statSync(join(previousRoot, "Penglai.exe")).size <= 0) {
      return { ok: false, reason: "backup Penglai.exe truncated" };
    }
  } catch {
    return { ok: false, reason: "backup Penglai.exe unreadable" };
  }
  return { ok: true };
}

export function restoreVerified(liveRoot) {
  return treeHasPayload(liveRoot);
}

export function nsisUpgradeTransactionContract(script) {
  const text = String(script ?? "");
  const errors = [];
  if (!/upgrade_backup_failed/.test(text)) {
    errors.push("CopyFiles backup must have a failure label");
  }
  if (!/IfFileExists "\$INSTDIR\.previous\\Penglai\.exe"/.test(text)) {
    errors.push("backup must verify previous Penglai.exe before treating it as restorable");
  }
  if (!/\$\{GetSize\}/.test(text)) {
    errors.push("backup must compare live and previous tree sizes");
  }
  if (!/\/PURGE/.test(text) && !/\/MIR/.test(text)) {
    errors.push("copy fallback must purge files not in the staged payload");
  }
  if (!/upgrade_restore_failed/.test(text)) {
    errors.push("rollback must have a failure path that does not claim success");
  }
  if (!/IfFileExists "\$INSTDIR\\Penglai\.exe" 0 upgrade_restore_failed/.test(text)) {
    errors.push("rollback must verify live Penglai.exe after rename");
  }
  if (/restored the previous install/.test(text) && !/upgrade_restore_failed/.test(text)) {
    errors.push("must not claim restore success without a verified restore path");
  }
  return errors;
}
