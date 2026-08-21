import assert from "node:assert/strict";
import test from "node:test";
import { UNSIGNED_NOTICE, createDesktopRuntime } from "./main.js";
import { assertIpcName } from "./preload.js";

test("unsigned notice present", () => {
  assert.match(UNSIGNED_NOTICE, /ad-hoc|unsigned|not notarized/i);
});

test("IPC allowlist rejects unknown", () => {
  assert.equal(assertIpcName("getHealth"), true);
  assert.equal(assertIpcName("eval"), false);
});

test("supervisor starts stopped", () => {
  const rt = createDesktopRuntime();
  assert.equal(rt.supervisor.state, "stopped");
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
  mkdirSync(join(resources, "runtime", "node", "bin"), { recursive: true });
  mkdirSync(join(resources, "runtime", "dsh", "lib"), { recursive: true });
  writeFileSync(join(resources, "runtime", "node", "bin", "node"), "");
  writeFileSync(join(resources, "runtime", "dsh", "lib", "bin.js"), "");
  const appDir = join(resources, "app");
  mkdirSync(appDir, { recursive: true });
  const found = findResourcesRoot({
    resourcesPath: join(tmpdir(), "missing-electron-resources"),
    moduleDir: appDir,
  });
  assert.equal(found, resources);
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
  assert.match(main, /revealWindow\(\)/);
  assert.match(main, /win\.loadFile\(recovery\)/);
  assert.match(main, /wizard:\s*\{\s*root:\s*wizardRoot/);
  assert.match(main, /wizardUrlForOrigin/);
  assert.match(main, /wizardFinished/);
  assert.match(main, /wizardPickFolder/);
  assert.match(main, /confirmPluginAction/);
  assert.match(main, /onboardingLedgerComplete/);
  assert.match(main, /officialVendorConsoleDecision/);
  assert.match(main, /shell\.openExternal/);
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) =>/);
});

test("control shell documents unsigned alpha", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.match(html, /ad-hoc|unsigned|not notarized/i);
  assert.match(html, /data-penglai-recovery/);
  assert.match(html, /Powered by DeepSeek Harness/);
  assert.match(html, /Content-Security-Policy/);
});
