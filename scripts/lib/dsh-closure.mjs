import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_DSH_RUNTIME_PACKAGES = [
  "zod",
  "ws",
  "fflate",
  "eventsource-parser",
  "node-addon-require-builtin",
  "node-addon-native-custom-loader",
  "@deepseek-ai/dsh-web-frontend",
  "@deepseek-ai/dsh-workspace",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-api-settings-controller",
  "@deepseek-ai/dsh-api-workspace-controller",
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-general",
  "@deepseek-ai/dsh-client-ui-slots",
];

export const DSH_RUNTIME_INTEGRATION_ROOTS = [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-general",
  "@deepseek-ai/dsh-client-ui-slots",
];

export const REQUIRE_BUILTIN_NATIVE_BY_TARGET = {
  "darwin-aarch64": "node-addon-require-builtin-darwin-arm64",
  "darwin-x86_64": "node-addon-require-builtin-darwin-x64",
  "win32-x86_64": "node-addon-require-builtin-win32-x64-msvc",
};

export const NODE_PTY_PREBUILD_BY_TARGET = {
  "darwin-aarch64": "darwin-arm64",
  "darwin-x86_64": "darwin-x64",
  "win32-x86_64": "win32-x64",
};

const ROOT_CANDIDATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Locate the pinned DSH install under either isolated `.pnpm` virtual store
 * or hoisted `node_modules/@deepseek-ai/dsh` (node-linker=hoisted).
 */
export function locateWorkspaceDsh({ root, pinnedVersion, resolvedPackageDir }) {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    const prefix = `@deepseek-ai+dsh@${pinnedVersion}_`;
    const pnpmDshRoot = readdirSync(pnpmDir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => join(pnpmDir, name))
      .find((candidate) => existsSync(join(candidate, "node_modules", "@deepseek-ai", "dsh")));
    if (pnpmDshRoot) {
      return {
        layout: "isolated",
        dshPackageDir: join(pnpmDshRoot, "node_modules", "@deepseek-ai", "dsh"),
        dshPackageRoot: pnpmDshRoot,
      };
    }
  }
  const hoisted = resolvedPackageDir || join(root, "node_modules", "@deepseek-ai", "dsh");
  if (existsSync(join(hoisted, "package.json")) && existsSync(join(root, "node_modules"))) {
    return {
      layout: "hoisted",
      dshPackageDir: hoisted,
      dshPackageRoot: root,
    };
  }
  return undefined;
}

export function packageDirFromAnchor(anchor, packageName) {
  try {
    const paths = createRequire(anchor).resolve.paths(packageName) ?? [];
    for (const searchPath of paths) {
      const candidate = join(searchPath, packageName);
      if (existsSync(join(candidate, "package.json"))) return candidate;
    }
  } catch {
    /* unresolvable specifier */
  }
  return undefined;
}

export function collectDshClosure(installAnchor, integrationRoots = DSH_RUNTIME_INTEGRATION_ROOTS) {
  const appManifest = JSON.parse(readFileSync(installAnchor, "utf8"));
  const links = new Map();
  if (typeof appManifest.name === "string" && appManifest.name) {
    links.set(appManifest.name, dirname(installAnchor));
  }
  const queue = [{ anchor: installAnchor, manifest: appManifest }];
  for (const name of integrationRoots) {
    if (links.has(name)) continue;
    const dir = packageDirFromAnchor(installAnchor, name);
    if (!dir) throw new Error(`embedded DSH integration root missing ${name}`);
    links.set(name, dir);
    const manifestPath = join(dir, "package.json");
    queue.push({
      anchor: manifestPath,
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    });
  }
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const dep of [
      ...Object.keys(next.manifest.dependencies ?? {}),
      // Native addons (koffi/sharp platform binaries) are declared as
      // optionalDependencies; skipping them leaves the embedded DSH unable to boot.
      ...Object.keys(next.manifest.optionalDependencies ?? {}),
      ...Object.keys(next.manifest.peerDependencies ?? {}),
    ]) {
      if (links.has(dep)) continue;
      const dir = packageDirFromAnchor(next.anchor, dep);
      if (!dir) continue;
      links.set(dep, dir);
      const manifestPath = join(dir, "package.json");
      queue.push({
        anchor: manifestPath,
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
      });
    }
  }
  return links;
}

export function assertDshClosure(links) {
  for (const name of REQUIRED_DSH_RUNTIME_PACKAGES) {
    const dir = links.get(name);
    if (!dir || !existsSync(join(dir, "package.json"))) {
      throw new Error(`embedded DSH closure missing ${name}`);
    }
  }
}

function copyFlatPackage(dir, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  const nestedModules = join(dir, "node_modules");
  cpSync(dir, dest, {
    recursive: true,
    dereference: true,
    filter(source) {
      return source !== nestedModules && !source.startsWith(`${nestedModules}${sep}`);
    },
  });
}

function packageVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

