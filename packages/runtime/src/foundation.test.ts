import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { assertArchConsistent, assertInputMatchesTarget } from "./arch-guard.js";
import { GENERATION_ID, resolveGenerationLayout, joinUserData } from "./layout.js";
import {
  applyPosixTreeModes,
  assertWindowsAclHonest,
  posixCredentialModes,
  windowsCredentialAcl,
  writeFileAtomic,
} from "./permissions.js";
import { assertProductionBundleClean } from "./scanner.js";
import { resolveRuntimeLayout } from "./index.js";

test("R50-DIST-006 generation layout isolates 0.5 and lists legacy", () => {
  const mac = resolveGenerationLayout({ platform: "darwin", home: "/Users/测 试" });
  assert.equal(mac.generationId, GENERATION_ID);
  assert.match(mac.userData.replace(/\\/g, "/"), /Penglai\/0\.5$/);
  assert.match(mac.userData, /测 试/);
  assert.ok(mac.legacyCandidates.some((p) => p.includes("penglai-v0.2.0-alpha.3") || p.includes(".dsh")));
  const win = resolveGenerationLayout({ platform: "win32", home: "C:\\Users\\测 试", localAppData: "C:\\Users\\测 试\\AppData\\Local" });
  assert.match(win.userData.replace(/\\/g, "/"), /Penglai\/0\.5$/);
  assert.equal(joinUserData(join(tmpdir(), "Penglai")), join(tmpdir(), "Penglai", "0.5"));
});

test("R50-DIST-007 arch guard rejects mixed Electron/Node", () => {
  assert.throws(
    () => assertArchConsistent({ target: "darwin-aarch64", nodeArch: "x64", electronArch: "arm64" }),
    /node arch/,
  );
  assert.throws(() => assertInputMatchesTarget("node-v22.22.2-darwin-arm64.tar.gz", "darwin-x86_64"), /not x64/);
  assert.throws(() => assertInputMatchesTarget("electron-v43.4.0-win32-x64.zip", "darwin-aarch64"), /not a darwin/);
  assert.doesNotThrow(() =>
    assertArchConsistent({ target: "darwin-aarch64", nodeArch: "arm64", electronArch: "arm64", processArch: "arm64" }),
  );
});

test("posix credential modes and atomic write", { skip: process.platform === "win32" }, () => {
  const modes = posixCredentialModes();
  assert.equal(modes.dir, 0o700);
  assert.equal(modes.file, 0o600);
  const dir = mkdtempSync(join(tmpdir(), "penglai-cred-"));
  const file = join(dir, ".credentials.yaml");
  writeFileAtomic(file, "secret: x\n", 0o600);
  applyPosixTreeModes(dir, [file]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file, "utf8"), "secret: x\n");
});

test("Windows ACL plan denies Users/Everyone by omission, never conflicting ACEs", () => {
  const plan = windowsCredentialAcl();
  assert.ok(plan.deny.includes("Users"));
  assert.ok(plan.deny.includes("Everyone"));
  assert.equal(plan.denyMode, "implicit-by-omission");
  assert.throws(() => assertWindowsAclHonest([{ id: "Everyone", allow: true }]), PenglaiError);
  assert.doesNotThrow(() => assertWindowsAclHonest([{ id: "current-user", allow: true }]));
});

test("R50-DIST-010 production scanner rejects fixture/key/owner path", () => {
  assert.throws(
    () =>
      assertProductionBundleClean({
        "resources/app.js": "fetch('/penglai/usable-fixture')",
      }),
    /usable-fixture/,
  );
  assert.throws(
    () => assertProductionBundleClean({ "evidence/generated/x.json": "{}" }),
    /evidence/,
  );
  assert.throws(
    () => assertProductionBundleClean({ "resources/app.js": "const x = 'penglai-loopback'" }),
    /penglai-loopback/,
  );
  assert.doesNotThrow(() => assertProductionBundleClean({ "resources/app.js": "official dsh web" }));
});

