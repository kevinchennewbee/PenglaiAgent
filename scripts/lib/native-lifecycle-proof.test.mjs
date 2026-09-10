import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION } from "./product.mjs";
import { observeStopChild, reapWindowsInstallTree, waitOwnedWindowsProcessesGone } from "./installed-app.mjs";
import {
  CURRENT_DSH_HOME_RELATIVE,
  CURRENT_DSH_HOME_VERSION,
  classifyApplicationShutdown,
  currentGenerationProfileIdentity,
  nsisDefaultInstallDir,
  nsisUninstallKeepsCustomInstdir,
  PERSISTED_PROFILE_FILES,
  persistedProfileProofValid,
  profileRestartProblems,
  readCurrentGenerationIdentity,
  readPersistedProfileProof,
  requestNativeApplicationClose,
  stableInventoryIdentity,
  waitForChildExitNoKill,
  windowsDefaultInstallDir,
  windowsFreshLifecyclePathContract,
  windowsFreshProfilePreflight,
} from "./native-lifecycle-proof.mjs";
import { FRESH_LIFECYCLE_SCHEMA, freshInstallUninstallEvidenceMatches, freshInstallUninstallEvidenceProblems } from "./native-fresh-set.mjs";

test("NSIS default INSTDIR and fresh Windows fixture path stay the same contract", () => {
  const nsis = readFileSync(join(ROOT, "scripts/nsis/Penglai.nsi"), "utf8");
  const fresh = readFileSync(join(ROOT, "scripts/verify-fresh-install-uninstall.mjs"), "utf8");
  const helper = readFileSync(join(ROOT, "scripts/lib/installed-app.mjs"), "utf8");
  assert.equal(nsisDefaultInstallDir(nsis), String.raw`$LOCALAPPDATA\Penglai\app\0.5`);
  assert.equal(nsisUninstallKeepsCustomInstdir(nsis), true);
  assert.equal(windowsDefaultInstallDir("C:\\Users\\runner\\AppData\\Local"), join("C:\\Users\\runner\\AppData\\Local", "Penglai", "app", "0.5"));
  const proofHelper = readFileSync(join(ROOT, "scripts/lib/native-lifecycle-proof.mjs"), "utf8");
  assert.deepEqual(windowsFreshLifecyclePathContract({ nsis, freshGate: fresh, helper, proofHelper }), []);
  const customNsis = nsis.replace('Keeping custom install directory $INSTDIR (not the default app tree).', "RMDir /r \"$INSTDIR\"");
  assert.ok(windowsFreshLifecyclePathContract({ nsis: customNsis, freshGate: fresh, helper, proofHelper }).length > 0);
  const customFresh = fresh.replace("function installWindowsDefault", "function installWindowsCustom");
  assert.ok(windowsFreshLifecyclePathContract({ nsis, freshGate: customFresh, helper, proofHelper }).length > 0);
});

