import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASE = "143482bf799b98734a70f74d38acb8932ed7864f";
const SOURCE_TAG = "dsh-v0.1.2-alpha.1";
const SOURCE_COMMIT = "cd5ef8148158c3a752a658978873241fdf8e2bbc";
const SOURCE_TREE = "a712eec535b48badc4fefb4df5176a7002e4280b";
const RELEASE_DSH = "0.1.1-rc.2";
const RETIRED_CHANNEL_GATE = join(ROOT, "scripts/verify-retired-channel-absence.mjs");
const MIGRATION_INVENTORY_GATE = join(ROOT, "scripts/verify-058-migration-inventory.mjs");
const OVERLAY_MAP_GATE = join(ROOT, "scripts/verify-058-overlay-map.mjs");
const IM_SUPPORT_TRUTH_GATE = join(ROOT, "scripts/verify-im-support-truth.mjs");

const failures = [];

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function fail(message) {
  failures.push(message);
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), "utf8"));
}

function dependenciesOf(manifest) {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
}

try {
  git(["cat-file", "-e", `${BASE}^{commit}`]);
  if (git(["merge-base", "--is-ancestor", BASE, "HEAD"], { encoding: "utf8" }) !== "") {
    // A successful merge-base ancestry check intentionally has no output.
  }
} catch {
  fail(`preview HEAD must descend from recorded main base ${BASE}`);
}

const protectedPaths = [
  ".github/workflows/deploy-website.yml",
  ".github/workflows/native-release-candidate.yml",
  "README.md",
  "SECURITY.md",
  "docs/0.5.7",
  "docs/ARCHITECTURE.md",
  "docs/IM_PLUGIN.md",
  "docs/PRODUCT.md",
  "docs/PUBLICATION_0.5.7.md",
  "docs/PUBLICATION_MANIFEST_0.5.7.md",
  "docs/RELEASE_NOTES_0.5.7.md",
  "docs/SECURITY.md",
  "packages/release-identity/src/pins.ts",
  "release-contract.json",
  "release-info.json",
  "website",
];

const protectedChanges = git(["diff", "--name-only", BASE, "--", ...protectedPaths])
  .split("\n")
  .filter(Boolean);
if (protectedChanges.length > 0) {
  fail(`preview preparation changed protected 0.5.7/public surfaces: ${protectedChanges.join(", ")}`);
}

const rootManifest = readJson("package.json");
if (rootManifest.version !== "0.5.7") fail(`root product version is ${rootManifest.version}, expected 0.5.7`);
if (rootManifest.packageManager !== "pnpm@10.14.0") {
  fail(`Penglai package manager changed to ${rootManifest.packageManager}`);
}

const manifestPaths = git(["ls-files", "--cached", "--others", "--exclude-standard"])
  .split("\n")
  .filter((path) => /^(?:package|apps\/[^/]+\/package|packages\/[^/]+\/package)\.json$/.test(path))
  .filter((path) => existsSync(join(ROOT, path)));
for (const path of manifestPaths) {
  const manifest = readJson(path);
  for (const [name, spec] of Object.entries(dependenciesOf(manifest))) {
    if (!name.startsWith("@deepseek-ai/dsh")) continue;
    if (spec !== RELEASE_DSH) {
      fail(`${path} uses unpublished or non-release DSH dependency ${name}@${spec}`);
    }
    if (/^(?:file:|link:|git(?:\+|:)|https?:)/.test(spec)) {
      fail(`${path} uses a forbidden source/path DSH dependency ${name}@${spec}`);
    }
  }
}

const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
if (lock.includes("0.1.2-alpha.1")) {
  fail("pnpm-lock.yaml contains 0.1.2-alpha.1 before official package reconciliation");
}
if (/deepseek[^\n]*(?:file:|link:|git\+|github\.com\/deepseek-ai\/deepseek-harness)/i.test(lock)) {
  fail("pnpm-lock.yaml contains a source/path DSH dependency");
}

const baseline = readFileSync(join(ROOT, "docs/0.5.8/DSH_SOURCE_BASELINE.md"), "utf8");
for (const fixed of [SOURCE_TAG, SOURCE_COMMIT, SOURCE_TREE]) {
  if (!baseline.includes(fixed)) fail(`source baseline document is missing ${fixed}`);
}

const decisionLog = readFileSync(join(ROOT, "docs/decisions.md"), "utf8");
if (!decisionLog.includes("D-063") || !decisionLog.includes(SOURCE_COMMIT)) {
  fail("D-063 does not bind the fixed DSH source commit");
}

try {
  execFileSync(process.execPath, [RETIRED_CHANNEL_GATE], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const detail = error && typeof error === "object" && "stderr" in error
    ? String(error.stderr).trim()
    : "no diagnostic output";
  fail(`retired channel absence gate failed: ${detail}`);
}

try {
  execFileSync(process.execPath, [MIGRATION_INVENTORY_GATE], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const detail = error && typeof error === "object" && "stderr" in error
    ? String(error.stderr).trim()
    : "no diagnostic output";
  fail(`migration inventory gate failed: ${detail}`);
}

try {
  execFileSync(process.execPath, [OVERLAY_MAP_GATE], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const detail = error && typeof error === "object" && "stderr" in error
    ? String(error.stderr).trim()
    : "no diagnostic output";
  fail(`overlay map gate failed: ${detail}`);
}

try {
  execFileSync(process.execPath, [IM_SUPPORT_TRUTH_GATE], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const detail = error && typeof error === "object" && "stderr" in error
    ? String(error.stderr).trim()
    : "no diagnostic output";
  fail(`IM support truth gate failed: ${detail}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema: 1,
    gate: "Penglai-0.5.8-preview",
    result: "FAIL",
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema: 1,
  gate: "Penglai-0.5.8-preview",
  result: "PASS",
  base: BASE,
  head: git(["rev-parse", "HEAD"]),
  sourceBaseline: { tag: SOURCE_TAG, commit: SOURCE_COMMIT, tree: SOURCE_TREE },
  productDshPin: RELEASE_DSH,
  protectedReleaseSurfaces: "unchanged",
}, null, 2));
