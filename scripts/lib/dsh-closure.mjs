import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
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
  "@deepseek-ai/dsh-host-apiproxy",
  "@deepseek-ai/dsh-client-connection",
];

export const REQUIRE_BUILTIN_NATIVE_BY_TARGET = {
  "darwin-aarch64": "node-addon-require-builtin-darwin-arm64",
  "darwin-x86_64": "node-addon-require-builtin-darwin-x64",
  "windows-x86_64": "node-addon-require-builtin-win32-x64-msvc",
};

const ROOT_CANDIDATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

export function collectDshClosure(installAnchor) {
  const appManifest = JSON.parse(readFileSync(installAnchor, "utf8"));
  const links = new Map();
  if (typeof appManifest.name === "string" && appManifest.name) {
    links.set(appManifest.name, dirname(installAnchor));
  }
  const queue = [{ anchor: installAnchor, manifest: appManifest }];
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
  cpSync(dir, dest, { recursive: true, dereference: true });
  rmSync(join(dest, "node_modules"), { recursive: true, force: true });
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
  };
}
