import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION } from "./product.mjs";
import { observeStopChild } from "./installed-app.mjs";
import {
  classifyApplicationShutdown,
  nsisDefaultInstallDir,
  nsisUninstallKeepsCustomInstdir,
  requestNativeApplicationClose,
  waitForChildExitNoKill,
  windowsFreshLifecyclePathContract,
  windowsDefaultInstallDir,
} from "./native-lifecycle-proof.mjs";
import { FRESH_LIFECYCLE_SCHEMA, freshInstallUninstallEvidenceMatches, freshInstallUninstallEvidenceProblems } from "./native-fresh-set.mjs";

test("NSIS default INSTDIR and fresh Windows fixture path stay the same contract", () => {
  const nsis = readFileSync(join(ROOT, "scripts/nsis/Penglai.nsi"), "utf8");
  const fresh = readFileSync(join(ROOT, "scripts/verify-fresh-install-uninstall.mjs"), "utf8");
  const helper = readFileSync(join(ROOT, "scripts/lib/installed-app.mjs"), "utf8");
  assert.equal(nsisDefaultInstallDir(nsis), String.raw`$LOCALAPPDATA\Penglai\app\0.5`);
  assert.equal(nsisUninstallKeepsCustomInstdir(nsis), true);
  assert.equal(windowsDefaultInstallDir("C:\\Users\\runner\\AppData\\Local"), join("C:\\Users\\runner\\AppData\\Local", "Penglai", "app", "0.5"));
  assert.deepEqual(windowsFreshLifecyclePathContract({ nsis, freshGate: fresh, helper }), []);
  const customNsis = nsis.replace('Keeping custom install directory $INSTDIR (not the default app tree).', "RMDir /r \"$INSTDIR\"");
  assert.ok(windowsFreshLifecyclePathContract({ nsis: customNsis, freshGate: fresh, helper }).length > 0);
  const customFresh = fresh.replace("function installWindowsDefault", "function installWindowsCustom");
  assert.ok(windowsFreshLifecyclePathContract({ nsis, freshGate: customFresh, helper }).length > 0);
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
