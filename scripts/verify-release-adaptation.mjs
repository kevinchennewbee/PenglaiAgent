import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCohortSnapshot, verifyCohortLock } from "./lib/dsh-npm-cohort.mjs";
import { readReleaseIdentityPins } from "./lib/release-pins-source.mjs";
import { ROOT } from "./lib/repo.mjs";

const BASE = "8f50d0e998f00b9f4b52e08a36738fbd27760e24";
const pins = readReleaseIdentityPins();
const failures = [];

function fail(message) {
  failures.push(message);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), "utf8"));
}

try {
  execFileSync("git", ["merge-base", "--is-ancestor", BASE, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.5.10 preview must descend from ${BASE}`);
}

const protectedPaths = [
  "docs/0.5.8",
  "docs/0.5.9",
  "docs/PUBLICATION_MANIFEST_0.5.8.md",
  "docs/RELEASE_NOTES_0.5.8.md",
];
const protectedChanges = git(["diff", "--name-only", BASE, "--", ...protectedPaths]).split("\n").filter(Boolean);
if (protectedChanges.length > 0) fail(`0.5.10 development rewrote immutable 0.5.8 history: ${protectedChanges.join(", ")}`);

if (pins.productVersion !== "0.5.10" || pins.dsh !== "0.1.2-rc.1") {
  fail(`release pins are ${pins.productVersion}/${pins.dsh}, expected 0.5.10/0.1.2-rc.1`);
}
if (existsSync(join(ROOT, ".pnpmfile.mjs"))) fail("0.5.10 must not activate the historical alpha.1 source resolver");

const snapshotPath = join(ROOT, "docs/0.5.10/DSH_NPM_COHORT.json");
const snapshotBytes = readFileSync(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
try {
  validateCohortSnapshot(snapshot);
} catch (error) {
  fail(`DSH npm cohort invalid: ${error.message}`);
}
const snapshotSha256 = createHash("sha256").update(snapshotBytes).digest("hex");
if (snapshotSha256 !== pins.dshSource.closureManifestSha256) {
  fail(`DSH npm cohort digest ${snapshotSha256} != release pin ${pins.dshSource.closureManifestSha256}`);
}

const packagedBytes = readJson("docs/0.5.10/DSH_ALPHA_PACKAGED_BYTES.json");
if (
  packagedBytes.schema !== 2 ||
  packagedBytes.dsh !== pins.dsh ||
  packagedBytes.mode !== "official-npm-cohort-no-source-patch" ||
  packagedBytes.source?.tag !== pins.dshSource.tag ||
  packagedBytes.source?.commit !== pins.dshSource.commit ||
  packagedBytes.source?.tree !== "27ab636bb3d77e698f5637e518db44ae1f61e262" ||
  packagedBytes.source?.cohortManifest !== "docs/0.5.10/DSH_NPM_COHORT.json"
) {
  fail("DSH packaged-byte policy identity is not the fixed rc.1 source and npm cohort");
}
const cohortByName = new Map(snapshot.packages.map((entry) => [entry.name, entry]));
for (const row of packagedBytes.officialBytes ?? []) {
  const separator = String(row.sourcePackage ?? "").lastIndexOf("@");
  const packageName = String(row.sourcePackage ?? "").slice(0, separator);
  const packageVersion = String(row.sourcePackage ?? "").slice(separator + 1);
  const cohortRow = cohortByName.get(packageName);
  if (
    !cohortRow ||
    packageVersion !== snapshot.version ||
    cohortRow.integrity !== row.integrity
  ) {
    fail(`packaged byte ${row.id} is not backed by the exact npm cohort integrity`);
    continue;
  }
  const target = join(ROOT, row.relative);
  if (!existsSync(target)) {
    fail(`packaged byte ${row.id} is missing from the installed rc.1 graph`);
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(target)).digest("hex");
  if (actual !== row.sha256) fail(`packaged byte ${row.id} digest drifted: ${actual}`);
}
for (const asset of packagedBytes.brandAssets ?? []) {
  const target = join(ROOT, asset.source);
  if (!existsSync(target)) {
    fail(`brand asset ${asset.name} is missing`);
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(target)).digest("hex");
  if (actual !== asset.sha256) fail(`brand asset ${asset.name} digest drifted: ${actual}`);
}

const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
try { verifyCohortLock(snapshot, lock); } catch (error) { fail(error.message); }
for (const forbidden of ["0.1.2-alpha.1", "penglai-dsh-source", "@deepseek-ai/dsh-client-runtime", "@deepseek-ai/cordis@4.0.1"]) {
  if (lock.includes(forbidden)) fail(`active lock contains forbidden ${forbidden}`);
}
for (const required of [
  "@deepseek-ai/dsh@0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-schedule@0.1.2-rc.1",
  "@deepseek-ai/dsh-deque@0.1.2-rc.1",
  "@deepseek-ai/dsh-util-time@0.1.2-rc.1",
  "@deepseek-ai/dsh-util-values@0.1.2-rc.1",
]) {
  if (!lock.includes(required)) fail(`active lock is missing ${required}`);
}
const cordisVersions = new Set([...lock.matchAll(/@deepseek-ai\/cordis@(\d+\.\d+\.\d+)/g)].map((match) => match[1]));
if (cordisVersions.size !== 1 || !cordisVersions.has("4.0.2")) {
  fail(`active lock has unexpected Cordis versions: ${[...cordisVersions].join(", ") || "none"}`);
}

const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
const cohort = new Set(snapshot.packages.map((entry) => `${entry.name}@${entry.version}`));
const ageExcludes = [...workspace.matchAll(/^  - '(@deepseek-ai\/[^']+)'$/gm)].map((match) => match[1]);
if (ageExcludes.length === 0) fail("minimum release age exclusions for the new cohort are missing");
for (const spec of ageExcludes) {
  if (!cohort.has(spec)) fail(`minimum release age exclusion is outside the verified cohort: ${spec}`);
}

const manifestGate = spawnSync(process.execPath, [join(ROOT, "scripts/migrate-release-manifests.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (manifestGate.status !== 0) fail(manifestGate.stderr || manifestGate.stdout || "0.5.10 manifest gate failed");

for (const relative of [
  "packages/dsh-bridge/src/index.ts",
  "packages/runtime/src/index.ts",
  "packages/runtime/src/plugin-catalog.ts",
  "packages/plugin-registry/src/catalog-schema.ts",
]) {
  const source = readFileSync(join(ROOT, relative), "utf8");
  if (source.includes("0.1.2-alpha.1") || !source.includes("0.1.2-rc.1")) fail(`${relative} is not on rc.1`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ verdict: "FAIL", command: "verify:release-adaptation", failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  verdict: "PASS",
  command: "verify:release-adaptation",
  productVersion: pins.productVersion,
  dsh: pins.dsh,
  cohortPackages: snapshot.packages.length,
  officialPackagedBytes: packagedBytes.officialBytes?.length ?? 0,
  minimumReleaseAgeExcludes: ageExcludes.length,
}));
