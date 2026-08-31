import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UNSIGNED_NOTICE, createDesktopRuntime } from "./main.js";
import { loadWindowUrl } from "./navigation-retry.js";
import { assertIpcName } from "./preload.js";
import { DshSupervisor, type DshSupervisorInner } from "./supervisor.js";
import { EMPTY_INVENTORY_PROOF, type RuntimeLayout, type SupervisorRecoverySnapshot, type UserLayout } from "@penglai/runtime";

test("community release notice keeps platform trust limits without candidate wording", () => {
  assert.match(UNSIGNED_NOTICE, /ad-hoc|unsigned|not notarized/i);
  assert.match(UNSIGNED_NOTICE, /community release/i);
  assert.doesNotMatch(UNSIGNED_NOTICE, /candidate|not a public release/i);
});

test("IPC allowlist rejects unknown", () => {
  assert.equal(assertIpcName("getHealth"), true);
  assert.equal(assertIpcName("restartPluginRuntime"), true);
  assert.equal(assertIpcName("eval"), false);
});

test("supervisor starts stopped", () => {
  const rt = createDesktopRuntime();
  assert.equal(rt.supervisor.state, "stopped");
});

test("desktop supervisor reflects one inner lifecycle instead of stale copied state", async () => {
  const layout: RuntimeLayout = {
    appRoot: "/fixture/app",
    nodeBin: "/fixture/app/runtime/node/bin/node",
    dshEntry: "/fixture/app/runtime/dsh/lib/bin.js",
    profileSeed: "/fixture/app/profile-seed/web",
    pluginsDir: "/fixture/app/plugins",
    manifestPath: "/fixture/app/runtime-manifest.json",
    officialDeepseek: "/fixture/app/runtime/dsh/node_modules/@deepseek-ai",
  };
  const user: UserLayout = {
    root: "/fixture/user",
    dshHome: "/fixture/user/dsh-home",
    profileWeb: "/fixture/user/dsh-home/profiles/web",
    transactions: "/fixture/user/profiles/transactions",
    snapshots: "/fixture/user/profiles/snapshots",
    imDb: "/fixture/user/im/penglai-im.sqlite",
    logs: "/fixture/user/logs",
  };
  let factoryCalls = 0;
  let startCalls = 0;
  let emitRecovery: ((snapshot: Readonly<SupervisorRecoverySnapshot>) => void) | undefined;
  const observedRecovery: string[] = [];
  const inner: DshSupervisorInner = {
    state: "stopped",
    port: 0,
    restarts: 0,
    health: undefined,
    upstreamCookie: undefined,
    child: { pid: 4242 },
    async start() {
      startCalls += 1;
      this.state = "healthy";
      this.port = 41_234;
      this.health = { http: 200, inventory: EMPTY_INVENTORY_PROOF };
      return { port: this.port };
    },
    async stop() {
      this.state = "stopped";
      this.health = undefined;
    },
  };
  const supervisor = new DshSupervisor(layout, (_layout, options) => {
    factoryCalls += 1;
    emitRecovery = options.onRecoveryStateChange;
    return inner;
  });
  supervisor.onRecoveryStateChange((snapshot) => observedRecovery.push(snapshot.status));

  await supervisor.start(user);
  assert.equal(supervisor.state, "healthy");
  assert.equal(supervisor.port, 41_234);
  assert.equal(supervisor.childPid, 4242);
  assert.equal(supervisor.recovery.status, "idle");
  inner.recovery = {
    status: "manual-action-required",
    reason: "restart-budget-exhausted",
    attempt: 3,
    maxAttempts: 3,
    exitCode: 1,
    trigger: "process-exit",
    lastFailure: "process-exit",
  };
  emitRecovery?.(inner.recovery);
  assert.deepEqual(observedRecovery, ["manual-action-required"]);
  assert.equal(supervisor.recovery.attempt, 3);
  inner.state = "crashed";
  inner.restarts = 1;
  inner.health = undefined;
  assert.equal(supervisor.state, "crashed");
  assert.equal(supervisor.restarts, 1);
  assert.equal(supervisor.health, undefined);

  await supervisor.start(user);
  assert.equal(factoryCalls, 1);
  assert.equal(startCalls, 2);
  await supervisor.stop();
  assert.equal(supervisor.state, "stopped");
});

