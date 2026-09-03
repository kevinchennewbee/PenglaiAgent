import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const PRODUCT_VERSION = "0.5.10";
const DSH_VERSION = "0.1.2-rc.1";
const VENDOR_VERSIONS = Object.freeze({
  "@deepseek-ai/cordis": "4.0.2",
  "@deepseek-ai/cordis-plugin-group": "1.0.2",
  "@deepseek-ai/cordis-plugin-hmr": "1.0.17",
  "@deepseek-ai/cordis-plugin-include": "1.0.7",
  "@deepseek-ai/cordis-plugin-loader": "1.0.3",
  "@deepseek-ai/cordis-plugin-logger-console": "1.0.2",
  "@deepseek-ai/cordis-plugin-timer": "1.1.4",
  "@deepseek-ai/cosmokit": "1.8.3",
  "@deepseek-ai/schemastery": "3.18.2",
});
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const WRITE = process.argv.includes("--write");

const manifestPaths = [join(ROOT, "package.json"), join(ROOT, "apps", "desktop", "package.json")];
for (const name of readdirSync(join(ROOT, "packages"))) {
  const path = join(ROOT, "packages", name, "package.json");
  if (existsSync(path)) manifestPaths.push(path);
}
manifestPaths.push(join(ROOT, "profile-seed", "web", "package.json"));

function migrateDependencies(dependencies = {}, { profileSeed = false } = {}) {
  let changed = false;
  for (const name of Object.keys(dependencies)) {
    let expected;
    if (name.startsWith("@penglai/")) expected = profileSeed ? PRODUCT_VERSION : "workspace:*";
    else if (name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-")) expected = DSH_VERSION;
    else expected = VENDOR_VERSIONS[name];
    if (expected && dependencies[name] !== expected) {
      dependencies[name] = expected;
      changed = true;
    }
  }
  return changed;
}

const changedPaths = [];
const failures = [];
for (const path of manifestPaths) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const profileSeed = path === manifestPaths.at(-1);
  let changed = false;
  if (path.endsWith("package.json") && !profileSeed && manifest.version !== PRODUCT_VERSION) {
    manifest.version = PRODUCT_VERSION;
    changed = true;
  }
  if (manifest.penglaiPlugin?.dshExact && manifest.penglaiPlugin.dshExact !== DSH_VERSION) {
    manifest.penglaiPlugin.dshExact = DSH_VERSION;
    changed = true;
  }
  for (const field of DEPENDENCY_FIELDS) changed = migrateDependencies(manifest[field], { profileSeed }) || changed;
  if (changed && WRITE) {
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    changedPaths.push(path);
  } else if (changed) {
    failures.push(path);
  }
}

if (failures.length > 0) {
  throw new Error(`0.5.10 manifest migration required:\n${failures.join("\n")}`);
}
console.log(JSON.stringify({
  verdict: "PASS",
  command: WRITE ? "migrate:release-manifests" : "verify:release-manifests",
  productVersion: PRODUCT_VERSION,
  dshVersion: DSH_VERSION,
  changed: changedPaths.length,
}));
