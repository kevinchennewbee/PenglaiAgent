import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  discoverAlpha2SourcePackages,
  DSH_ALPHA2,
  readRootDistTags,
  resolveRegistryEntries,
  validateCohortSnapshot,
  verifySnapshotAgainstRegistry,
} from "./lib/dsh-npm-cohort.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SNAPSHOT = resolve(ROOT, "docs", "0.5.9", "DSH_NPM_COHORT.json");
const args = process.argv.slice(2);
const write = args.includes("--write");
const live = args.includes("--live");
const upstreamIndex = args.indexOf("--upstream");
const upstreamRoot = upstreamIndex >= 0 ? args[upstreamIndex + 1] : process.env.PENGLAI_DSH_UPSTREAM;

if (write) {
  if (!upstreamRoot) throw new Error("--write requires --upstream <path> or PENGLAI_DSH_UPSTREAM");
  const commit = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (commit !== DSH_ALPHA2.commit) throw new Error(`upstream HEAD ${commit}, expected ${DSH_ALPHA2.commit}`);
  const sourcePackages = discoverAlpha2SourcePackages(upstreamRoot);
  const packages = await resolveRegistryEntries(sourcePackages);
  const rootRegistry = await readRootDistTags();
  const snapshot = {
    schemaVersion: 1,
    source: {
      repository: "https://github.com/deepseek-ai/DeepSeek-Harness.git",
      tag: DSH_ALPHA2.tag,
      commit: DSH_ALPHA2.commit,
    },
    version: DSH_ALPHA2.version,
    distTags: rootRegistry.distTags,
    publishedAt: rootRegistry.publishedAt,
    packages,
  };
  const summary = validateCohortSnapshot(snapshot);
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ verdict: "PASS", command: "prepare:dsh-npm-cohort", ...summary, snapshot: SNAPSHOT }));
} else {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const summary = live ? await verifySnapshotAgainstRegistry(snapshot) : validateCohortSnapshot(snapshot);
  console.log(JSON.stringify({ verdict: "PASS", command: live ? "verify:dsh-npm-cohort:live" : "verify:dsh-npm-cohort", ...summary }));
}
