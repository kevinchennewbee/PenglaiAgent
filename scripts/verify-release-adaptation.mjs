import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DSH_EXTERNAL_PACKAGES, DSH_REQUIRED_PACKAGES, validateCohortSnapshot, verifyCohortLock } from "./lib/dsh-npm-cohort.mjs";
import { readReleaseIdentityPins } from "./lib/release-pins-source.mjs";
import { assertNextUpdaterSequence } from "./lib/native-upgrade-set.mjs";
import { ROOT } from "./lib/repo.mjs";

const BASE = "87f6aec04b2b77d45a5c2b280d1b75332a80eb33";
const PUBLISHED_0512 = "54a0ef30afa4e3d653e400a637d4aa8eb4abbb75";
const PUBLISHED_060 = "7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316";
const PUBLISHED_060_RECORDS = "9daf5fff8f6818db5bddaf21122e777b245622f4";
const PUBLISHED_061 = "7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b";
const PUBLISHED_061_RECORDS = "67d0d52f1610e13e461499a2731debfa83bfead1";
const PUBLISHED_062 = "83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6";
const PUBLISHED_062_RECORDS = "a7c76535e3cc81c5467239dc091a4593b3ffbfd1";
const PUBLISHED_063 = "1c103212ad25b7d2a0061c2c4bfa595cd413c138";
// The 0.6.3 planning records were the last ones read as present tense, so they
// carry an outcome banner and their bodies are kept verbatim.
//
// The base must be a commit that exists on `main`. It was first written as the
// branch commit that added the banner, which the squash merge removed from main
// — the next native run failed with `fatal: bad object` before it built
// anything. `fc50dc28` is the merge that landed the banner.
const PUBLISHED_063_RECORDS = "fc50dc284e3ffb10fcf86f9c7fcb04fff35849d8";
const PUBLISHED_065 = "ce8eb049523e786e65f5bfdb20f64d9e6ab4c7e8";
const DSH_TREE = "2144281b72e5cfa3c4ad060d77622133d7f4e7c0";
const pins = readReleaseIdentityPins();
const failures = [];

function fail(message) {
  failures.push(message);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    // A base commit that is not an ancestor of HEAD — one a squash merge removed,
    // or a shallow checkout — used to surface as an unhandled execFileSync stack
    // that named neither the guard nor the reason. Report what could not be
    // compared instead; the recorded failure still fails the gate.
    const detail = String(error.stderr ?? error.message ?? error).trim().split("\n")[0];
    fail(`git ${args.join(" ")} failed: ${detail}`);
    return "";
  }
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), "utf8"));
}

