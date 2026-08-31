#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const GENERATED = join(ROOT, "evidence", "generated");
const TARGETS = ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"];
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function fail(message) {
  console.error(`aggregate:supply-chain FAIL: ${message}`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label}: ${String(error)}`);
  }
}

const records = TARGETS.map((target) => {
  const path = join(GENERATED, `licenses-${target}.json`);
  if (!existsSync(path)) fail(`missing ${path}`);
  const record = readJson(path, `license inventory ${target}`);
  if (
    record.schema !== 2 ||
    record.sourceSha !== sourceSha ||
    record.target !== target ||
    !Array.isArray(record.production) ||
    !Array.isArray(record.completeInstalled)
  ) {
    fail(`license inventory identity mismatch for ${target}`);
  }
  return record;
});

function mergeRows(field) {
  const merged = new Map();
  for (const [targetIndex, record] of records.entries()) {
    const target = TARGETS[targetIndex];
    for (const row of record[field]) {
      const key = `${row.name}@${row.version}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, { ...row, auditedTargets: [target] });
        continue;
      }
      for (const critical of ["integrity", "declaredLicense", "effectiveLicense", "disposition", "source", "rationale"]) {
        if ((current[critical] ?? null) !== (row[critical] ?? null)) {
          fail(`${field} conflict for ${key}: ${critical} differs on ${target}`);
        }
      }
      current.auditedTargets = [...new Set([...current.auditedTargets, target])].sort();
      merged.set(key, current);
    }
  }
  return [...merged.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

const aggregate = {
  schema: 2,
  sourceSha,
  target: "release-set",
  auditedTargets: TARGETS,
  command: "three-native-target audited manifest union",
  productionComponentCount: 0,
  production: mergeRows("production"),
  completeInstalled: mergeRows("completeInstalled"),
  policyDecisions: records[0].policyDecisions,
  declaredArtifacts: records[0].declaredArtifacts,
};
for (const [index, record] of records.entries()) {
  if (JSON.stringify(record.policyDecisions) !== JSON.stringify(records[0].policyDecisions)) {
    fail(`policy decisions conflict on ${TARGETS[index]}`);
  }
  if (JSON.stringify(record.declaredArtifacts) !== JSON.stringify(records[0].declaredArtifacts)) {
    fail(`declared artifacts conflict on ${TARGETS[index]}`);
  }
}
aggregate.productionComponentCount = aggregate.production.length;
mkdirSync(GENERATED, { recursive: true });
writeFileSync(join(GENERATED, "licenses.json"), `${JSON.stringify(aggregate, null, 2)}\n`);

for (const args of [
  ["scripts/sbom.mjs"],
  ["--import", "tsx", "scripts/third-party-notices.mjs"],
]) {
  const run = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (run.status !== 0) fail(`${args.at(-1)} failed with ${run.status}`);
}

const sbom = readJson(join(GENERATED, "sbom.json"), "aggregate SBOM");
if (sbom.sourceSha !== sourceSha || sbom.target !== "release-set") {
  fail("aggregate SBOM identity mismatch");
}
console.log("aggregate:supply-chain ok", aggregate.production.length, "production components");
