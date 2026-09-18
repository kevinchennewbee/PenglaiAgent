import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const BUNDLED_PNPM_VERSION = "11.11.0";
const REFLINK_TARGETS = {
  "darwin-aarch64": "reflink-darwin-arm64",
  "darwin-x86_64": "reflink-darwin-x64",
  "win32-x86_64": "reflink-win32-x64-msvc",
  "linux-loong64": null,
};
const REFLINK_PACKAGE_PATH =
  /^dist\/node_modules\/@reflink\/(reflink-(?:darwin-(?:arm64|x64)|win32-(?:arm64|x64)-msvc))(?:\/|$)/;

/** Keep pnpm's JavaScript and notices intact; omit only foreign optional native
 * helpers. Linux uses Node's copy implementation and requires no reflink addon.
 * Unknown executable formats are rejected rather than silently shipped.
 */
export function copyBundledPnpm(source, destination, target) {
  if (!Object.hasOwn(REFLINK_TARGETS, target)) throw new Error(`unsupported pnpm target ${target}`);
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (manifest.name !== "pnpm" || manifest.version !== BUNDLED_PNPM_VERSION || manifest.bin?.pnpm !== "bin/pnpm.mjs") {
    throw new Error("bundled pnpm identity or entry mismatch");
  }
  if (!existsSync(join(source, "bin", "pnpm.mjs")) || !existsSync(join(source, "dist", "pnpm.mjs"))) {
    throw new Error("bundled pnpm JavaScript closure missing");
  }
  const retainedNative = REFLINK_TARGETS[target];
  const omitted = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      const path = relative(source, file).split("\\").join("/");
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`pnpm input must not contain symlinks: ${path}`);
      if (stat.isDirectory()) {
        const reflinkPackage = REFLINK_PACKAGE_PATH.exec(path)?.[1];
        if (reflinkPackage && reflinkPackage !== retainedNative) {
          // pnpm carries optional native helper packages as full package trees.
          // Dropping only the .node binary leaves foreign-architecture paths
          // and metadata in the installer, so omit the entire foreign helper.
          omitted.push(`${path}/`);
          continue;
        }
        walk(file);
        continue;
      }
      if (!stat.isFile()) throw new Error(`pnpm input contains special file: ${path}`);
      if (/\.(?:node|exe|dll|dylib|so)$/i.test(path)) {
        const addon = /^dist\/node_modules\/@reflink\/(reflink-(?:darwin-(?:arm64|x64)|win32-(?:arm64|x64)-msvc))\/[^/]+\.node$/.exec(path);
        const fastlist = /^dist\/vendor\/fastlist-0\.3\.0-(x64|x86)\.exe$/.exec(path);
        if (!addon && !fastlist) throw new Error(`unreviewed pnpm native helper: ${path}`);
        const keep = addon ? addon[1] === retainedNative : target === "win32-x86_64" && fastlist[1] === "x64";
        if (!keep) { omitted.push(path); continue; }
      }
      const out = join(destination, ...path.split("/"));
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(file, out);
    }
  };
  walk(source);
  return { name: manifest.name, version: manifest.version, target, omitted, entry: "bin/pnpm.mjs" };
}
