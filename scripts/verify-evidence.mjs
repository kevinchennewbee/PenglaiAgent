import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, gitState, isDocsOnlyRange } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

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

const collect = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "packages/release-identity/src/*.test.ts"],
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
  finish("FAIL", { command: "verify:evidence", reason: "identity tests failed while collecting assertions" });
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
