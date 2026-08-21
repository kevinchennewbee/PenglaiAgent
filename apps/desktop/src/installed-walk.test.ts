import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
  assert.match(windowsPayload, /join\(staging, "runtime", "helpers"\)/);
  assert.match(windowsPayload, /stamp-windows-exe\.mjs/);
  assert.match(windowsPayload, /release-info\.json/);
  const verifyInstalled = readFileSync(join(root, "scripts/verify-installed.mjs"), "utf8");
  assert.match(verifyInstalled, /R50-WIN-009/);
  assert.match(verifyInstalled, /R50-MAC-010/);
  assert.match(soak, /remote-debugging-port/);
});
