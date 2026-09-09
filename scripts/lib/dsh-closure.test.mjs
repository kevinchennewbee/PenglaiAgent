import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import test from "node:test";
import {
  collectDshClosure,
  DSH_RUNTIME_INTEGRATION_ROOTS,
  locateWorkspaceDsh,
  materializeDshClosure,
  materializeNestedVersionConflicts,
  OPTIONAL_INTERNALS_TARGETS,
  packageSupportsTarget,
  REQUIRED_DSH_RUNTIME_PACKAGES,
  REQUIRE_BUILTIN_NATIVE_BY_TARGET,
  resolveRequireBuiltinNative,
} from "./dsh-closure.mjs";

test("locateWorkspaceDsh uses hoisted node_modules when .pnpm has no DSH entry", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-hoist-"));
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".pnpm", "lock.yaml"), "lockfileVersion: 9.0\n");
  const dshDir = join(root, "node_modules", "@deepseek-ai", "dsh");
  mkdirSync(dshDir, { recursive: true });
  writeFileSync(join(dshDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" }));
  const located = locateWorkspaceDsh({
    root,
    pinnedVersion: "0.1.1-rc.2",
    resolvedPackageDir: dshDir,
  });
  assert.equal(located?.layout, "hoisted");
  assert.equal(located?.dshPackageDir, dshDir);
  assert.equal(located?.dshPackageRoot, root);
});

test("locateWorkspaceDsh prefers isolated .pnpm virtual store when present", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-iso-"));
  const virtual = join(root, "node_modules", ".pnpm", "@deepseek-ai+dsh@0.1.1-rc.2_abc");
  const nested = join(virtual, "node_modules", "@deepseek-ai", "dsh");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" }));
  const located = locateWorkspaceDsh({
    root,
    pinnedVersion: "0.1.1-rc.2",
    resolvedPackageDir: join(root, "node_modules", "@deepseek-ai", "dsh"),
  });
  assert.equal(located?.layout, "isolated");
  assert.equal(located?.dshPackageDir, nested);
  assert.equal(located?.dshPackageRoot, virtual);
});

test("alpha runtime closure includes every Penglai client injection root", () => {
  const links = collectDshClosure(resolve("node_modules/@deepseek-ai/dsh/package.json"));
  for (const name of DSH_RUNTIME_INTEGRATION_ROOTS) assert.equal(links.has(name), true, name);
  for (const name of REQUIRED_DSH_RUNTIME_PACKAGES) assert.equal(links.has(name), true, name);
  assert.equal(links.has("@deepseek-ai/dsh-host-apiproxy"), false);
});

test("target closure excludes optional native packages for other operating systems and CPUs", () => {
  assert.equal(packageSupportsTarget({ os: ["darwin"], cpu: ["arm64"] }, "win32-x86_64"), false);
  assert.equal(packageSupportsTarget({ os: ["win32"], cpu: ["x64"] }, "win32-x86_64"), true);
  assert.equal(packageSupportsTarget({ os: ["!win32"] }, "win32-x86_64"), false);
  assert.equal(packageSupportsTarget({ cpu: ["!arm64"] }, "win32-x86_64"), true);

  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-target-"));
  const app = join(root, "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "target-fixture",
      optionalDependencies: {
        "native-win": "1.0.0",
        "native-mac-arm": "1.0.0",
        "native-mac-x64": "1.0.0",
      },
    }),
  );
  for (const [name, manifest] of [
    ["native-win", { name: "native-win", version: "1.0.0", os: ["win32"], cpu: ["x64"] }],
    ["native-mac-arm", { name: "native-mac-arm", version: "1.0.0", os: ["darwin"], cpu: ["arm64"] }],
    ["native-mac-x64", { name: "native-mac-x64", version: "1.0.0", os: ["darwin"], cpu: ["x64"] }],
  ]) {
    const packageDir = join(root, "node_modules", name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(manifest));
  }

  const links = collectDshClosure(join(app, "package.json"), [], "win32-x86_64");
  assert.equal(links.has("native-win"), true);
  assert.equal(links.has("native-mac-arm"), false);
  assert.equal(links.has("native-mac-x64"), false);
});

test("flattening preserves a package-local dependency when its version differs", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-conflict-"));
  const sourceA = join(root, "source", "package-a");
  const sourceX2 = join(root, "source", "package-x2");
  const sourceX1 = join(sourceA, "node_modules", "package-x");
  const modules = join(root, "dest", "node_modules");
  for (const [dir, manifest] of [
    [sourceA, { name: "package-a", version: "1.0.0", dependencies: { "package-x": "1.0.0" } }],
    [sourceX1, { name: "package-x", version: "1.0.0" }],
    [sourceX2, { name: "package-x", version: "2.0.0" }],
  ]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  }
  mkdirSync(join(modules, "package-a"), { recursive: true });
  writeFileSync(join(modules, "package-a", "package.json"), JSON.stringify({ name: "package-a", version: "1.0.0" }));
  const result = materializeNestedVersionConflicts(
    new Map([["package-a", sourceA], ["package-x", sourceX2]]),
    modules,
  );
  assert.equal(result.nestedConflictCount, 1);
  const nested = JSON.parse(readFileSync(join(modules, "package-a", "node_modules", "package-x", "package.json"), "utf8"));
  assert.equal(nested.version, "1.0.0");
});