test("forced stopChild termination is not a graceful application shutdown", async (context) => {
  const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});process.stdout.write("READY\\n");setInterval(()=>{},1000);'], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
  });
  const observed = await observeStopChild(child, 50);
  const windowsHost = process.platform === "win32";
  assert.equal(observed.forced, true);
  if (windowsHost) {
    assert.ok(observed.method === "node-sigterm-windows" || observed.method === "taskkill-force");
  } else {
    assert.equal(observed.signal, "SIGKILL");
    assert.equal(observed.method, "sigkill");
  }
  const liveTarget = windowsHost ? "win32-x86_64" : "darwin-aarch64";
  assert.equal(
    classifyApplicationShutdown(
      {
        graceful: true,
        forced: observed.forced,
        requestedClose: true,
        method: observed.method,
        exitCode: observed.code,
        signal: observed.signal,
      },
      liveTarget,
    ).graceful,
    false,
  );
  if (!windowsHost) {
    assert.equal(
      classifyApplicationShutdown(
        {
          graceful: true,
          forced: observed.forced,
          requestedClose: true,
          method: "posix-sigterm",
          exitCode: observed.code,
          signal: observed.signal,
        },
        "darwin-aarch64",
      ).graceful,
      false,
    );
  }
  const receipt = {
    schema: FRESH_LIFECYCLE_SCHEMA,
    command: "verify:fresh-install-uninstall",
    kind: "installed-lifecycle",
    scope: "fresh-install-restart-default-uninstall",
    verdict: "PASS",
    target: liveTarget,
    sourceSha: "a".repeat(40),
    installer: windowsHost ? "Penglai_0.6.1_windows_x64_setup.exe" : "Penglai_0.6.1_macos_aarch64.dmg",
    installerSha256: "b".repeat(64),
    host: windowsHost ? { platform: "win32", arch: "x64" } : { platform: "darwin", arch: "arm64" },
    destination: windowsHost ? "C:\\Users\\runner\\AppData\\Local\\Penglai\\app\\0.5" : "/tmp/Penglai.app",
    windowsInstall: windowsHost
      ? { path: "C:\\Users\\runner\\AppData\\Local\\Penglai\\app\\0.5", customDestination: false, payloadDeletedByHarness: false }
      : undefined,
    boot: {
      freshReadiness: true,
      profileIdentity: { inventorySha256: "e".repeat(64), dshHomePresent: true },
      shutdown: {
        graceful: true,
        forced: observed.forced,
        requestedClose: true,
        method: windowsHost ? observed.method : "posix-sigterm",
        exitCode: observed.code,
        signal: observed.signal,
      },
    },
    restart: {
      freshReadiness: true,
      resumed: true,
      profileIdentity: { inventorySha256: "e".repeat(64), dshHomePresent: true },
      shutdown: {
        graceful: true,
        forced: false,
        requestedClose: true,
        method: windowsHost ? "windows-wm-close" : "posix-sigterm",
        exitCode: 0,
        signal: null,
      },
    },
    processCleanup: { afterBoot: true, afterRestart: true, afterUninstall: true },
    uninstall: {
      method: windowsHost ? "nsis-uninstaller" : "dedicated-app-removal",
      uninstallRemovedApp: true,
      wholeInstdirDeletedToManufacturePass: false,
    },
    ownerData: {
      sentinelPreservedAfterBoot: true,
      sentinelPreservedAfterRestart: true,
      sentinelPreservedAfterUninstall: true,
      sentinelUnchanged: true,
      sentinelSha256: "c".repeat(64),
      scope: windowsHost ? "localappdata-penglai-0.5-excluding-update-cache" : "task-created-user-data",
    },
  };
  const expected = { sourceSha: receipt.sourceSha, installerSha256: receipt.installerSha256, target: receipt.target };
  assert.equal(freshInstallUninstallEvidenceMatches(receipt, expected), false);
  assert.ok(freshInstallUninstallEvidenceProblems(receipt, expected).includes("forced or abnormal shutdown"));
});

test("posix SIGTERM close of a cooperative child is classified graceful on Mac only", async (context) => {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>process.exit(0));process.stdout.write('READY\\n');setInterval(()=>{},1000);"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  context.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
  });
  const waiting = waitForChildExitNoKill(child, 2_000);
  const closeReq = await requestNativeApplicationClose(child, { platform: "darwin" });
  const waited = await waiting;
  assert.equal(closeReq.method, "posix-sigterm");
  assert.equal(closeReq.requestedClose, true);
  assert.equal(waited.code, 0);
  assert.equal(waited.signal, null);
  assert.equal(
    classifyApplicationShutdown({ ...closeReq, exitCode: waited.code, signal: waited.signal, forced: false }, "darwin-aarch64").graceful,
    true,
  );
  assert.equal(
    classifyApplicationShutdown({ ...closeReq, exitCode: waited.code, signal: waited.signal, forced: false }, "win32-x86_64").graceful,
    false,
  );
});

test("Node SIGTERM on Windows and taskkill /F are never graceful shutdown proof", () => {
  assert.equal(
    classifyApplicationShutdown(
      { graceful: true, forced: false, requestedClose: true, method: "node-sigterm-windows", exitCode: 1, signal: null },
      "win32-x86_64",
    ).graceful,
    false,
  );
  assert.equal(
    classifyApplicationShutdown(
      { graceful: true, forced: true, requestedClose: true, method: "taskkill-force", exitCode: 1, signal: null },
      "win32-x86_64",
    ).graceful,
    false,
  );
  assert.equal(
    classifyApplicationShutdown(
      { graceful: true, forced: false, requestedClose: true, method: "windows-wm-close", exitCode: 0, signal: null },
      "win32-x86_64",
    ).graceful,
    true,
  );
});

