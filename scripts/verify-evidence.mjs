import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, gitState, isDocsOnlyRange } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { evidenceName, missingNativeInstalledTargets, RELEASE_TARGETS } from "./lib/release-targets.mjs";

const git = gitState();
const identity = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);
const registryMarkdown = readFileSync(join(ROOT, "docs/ACCEPTANCE.md"), "utf8");
let entries;
try {
  entries = identity.assertRegistryConsistent(registryMarkdown);
} catch (err) {
  finish("FAIL", { command: "verify:evidence", reason: String(err) });
}

const evidenceDir = join(ROOT, "evidence/generated");
mkdirSync(evidenceDir, { recursive: true });
const unitAssertionFile = join(evidenceDir, "unit-assertions.jsonl");
writeFileSync(unitAssertionFile, "");

/**
 * Collector suites.
 *
 * Only suites that actually emit assertions belong here. The list used to run
 * `packages/memory/src/r55-memory.test.ts` and
 * `packages/office/src/r55-office.test.ts`; neither calls `recordAssertion`, and
 * the office package is excluded from `pnpm-workspace.yaml` entirely, so the
 * suite could not even resolve its imports. That made this gate fail on every
 * run for a reason unrelated to evidence, which is how a blocking gate gets
 * ignored. The evidence-emitting suites are `packages/release-identity/src/*.test.ts`
 * plus the DRIFT probes and the installed runner, which are invoked separately.
 */
const COLLECTOR_SUITES = ["packages/release-identity/src/*.test.ts"];

const collect = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...COLLECTOR_SUITES],
  {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PENGLAI_EVIDENCE_DIR: unitAssertionFile,
    },
  },
);
if (collect.status !== 0) {
  process.stderr.write(collect.stdout || "");
  process.stderr.write(collect.stderr || "");
  // A collector suite that cannot run is a blocked evaluation, not a failed
  // assertion. BLOCKED (exit 4) still stops publication, but it records "not
  // evaluated on this host" rather than "evaluated and wrong". A missing local
  // dependency is an environment condition; claiming it as an evidence FAIL
  // would be a false statement about the product.
  finish("BLOCKED", {
    command: "verify:evidence",
    reason: "collector suites could not run on this host",
    suites: COLLECTOR_SUITES,
  });
}

/**
 * Drift probes are collected here so their records exist for the release
 * aggregate. They are run with `--collect-only`, which writes assertions without
 * printing; the probe verdict is deliberately not allowed to change the
 * publication decision here (an unreachable vendor must not stop a complete
 * release), but a probe that never ran leaves `R50-DRIFT-001..005` without
 * evidence, which this gate reports as INCOMPLETE.
 */
const driftAssertionFile = join(evidenceDir, "drift-assertions.jsonl");
writeFileSync(driftAssertionFile, "");
const driftCollect = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/verify-drift.mjs", "--collect-only"],
  {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PENGLAI_EVIDENCE_DIR: driftAssertionFile },
  },
);
if (driftCollect.status !== 0) {
  // Recorded, not fatal: the drift verdict is published, not gating. The
  // assertion records it did write are still read below.
  process.stderr.write(driftCollect.stdout || "");
  process.stderr.write(driftCollect.stderr || "");
}