test("require-builtin native is required only where npm publishes it", () => {
  assert.equal(REQUIRE_BUILTIN_NATIVE_BY_TARGET["darwin-aarch64"], "node-addon-require-builtin-darwin-arm64");
  assert.equal(REQUIRE_BUILTIN_NATIVE_BY_TARGET["darwin-x86_64"], "node-addon-require-builtin-darwin-x64");
  assert.equal(REQUIRE_BUILTIN_NATIVE_BY_TARGET["win32-x86_64"], "node-addon-require-builtin-win32-x64-msvc");
  assert.equal("linux-loong64" in REQUIRE_BUILTIN_NATIVE_BY_TARGET, false);
  assert.deepEqual([...OPTIONAL_INTERNALS_TARGETS], ["linux-loong64"]);
  const optional = resolveRequireBuiltinNative(resolve("package.json"), "linux-loong64");
  assert.equal(optional.required, false);
  assert.equal(optional.name, undefined);
  const required = resolveRequireBuiltinNative(resolve("package.json"), "darwin-aarch64");
  assert.equal(required.required, true);
  assert.equal(required.name, "node-addon-require-builtin-darwin-arm64");
  assert.throws(
    () => resolveRequireBuiltinNative(resolve("package.json"), "linux-x64"),
    /no require-builtin native mapping/,
  );
});

function writeClosureFixture(work, { withPty } = {}) {
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "fixture-root",
      version: "1.0.0",
      dependencies: Object.fromEntries(
        [...REQUIRED_DSH_RUNTIME_PACKAGES, ...(withPty ? ["node-pty"] : [])].map((name) => [name, "1.0.0"]),
      ),
    }),
  );
  for (const name of REQUIRED_DSH_RUNTIME_PACKAGES) {
    const dir = join(work, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
}

test("linux-loong64 flatten omits unpublished require-builtin native and still requires pty", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-dsh-optional-int-"));
  writeClosureFixture(work, { withPty: true });
  const pty = join(work, "node_modules", "node-pty");
  mkdirSync(join(pty, "prebuilds", "linux-loong64"), { recursive: true });
  writeFileSync(join(pty, "package.json"), JSON.stringify({ name: "node-pty", version: "1.0.0" }));
  writeFileSync(join(pty, "prebuilds", "linux-loong64", "pty.node"), "pty\n");
  const sharp = join(work, "node_modules", "sharp");
  mkdirSync(sharp, { recursive: true });
  writeFileSync(join(sharp, "package.json"), JSON.stringify({ name: "sharp", version: "0.35.4" }));
  const rootPkg = JSON.parse(readFileSync(join(work, "package.json"), "utf8"));
  rootPkg.dependencies.sharp = "0.35.4";
  writeFileSync(join(work, "package.json"), JSON.stringify(rootPkg));
  const dest = join(work, "dest");
  const flattened = materializeDshClosure(join(work, "package.json"), dest, "linux-loong64");
  assert.equal(flattened.optionalInternals, "unavailable");
  assert.equal(flattened.native, null);
  assert.equal(existsSync(join(dest, "node_modules", "node-addon-require-builtin-linux-loong64-gnu")), false);
  assert.equal(existsSync(join(dest, "node_modules", "node-pty", "prebuilds", "linux-loong64", "pty.node")), true);
});

test("darwin flatten still embeds the published require-builtin native", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-dsh-required-int-"));
  writeClosureFixture(work);
  const dest = join(work, "dest");
  const flattened = materializeDshClosure(join(work, "package.json"), dest, "darwin-aarch64");
  assert.equal(flattened.native, "node-addon-require-builtin-darwin-arm64");
  assert.equal(flattened.optionalInternals, "embedded");
  assert.equal(
    existsSync(join(dest, "node_modules", "node-addon-require-builtin-darwin-arm64", "package.json")),
    true,
  );
});

test("official loader declares require-builtin as an optional peer", () => {
  const loader = JSON.parse(
    readFileSync(resolve("node_modules/@deepseek-ai/cordis-plugin-loader/package.json"), "utf8"),
  );
  assert.equal(loader.peerDependencies["node-addon-require-builtin"], "^0.1.4");
  assert.equal(loader.peerDependenciesMeta["node-addon-require-builtin"].optional, true);
  const builtin = JSON.parse(
    readFileSync(resolve("node_modules/node-addon-require-builtin/package.json"), "utf8"),
  );
  assert.equal("node-addon-require-builtin-linux-loong64-gnu" in (builtin.optionalDependencies ?? {}), false);
  const loaderJs = readFileSync(
    resolve("node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js"),
    "utf8",
  );
  assert.match(loaderJs, /try \{\s*return require\("node-addon-require-builtin"\)\.requireBuiltin\(id\);\s*\} catch \{\}/);
  assert.match(loaderJs, /if \(!raw\) return;/);
});

test("closure fails closed when a required peer cannot be resolved", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-required-peer-"));
  const manifest = join(root, "package.json");
  writeFileSync(manifest, JSON.stringify({
    name: "fixture-root",
    version: "1.0.0",
    peerDependencies: { "penglai-required-peer-that-does-not-exist": "1.0.0" },
  }));
  assert.throws(
    () => collectDshClosure(manifest, []),
    /cannot resolve required dependency penglai-required-peer-that-does-not-exist/,
  );
});
