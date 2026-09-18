import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import type { Context } from "@deepseek-ai/cordis";
import { boot, composeEntries, initProfile, readProfileManifest, readProfilePatches, type ProfileContext } from "@deepseek-ai/dsh-app-boot";
import { pnpmLocalFileSpecifier } from "@penglai/runtime";
import { createOfficialPluginManager } from "./official-manager.js";

/** Real pinned Loader/Include/manager and pnpm. The feature payload is a small
 * fixture, not evidence that the production Memory engine ran. */
async function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "penglai-official-manager-")));
  let ctx: Context | undefined;
  t.after(async () => {
    await ctx?.fiber.dispose();
    rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const dir = join(home, "profiles", "test");
  const anchor = join(home, "package.json");
  const source = join(home, "bundled");
  const writePackage = (name: string, bundle = false) => {
    const path = join(source, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify({
      name, version: "1.0.0", type: "module", exports: "./index.mjs",
      ...(bundle ? { dsh: { bundle: { patch: "./cordis.patch.yml" } } } : {}),
    }));
    writeFileSync(join(path, "index.mjs"), "export function apply() {}\n");
    if (bundle) writeFileSync(join(path, "cordis.patch.yml"), "[]\n");
    return path;
  };
  const core = writePackage("fixture-core", true);
  const memory = writePackage("@penglai/memory");
  writeFileSync(join(core, "cordis.patch.yml"), JSON.stringify([{ insert: [
    { id: "penglai-plugin-center", name: "cordis:penglaiCenter" },
    { id: "penglai-memory", name: "@penglai/memory" },
  ] }]));
  writeFileSync(anchor, JSON.stringify({ name: "fixture-installation", dependencies: { "fixture-core": "1.0.0" } }));
  initProfile(dir, ["fixture-core"]);
  for (const [name, path] of [["fixture-core", core], ["@penglai/memory", memory]] as const) {
    const destination = join(dir, "node_modules", name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(path, destination, { recursive: true });
  }
  const manifest = readProfileManifest("dsh", dir);
  manifest.dependencies = { "fixture-core": pnpmLocalFileSpecifier(core), "@penglai/memory": pnpmLocalFileSpecifier(memory) };
  writeFileSync(join(dir, "package.json"), JSON.stringify({ ...manifest, packageManager: "pnpm@11.11.0" }));
  writeFileSync(join(dir, "cordis.yml"), "[]\n");
  const cli = fileURLToPath(new URL("../../../node_modules/pnpm/bin/pnpm.mjs", import.meta.url));
  const profile: ProfileContext = {
    name: "test", dir, patchPath: join(dir, "cordis.patch.yml"), installAnchor: anchor,
    startedBundles: ["fixture-core"], cwd: home, home, overlays: [], telemetryDisabledEnv: "1",
    packageManager: {
      command: process.execPath,
      args: [cli, "--pm-on-fail=error"],
      env: { CI: "true", HOME: home, npm_config_offline: "true", npm_config_package_import_method: "copy", npm_config_store_dir: join(home, "store") },
    },
  };
  const start = async () => {
    ctx = await boot("dsh", join(dir, "cordis.yml"), readProfilePatches("dsh", profile), (root) => {
      root.provide("appReady", { onReady: (listener: () => void) => { listener(); return () => {}; } });
      root.provide("profileContext", profile);
      root.loader.builtins.penglaiCenter = {
        inject: ["loader", "profileContext"],
        apply: (owner: Context) => { createOfficialPluginManager(owner); },
      };
    });
    return ctx.pluginManager;
  };
  const manager = await start();
  return { manager, dir, home, profile, memory, writePackage, restart: async () => { await ctx?.fiber.dispose(); return start(); } };
}

test("official management refuses an absent or retargetable pnpm invocation", () => {
  for (const packageManager of [undefined, { command: "pnpm", args: [] }, { command: process.execPath, args: ["relative/pnpm.mjs"] }]) {
    assert.throws(() => createOfficialPluginManager({ profileContext: { packageManager } } as unknown as Context), /application-owned/);
  }
});

test("real official manager protects its Center owner, retains plain builtins, and persists Memory toggles through restart", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const rows = await f.manager.listPlugins();
  const center = rows.find((row) => row.entryId === "include:penglai-plugin-center");
  const memory = rows.find((row) => row.moduleName === "@penglai/memory");
  assert.equal(center?.readOnlyReason, "management-required");
  assert.ok(memory && "patchId" in memory);
  const protectedResult = await f.manager.setPluginEnabled(center!.entryId, false);
  assert.equal(protectedResult.application, "failed");
  assert.equal(protectedResult.error?.code, "management-required");
  const before = readFileSync(join(f.dir, "package.json"), "utf8");
  const removed = await f.manager.removeBundle("@penglai/memory");
  assert.equal(removed.application, "failed");
  assert.equal(removed.error?.code, "not-removable");
  assert.equal(readFileSync(join(f.dir, "package.json"), "utf8"), before);
  const result = await f.manager.setPluginEnabled(memory.entryId, false);
  assert.equal(result.application, "restart-required");
  assert.equal((await f.manager.listPlugins()).find((row) => row.entryId === memory.entryId)?.enabled, true, "saved selection is not current runtime state");
  assert.equal(composeEntries([readProfilePatches("dsh", f.profile)]).find((row) => row.id === "penglai-memory")?.disabled, true);
  const restarted = await f.restart();
  const stopped = (await restarted.listPlugins()).find((row) => row.moduleName === "@penglai/memory");
  assert.equal(stopped?.enabled, false);
  assert.equal(stopped?.fiberPhase, null);
  assert.equal(existsSync(join(f.dir, "node_modules", "@penglai/memory", "package.json")), true);
  assert.equal(readFileSync(join(f.dir, "package.json"), "utf8"), before);
  assert.equal((await restarted.setPluginEnabled(stopped!.entryId, true)).application, "restart-required");
  const enabled = await f.restart();
  assert.equal((await enabled.listPlugins()).find((row) => row.moduleName === "@penglai/memory")?.enabled, true);
});

test("official manager installs and removes a local bundle using real pinned pnpm without a signed-catalog allowlist", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const extension = f.writePackage("fixture-open-extension", true);
  const sourceBefore = readFileSync(join(f.memory, "package.json"), "utf8");
  assert.equal((await f.manager.inspect(extension)).status, "accepted");
  const result = await f.manager.installBundle(extension, { enabled: false });
  assert.equal(result.application, "restart-required", JSON.stringify(result));
  assert.equal(result.packageResult?.exitCode, 0, JSON.stringify(result));
  const installed = (await f.manager.listBundles()).find((row) => row.name === "fixture-open-extension");
  assert.equal(installed?.installed, true);
  assert.equal(installed?.enabled, false);
  assert.equal(installed?.removable, true);
  assert.equal(readFileSync(join(f.memory, "package.json"), "utf8"), sourceBefore, "package operations must not modify immutable source fixtures");
  assert.equal(existsSync(join(f.dir, "node_modules", "@penglai/memory", "package.json")), true);
  const removal = await f.manager.removeBundle("fixture-open-extension");
  assert.equal(removal.packageResult?.exitCode, 0, JSON.stringify(removal));
  assert.equal((await f.manager.listBundles()).some((row) => row.name === "fixture-open-extension"), false);
});
