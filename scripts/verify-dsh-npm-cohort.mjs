import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  discoverSourcePackages,
  DSH_UPSTREAM,
  readRootDistTags,
  readTarballSha256,
  resolveRegistryEntries,
  validateCohortSnapshot,
  verifySnapshotAgainstRegistry,
} from "./lib/dsh-npm-cohort.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SNAPSHOT = resolve(ROOT, "docs", "0.5.10", "DSH_NPM_COHORT.json");
const args = process.argv.slice(2);
const write = args.includes("--write");
const live = args.includes("--live");
const upstreamIndex = args.indexOf("--upstream");
const upstreamRoot = upstreamIndex >= 0 ? args[upstreamIndex + 1] : process.env.PENGLAI_DSH_UPSTREAM;

if (write) {
  if (!upstreamRoot) throw new Error("--write requires --upstream <path> or PENGLAI_DSH_UPSTREAM");
  const commit = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (commit !== DSH_UPSTREAM.commit) throw new Error(`upstream HEAD ${commit}, expected ${DSH_UPSTREAM.commit}`);
  const sourcePackages = discoverSourcePackages(upstreamRoot);
  const packages = await resolveRegistryEntries(sourcePackages);
  const rootRegistry = await readRootDistTags();
  const rootPackage = packages.find((entry) => entry.name === "@deepseek-ai/dsh");
  const rootTarballSha256 = await readTarballSha256(rootPackage.tarball);
  const snapshot = {
    schemaVersion: 1,
    source: {
      repository: "https://github.com/deepseek-ai/DeepSeek-Harness.git",
      tag: DSH_UPSTREAM.tag,
      commit: DSH_UPSTREAM.commit,
    },
    version: DSH_UPSTREAM.version,
    rootTarballSha256,
    upstreamFacts: {
      welcomeNotice: DSH_UPSTREAM.welcomeNotice,
    },
    distTags: rootRegistry.distTags,
    publishedAt: rootRegistry.publishedAt,
    packages,
  };
  const summary = validateCohortSnapshot(snapshot);
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ verdict: "PASS", command: "prepare:dsh-npm-cohort", ...summary, snapshot: SNAPSHOT }));
} else {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  if (live && !upstreamRoot) throw new Error("--live requires --upstream <path> or PENGLAI_DSH_UPSTREAM");
  if (live) {
    const commit = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (commit !== DSH_UPSTREAM.commit) throw new Error(`upstream HEAD ${commit}, expected ${DSH_UPSTREAM.commit}`);
    const dirty = execFileSync("git", ["-C", upstreamRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
    if (dirty) throw new Error("upstream checkout must be clean for live cohort verification");
  }
  const summary = live
    ? await verifySnapshotAgainstRegistry(snapshot, { sourceRoot: upstreamRoot })
    : validateCohortSnapshot(snapshot);
  console.log(JSON.stringify({ verdict: "PASS", command: live ? "verify:dsh-npm-cohort:live" : "verify:dsh-npm-cohort", ...summary }));
}