try {
  execFileSync("git", ["merge-base", "--is-ancestor", BASE, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.6.5 must descend from published 0.5.11 ${BASE}`);
}
try {
  execFileSync("git", ["merge-base", "--is-ancestor", PUBLISHED_0512, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.6.5 must descend from published 0.5.12 ${PUBLISHED_0512}`);
}
try {
  execFileSync("git", ["merge-base", "--is-ancestor", PUBLISHED_060, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.6.5 must descend from published 0.6.0 ${PUBLISHED_060}`);
}
try {
  execFileSync("git", ["merge-base", "--is-ancestor", PUBLISHED_061, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.6.5 must descend from published 0.6.1 ${PUBLISHED_061}`);
}
try {
  execFileSync("git", ["merge-base", "--is-ancestor", PUBLISHED_062, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.6.5 must descend from published 0.6.2 ${PUBLISHED_062}`);
}
try {
  execFileSync("git", ["merge-base", "--is-ancestor", PUBLISHED_063, "HEAD"], { cwd: ROOT, stdio: "ignore" });
} catch {
  fail(`0.6.5 must descend from published 0.6.3 ${PUBLISHED_063}`);
}

const protectedPaths = [
  "docs/0.5.8",
  "docs/0.5.9",
  "docs/0.5.10",
  "docs/PUBLICATION_MANIFEST_0.5.8.md",
  "docs/RELEASE_NOTES_0.5.8.md",
  "docs/PUBLICATION_MANIFEST_0.5.10.md",
  "docs/RELEASE_NOTES_0.5.10.md",
  "docs/PUBLICATION_MANIFEST_0.5.11.md",
];
const protectedChanges = git(["diff", "--name-only", BASE, "--", ...protectedPaths]).split("\n").filter(Boolean);
if (protectedChanges.length > 0) {
  fail(`0.6.5 rewrote immutable published history: ${protectedChanges.join(", ")}`);
}
const protected060 = git([
  "diff",
  "--name-only",
  PUBLISHED_060_RECORDS,
  "--",
  "docs/0.6.0",
  "docs/PUBLICATION_MANIFEST_0.6.0.md",
  "docs/RELEASE_NOTES_0.6.0.md",
  "docs/PUBLICATION_0.6.0.md",
]).split("\n").filter(Boolean);
if (protected060.length > 0) {
  fail(`0.6.5 rewrote immutable 0.6.0 publication records: ${protected060.join(", ")}`);
}
const protected061 = git([
  "diff",
  "--name-only",
  PUBLISHED_061_RECORDS,
  "--",
  "docs/0.6.1",
  "docs/PUBLICATION_MANIFEST_0.6.1.md",
  "docs/RELEASE_NOTES_0.6.1.md",
]).split("\n").filter(Boolean);
if (protected061.length > 0) {
  fail(`0.6.5 rewrote immutable 0.6.1 publication records: ${protected061.join(", ")}`);
}
const protected062 = git([
  "diff",
  "--name-only",
  PUBLISHED_062_RECORDS,
  "--",
  "docs/0.6.2",
  "docs/PUBLICATION_MANIFEST_0.6.2.md",
  "docs/RELEASE_NOTES_0.6.2.md",
]);
if (protected062.split("\n").filter(Boolean).length > 0) {
  fail(`0.6.5 rewrote immutable 0.6.2 publication records: ${protected062}`);
}
const protected063 = git([
  "diff",
  "--name-only",
  PUBLISHED_063_RECORDS,
  "--",
  "docs/0.6.3",
  "docs/PUBLICATION_MANIFEST_0.6.3.md",
  "docs/RELEASE_NOTES_0.6.3.md",
]).split("\n").filter(Boolean);
if (protected063.length > 0) {
  fail(`0.6.5 rewrote immutable 0.6.3 publication records: ${protected063.join(", ")}`);
}
const protected065 = git([
  "diff", "--name-only", PUBLISHED_065, "--",
  "docs/0.6.5", "docs/PUBLICATION_MANIFEST_0.6.5.md",
  "docs/RELEASE_NOTES_0.6.5.md", "docs/PUBLICATION_0.6.5.md",
]).split("\n").filter(Boolean);
if (protected065.length > 0) fail(`0.6.6 rewrote immutable 0.6.5 publication records: ${protected065.join(", ")}`);


if (pins.productVersion !== "0.6.6" || pins.dsh !== "0.1.7-alpha.2") {
  fail(`release pins are ${pins.productVersion}/${pins.dsh}, expected 0.6.6/0.1.7-alpha.2`);
}
try {
  assertNextUpdaterSequence(readJson("docs/0.6.6/UPGRADE_SOURCES.json"), pins.updaterSequence);
} catch (error) {
  fail(error.message);
}
if (existsSync(join(ROOT, ".pnpmfile.mjs"))) fail("0.6.5 must not activate the historical alpha.1 source resolver");

const snapshotPath = join(ROOT, "docs/0.6.6/DSH_NPM_COHORT.json");
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

const packagedBytes = readJson("docs/0.6.6/DSH_PACKAGED_BYTES.json");
if (
  packagedBytes.schema !== 2 ||
  packagedBytes.dsh !== pins.dsh ||
  packagedBytes.mode !== "official-npm-cohort-no-source-patch" ||
  packagedBytes.source?.tag !== pins.dshSource.tag ||
  packagedBytes.source?.commit !== pins.dshSource.commit ||
  packagedBytes.source?.tree !== DSH_TREE ||
  packagedBytes.source?.cohortManifest !== "docs/0.6.6/DSH_NPM_COHORT.json"
) {
  fail("DSH packaged-byte policy identity is not the fixed 0.1.7-alpha.2 source and npm cohort");
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
    fail(`packaged byte ${row.id} is missing from the installed 0.1.7-alpha.2 graph`);
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
for (const required of ["@deepseek-ai/dsh", ...DSH_REQUIRED_PACKAGES].map((name) => `${name}@${pins.dsh}`)) {
  if (!lock.includes(required)) fail(`active lock is missing ${required}`);
}
if (lock.includes("@deepseek-ai/dsh@0.1.2-rc.1")) fail("active lock still contains 0.1.2-rc.1 DSH");
if (lock.includes("0.1.6-alpha.2")) fail("active lock still contains leftover 0.1.6-alpha.2");
const cordisVersions = new Set([...lock.matchAll(/@deepseek-ai\/cordis@(\d+\.\d+\.\d+)/g)].map((match) => match[1]));
if (cordisVersions.size !== 1 || !cordisVersions.has("4.0.4")) {
  fail(`active lock has unexpected Cordis versions: ${[...cordisVersions].join(", ") || "none"}`);
}

const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
const cohort = new Set(snapshot.packages.map((entry) => `${entry.name}@${entry.version}`));
for (const [name, row] of Object.entries(DSH_EXTERNAL_PACKAGES)) cohort.add(`${name}@${row.version}`);
const ageExcludes = [...workspace.matchAll(/^  - '(@deepseek-ai\/[^']+)'$/gm)].map((match) => match[1]);
if (ageExcludes.length === 0) fail("minimum release age exclusions for the new cohort are missing");
for (const spec of ageExcludes) {
  if (!cohort.has(spec)) fail(`minimum release age exclusion is outside the verified cohort: ${spec}`);
}

const manifestGate = spawnSync(process.execPath, [join(ROOT, "scripts/migrate-release-manifests.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (manifestGate.status !== 0) fail(manifestGate.stderr || manifestGate.stdout || "0.6.5 manifest gate failed");

for (const relative of [
  "packages/dsh-bridge/src/index.ts",
  "packages/runtime/src/index.ts",
  "packages/runtime/src/plugin-catalog.ts",
  "packages/plugin-registry/src/catalog-schema.ts",
]) {
  const source = readFileSync(join(ROOT, relative), "utf8");
  if (!source.includes("0.1.7-alpha.2")) fail(`${relative} is not on 0.1.7-alpha.2`);
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
