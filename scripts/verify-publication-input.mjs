import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { PRODUCT_VERSION, PUBLICATION_TARGET } from "./lib/product.mjs";
import { githubReleaseEndpoint } from "./lib/github-release.mjs";

const source = requireCleanCandidateSource();
if (!source.ok || !source.frozen) throw new Error("publication requires clean exact origin/main");
const runId = process.env.PENGLAI_NATIVE_RUN_ID;
if (!/^[1-9][0-9]*$/.test(runId ?? "")) throw new Error("exact native workflow run ID is required");
const repo = PUBLICATION_TARGET.repo;
function api(path) {
  return JSON.parse(execFileSync("gh", ["api", `repos/${repo}/${path}`], { encoding: "utf8" }));
}
const run = api(`actions/runs/${runId}`);
if (run.head_sha !== source.git.head || run.head_branch !== "main" || run.event !== "workflow_dispatch" || run.path.split("@")[0] !== ".github/workflows/native-release-candidate.yml" || run.status !== "completed" || run.conclusion !== "success") {
  throw new Error("native workflow is not a successful exact-main release build");
}
const artifacts = api(`actions/runs/${runId}/artifacts?per_page=100`).artifacts;
for (const target of ["darwin-aarch64", "darwin-x86_64", "win32-x86_64", "native-evidence-set"]) {
  if (!artifacts.some((row) => row.name === `penglai-${PRODUCT_VERSION}-${target}` && !row.expired)) {
    throw new Error(`native workflow is missing the sealed ${target} artifact`);
  }
}
const runs = api(`actions/workflows/source-ci.yml/runs?head_sha=${source.git.head}&branch=main&event=push&per_page=100`).workflow_runs;
if (!runs.some((row) => row.head_sha === source.git.head && row.status === "completed" && row.conclusion === "success")) {
  throw new Error("exact-main Source CI must pass before publication");
}
const checks = api(`commits/${source.git.head}/check-runs?per_page=100`).check_runs;
if (!checks.some((row) => row.name === "Analyze (javascript-typescript)" && row.app?.id === 15368 && row.status === "completed" && row.conclusion === "success")) {
  throw new Error("exact-main required CodeQL check must pass before publication");
}
const gate = JSON.parse(readFileSync(join(ROOT, "evidence/generated/verify-release.json"), "utf8"));
if (gate.command !== "verify:release" || gate.verdict !== "PASS" || gate.exitCode !== 0 || gate.dryRun !== false || gate.sourceSha !== source.git.head || !gate.records?.length || gate.records.some((row) => row.verdict !== "PASS" || row.exit !== 0)) {
  throw new Error("downloaded complete release aggregate does not match this source");
}
const releasePath = githubReleaseEndpoint(repo, { draft: true, tag: PUBLICATION_TARGET.tag, releaseId: process.env.PENGLAI_RELEASE_ID });
const release = api(releasePath.slice(`repos/${repo}/`.length));
if (release.draft !== true || release.prerelease !== false || release.immutable === true || release.target_commitish !== source.git.head || release.tag_name !== PUBLICATION_TARGET.tag) {
  throw new Error("publication target must be the exact-source mutable draft");
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\nsource_sha=${source.git.head}\n`);
console.log(JSON.stringify({ verdict: "PASS", sourceSha: source.git.head, nativeRunId: Number(runId), releaseId: release.id }));