test("R2-DIST-003 layout refuses missing embedded runtime", async () => {
  const { layoutFromResources } = await import("./supervisor.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  assert.throws(() => layoutFromResources(mkdtempSync(join(tmpdir(), "empty-res-"))));
});

test("findResourcesRoot prefers a real runtime over isPackaged guesses", async () => {
  const { findResourcesRoot } = await import("./supervisor.js");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const resources = mkdtempSync(join(tmpdir(), "penglai-res-"));
  const nodePath =
    process.platform === "win32"
      ? join(resources, "runtime", "node", "node.exe")
      : join(resources, "runtime", "node", "bin", "node");
  mkdirSync(join(nodePath, ".."), { recursive: true });
  mkdirSync(join(resources, "runtime", "dsh", "lib"), { recursive: true });
  writeFileSync(nodePath, "");
  writeFileSync(join(resources, "runtime", "dsh", "lib", "bin.js"), "");
  const appDir = join(resources, "app");
  mkdirSync(appDir, { recursive: true });
  const found = findResourcesRoot({
    resourcesPath: join(tmpdir(), "missing-electron-resources"),
    moduleDir: appDir,
  });
  assert.equal(found, resources);
  assert.throws(() => findResourcesRoot({
    authoritativeRoot: join(tmpdir(), "missing-authoritative-resources"),
    resourcesPath: resources,
    moduleDir: appDir,
  }));
});

test("owned runtime path matches both POSIX and Windows node layouts", async () => {
  const { isOwnedRuntimePath } = await import("./supervisor.js");
  // POSIX: <appRoot>/runtime/node/bin/node
  assert.equal(isOwnedRuntimePath("/App/Penglai.app/Resources", "/App/Penglai.app/Resources/runtime/node/bin/node"), true);
  assert.equal(isOwnedRuntimePath("/App/Penglai.app/Resources", "/App/Penglai.app/Resources/runtime/dsh/lib/bin.js"), true);
  assert.equal(isOwnedRuntimePath("/App/Penglai.app/Resources", "/usr/bin/node"), false);
  assert.equal(isOwnedRuntimePath("/App/Penglai.app/Resources", "/App/Penglai.app/Resources"), false);
  // Windows: <appRoot>\runtime\node\node.exe must not be rejected for backslashes.
  assert.equal(isOwnedRuntimePath("C:\\ProgramData\\Penglai\\app\\0.5", "C:\\ProgramData\\Penglai\\app\\0.5\\runtime\\node\\node.exe"), true);
  assert.equal(isOwnedRuntimePath("C:\\ProgramData\\Penglai\\app\\0.5", "C:\\Windows\\System32\\node.exe"), false);
  // A sibling directory named "runtime-x" must not count.
  assert.equal(isOwnedRuntimePath("/App/Resources", "/App/Resources/runtime-x/node/bin/node"), false);
});

test("startup failure can load the recovery page instead of a blank window", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("./electron-main.ts", import.meta.url), "utf8");
  assert.match(main, /pathToFileURL\(recoveryPage\)/);
  assert.match(main, /navigationDecision\(next, allowedOrigin, recoveryUrl, \{ wizardComplete/);
  assert.match(main, /isOwnedRuntimePath\(layout\.appRoot, layout\.nodeBin\)/);
  assert.match(main, /show:\s*false/);
  assert.match(main, /opacity:\s*platform === "win32" \? 0 : 1/);
  assert.match(main, /backgroundColor:\s*"#f8f4ee"/);
  assert.match(main, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(main, /await delay\(120\)/);
  assert.match(main, /win\.setOpacity\(1\)/);
  const splashBlock = main.slice(main.indexOf("if (existsSync(splashPage))"), main.indexOf("if (existsSync(splashPage))") + 500);
  assert.ok(splashBlock.indexOf('requestAnimationFrame(resolve)') < splashBlock.indexOf('await revealWindow();'));
  assert.ok(main.indexOf('win.show();') < main.indexOf('win.setOpacity(1)'));
  assert.match(main, /revealWindow\(\)/);
  assert.match(main, /win\.loadFile\(recoveryPage\)/);
  assert.match(main, /wizard:\s*\{\s*root:\s*wizardRoot/);
  assert.match(main, /wizardUrlForOrigin/);
  assert.match(main, /wizardFinished/);
  assert.match(main, /wizardPickFolder/);
  assert.match(main, /confirmPluginAction/);
  assert.match(main, /installEnable:\s*"plugin-enable"/);
  assert.match(main, /disable:\s*"plugin-disable"/);
  assert.match(main, /rollback:\s*"plugin-rollback"/);
  assert.match(main, /requestOwnerApprovalArgs/);
  assert.match(main, /onboardingLedgerComplete/);
  assert.match(main, /officialVendorConsoleDecision/);
  assert.match(main, /shell\.openExternal/);
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) =>/);
  assert.match(main, /openPluginLink/);
  assert.match(main, /assertSafeHttpsUrl/);
  assert.match(main, /recoveryCopyDiagnostics/);
  assert.match(main, /onRecoveryStateChange/);
  assert.match(main, /manual-action-required/);
  assert.match(main, /lastRecoveryDiagnostic/);
  assert.match(main, /retainPrimarySupervisorDiagnostic/);
  assert.match(main, /RECOVERY_DIAGNOSTIC_CHANNEL/);
  assert.match(main, /diagnostic\.referenceId/);
  assert.match(main, /if \(recoveryIpcNames\.has\(name\)\) continue/);
  assert.match(main, /event\.sender\.getURL\(\) !== recoveryUrl/);
  assert.ok(main.indexOf("for (const name of recoveryIpcNames)") < main.indexOf("const resources = resourcesRoot()"));
  assert.doesNotMatch(main, /p\.dataset\.penglaiError|p\.textContent/);
  assert.match(main, /splash\.html/);
  assert.match(main, /extraFileUrls/);
  const gatewayPublish = main.lastIndexOf("publishGateway();");
  const homeActivation = main.lastIndexOf("activateDshHomeBootPlan({");
  assert.ok(homeActivation > 0);
  assert.ok(gatewayPublish > homeActivation);
  assert.match(main, /rmSync\(join\(user\.root, "gateway\.port"\), \{ force: true \}\)/);
});

test("startup failure tears down owned services before rendering recovery", () => {
  const source = readFileSync(new URL("./electron-main.ts", import.meta.url), "utf8");
  const failProbe = source.slice(source.indexOf("const failProbe"), source.indexOf("const failProbe") + 2_000);
  assert.match(failProbe, /await stopOwnedServices\(\)/);
  assert.ok(failProbe.indexOf("await stopOwnedServices()") < failProbe.indexOf("win.loadFile(recoveryPage)"));
  assert.match(failProbe, /if \(stopping \|\| win\.isDestroyed\(\)\) return/);
});

test("desktop navigation retries one transient Electron abort", async () => {
  let calls = 0;
  let current = "file:///splash.html";
  const win = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, getURL: () => current },
    loadURL: async (target: string) => {
      calls += 1;
      if (calls === 1) throw new Error("ERR_ABORTED (-3) loading URL");
      current = target;
    },
  };
  await loadWindowUrl(win, "http://127.0.0.1:1234/", () => false, {
    retryDelayMs: 0,
    timeoutMs: 100,
  });
  assert.equal(calls, 2);
  assert.equal(current, "http://127.0.0.1:1234/");
});

