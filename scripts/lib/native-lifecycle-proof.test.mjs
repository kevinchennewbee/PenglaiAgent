import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  profileRestartProblems,
  readCurrentGenerationIdentity,
  requestNativeApplicationClose,
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

test("forced SIGKILL from stopChild is not a graceful application shutdown", async (context) => {
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
  assert.equal(observed.signal, "SIGKILL");
  assert.equal(observed.forced, true);
  assert.equal(observed.method, "sigkill");
  const classified = classifyApplicationShutdown(
    {
      graceful: true,
      forced: observed.forced,
      requestedClose: true,
      method: "posix-sigterm",
      exitCode: observed.code,
      signal: observed.signal,
    },
    "darwin-aarch64",
  );
  assert.equal(classified.graceful, false);
  const receipt = {
    schema: FRESH_LIFECYCLE_SCHEMA,
    command: "verify:fresh-install-uninstall",
    kind: "installed-lifecycle",
    scope: "fresh-install-restart-default-uninstall",
    verdict: "PASS",
    target: "darwin-aarch64",
    sourceSha: "a".repeat(40),
    installer: "Penglai_0.6.1_macos_aarch64.dmg",
    installerSha256: "b".repeat(64),
    host: { platform: "darwin", arch: "arm64" },
    boot: {
      freshReadiness: true,
      profileIdentity: { inventorySha256: "e".repeat(64), dshHomePresent: true },
      shutdown: {
        graceful: true,
        forced: observed.forced,
        requestedClose: true,
        method: "posix-sigterm",
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
        method: "posix-sigterm",
        exitCode: 0,
        signal: null,
      },
    },
    processCleanup: { afterBoot: true, afterRestart: true, afterUninstall: true },
    uninstall: { method: "dedicated-app-removal", uninstallRemovedApp: true, wholeInstdirDeletedToManufacturePass: false },
    ownerData: {
      sentinelPreservedAfterBoot: true,
      sentinelPreservedAfterRestart: true,
      sentinelPreservedAfterUninstall: true,
      sentinelUnchanged: true,
      sentinelSha256: "c".repeat(64),
      scope: "task-created-user-data",
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
  if (!skipHome) mkdirSync(join(root, ...relative.split("/")), { recursive: true });
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
    writeFileSync(join(root, ".credentials.yaml"), "DEEPSEEK_API_KEY: not-hashed\n");
    const current = currentGenerationProfileIdentity(root);
    assert.equal(current.ok, true);
    assert.deepEqual(profileRestartProblems(previous, current), []);
    assert.equal(current.stable.digest, previous.stable.digest);

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