test("publication workflow consumes the current 0.6.1 native evidence set and eleven-asset contract", async () => {
  const { EXACT_RELEASE_ASSETS } = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/contract.ts")).href);
  const publish = readFileSync(join(ROOT, ".github/workflows/publish-release.yml"), "utf8");
  const native = readFileSync(join(ROOT, ".github/workflows/native-release-candidate.yml"), "utf8");
  assert.equal(EXACT_RELEASE_ASSETS.length, 11);
  const nativeName = `penglai-${PRODUCT_VERSION}-native-evidence-set`;
  const readbackName = `penglai-${PRODUCT_VERSION}-public-readback`;
  assert.match(native, new RegExp(`name:\\s*${nativeName}`));
  assert.match(publish, new RegExp(`name:\\s*${nativeName}`));
  assert.match(publish, /Read back all eleven draft assets/);
  assert.match(publish, new RegExp(`name:\\s*${readbackName}`));
  assert.doesNotMatch(publish, /penglai-0\.6\.0-native-evidence-set/);
  assert.doesNotMatch(publish, /all ten draft assets/);
  assert.doesNotMatch(publish, /penglai-0\.6\.0-public-readback/);
  const mismatched = publish.replaceAll(`penglai-${PRODUCT_VERSION}-native-evidence-set`, "penglai-0.6.0-native-evidence-set");
  assert.match(mismatched, /penglai-0\.6\.0-native-evidence-set/);
  assert.doesNotMatch(mismatched, new RegExp(`name:\\s*penglai-${PRODUCT_VERSION}-native-evidence-set`));
});

function writeSnap(root, { nonce, pid, entries = [{ id: "@penglai/office", enabled: true, fiberPhase: "active" }] }) {
  mkdirSync(join(root, "plugins"), { recursive: true });
  writeFileSync(
    join(root, "plugins", "inventory-snapshot.json"),
    JSON.stringify({
      at: new Date().toISOString(),
      launchNonce: nonce,
      dshPid: pid,
      entries,
      required: { office: true, memory: true, credentials: true, "plugin-center": true, im: false, smokeDisabled: true },
      requiredProofs: [],
      ok: true,
    }, null, 2),
  );
}

test("stable inventory ignores process instance IDs and ordering while preserving plugin identity and multiplicity", () => {
  const entries = [
    { entryId: "include:office", moduleName: "@penglai/office", enabled: true, fiberPhase: "active", healthy: true, health: "ready" },
    { entryId: "process-instance-a", moduleName: "@deepseek-ai/dsh-host-directory-picker-native", enabled: true, fiberPhase: "active", healthy: true, health: "ready" },
  ];
  const snapshot = { at: "first", launchNonce: "boot-a", dshPid: 101, entries, ok: true, requiredProofs: [] };
  const before = stableInventoryIdentity(snapshot);
  const restarted = { ...snapshot, at: "second", launchNonce: "boot-b", dshPid: 202, entries: entries.map((entry, index) => ({ ...entry, entryId: `other-instance-${index}` })).reverse() };
  assert.equal(before.ok, true);
  assert.equal(stableInventoryIdentity(restarted).digest, before.digest);
  for (const changed of [
    entries.slice(1),
    [...entries, { ...entries[1], entryId: "additional-instance" }],
    entries.map((entry, index) => index === 1 ? { ...entry, moduleName: "@penglai/unexpected" } : entry),
    entries.map((entry, index) => index === 1 ? { ...entry, enabled: false } : entry),
    entries.map((entry, index) => index === 1 ? { ...entry, healthy: false, health: "failed" } : entry),
  ]) {
    assert.notEqual(stableInventoryIdentity({ ...snapshot, entries: changed }).digest, before.digest);
  }
  assert.equal(stableInventoryIdentity({ ...snapshot, entries: [null] }).ok, false);
});

