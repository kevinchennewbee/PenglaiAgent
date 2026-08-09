#!/usr/bin/env node
/**
 * Generate a tauri-plugin-updater `latest.json` manifest for the Penglai 0.4
 * desktop release.
 *
 * Two modes:
 *
 *   1. From a local directory of built artifacts (used in CI right after the
 *      Tauri build, before/after uploading assets):
 *
 *        node generate-latest-json.mjs --from-dir dist --version 0.4.0
 *
 *      Scans `dist/` for the per-platform updater bundle + its `.sig` file,
 *      reads the signature text, and writes `latest.json`.
 *
 *   2. From a published GitHub release (used to regenerate the manifest from
 *      assets already on a release, e.g. after a manual re-upload):
 *
 *        node generate-latest-json.mjs --from-release v0.4.0
 *
 *      Fetches the release assets via the GitHub API, downloads each `.sig`
 *      (raw), and writes `latest.json`. Set GH_TOKEN to avoid rate limits.
 *
 * Platform artifact naming convention (matches the CI workflow):
 *   darwin-aarch64: Penglai_<ver>_macos_aarch64.app.tar.gz[.sig]
 *   darwin-x86_64:  Penglai_<ver>_macos_x64.app.tar.gz[.sig]
 *   windows-x86_64: Penglai_<ver>_windows_x64_setup.exe[.sig]
 *
 * The `url` for each platform points at the canonical GitHub version release.
 * Metadata is fetched only from GitHub; a mutable third-party proxy must not
 * be able to pair counterfeit metadata with an older, still-valid bundle.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertReleaseTag,
  loadReleaseContract,
  readUpdaterPublicKey,
  releaseTag,
  updaterBundleName,
  verifyUpdaterSignature,
} from "./release-contract.mjs";

const CONTRACT = loadReleaseContract();
const DEFAULT_REPO = CONTRACT.repository;

function parseArgs() {
  const a = {
    fromDir: null,
    fromRelease: null,
    version: null,
    repo: DEFAULT_REPO,
    baseUrl: null,
    out: "latest.json",
    notes: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const next = () => process.argv[++i];
    switch (arg) {
      case "--from-dir":
        a.fromDir = next();
        break;
      case "--from-release":
        a.fromRelease = next();
        break;
      case "--version":
        a.version = next();
        break;
      case "--repo":
        a.repo = next();
        break;
      case "--base-url":
        a.baseUrl = next();
        break;
      case "--out":
        a.out = next();
        break;
      case "--notes":
        a.notes = next();
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        console.error(`unknown arg: ${arg}`);
        process.exit(2);
    }
  }
  return a;
}

function printHelp() {
  console.error(`Usage:
  generate-latest-json.mjs --from-dir <dir> --version <ver> [options]
  generate-latest-json.mjs --from-release <v0.4.x-tag> [--version <ver>] [options]

Options:
  --version <ver>   Release version (required for --from-dir; inferred from tag otherwise)
  --repo <o/r>      Canonical GitHub repo (must remain ${DEFAULT_REPO})
  --base-url <url>  Asset URL prefix for local diagnostics (release verification accepts canonical GitHub only)
  --out <path>      Output path (default latest.json)
  --notes <text>    Release notes string (default "Penglai <ver> release")`);
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function baseUrl(args, version) {
  if (args.baseUrl) return args.baseUrl.replace(/\/$/, "");
  const tag = `v${version}`;
  return `https://github.com/${args.repo}/releases/download/${tag}`;
}

function buildManifest(version, platforms, notes) {
  return {
    version,
    notes: notes ?? `Penglai ${version} release`,
    pub_date: new Date().toISOString(),
    platforms,
  };
}

// ── mode 1: from a local directory ──────────────────────────────

function fromDir(args) {
  if (!args.version) die("--version is required with --from-dir");
  assertReleaseTag(releaseTag(args.version), CONTRACT);
  const dir = args.fromDir;
  if (!dir || !fs.existsSync(dir)) die(`directory not found: ${dir}`);
  const files = fs.readdirSync(dir);
  const platforms = {};
  const publicKey = readUpdaterPublicKey();
  for (const p of CONTRACT.platforms) {
    const bundle = updaterBundleName(p, args.version);
    const sig = `${bundle}.sig`;
    if (!files.includes(bundle)) {
      die(`missing updater bundle for ${p.key}: ${path.join(dir, bundle)}`);
    }
    if (!files.includes(sig)) {
      die(`missing updater signature for ${p.key}: ${path.join(dir, sig)}`);
    }
    const bundlePath = path.join(dir, bundle);
    const signature = fs.readFileSync(path.join(dir, sig), "utf-8").trim();
    verifyUpdaterSignature(fs.readFileSync(bundlePath), signature, publicKey);
    const url = `${baseUrl(args, args.version)}/${bundle}`;
    platforms[p.key] = { signature, url };
  }
  const manifest = buildManifest(args.version, platforms, args.notes);
  fs.writeFileSync(args.out, JSON.stringify(manifest, null, 2) + "\n");
  console.error(`wrote ${args.out} (from ${dir})`);
  console.error(JSON.stringify(manifest, null, 2));
}

// ── mode 2: from a published GitHub release ─────────────────────

async function githubFetch(url, token) {
  const headers = { "User-Agent": "penglai-updater-gen" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res;
}

async function fromRelease(args) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (args.fromRelease === "latest") {
    die("--from-release latest is forbidden: select the immutable v0.4.x tag explicitly");
  }
  const tag = args.fromRelease;
  assertReleaseTag(tag, CONTRACT);
  const api = args.repo.startsWith("http")
    ? args.repo
    : `https://api.github.com/repos/${args.repo}/releases/tags/${tag}`;

  const res = await githubFetch(api, token);
  const release = await res.json();
  if (release.draft) die(`release ${release.tag_name} is still a draft`);
  if (release.tag_name !== tag) die(`release tag mismatch: expected ${tag}, found ${release.tag_name}`);
  const version = args.version || (release.tag_name || "").replace(/^v/, "");
  assertReleaseTag(releaseTag(version), CONTRACT);

  const assets = release.assets || [];
  const findAsset = (name) => assets.find((a) => a.name === name);
  const platforms = {};
  const publicKey = readUpdaterPublicKey();
  for (const p of CONTRACT.platforms) {
    const bundle = updaterBundleName(p, version);
    const sigName = `${bundle}.sig`;
    const bundleAsset = findAsset(bundle);
    const sigAsset = findAsset(sigName);
    if (!bundleAsset) {
      die(`missing updater bundle '${bundle}' for ${p.key} on release ${release.tag_name}`);
    }
    if (!sigAsset) {
      die(`missing signature asset '${sigName}' for ${p.key} on release ${release.tag_name}`);
    }
    // Fetch the raw signature text.
    const sigRes = await githubFetch(sigAsset.browser_download_url, token);
    const signature = (await sigRes.text()).trim();
    const bundleRes = await githubFetch(bundleAsset.browser_download_url, token);
    verifyUpdaterSignature(Buffer.from(await bundleRes.arrayBuffer()), signature, publicKey);
    const url = `${baseUrl(args, version)}/${bundle}`;
    platforms[p.key] = { signature, url };
  }
  const manifest = buildManifest(version, platforms, args.notes);
  fs.writeFileSync(args.out, JSON.stringify(manifest, null, 2) + "\n");
  console.error(`wrote ${args.out} (from release ${release.tag_name})`);
  console.error(JSON.stringify(manifest, null, 2));
}

// ── main ────────────────────────────────────────────────────────

const args = parseArgs();
if (args.repo !== DEFAULT_REPO) {
  die(`--repo must remain the canonical release repository ${DEFAULT_REPO}`);
}
if (!args.fromDir && !args.fromRelease) {
  printHelp();
  die("either --from-dir or --from-release is required");
}
if (args.fromDir) {
  fromDir(args);
} else {
  fromRelease(args).catch((e) => die(e instanceof Error ? e.message : String(e)));
}
