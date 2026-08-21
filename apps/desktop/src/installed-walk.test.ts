import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_FRESH_SETTINGS_WALK,
  REQUIRED_FULL_SETTINGS_WALK,
  REQUIRED_SETTINGS_WALK,
  REQUIRED_WIZARD_KEYLESS,
  WIZARD_RESUME_STEPS,
  settingsWalkComplete,
  wizardKeylessComplete,
  wizardResumeReady,
  wizardStepDeadEnd,
} from "./installed-walk.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-E2E-003 separates fresh settings from explicit full composition", () => {
  assert.deepEqual([...REQUIRED_FRESH_SETTINGS_WALK], ["ui-penglai", "ui-center", "ui-update", "ui-uninstall"]);
  assert.deepEqual([...REQUIRED_FULL_SETTINGS_WALK], [...REQUIRED_SETTINGS_WALK]);
  assert.equal(settingsWalkComplete(["ui-update", "ui-center"], "fresh"), false);
  assert.equal(settingsWalkComplete([...REQUIRED_FRESH_SETTINGS_WALK], "fresh"), true);
  assert.equal(settingsWalkComplete([...REQUIRED_FRESH_SETTINGS_WALK], "full"), false);
  assert.equal(settingsWalkComplete([...REQUIRED_FULL_SETTINGS_WALK], "full"), true);
});

