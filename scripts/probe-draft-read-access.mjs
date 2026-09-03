import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubReleaseEndpoint } from "./lib/github-release.mjs";

const contract = JSON.parse(readFileSync("release-contract.json", "utf8"));
const repo = contract.publication.repo;
const endpoint = githubReleaseEndpoint(repo, { draft: true, tag: contract.publication.tag, releaseId: process.env.PENGLAI_RELEASE_ID });
const release = JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
if (!release.draft || release.immutable || release.tag_name !== contract.publication.tag) throw new Error("expected the current mutable draft");
const runId = process.env.PENGLAI_NATIVE_RUN_ID;
if (!/^[1-9][0-9]*$/.test(runId ?? "")) throw new Error("native run ID is required for API access preflight");
function api(path) {
  return JSON.parse(execFileSync("gh", ["api", `repos/${repo}/${path}`], { encoding: "utf8" }));
}
const nativeRun = api(`actions/runs/${runId}`);
if (nativeRun.head_sha !== release.target_commitish) throw new Error("probe run and draft source differ");
const artifacts = api(`actions/runs/${runId}/artifacts?per_page=100`).artifacts;
const checks = api(`commits/${nativeRun.head_sha}/check-runs?per_page=100`).check_runs;
const sourceRuns = api(`actions/workflows/source-ci.yml/runs?head_sha=${nativeRun.head_sha}&branch=main&event=push&per_page=100`).workflow_runs;
if (!artifacts.length || !checks.length || !sourceRuns.length) throw new Error("expected native artifacts, source runs and check records");
const asset = release.assets.find((row) => row.state === "uploaded");
if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error("an uploaded digest-bound draft asset is required");
const temp = mkdtempSync(join(tmpdir(), "penglai-draft-read-"));
try {
  const path = join(temp, "asset.bin");
  const fd = openSync(path, "wx", 0o600);
  try {
    execFileSync("gh", ["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${asset.id}`], { stdio: ["ignore", fd, "pipe"] });
  } finally {
    closeSync(fd);
  }
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.size || `sha256:${sha256}` !== asset.digest) throw new Error("draft asset byte readback mismatch");
  console.log(JSON.stringify({ verdict: "PASS", command: "probe-draft-read-access", evidenceClass: "draft-api-and-byte-access-only", releaseId: release.id, sourceSha: release.target_commitish, nativeArtifacts: artifacts.length, sourceRuns: sourceRuns.length, checks: checks.length, asset: asset.name, size: bytes.length, sha256 }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