function writeCurrentHome(root, { version = CURRENT_DSH_HOME_VERSION, relative = CURRENT_DSH_HOME_RELATIVE, malformed = false, skipHome = false } = {}) {
  if (malformed) {
    writeFileSync(join(root, "dsh-home-active.json"), "{not-json");
    return;
  }
  writeFileSync(
    join(root, "dsh-home-active.json"),
    JSON.stringify({
      schema: 1,
      activeVersion: version,
      homeRelative: relative,
      activatedAt: "2026-09-10T00:00:00.000Z",
      activationKind: "fresh",
      targetDigest: "a".repeat(64),
    }),
  );
  if (!skipHome) {
    const home = join(root, ...relative.split("/"));
    const profile = join(home, "profiles", "web");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(home, ".penglai-dsh-home.json"), JSON.stringify({ schema: 1, kind: "fresh", state: "active", dshVersion: version }));
    writeFileSync(join(profile, "package.json"), JSON.stringify({ private: true, dependencies: {} }));
    writeFileSync(join(profile, "cordis.yml"), "plugins: {}\n");
  }
}

test("current-generation restart accepts writer nonce/PID change and rejects stale or absent homes", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-stable-restart-"));
  try {
    writeCurrentHome(root);
    writeSnap(root, { nonce: "boot", pid: 11 });
    const previous = currentGenerationProfileIdentity(root);
    assert.equal(previous.ok, true);
    assert.equal(previous.generation.activeVersion, CURRENT_DSH_HOME_VERSION);
    assert.equal(previous.generation.homeRelative, CURRENT_DSH_HOME_RELATIVE);
    assert.equal(previous.onboardingCompleted, false);
    writeSnap(root, { nonce: "restart", pid: 22 });
    writeFileSync(join(root, ".credentials.yaml"), "fixture: root vault bytes are excluded\n");
    writeFileSync(join(root, CURRENT_DSH_HOME_RELATIVE, ".credentials.yaml"), "fixture: current vault bytes are excluded\n");
    const current = currentGenerationProfileIdentity(root);
    assert.equal(current.ok, true);
    assert.deepEqual(profileRestartProblems(previous, current), []);
    assert.equal(current.stable.digest, previous.stable.digest);
    assert.equal(current.persisted.digest, previous.persisted.digest);

    writeSnap(root, { nonce: "boot", pid: 11 });
    const stale = currentGenerationProfileIdentity(root);
    assert.ok(profileRestartProblems(previous, stale).includes("stale process-bound readiness"));

    writeSnap(root, { nonce: "other", pid: 33, entries: [{ id: "@penglai/memory", enabled: true, fiberPhase: "active" }] });
    const changed = currentGenerationProfileIdentity(root);
    assert.ok(profileRestartProblems(previous, changed).includes("changed stable generation state"));

    const empty = mkdtempSync(join(tmpdir(), "penglai-absent-home-"));
    writeSnap(empty, { nonce: "boot", pid: 11 });
    const absent = currentGenerationProfileIdentity(empty);
    assert.equal(absent.generation.ok, false);
    assert.equal(absent.generation.homePresent, false);
    assert.ok(profileRestartProblems(absent, absent).includes("absent current generation identity"));
    rmSync(empty, { recursive: true, force: true });

    const malformedRoot = mkdtempSync(join(tmpdir(), "penglai-malformed-home-"));
    writeCurrentHome(malformedRoot, { malformed: true });
    assert.equal(readCurrentGenerationIdentity(malformedRoot).ok, false);
    rmSync(malformedRoot, { recursive: true, force: true });

    const oldRoot = mkdtempSync(join(tmpdir(), "penglai-old-home-"));
    writeCurrentHome(oldRoot, { version: "0.1.5-alpha.1", relative: "dsh-homes/dsh-v0.1.5-alpha.1" });
    assert.equal(readCurrentGenerationIdentity(oldRoot).ok, false);
    rmSync(oldRoot, { recursive: true, force: true });

    const missingHome = mkdtempSync(join(tmpdir(), "penglai-missing-home-dir-"));
    writeCurrentHome(missingHome, { skipHome: true });
    assert.equal(readCurrentGenerationIdentity(missingHome).ok, false);
    rmSync(missingHome, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restart requires persisted profile files and successful inventory, not just a current Home directory", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-persisted-profile-"));
  try {
    writeCurrentHome(root);
    writeSnap(root, { nonce: "first", pid: 11 });
    const before = currentGenerationProfileIdentity(root);
    assert.equal(before.ok, true);

    const inventory = join(root, "plugins", "inventory-snapshot.json");
    const failed = JSON.parse(readFileSync(inventory, "utf8"));
    writeFileSync(inventory, JSON.stringify({ ...failed, ok: false, launchNonce: "second", dshPid: 22 }));
    const unhealthy = currentGenerationProfileIdentity(root);
    assert.equal(unhealthy.ok, false);
    assert.ok(profileRestartProblems(before, unhealthy).includes("required plugin inventory failed"));

    writeSnap(root, { nonce: "second", pid: 22 });
    const profile = join(root, CURRENT_DSH_HOME_RELATIVE, "profiles", "web", "cordis.yml");
    rmSync(profile);
    const absent = currentGenerationProfileIdentity(root);
    assert.equal(absent.ok, false);
    assert.ok(profileRestartProblems(before, absent).includes("absent persisted profile proof"));
    writeFileSync(profile, "plugins: {}\n");

    const activationPath = join(root, "dsh-home-active.json");
    const activation = JSON.parse(readFileSync(activationPath, "utf8"));
    writeFileSync(activationPath, JSON.stringify({ ...activation, activatedAt: "2026-09-10T01:00:00Z" }));
    const recreated = currentGenerationProfileIdentity(root);
    assert.equal(recreated.ok, true);
    assert.equal(recreated.stable.digest, before.stable.digest);
    assert.ok(profileRestartProblems(before, recreated).includes("changed persisted profile state"));

    writeFileSync(activationPath, JSON.stringify({ ...activation, activatedAt: "invalid" }));
    assert.equal(currentGenerationProfileIdentity(root).ok, false);
    writeFileSync(activationPath, JSON.stringify(activation));

    const settings = join(root, CURRENT_DSH_HOME_RELATIVE, "settings.yaml");
    writeFileSync(settings, "locale: en\n");
    const configured = currentGenerationProfileIdentity(root);
    writeFileSync(settings, "locale: zh\n");
    writeSnap(root, { nonce: "third", pid: 33 });
    const changed = currentGenerationProfileIdentity(root);
    assert.equal(changed.ok, true);
    assert.ok(profileRestartProblems(configured, changed).includes("changed persisted profile state"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lingering owned Windows descendants cannot PASS after forced cleanup", async () => {
  const installRoot = "C:\\Users\\runner\\AppData\\Local\\Penglai\\app\\0.5";
  const rows = [
    { pid: 11, parentPid: 1, name: "Penglai.exe", executablePath: `${installRoot}\\Penglai.exe`, commandLine: "" },
    { pid: 13, parentPid: 1, name: "Penglai.exe", executablePath: "C:\\Users\\owner\\AppData\\Local\\Penglai-other\\Penglai.exe", commandLine: "" },
  ];
  let listed = rows.slice();
  let t = 0;
  const observed = await waitOwnedWindowsProcessesGone(installRoot, undefined, {
    timeoutMs: 20,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    listProcesses: () => listed,
  });
  assert.equal(observed.ok, false);
  assert.equal(observed.forced, false);
  assert.equal(observed.leftover.map((row) => row.pid).join(","), "11");
  const kills = [];
  const reaped = await reapWindowsInstallTree(installRoot, 1_000, undefined, {
    listProcesses: () => listed,
    kill: (pid) => {
      kills.push(pid);
      listed = listed.filter((row) => row.pid !== pid);
    },
  });
  assert.deepEqual(kills, [11]);
  assert.equal(reaped.ok, true);
  assert.ok(!kills.includes(13));
});

test("Windows preflight refuses unowned profile and inherited user-data overrides before mutation", () => {
  const local = mkdtempSync(join(tmpdir(), "penglai-localapp-"));
  const expectedUser = join(local, "Penglai", "0.5");
  mkdirSync(expectedUser, { recursive: true });
  writeFileSync(join(expectedUser, "dsh-home-active.json"), "{}");
  const blockedProfile = windowsFreshProfilePreflight({ localAppData: local, env: {}, installExists: false });
  assert.equal(blockedProfile.ok, false);
  assert.match(blockedProfile.reason, /unowned existing Penglai profile/);
  rmSync(join(expectedUser, "dsh-home-active.json"));
  const override = windowsFreshProfilePreflight({
    localAppData: local,
    env: { PENGLAI_USER_DATA: join(local, "other-profile") },
    installExists: false,
  });
  assert.equal(override.ok, false);
  assert.match(override.reason, /contradictory PENGLAI_USER_DATA/);
  const existingInstall = windowsFreshProfilePreflight({ localAppData: local, env: {}, installExists: true });
  assert.equal(existingInstall.ok, false);
  assert.match(existingInstall.reason, /existing Penglai install/);
  const clean = windowsFreshProfilePreflight({ localAppData: local, env: {}, installExists: false });
  assert.equal(clean.ok, true);
  rmSync(local, { recursive: true, force: true });
});

test("persisted profile proof binds open/stat/read to one regular file and fails closed on races", async (context) => {
  const src = readFileSync(join(ROOT, "scripts/lib/native-lifecycle-proof.mjs"), "utf8");
  const reader = src.slice(src.indexOf("function readContainedRegularFile"), src.indexOf("export function currentGenerationProfileIdentity"));
  assert.match(reader, /O_RDONLY \| \(constants\.O_NOFOLLOW/);
  assert.match(reader, /readFileSync\(fd\)/);
  assert.doesNotMatch(reader, /readFileSync\(path\)/);

  const root = mkdtempSync(join(tmpdir(), "penglai-profile-proof-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeCurrentHome(root);
  const generation = readCurrentGenerationIdentity(root);
  const healthy = readPersistedProfileProof(root, generation);
  assert.equal(healthy.ok, true);
  assert.equal(persistedProfileProofValid(healthy), true);
  assert.equal(healthy.files.length > 0, true);
  assert.equal(healthy.files.some((row) => row.relative.includes("credentials")), false);
  assert.equal(healthy.files.some((row) => /session|media|Memory/i.test(row.relative)), false);

  writeSnap(root, { nonce: "boot", pid: 11 });
  const previous = currentGenerationProfileIdentity(root);
  writeSnap(root, { nonce: "restart", pid: 22 });
  const restarted = currentGenerationProfileIdentity(root);
  assert.deepEqual(profileRestartProblems(previous, restarted), []);

  const required = join(root, "dsh-home-active.json");
  const original = readFileSync(required);
  const outside = join(root, "outside-profile.json");
  writeFileSync(outside, original);
  unlinkSync(required);
  try {
    symlinkSync(outside, required);
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      writeFileSync(required, original);
      context.skip("Windows account cannot create file symlinks without Developer Mode or elevation");
      return;
    }
    throw error;
  }
  const linked = readPersistedProfileProof(root, generation);
  assert.equal(linked.ok, false);
  assert.match(linked.reason, /invalid persisted profile file/);
  unlinkSync(required);
  writeFileSync(required, original);
  assert.equal(readPersistedProfileProof(root, generation).ok, true);

  const oversized = join(root, CURRENT_DSH_HOME_RELATIVE, "settings.yaml");
  writeFileSync(oversized, "x".repeat(4 * 1024 * 1024 + 1));
  const tooBig = readPersistedProfileProof(root, generation);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /invalid persisted profile file/);
  unlinkSync(oversized);
  assert.equal(readPersistedProfileProof(root, generation).ok, true);

  unlinkSync(required);
  const missing = readPersistedProfileProof(root, generation);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /missing persisted profile file/);
  writeFileSync(required, original);

  const swapper = spawn(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs");
const target = process.env.PENGLAI_SWAP_TARGET;
const outside = process.env.PENGLAI_SWAP_OUTSIDE;
const orig = fs.readFileSync(target);
for (;;) {
  try { fs.unlinkSync(target); } catch {}
  try { fs.symlinkSync(outside, target); } catch {}
  try { fs.unlinkSync(target); } catch {}
  try { fs.writeFileSync(target, orig); } catch {}
}`,
    ],
    {
      env: { ...process.env, PENGLAI_SWAP_TARGET: required, PENGLAI_SWAP_OUTSIDE: outside },
      stdio: "ignore",
    },
  );
  context.after(() => {
    try {
      swapper.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  for (let i = 0; i < 80; i += 1) {
    const raced = readPersistedProfileProof(root, generation);
    assert.equal(typeof raced.ok, "boolean");
    if (raced.ok) assert.equal(persistedProfileProofValid(raced), true);
    else assert.match(String(raced.reason ?? ""), /persisted profile|unavailable|invalid|missing|empty/);
  }
  swapper.kill("SIGKILL");
  await new Promise((resolve) => {
    if (swapper.exitCode !== null || swapper.signalCode) {
      resolve(undefined);
      return;
    }
    swapper.once("exit", () => resolve(undefined));
  });
  try {
    unlinkSync(required);
  } catch {
    /* restored below */
  }
  writeFileSync(required, original);
  const restored = readPersistedProfileProof(root, generation);
  assert.equal(restored.ok, true);
  assert.equal(persistedProfileProofValid(restored), true);
});

const requireRoot = createRequire(join(ROOT, "package.json"));

function loadLifecycleFunction(name, deps = {}) {
  const ts = requireRoot("typescript");
  const file = "scripts/lib/native-lifecycle-proof.mjs";
  const source = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = sf.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `actual source declaration exists: ${name}`);
  const js = ts.transpileModule(declaration.getText(sf), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", ...Object.keys(deps), `${js};return ${name};`)({}, ...Object.values(deps));
}

function loadMaxProfileFileBytes() {
  const ts = requireRoot("typescript");
  const file = "scripts/lib/native-lifecycle-proof.mjs";
  const source = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = new Set(["CURRENT_DSH_HOME_VERSION", "CURRENT_DSH_HOME_RELATIVE", "PERSISTED_PROFILE_FILES", "MAX_PROFILE_FILE_BYTES"]);
  const declarations = sf.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((declaration) => names.has(declaration.name.getText(sf))),
    )
    .map((node) => node.getText(sf))
    .join("\n");
  const js = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", "PINNED_DSH", `${js};return MAX_PROFILE_FILE_BYTES;`)({}, CURRENT_DSH_HOME_VERSION);
}

test("opened required profile file that grows past the byte cap after read is rejected", (context) => {
  const root = mkdtempSync(join(tmpdir(), "penglai-profile-growth-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeCurrentHome(root);
  const generation = readCurrentGenerationIdentity(root);
  const before = readPersistedProfileProof(root, generation);
  assert.equal(before.ok, true);
  assert.equal(persistedProfileProofValid(before), true);

  const required = join(root, PERSISTED_PROFILE_FILES[0].relative);
  const original = readFileSync(required);
  const max = loadMaxProfileFileBytes();
  assert.equal(max, 4 * 1024 * 1024);
  const sha256Bytes = loadLifecycleFunction("sha256Bytes", { createHash });
  const canonicalJson = loadLifecycleFunction("canonicalJson");
  const persistedProfileDigest = loadLifecycleFunction("persistedProfileDigest", { sha256Bytes, canonicalJson });
  let grew = false;
  const readContainedRegularFile = loadLifecycleFunction("readContainedRegularFile", {
    constants: fs.constants,
    openSync: fs.openSync,
    fstatSync: fs.fstatSync,
    lstatSync: fs.lstatSync,
    realpathSync: fs.realpathSync,
    closeSync: fs.closeSync,
    dirname: path.dirname,
    basename: path.basename,
    relative: path.relative,
    join: path.join,
    isAbsolute: path.isAbsolute,
    MAX_PROFILE_FILE_BYTES: max,
    readFileSync(fd) {
      const bytes = fs.readFileSync(fd);
      if (!grew) {
        fs.appendFileSync(required, Buffer.alloc(max + 1));
        grew = true;
      }
      return bytes;
    },
  });
  const readProof = loadLifecycleFunction("readPersistedProfileProof", {
    join: path.join,
    realpathSync: fs.realpathSync,
    readContainedRegularFile,
    PERSISTED_PROFILE_FILES,
    sha256Bytes,
    persistedProfileDigest,
  });
  const grown = readProof(root, generation);
  assert.equal(grew, true);
  assert.equal(grown.ok, false);
  assert.match(String(grown.reason ?? ""), /invalid persisted profile file: dsh-home-active\.json/);
  const actualSize = statSync(required).size;
  assert.equal(actualSize > max, true);
  assert.equal(actualSize, original.length + max + 1);

  writeFileSync(required, original);
  const restored = readPersistedProfileProof(root, generation);
  assert.equal(restored.ok, true);
  assert.equal(persistedProfileProofValid(restored), true);
  assert.equal(restored.digest, before.digest);
});


