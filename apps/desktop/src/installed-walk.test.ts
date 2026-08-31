import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
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
  assert.deepEqual([...REQUIRED_FRESH_SETTINGS_WALK], [
    "ui-penglai",
    "ui-center",
    "ui-office",
    "ui-memory",
    "ui-update",
    "ui-uninstall",
  ]);
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
  assert.match(walk, /\^开始使用\$/);
  assert.match(walk, /\^Get started\$/);
  assert.match(walk, /welcome-dismiss/);
  assert.match(walk, /duplicate-dsh-onboarding/);
  assert.match(walk, /document\.getElementById\("root"\)\?\.inert/);
  assert.match(walk, /Add an API key to get started\|添加一个 API Key 开始使用/);
  assert.doesNotMatch(walk, /officialByok: headings\.some\(\(h\) => \/API Key/);
  assert.match(walk, /upstream-window-title/);
  assert.match(walk, /target\.readyFlag \? 30_000 : target\.flag \? 15_000 : 5_000/);
  assert.match(walk, /snapshot\?\.\[target\.flag\]/);
  assert.match(walk, /snapshot\?\.\[target\.readyFlag\] === target\.readyValue/);
  assert.match(walk, /\^软件更新\$/);
  assert.match(walk, /const visibleButtons = buttons\.filter\(visible\)/);
  assert.doesNotMatch(walk, /official-byok-dismiss/);
  assert.match(walk, /clickButtonText\(\["\^蓬莱\$", "\^Penglai\$"\]\)/);
  assert.match(walk, /button\[aria-haspopup=\\?"dialog\\?"\]\[aria-expanded\]/);
  assert.match(walk, /semanticFallback/);
  assert.match(e2e, /assertInstalledPenglaiIdentity/);
  assert.match(e2e, /launchPackaged\(exe, resources, refuseUser/);
  assert.match(e2e, /launchInstalledHarness\(harnessApp, resources, userData/);
});

test("collapsed official DSH settings trigger opens through its dialog semantics", async () => {
  const { settingsTriggerClickScript } = await import("../../../scripts/lib/browser-window-walk.mjs");
  let clicked = false;
  const button = {
    disabled: false,
    textContent: "",
    getAttribute(name: string) {
      if (name === "aria-haspopup") return "dialog";
      if (name === "aria-expanded") return "false";
      return null;
    },
    click() { clicked = true; },
  };
  const document = {
    querySelectorAll: () => [button],
    querySelector: (selector: string) => selector === 'button[aria-haspopup="dialog"][aria-expanded]' ? button : null,
  };
  const result = runInNewContext(settingsTriggerClickScript(), { document });
  assert.equal(result.ok, true);
  assert.equal(result.semanticFallback, true);
  assert.equal(clicked, true);
});

test("installed settings walk defers expensive renderer click work outside the CDP request", async () => {
  const { settingsTriggerClickScript } = await import("../../../scripts/lib/browser-window-walk.mjs");
  let clicked = false;
  let scheduled: (() => void) | undefined;
  const button = {
    disabled: false,
    textContent: "Settings",
    getAttribute: () => null,
    click() { clicked = true; },
  };
  const document = {
    querySelectorAll: () => [button],
    querySelector: () => null,
  };
  const result = runInNewContext(settingsTriggerClickScript(true), {
    document,
    setTimeout(callback: () => void) {
      scheduled = callback;
      return 1;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.deferred, true);
  assert.equal(clicked, false);
  scheduled?.();
  assert.equal(clicked, true);
});

test("installed settings walk ignores hidden duplicate navigation buttons", async () => {
  const { clickButtonText } = await import("../../../scripts/lib/browser-window-walk.mjs");
  let hiddenClicked = false;
  let visibleClicked = false;
  const hidden = {
    disabled: false,
    textContent: "Storage and uninstall",
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    click() { hiddenClicked = true; },
  };
  const visible = {
    disabled: false,
    textContent: "Storage and uninstall",
    getBoundingClientRect: () => ({ width: 120, height: 30 }),
    click() { visibleClicked = true; },
  };
  const result = runInNewContext(clickButtonText(["^Storage and uninstall$"]), {
    document: { querySelectorAll: () => [hidden, visible] },
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  });
  assert.equal(result.ok, true);
  assert.equal(hiddenClicked, false);
  assert.equal(visibleClicked, true);
});

test("installed soak samples bundled IM without bypassing native owner approval", async () => {
  const { bundledOptionalPluginDefaultOffSample } = await import("../../../scripts/lib/browser-window-walk.mjs");
  const sha256 = "a".repeat(64);
  const sample = bundledOptionalPluginDefaultOffSample({
    id: "@penglai/im",
    catalogEntry: {
      id: "@penglai/im",
      source: "bundled-first-party",
      builtIn: true,
      installClass: "optional-first-party",
      defaultEnabled: false,
      sha256,
    },
    packageSha256: sha256,
    desiredEnabled: false,
    inventoryEntry: { moduleName: "@penglai/im", enabled: false, fiberPhase: null },
    centerCard: { id: "@penglai/im", installed: "not-installed", loaded: false, actions: ["installEnable"] },
  });
  assert.equal(sample.ok, true);
  assert.equal(sample.catalogBound, true);
  assert.equal(sample.loaderDefaultOff, true);
  assert.equal(sample.centerOffersOwnerGatedEnable, true);
  assert.equal(
    bundledOptionalPluginDefaultOffSample({
      ...sample,
      id: "@penglai/im",
      catalogEntry: { id: "@penglai/im", sha256 },
      packageSha256: sha256,
      desiredEnabled: false,
      inventoryEntry: { moduleName: "@penglai/im", enabled: false, fiberPhase: null },
      centerCard: { id: "@penglai/im", loaded: false, actions: ["installEnable"] },
    }).ok,
    false,
  );
});

test("live installed evidence captures public screenshots only after model selection and completed onboarding", () => {
  const live = readFileSync(new URL("../../../scripts/e2e-installed-live.mjs", import.meta.url), "utf8");
  assert.match(live, /PENGLAI_CAPTURE_PUBLIC_SHOTS/);
  assert.match(live, /models-loaded\.png/);
  assert.match(live, /onboarding-complete\.png/);
  assert.match(live, /walkInstalledBrowserWindow/);
  assert.match(live, /data-dsh-boot/);
  assert.match(live, /Penglai product UI plugin boot failed/);
  assert.doesNotMatch(live, /captureShot\([^\n]*keytest|captureShot\([^\n]*credential/i);
});

test("native release workflow proves bundled optional plugins across restart", () => {
  const workflow = readFileSync(join(root, ".github/workflows/native-release-candidate.yml"), "utf8");
  const compat = readFileSync(join(root, "scripts/u3-first-party-plugins.mjs"), "utf8");
  assert.match(workflow, /mode:\s*\n\s+description:/);
  assert.match(workflow, /default: native/);
  assert.match(workflow, /inputs\.mode == 'native'/g);
  assert.match(workflow, /inputs\.mode == 'catalog'/);
  assert.match(
    workflow,
    /npm-cohort:[\s\S]*?steps:[\s\S]*?fetch-depth: 0[\s\S]*?Check out immutable official DSH alpha\.2 source/,
  );
  const macosWorkflow = workflow.slice(workflow.indexOf("\n  macos:"), workflow.indexOf("\n  windows:"));
  const windowsWorkflow = workflow.slice(workflow.indexOf("\n  windows:"), workflow.indexOf("\n  aggregate:"));
  for (const nativeWorkflow of [macosWorkflow, windowsWorkflow]) {
    assert.ok(nativeWorkflow.indexOf("Build source from the clean checkout") >= 0);
    assert.ok(nativeWorkflow.indexOf("Audit target-specific supply chain") >= 0);
    assert.ok(
      nativeWorkflow.indexOf("Build source from the clean checkout") <
        nativeWorkflow.indexOf("Audit target-specific supply chain"),
    );
  }
  assert.match(workflow, /pnpm test:u3:plugins/g);
  assert.match(workflow, /u3-first-party-plugins\.json/g);
  assert.match(compat, /installFromExactInstaller/);
  assert.match(compat, /inspectPackagedCandidate/);
  assert.match(compat, /all-enabled-after-restart/);
  assert.match(compat, /optionalSettingsReady/);
  assert.match(compat, /requireOptionalPlugins: name === "all-enabled-after-restart"/);
  assert.match(compat, /all-disabled-after-restart/);
  assert.match(compat, /fiberPhase/);
  assert.match(compat, /official\.websocket/);
  assert.match(compat, /observeOfficialSurfaces/);
  assert.match(compat, /installed-product-ui-fixture/);
  assert.match(compat, /credentialRef: "DEEPSEEK_API_KEY"/);
  assert.match(compat, /join\(fixtureDshHome, "\.credentials\.yaml"\)/);
  assert.match(compat, /phase\.official\.mounted/);
  assert.match(compat, /writeFileSync\(profilePatch, text, \{ mode: 0o600 \}\)/);
  assert.doesNotMatch(compat, /ftruncateSync/);
  const welcome = readFileSync(join(root, "scripts/u3-welcome-smoke.mjs"), "utf8");
  assert.match(welcome, /startup\.error\.log/);
  assert.match(welcome, /dsh\.stderr\.log/);
  assert.doesNotMatch(compat, /pre-DSH wizard/);
  const bundled = readFileSync(join(root, "scripts/verify-bundled-runtime.mjs"), "utf8");
  assert.match(bundled, /Contents", "Resources"/);
  assert.match(bundled, /mnemon/);
  assert.match(bundled, /penglai_office_commit/);
  assert.doesNotMatch(bundled, /join\(ROOT, "third_party"/);
  assert.doesNotMatch(compat, /PENGLAI_ALLOW_TEST_HARNESS/);
});

test("Windows NSIS compiles UTF-8 source and exposes bilingual component copy", () => {
  const packager = readFileSync(join(root, "scripts/package-windows-nsis.mjs"), "utf8");
  const installer = readFileSync(join(root, "scripts/nsis/Penglai.nsi"), "utf8");
  const license = readFileSync(join(root, "scripts/nsis/license.rtf"), "utf8");
  assert.match(packager, /"\/INPUTCHARSET",\s*"UTF8"/);
  assert.match(installer, /Unicode true/);
  assert.match(installer, /LangString NAME_Desktop \$\{LANG_SIMPCHINESE\} "桌面快捷方式"/);
  assert.match(installer, /LangString DESC_App \$\{LANG_SIMPCHINESE\} "安装蓬莱桌面客户端、官方 DSH 核心和内置插件。"/);
  assert.match(installer, /MUI_DESCRIPTION_TEXT \$\{SecDesktop\} "\$\(DESC_Desktop\)"/);
  assert.doesNotMatch(installer, /0\.5\.3/);
  assert.doesNotMatch(license, /0\.5\.3/);
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

test("soak runner samples IM offline sleep without faking lifecycle proof", () => {
  const soak = readFileSync(join(root, "scripts/soak-installed.mjs"), "utf8");
  assert.match(soak, /PENGLAI_SOAK/);
  assert.match(soak, /fromExactDmg/);
  assert.match(soak, /installerSha256/);
  assert.match(soak, /two-hour soak not present/);
  assert.match(soak, /samplesCovered/);
  assert.match(soak, /evaluateLiveSample/);
  assert.match(soak, /PENGLAI_SOAK_ALLOW_LONG/);
  assert.match(soak, /bundledOptionalPluginDefaultOffSample/);
  assert.match(soak, /bundled-default-off/);
  assert.doesNotMatch(soak, /installOptionalPlugins:\s*true/);
  assert.match(soak, /installed-soak-fixture/);
  assert.match(soak, /credentialRef: "DEEPSEEK_API_KEY"/);
  assert.match(soak, /join\(fixtureDshHome, "\.credentials\.yaml"\)/);
  assert.match(soak, /launchPackaged\(exe, resources, nativeUserData/);
  assert.match(soak, /probeLiveHttpWs/);
  assert.match(soak, /exactExecutableSoak/);
  assert.match(soak, /expectedNativeIdentity/);
  for (const sample of ["im", "offline", "sleep"]) {
    assert.match(soak, new RegExp(`"${sample}"`));
  }
  assert.match(soak, /navigation-only-not-upgrade-or-uninstall-evidence/);
  assert.doesNotMatch(soak, /mark\("update"|mark\("uninstall"/);
  assert.match(soak, /SIGSTOP/);
  assert.match(soak, /penglai-windows-host\.exe/);
  const installedHelper = readFileSync(join(root, "scripts/lib/installed-app.mjs"), "utf8");
  assert.match(installedHelper, /process-suspend/);
  assert.match(installedHelper, /process-resume/);
  const windowsPayload = readFileSync(join(root, "scripts/package-windows-payload.mjs"), "utf8");
  assert.match(windowsPayload, /build-windows-host\.mjs/);
  assert.match(windowsPayload, /scripts\/bundle-desktop\.mjs/);
  assert.doesNotMatch(windowsPayload, /if \(!existsSync\(join\(ROOT, "dist", "desktop-bundle", "electron-main\.js"\)\)\)/);
  assert.match(windowsPayload, /desktop bundle is missing or does not match the current startup page/);
  assert.match(windowsPayload, /stagingForTarget\(ROOT, "win32-x86_64"\)/);
  assert.match(windowsPayload, /join\(staging, "runtime", "helpers", "penglai-windows-host\.exe"\)/);
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