test("embed-runtime is target-aware and reads the release contract", () => {
  const src = readFileSync(new URL("../../../scripts/embed-runtime.mjs", import.meta.url), "utf8");
  assert.match(src, /--target/);
  assert.match(src, /release-contract\.json/);
  assert.match(src, /win32-x86_64/);
  assert.match(src, /darwin-x86_64/);
  assert.match(src, /materializeDshClosure/);
  assert.match(src, /rmSync\(staging, \{ recursive: true, force: true, maxRetries: 5, retryDelay: 100 \}\)/);
  assert.match(src, /execFileSync\("ditto", \[extractedRoot, nodeDest\]\)/);
  assert.match(src, /copyFileSync\(targetPath, child\)/);
  assert.match(src, /cpSync\(extractedRoot, nodeDest, \{ recursive: true, dereference: true \}\)/);
  assert.match(src, /abs\.slice\(staging\.length \+ 1\)\.replaceAll\("\\\\", "\/"\)/);
  const closure = readFileSync(new URL("../../../scripts/lib/dsh-closure.mjs", import.meta.url), "utf8");
  assert.match(closure, /REQUIRE_BUILTIN_NATIVE_BY_TARGET/);
  assert.match(closure, /node-addon-require-builtin-darwin-arm64/);
});

test("profile verifier proves fresh optional-off and explicit composition modes", () => {
  const src = readFileSync(new URL("../../../scripts/verify-profile.mjs", import.meta.url), "utf8");
  assert.match(src, /PENGLAI_PLUGINS_DIR:\s*layout\.pluginsDir/);
  assert.match(src, /\["fresh", "im-only", "im-asr", "im-tts", "full"\]/);
  assert.match(src, /installFirstPartyPlugins/);
});

test("official DSH closure BFS includes runtime packages that healProfilesModuleFallback must flatten", async () => {
  const { collectDshClosure, assertDshClosure, REQUIRED_DSH_RUNTIME_PACKAGES } = await import(
    "../../../scripts/lib/dsh-closure.mjs"
  );
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const workspace = createRequire(join(process.cwd(), "packages/dsh-bridge/package.json")).resolve(
    "@deepseek-ai/dsh/package.json",
  );
  assert.equal(existsSync(workspace), true);
  const links = collectDshClosure(workspace);
  assertDshClosure(links);
  for (const name of REQUIRED_DSH_RUNTIME_PACKAGES) {
    assert.equal(links.has(name), true, name);
  }
});

test("DSH closure keeps only the node-pty payload for the declared release target", async () => {
  const { pruneNodePtyNativePayloads } = await import(
    "../../../scripts/lib/dsh-closure.mjs"
  );
  const targets = [
    ["darwin-aarch64", "darwin-arm64", "pty.node"],
    ["darwin-x86_64", "darwin-x64", "pty.node"],
    ["win32-x86_64", "win32-x64", "conpty.node"],
  ] as const;
  for (const [target, keep, binding] of targets) {
    const modules = mkdtempSync(join(tmpdir(), `penglai-node-pty-${keep}-`));
    const nodePty = join(modules, "node-pty");
    for (const platform of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]) {
      const dir = join(nodePty, "prebuilds", platform);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, platform.startsWith("win32") ? "conpty.node" : "pty.node"), platform);
      if (platform.startsWith("darwin")) writeFileSync(join(dir, "spawn-helper"), platform);
    }
    for (const platform of ["win10-arm64", "win10-x64"]) {
      const dir = join(nodePty, "third_party", "conpty", "1.25.260303002", platform);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "conpty.dll"), platform);
    }
    const result = pruneNodePtyNativePayloads(modules, target);
    assert.equal(result.present, true);
    assert.equal(existsSync(join(nodePty, "prebuilds", keep, binding)), true);
    for (const platform of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]) {
      assert.equal(existsSync(join(nodePty, "prebuilds", platform)), platform === keep);
    }
    assert.equal(
      existsSync(join(nodePty, "third_party", "conpty")),
      target === "win32-x86_64",
    );
    if (target === "win32-x86_64") {
      assert.equal(
        existsSync(join(nodePty, "third_party", "conpty", "1.25.260303002", "win10-x64", "conpty.dll")),
        true,
      );
      assert.equal(
        existsSync(join(nodePty, "third_party", "conpty", "1.25.260303002", "win10-arm64")),
        false,
      );
    }
  }
});

test("windows layout uses node.exe", () => {
  const layout = resolveRuntimeLayout("/app", "win32");
  assert.match(layout.nodeBin, /node\.exe$/);
  const mac = resolveRuntimeLayout("/app", "darwin");
  assert.match(mac.nodeBin.replace(/\\/g, "/"), /bin\/node$/);
});