test("wizard resume ignores the HTML shell until a ledger step is painted", () => {
  assert.deepEqual([...WIZARD_RESUME_STEPS], ["appearance", "models", "credential", "test"]);
  assert.equal(wizardResumeReady({ wizard: true, wizardStep: "" }), false);
  assert.equal(wizardResumeReady({ wizard: true }), false);
  assert.equal(wizardResumeReady({ wizard: false, wizardStep: "credential" }), false);
  assert.equal(wizardResumeReady({ wizard: true, wizardStep: "welcome" }), false);
  assert.equal(wizardResumeReady({ wizard: true, wizardStep: "credential" }), true);
  const e2e = readFileSync(join(root, "scripts/e2e-installed.mjs"), "utf8");
  assert.match(e2e, /wizardResumeReady/);
  assert.doesNotMatch(e2e, /waitEval\(attached\.session, SNAPSHOT_JS, \(s\) => Boolean\(s && s\.wizard\),/);
});

test("keyless installed walk does not require official DSH HTTP/WS while the wizard is showing", () => {
  const e2e = readFileSync(join(root, "scripts/e2e-installed.mjs"), "utf8");
  const live = readFileSync(join(root, "scripts/lib/runner-live.mjs"), "utf8");
  assert.match(live, /requireOfficialLive/);
  assert.match(e2e, /requireOfficialLive:\s*!walk\?\.wizardKeyless\?\.ok/);
});

test("wizard keyless walk treats a no-exit step as FAIL and credential empty as honest stop", () => {
  assert.deepEqual([...REQUIRED_WIZARD_KEYLESS], ["welcome", "privacy", "appearance", "models", "credential"]);
  assert.equal(wizardKeylessComplete(["welcome", "privacy"]), false);
  assert.equal(wizardKeylessComplete(["welcome", "privacy", "appearance", "models", "credential"]), true);
  assert.equal(
    wizardStepDeadEnd({ continueDisabled: true, skipEnabled: false, backEnabled: false }),
    true,
  );
  assert.equal(
    wizardStepDeadEnd({ continueDisabled: true, skipEnabled: false, backEnabled: true }),
    false,
  );
  assert.equal(
    wizardStepDeadEnd({ continueDisabled: true, skipEnabled: false, backEnabled: false, hasForwardInput: true }),
    false,
  );
});

test("installed e2e drives packaged BrowserWindow via CDP and has no in-app probe", () => {
  const e2e = readFileSync(join(root, "scripts/e2e-installed.mjs"), "utf8");
  const walk = readFileSync(join(root, "scripts/lib/browser-window-walk.mjs"), "utf8");
  const cdp = readFileSync(join(root, "scripts/lib/cdp.mjs"), "utf8");
  assert.doesNotMatch(e2e, /PENGLAI_INSTALLED_PROBE/);
  assert.doesNotMatch(walk, /PENGLAI_INSTALLED_PROBE/);
  assert.match(e2e, /remote-debugging-port/);
  assert.match(e2e, /browser-window-walk/);
  assert.match(walk, /evaluate\(/);
  assert.match(cdp, /Runtime\.evaluate/);
  assert.match(cdp, /json\/list/);
  assert.match(walk, /data-penglai-wizard/);
  assert.match(walk, /wizardKeyless|honestStop/);
  assert.doesNotMatch(walk, /data-penglai-onboarding-continue/);
  assert.match(walk, /isDeadEnd|deadEnds/);
  assert.match(walk, /ui-penglai/);
  assert.match(walk, /Speech recognition/);
  assert.match(walk, /Storage and uninstall/);
  assert.match(walk, /installOptionalPlugins/);
  assert.match(walk, /data-penglai-plugin-action/);
  assert.match(walk, /actionStatus === "success"/);
  assert.match(walk, /await delay\(1_200\)/);
  assert.match(walk, /clickButtonText\(\["\^蓬莱\$", "\^Penglai\$"\]\)/);
  assert.match(e2e, /assertInstalledPenglaiIdentity/);
  assert.match(e2e, /launchPackaged\(exe, resources, refuseUser/);
  assert.match(e2e, /launchInstalledHarness\(harnessApp, resources, userData/);
});

test("native release workflow proves bundled optional plugins across restart", () => {
  const workflow = readFileSync(join(root, ".github/workflows/native-release-candidate.yml"), "utf8");
  const compat = readFileSync(join(root, "scripts/u3-first-party-plugins.mjs"), "utf8");
  assert.match(workflow, /pnpm test:u3:plugins/g);
  assert.match(workflow, /u3-first-party-plugins\.json/g);
  assert.match(compat, /installFromExactInstaller/);
  assert.match(compat, /inspectPackagedCandidate/);
  assert.match(compat, /all-enabled-after-restart/);
  assert.match(compat, /all-disabled-after-restart/);
  assert.match(compat, /fiberPhase/);
  assert.match(compat, /official\.websocket/);
  assert.match(compat, /observeOfficialTransport/);
  assert.match(compat, /writeFileSync\(profilePatch, text, \{ mode: 0o600 \}\)/);
  assert.doesNotMatch(compat, /ftruncateSync/);
  assert.doesNotMatch(compat, /observeOfficialSurfaces/);
  assert.doesNotMatch(compat, /phase\.official\.hasRoot/);
  assert.doesNotMatch(compat, /phase\.official\.hasDshBoot/);
  assert.match(compat, /pre-DSH wizard/);
  assert.doesNotMatch(compat, /PENGLAI_ALLOW_TEST_HARNESS/);
});

test("plugin transport observation does not wait for the post-wizard DOM", async () => {
  const { observeOfficialTransport } = await import("../../../scripts/lib/browser-window-walk.mjs");
  const expressions: string[] = [];
  const session = {
    send: async (method: string, params: { expression: string }) => {
      assert.equal(method, "Runtime.evaluate");
      expressions.push(params.expression);
      const value = params.expression.includes("fetch(location.origin")
        ? { status: 200, ok: true, official: true }
        : params.expression.includes("new WebSocket")
          ? { opened: true, readyState: 1 }
          : { wizard: true, hasRoot: false, hasDshBoot: false };
      return { result: { value } };
    },
  };
  const result = await observeOfficialTransport(session);
  assert.equal(result.official, true);
  assert.equal(result.snap.wizard, true);
  assert.equal(expressions.length, 3);
});

test("installed harness shutdown waits for the process close after SIGKILL", () => {
  const helper = readFileSync(join(root, "scripts/lib/installed-app.mjs"), "utf8");
  assert.match(helper, /closed\.then\(\(value\) => \(\{ exited: true, value \}\)\)/);
  assert.match(helper, /did not exit after SIGKILL/);
  assert.doesNotMatch(helper, /resolveClose\(\[null, "SIGKILL"\]\)/);
});

test("installed restart requests the product lifecycle before signal fallback", async () => {
  const { requestBrowserClose } = await import("../../../scripts/lib/installed-app.mjs");
  const calls: unknown[][] = [];
  let closed = false;
  const session = {
    send: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
    close: () => {
      closed = true;
    },
  };
  assert.equal(await requestBrowserClose(session, 321), true);
  assert.deepEqual(calls, [["Browser.close", {}, 321]]);
  assert.equal(closed, true);

  const compat = readFileSync(join(root, "scripts/u3-first-party-plugins.mjs"), "utf8");
  assert.match(compat, /requestBrowserClose\(cdpSession\)/);
  assert.ok(compat.indexOf("requestBrowserClose(cdpSession)") < compat.indexOf("stopChild(launched.child)"));
});

test("installed harness shutdown returns only after the child is gone", async (context) => {
  const { stopChild } = await import("../../../scripts/lib/installed-app.mjs");
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { stdio: "ignore" },
  );
  context.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  await once(child, "spawn");
  const pid = child.pid;
  assert.ok(pid);
  await stopChild(child, 50);
  assert.ok(child.exitCode !== null || child.signalCode);
  assert.throws(
    () => process.kill(pid, 0),
    (error: NodeJS.ErrnoException) => error.code === "ESRCH",
  );
});

test("single-instance ownership is scoped after the app-private userData path", () => {
  const main = readFileSync(join(root, "apps/desktop/src/electron-main.ts"), "utf8");
  const configure = main.indexOf("configureGenerationPaths({");
  const lock = main.indexOf("app.requestSingleInstanceLock()");
  assert.ok(configure >= 0 && lock > configure, "userData must be configured before acquiring the instance lock");
});

test("installed app helper refuses Electron executable and wrong Info.plist identity", async () => {
  const helper = readFileSync(join(root, "scripts/lib/installed-app.mjs"), "utf8");
  assert.match(helper, /CFBundleExecutable/);
  assert.match(helper, /com\.penglai\.dsh/);
  assert.doesNotMatch(helper, /for \(const name of \["Penglai", "Electron"\]\)/);
});

test("installed UI harness executes only the exact installed resources/app", async () => {
  const { installedHarnessEnvironment, installedHarnessSpec } = await import("../../../scripts/lib/installed-app.mjs");
  const rootDir = mkdtempSync(join(tmpdir(), "penglai-installed-harness-"));
  const harness = join(rootDir, "Electron");
  const resources = join(rootDir, "installed", "resources");
  mkdirSync(join(resources, "app"), { recursive: true });
  writeFileSync(harness, "harness");
  writeFileSync(join(resources, "app", "package.json"), "{}");
  writeFileSync(join(resources, "app", "electron-main.js"), "main");
  assert.deepEqual(installedHarnessSpec(harness, resources), {
    executable: harness,
    appEntry: join(resources, "app"),
  });
  assert.throws(
    () => installedHarnessSpec(join(rootDir, "missing"), resources),
    /harness executable missing/,
  );
  const windowsEnv = installedHarnessEnvironment(
    resources,
    join(rootDir, "profile"),
    {},
    "win32",
    {
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      SECRET_TOKEN: "must-not-cross",
    },
  );
  assert.equal(windowsEnv.SystemRoot, "C:\\Windows");
  assert.equal(windowsEnv.USERPROFILE, join(rootDir, "profile"));
  assert.match(windowsEnv.PATH, /System32/);
  assert.equal("SECRET_TOKEN" in windowsEnv, false);
  assert.ok(existsSync(windowsEnv.TEMP));
});

test("soak runner samples IM offline sleep update uninstall on the exact DMG", () => {
  const soak = readFileSync(join(root, "scripts/soak-installed.mjs"), "utf8");
  assert.match(soak, /PENGLAI_SOAK/);
  assert.match(soak, /fromExactDmg/);
  assert.match(soak, /installerSha256/);
  assert.match(soak, /two-hour soak not present/);
  assert.match(soak, /samplesCovered/);
  assert.match(soak, /evaluateLiveSample/);
  assert.match(soak, /PENGLAI_SOAK_ALLOW_LONG/);
  assert.match(soak, /installOptionalPlugins:\s*true/);
  for (const sample of ["im", "offline", "sleep", "update", "uninstall"]) {
    assert.match(soak, new RegExp(`"${sample}"`));
  }
  assert.match(soak, /SIGSTOP/);
  assert.match(soak, /penglai-windows-host\.exe/);
  const installedHelper = readFileSync(join(root, "scripts/lib/installed-app.mjs"), "utf8");
  assert.match(installedHelper, /process-suspend/);
  assert.match(installedHelper, /process-resume/);
  const windowsPayload = readFileSync(join(root, "scripts/package-windows-payload.mjs"), "utf8");
  assert.match(windowsPayload, /build-windows-host\.mjs/);
  assert.match(windowsPayload, /stagingForTarget\(ROOT, "win32-x86_64"\)/);
  assert.match(windowsPayload, /join\(staging, "runtime", "helpers"\)/);
  assert.match(windowsPayload, /stamp-windows-exe\.mjs/);
  assert.match(windowsPayload, /release-info\.json/);
  const embedRuntime = readFileSync(join(root, "scripts/embed-runtime.mjs"), "utf8");
  assert.match(embedRuntime, /packedPlugins !== stagedPlugins/);
  assert.match(embedRuntime, /cpSync\(packedPlugins, stagedPlugins/);
  const verifyInstalled = readFileSync(join(root, "scripts/verify-installed.mjs"), "utf8");
  assert.match(verifyInstalled, /R50-WIN-009/);
  assert.match(verifyInstalled, /R50-MAC-010/);
  assert.match(soak, /remote-debugging-port/);
});
