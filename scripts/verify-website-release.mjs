import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertWebsitePublication,
  parseSha256Sums,
} from "../packages/release-identity/src/website-publication.ts";
import { ROOT } from "./lib/repo.mjs";

const REPO = "kevinchennewbee/PenglaiAgent";
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function fail(message) {
  throw new Error(`verify-website-release: ${message}`);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const token = process.env.GITHUB_TOKEN?.trim();
const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function fetchJson(url, label) {
  const response = await fetch(url, { redirect: "manual", headers: githubHeaders });
  if (response.status !== 200) fail(`${label} returned HTTP ${response.status}`);
  return response.json();
}

async function downloadSmallPublicAsset(asset, label) {
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 * 1024) {
    fail(`${label} public asset size is invalid`);
  }
  let current = asset.browser_download_url;
  for (let hop = 0; hop <= 4; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
      fail(`${label} redirect host refused`);
    }
    const response = await fetch(current, { redirect: "manual" });
    if (response.status === 200) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== asset.size) fail(`${label} public size mismatch`);
      return bytes;
    }
    if (response.status < 300 || response.status >= 400 || hop === 4) fail(`${label} returned HTTP ${response.status}`);
    const location = response.headers.get("location");
    await response.body?.cancel?.();
    if (!location) fail(`${label} redirect is missing Location`);
    current = new URL(location, current).href;
  }
  fail(`${label} exceeded redirect limit`);
}

async function peeledTagCommit(tag) {
  let object = await fetchJson(`https://api.github.com/repos/${REPO}/git/ref/tags/${encodeURIComponent(tag)}`, "tag ref");
  object = object.object;
  for (let depth = 0; object?.type === "tag" && depth < 3; depth += 1) {
    const annotated = await fetchJson(object.url, "annotated tag");
    object = annotated.object;
  }
  if (object?.type !== "commit" || !/^[0-9a-f]{40}$/.test(String(object.sha ?? ""))) fail("tag does not peel to a commit");
  return object.sha;
}

const tag = option("--tag");
if (tag !== "v0.5.9") fail("tag must be exactly v0.5.9");
if (process.env.GITHUB_ACTIONS === "true") {
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_REF !== "refs/heads/main") {
    fail("GitHub deployment must be dispatched from refs/heads/main");
  }
}

const head = git(["rev-parse", "HEAD"]);
const originMain = git(["rev-parse", "refs/remotes/origin/main"]);
if (head !== originMain || (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== head)) {
  fail("website source is not the exact current origin/main commit");
}

const contract = JSON.parse(readFileSync(join(ROOT, "release-contract.json"), "utf8"));
if (contract.version !== "0.5.9" || contract.publication?.tag !== tag || contract.publication?.repo !== REPO) {
  fail("release contract is not exact v0.5.9");
}

const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, "Release");
const peeledSourceSha = await peeledTagCommit(tag);
const currentMain = await fetchJson(`https://api.github.com/repos/${REPO}/git/ref/heads/main`, "main ref");
if (release.tag_name !== tag) fail("Release tag_name does not match v0.5.9");
if (currentMain.object?.type !== "commit" || currentMain.object.sha !== head) {
  fail("website source is no longer the exact current main commit");
}
if (!gitSucceeds(["merge-base", "--is-ancestor", peeledSourceSha, head])) {
  fail("peeled v0.5.9 commit is not an ancestor of the website source");
}
const assets = Array.isArray(release.assets) ? release.assets : [];
const asset = (name) => assets.find((entry) => entry.name === name);
const sumsBytes = await downloadSmallPublicAsset(asset("SHA256SUMS"), "SHA256SUMS");
const manifestBytes = await downloadSmallPublicAsset(asset("release-manifest.json"), "release-manifest.json");
const releaseManifest = JSON.parse(manifestBytes.toString("utf8"));
const changedPaths = git(["diff", "--name-only", `${peeledSourceSha}..${head}`]).split(/\r?\n/).filter(Boolean);
const sums = parseSha256Sums(sumsBytes.toString("utf8"));
const installers = contract.targets.map((target) => {
  const publicAsset = asset(target.installer);
  if (!publicAsset) fail(`missing public installer ${target.installer}`);
  return {
    name: target.installer,
    size: publicAsset.size,
    sha256: sums[target.installer],
  };
});

assertWebsitePublication({
  repo: REPO,
  version: contract.version,
  tag,
  dshVersion: contract.dshVersion,
  peeledSourceSha,
  targetCommitish: release.target_commitish,
  releaseManifestSourceSha: releaseManifest.privateCandidateSourceSha,
  draft: release.draft,
  prerelease: release.prerelease,
  immutable: release.immutable,
  exactAssetNames: contract.exactAssets,
  actualAssetNames: assets.map((entry) => entry.name),
  installers,
  sha256Sums: sums,
  changedPaths,
  files: {
    readme: readFileSync(join(ROOT, "README.md"), "utf8"),
    chinese: readFileSync(join(ROOT, "website/index.html"), "utf8"),
    english: readFileSync(join(ROOT, "website/en/index.html"), "utf8"),
  },
});

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release_sha=${peeledSourceSha}\n`);
console.log(JSON.stringify({
  verdict: "PASS",
  command: "verify-website-release",
  tag,
  releaseSha: peeledSourceSha,
  siteSourceSha: head,
  changedPaths,
}));
