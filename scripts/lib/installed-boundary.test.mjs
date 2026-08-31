import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { credentialFreeInstalledChecks, credentialFreeInstalledPass } from "./installed-boundary.mjs";
import {
  isControlledWindowsInstallerFixture,
  waitForBoundedChild,
  windowsFixtureRemovalObserved,
} from "./installed-app.mjs";

function sample() {
  return {
    identityOk: true,
    rec: {
      fromExactDmg: true,
      walk: { wizardKeyless: { ok: true, honestStop: "keytest", skippedNonceTurn: true } },
      resume: { attempted: true, ok: true },
    },
    first: {
      identity: { ok: true },
      nativeBoot: { ok: true, authenticationBoundary: true },
      processTree: { ownedAbsolute: true, dshPid: 42 },
      inventory: { ok: true, im: false },
      welcome: { clicked: true, persisted: true },
      onboarding: { walked: ["language", "privacy", "models", "keytest"], providers: { rows: 40 } },
      resume: { attempted: true, ok: true },
    },
  };
}

test("credential-free installed boundary passes only at the honest API-key stop", () => {
  const input = sample();
  assert.equal(credentialFreeInstalledPass(input), true);
  assert.deepEqual(new Set(Object.values(credentialFreeInstalledChecks(input))), new Set(["PASS"]));
});

test("credential-free installed boundary fails closed without auth, catalog, or resume", () => {
  const input = sample();
  input.first.nativeBoot.authenticationBoundary = false;
  input.first.onboarding.providers.rows = 0;
  input.rec.resume.ok = false;
  input.first.resume.ok = false;
  const checks = credentialFreeInstalledChecks(input);
  assert.equal(checks.proxyAuthenticationBoundary, "FAIL");
  assert.equal(checks.officialProviderCatalog, "FAIL");
  assert.equal(checks.resume, "FAIL");
  assert.equal(credentialFreeInstalledPass(input), false);
});

test("credential-free evidence never claims a nonce or first Turn", () => {
  const checks = credentialFreeInstalledChecks(sample());
  assert.equal(Object.hasOwn(checks, "officialNonceTurn"), false);
  assert.equal(Object.hasOwn(checks, "officialFirstTurn"), false);
});

test("bounded child wait times out and terminates the release subprocess", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const result = await waitForBoundedChild(child, 100);
  assert.equal(result.timedOut, true);
  assert.equal(result.treeKilled, true);
  assert.equal(result.closeObserved, true);
});

test("Windows fixture cleanup is limited to dedicated workspace install roots", () => {
  const root = "D:\\work\\PenglaiAgent";
  assert.equal(isControlledWindowsInstallerFixture("D:\\work\\PenglaiAgent\\.tmp-installed-e2e-app", root), true);
  assert.equal(isControlledWindowsInstallerFixture("D:\\work\\PenglaiAgent\\.tmp\\u3-welcome-app", root), true);
  assert.equal(
    isControlledWindowsInstallerFixture("D:\\work\\PenglaiAgent\\dist\\Penglai-v0.5.9-win32-x64\\Penglai", root),
    true,
  );
  assert.equal(isControlledWindowsInstallerFixture("D:\\work\\PenglaiAgent", root), false);
  assert.equal(isControlledWindowsInstallerFixture("C:\\Users\\owner\\AppData\\Local\\Penglai\\app\\0.5", root), false);
  assert.equal(isControlledWindowsInstallerFixture("D:\\work\\other\\.tmp-installed-e2e-app", root), false);
});

test("Windows fixture cleanup waits for both registry and install directory removal", () => {
  assert.equal(
    windowsFixtureRemovalObserved({ installDirExists: false, registeredInstallDir: "", uninstallCommand: "" }),
    true,
  );
  assert.equal(
    windowsFixtureRemovalObserved({
      installDirExists: true,
      registeredInstallDir: "",
      uninstallCommand: "",
    }),
    false,
  );
  assert.equal(
    windowsFixtureRemovalObserved({
      installDirExists: false,
      registeredInstallDir: "D:\\fixture",
      uninstallCommand: "",
    }),
    false,
  );
});