export function materializeNestedVersionConflicts(links, modulesDir) {
  const copied = new Set();
  function preserve(sourceDir, destinationDir) {
    const manifestPath = join(sourceDir, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const dependency of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]) {
      const actual = packageDirFromAnchor(manifestPath, dependency);
      if (!actual) continue;
      const flattened = links.get(dependency);
      if (flattened && packageVersion(flattened) === packageVersion(actual)) continue;
      const nestedDestination = join(destinationDir, "node_modules", dependency);
      const key = `${actual}\0${nestedDestination}`;
      if (copied.has(key)) continue;
      copied.add(key);
      copyFlatPackage(actual, nestedDestination);
      preserve(actual, nestedDestination);
    }
  }
  for (const [name, sourceDir] of links) {
    preserve(sourceDir, join(modulesDir, name));
  }
  return { nestedConflictCount: copied.size };
}

export function assertNestedVersionConflicts(links, modulesDir) {
  for (const [name, sourceDir] of links) {
    const manifestPath = join(sourceDir, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const dependency of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]) {
      const actual = packageDirFromAnchor(manifestPath, dependency);
      const flattened = links.get(dependency);
      if (!actual || !flattened || packageVersion(flattened) === packageVersion(actual)) continue;
      const nested = join(modulesDir, name, "node_modules", dependency);
      if (packageVersion(nested) !== packageVersion(actual)) {
        throw new Error(`embedded DSH closure lost nested ${dependency}@${packageVersion(actual)} required by ${name}`);
      }
    }
  }
}

export function pruneNodePtyNativePayloads(modulesDir, target) {
  const expected = NODE_PTY_PREBUILD_BY_TARGET[target];
  if (!expected) throw new Error(`no node-pty native mapping for ${target}`);
  const nodePty = join(modulesDir, "node-pty");
  if (!existsSync(nodePty)) return { present: false, target: expected };
  const prebuilds = join(nodePty, "prebuilds");
  const expectedPrebuild = join(prebuilds, expected);
  if (!existsSync(expectedPrebuild)) {
    throw new Error(`embedded DSH closure missing node-pty ${expected}`);
  }
  for (const name of readdirSync(prebuilds)) {
    if (name !== expected) rmSync(join(prebuilds, name), { recursive: true, force: true });
  }
  const binding = join(
    expectedPrebuild,
    target === "win32-x86_64" ? "conpty.node" : "pty.node",
  );
  if (!existsSync(binding)) {
    throw new Error(`embedded DSH closure missing node-pty binding ${target}`);
  }
  const conpty = join(nodePty, "third_party", "conpty");
  if (target !== "win32-x86_64") {
    rmSync(conpty, { recursive: true, force: true });
  } else if (existsSync(conpty)) {
    for (const name of readdirSync(conpty)) {
      if (name !== "1.25.260303002") {
        rmSync(join(conpty, name), { recursive: true, force: true });
        continue;
      }
      const versionRoot = join(conpty, name);
      for (const platform of readdirSync(versionRoot)) {
        if (platform !== "win10-x64") {
          rmSync(join(versionRoot, platform), { recursive: true, force: true });
        }
      }
    }
  }
  return { present: true, target: expected, binding };
}

export function resolveRequireBuiltinNative(installAnchor, target) {
  const name = REQUIRE_BUILTIN_NATIVE_BY_TARGET[target];
  if (!name) throw new Error(`no require-builtin native mapping for ${target}`);
  const anchors = [
    installAnchor,
    join(dirname(installAnchor), "package.json"),
    join(ROOT_CANDIDATE, "package.json"),
  ];
  for (const anchor of anchors) {
    const dir = packageDirFromAnchor(anchor, name);
    if (dir) return { name, dir };
  }
  return { name, dir: undefined };
}

export function materializeDshClosure(installAnchor, destRoot, target) {
  const links = collectDshClosure(installAnchor);
  assertDshClosure(links);
  const modulesDir = join(destRoot, "node_modules");
  rmSync(modulesDir, { recursive: true, force: true });
  mkdirSync(modulesDir, { recursive: true });
  const appName = JSON.parse(readFileSync(installAnchor, "utf8")).name;
  for (const [name, dir] of links) {
    if (name === appName) continue;
    copyFlatPackage(dir, join(modulesDir, name));
  }
  const nestedConflicts = materializeNestedVersionConflicts(links, modulesDir);
  assertNestedVersionConflicts(links, modulesDir);
  const nodePty = pruneNodePtyNativePayloads(modulesDir, target);
  const native = resolveRequireBuiltinNative(installAnchor, target);
  if (!native.dir || !existsSync(join(native.dir, "package.json"))) {
    throw new Error(`embedded DSH closure missing ${native.name} for ${target}`);
  }
  copyFlatPackage(native.dir, join(modulesDir, native.name));
  const flattened = new Map(
    [...links.keys()]
      .filter((name) => name !== appName)
      .map((name) => [name, join(modulesDir, name)]),
  );
  flattened.set(native.name, join(modulesDir, native.name));
  assertDshClosure(flattened);
  if (!existsSync(join(modulesDir, native.name, "package.json"))) {
    throw new Error(`flattened DSH closure missing ${native.name}`);
  }
  return {
    packages: [...flattened.keys()],
    native: native.name,
    nodePty,
    nestedConflicts,
  };
}