test("desktop navigation does not load into a closed window", async () => {
  let calls = 0;
  const win = {
    isDestroyed: () => true,
    webContents: { isDestroyed: () => true, getURL: () => "" },
    loadURL: async () => {
      calls += 1;
    },
  };
  await assert.rejects(
    loadWindowUrl(win, "http://127.0.0.1:1234/", () => false, {
      retryDelayMs: 0,
      timeoutMs: 100,
    }),
    /window closed during navigation/,
  );
  assert.equal(calls, 0);
});

test("recovery screen uses plain user-facing language", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /ad-hoc|notarized|Gatekeeper|community-verified|DeepSeek Harness/i);
  assert.match(html, /蓬莱未能正常启动/);
  assert.match(html, /keep security protections enabled/i);
  assert.match(html, /data-penglai-recovery/);
  assert.match(html, /data-penglai-recovery-en/);
  assert.match(html, /data-penglai-recovery-zh/);
  assert.match(html, /Penglai could not start normally/);
  assert.match(html, /data-penglai-recovery-retry/);
  assert.match(html, /Automatic recovery stopped after three attempts/);
  assert.match(html, /自动恢复已尝试三次并停止/);
  assert.match(html, /data-penglai-recovery-exhausted/);
  assert.match(html, /data-penglai-recovery-reference/);
  assert.match(html, /Content-Security-Policy/);
});

test("R56-CORE-006 splash names boot phases in plain user-facing language", async () => {
  const html = readFileSync(new URL("../static/splash.html", import.meta.url), "utf8");
  assert.match(html, /data-penglai-splash/);
  assert.match(html, /data-penglai-splash-en/);
  assert.match(html, /data-penglai-splash-zh/);
  assert.match(html, /正在准备你的个人 AI 助手/);
  assert.match(html, /Getting your personal AI assistant ready/);
  assert.match(html, /首次启动可能需要几秒/);
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(html, /DeepSeek Harness|HTTP health|Runtime \/|Required plugins|official DSH/i);
  assert.doesNotMatch(html, /<ol|<li/);
  assert.match(html, /starting-dsh/);
  assert.match(html, /verifying-required-plugins/);
  assert.doesNotMatch(html, /data-penglai-recovery/);
});