function readAssertions(filename) {
  const path = join(evidenceDir, filename);
  if (!existsSync(path)) return [];
  const records = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

const collections = [
  { file: "unit-assertions.jsonl", class: "unit-suite" },
  { file: "contract-assertions.jsonl", class: "contract-suite" },
  { file: "artifact-assertions.jsonl", class: "artifact-runner" },
  { file: "installed-assertions.jsonl", class: "installed-runner" },
  { file: "live-assertions.jsonl", class: "live-runner" },
  { file: "soak-assertions.jsonl", class: "soak-runner" },
  { file: "export-assertions.jsonl", class: "export-runner" },
  { file: "drift-assertions.jsonl", class: "drift-runner" },
];
const records = collections.flatMap((entry) => identity.tagCollection(readAssertions(entry.file), entry.class));

const imported = [];
const dmgPath = join(evidenceDir, "local-dmg.json");
const installedPath = join(evidenceDir, "installed-e2e.json");
const soakPath = join(evidenceDir, "soak.json");
const exportPath = join(evidenceDir, "public-export.json");
const currentDmg = existsSync(dmgPath) ? JSON.parse(readFileSync(dmgPath, "utf8")) : null;
const currentExactDmg =
  currentDmg?.sha256 &&
  (currentDmg.sourceSha === git.head || isDocsOnlyRange(currentDmg.sourceSha, git.head))
    ? currentDmg
    : null;
const currentArtifactByTarget = {};
if (currentExactDmg) currentArtifactByTarget["darwin-aarch64"] = currentExactDmg.sha256;
for (const target of RELEASE_TARGETS) {
  const installerEvidence = join(evidenceDir, evidenceName("local-installer", target));
  if (!existsSync(installerEvidence)) continue;
  const rec = JSON.parse(readFileSync(installerEvidence, "utf8"));
  if (rec?.sha256 && (rec.sourceSha === git.head || isDocsOnlyRange(rec.sourceSha, git.head))) {
    currentArtifactByTarget[target] = rec.sha256;
  }
}
const installedPresent = RELEASE_TARGETS.filter((target) => existsSync(join(evidenceDir, evidenceName("installed-e2e", target))));
const installedMissing = missingNativeInstalledTargets(installedPresent);
if (installedMissing.length) {
  imported.push({
    kind: "installed-set",
    imported: false,
    verdict: "INCOMPLETE",
    reason: `missing installed evidence for ${installedMissing.join(",")}`,
  });
}

function importFresh(kind, extra) {
  const bound = identity.bindArtifactFreshness({ candidateSha: git.head, ...extra });
  imported.push({ kind, imported: bound.ok, verdict: bound.verdict, reason: bound.reason });
  return bound;
}
if (existsSync(installedPath) && currentExactDmg) {
  const rec = JSON.parse(readFileSync(installedPath, "utf8"));
  importFresh("installed", {
    evidenceSourceSha: rec.sourceSha ?? currentExactDmg.sourceSha,
    evidenceArtifactSha256: rec.installerSha256,
    currentArtifactSha256: currentExactDmg.sha256,
  });
}
if (existsSync(soakPath) && currentExactDmg) {
  const rec = JSON.parse(readFileSync(soakPath, "utf8"));
  importFresh("soak", {
    evidenceSourceSha: rec.sourceSha ?? currentExactDmg.sourceSha,
    currentArtifactSha256: currentExactDmg.sha256,
    soakArtifactSha256: rec.installerSha256,
    soakSamples: rec.samplesCovered ?? rec.sampleSet ?? [],
  });
}
if (existsSync(exportPath)) {
  const rec = JSON.parse(readFileSync(exportPath, "utf8"));
  if (rec.privateCandidateSourceSha === git.head) {
    importFresh("public-export", {
      exportSourceSha: rec.privateCandidateSourceSha,
      exportDirty: rec.treeDirty === true,
    });
  } else {
    imported.push({
      kind: "public-export",
      imported: false,
      verdict: "INCOMPLETE",
      reason: "public-export is not bound to current HEAD",
    });
  }
}

try {
  identity.assertNoFanOut(records);
  for (const record of records) identity.assertNativeHonest(record);
} catch (err) {
  finish("FAIL", { command: "verify:evidence", reason: String(err) });
}

const manifest = identity.evaluateEvidenceV3({
  registry: entries,
  records,
  candidateSha: git.head,
  currentArtifactByTarget,
});
const out = {
  ...manifest,
  schemaVersion: identity.EVIDENCE_SCHEMA_V3,
  release: identity.PRODUCT_VERSION,
  runId: "verify-evidence",
  generatedFromRunner: true,
  hardcodedPass: false,
  collections: collections.map((entry) => ({
    file: entry.file,
    class: entry.class,
    records: readAssertions(entry.file).length,
  })),
  imported,
  engine: "v3",
};
writeFileSync(join(evidenceDir, "evidence-summary.json"), `${JSON.stringify(out, null, 2)}\n`);
finish(out.verdict, { command: "verify:evidence", totals: out.totals, engine: "v3" });
