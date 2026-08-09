#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertReleaseTag,
  expectedReleaseAssetNames,
  installerName,
  loadReleaseContract,
  readUpdaterPublicKey,
  releaseTag,
  sha256File,
  unsignedReleaseAssetNames,
  updaterBundleName,
  verifyUpdaterSignature,
} from "./release-contract.mjs";

function parseArgs() {
  const args = { directory: null, version: null, writeSha256: false };
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === "--dir") args.directory = path.resolve(process.argv[++index]);
    else if (value === "--version") args.version = process.argv[++index];
    else if (value === "--write-sha256") args.writeSha256 = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.directory) throw new Error("--dir is required");
  if (!args.version) throw new Error("--version is required");
  return args;
}

function exactFileSet(directory, expected) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const unsupported = entries.filter((entry) => !entry.isFile());
  if (unsupported.length > 0) {
    throw new Error(`release directory contains non-files: ${unsupported.map((entry) => entry.name).join(", ")}`);
  }
  const actual = entries.map((entry) => entry.name).sort();
  const wanted = [...expected].sort();
  const missing = wanted.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !wanted.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `release asset set mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`,
    );
  }
  for (const name of actual) {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`release asset must be a regular file: ${name}`);
    if (stat.size === 0) throw new Error(`release asset is empty: ${name}`);
  }
  return actual;
}

function validateUpdaterArtifacts(directory, contract, publicKey) {
  for (const platform of contract.platforms) {
    const bundle = updaterBundleName(platform, contract.version);
    const signature = fs.readFileSync(path.join(directory, `${bundle}.sig`), "utf8").trim();
    verifyUpdaterSignature(fs.readFileSync(path.join(directory, bundle)), signature, publicKey);
    if (platform.os === "macos") {
      const installer = installerName(platform, contract.version);
      const installerSignature = fs
        .readFileSync(path.join(directory, `${installer}.sig`), "utf8")
        .trim();
      verifyUpdaterSignature(
        fs.readFileSync(path.join(directory, installer)),
        installerSignature,
        publicKey,
      );
    }
  }
}

function validateLatestJson(directory, contract, publicKey) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "latest.json"), "utf8"));
  if (manifest.version !== contract.version) {
    throw new Error(`latest.json version mismatch: ${manifest.version}`);
  }
  if (!Number.isFinite(Date.parse(manifest.pub_date))) throw new Error("latest.json pub_date is invalid");
  const expectedKeys = contract.platforms.map((platform) => platform.key).sort();
  const actualKeys = Object.keys(manifest.platforms ?? {}).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`latest.json platform set mismatch: ${actualKeys.join(", ")}`);
  }
  for (const platform of contract.platforms) {
    const bundle = updaterBundleName(platform, contract.version);
    const entry = manifest.platforms[platform.key];
    const expectedPath = `/releases/download/${releaseTag(contract.version)}/${bundle}`;
    const allowedUrls = new Set([
      `https://github.com/${contract.repository}${expectedPath}`,
    ]);
    if (
      typeof entry?.url !== "string" ||
      !allowedUrls.has(entry.url)
    ) {
      throw new Error(`${platform.key} updater URL is not immutable: ${entry?.url}`);
    }
    const signature = fs.readFileSync(path.join(directory, `${bundle}.sig`), "utf8").trim();
    if (entry.signature !== signature) {
      throw new Error(`${platform.key} latest.json signature does not match its .sig asset`);
    }
    verifyUpdaterSignature(fs.readFileSync(path.join(directory, bundle)), entry.signature, publicKey);
  }
}

function validateSbom(directory, contract) {
  const sbom = JSON.parse(fs.readFileSync(path.join(directory, "SBOM.cdx.json"), "utf8"));
  if (sbom.bomFormat !== "CycloneDX" || typeof sbom.specVersion !== "string") {
    throw new Error("SBOM.cdx.json is not a CycloneDX document");
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error("SBOM.cdx.json has no dependency components");
  }
  if (sbom.metadata?.component?.version !== contract.version) {
    throw new Error("SBOM.cdx.json application version does not match the release");
  }
  const componentNames = new Set(sbom.components.map((component) => component.name));
  if (!componentNames.has("Node.js bundled runtime")) {
    throw new Error("SBOM.cdx.json does not inventory the bundled Node runtime");
  }
}

function sha256Text(directory, names) {
  return `${[...names]
    .sort()
    .map((name) => `${sha256File(path.join(directory, name))}  ${name}`)
    .join("\n")}\n`;
}

function validateSha256Sums(directory, names) {
  const expected = sha256Text(directory, names);
  const actual = fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8");
  if (actual !== expected) throw new Error("SHA256SUMS does not exactly bind the release asset set");
}

export function verifyReleaseDirectory(
  directory,
  { version, writeSha256 = false, publicKey = readUpdaterPublicKey() } = {},
) {
  const contract = loadReleaseContract();
  assertReleaseTag(releaseTag(version), contract);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`release directory not found: ${directory}`);
  }

  const unsignedNames = unsignedReleaseAssetNames(contract);
  exactFileSet(directory, writeSha256 ? unsignedNames : expectedReleaseAssetNames(contract));
  validateUpdaterArtifacts(directory, contract, publicKey);
  validateLatestJson(directory, contract, publicKey);
  validateSbom(directory, contract);
  const notices = fs.readFileSync(path.join(directory, "THIRD_PARTY_NOTICES.txt"), "utf8");
  if (notices.trim().length < 100) throw new Error("THIRD_PARTY_NOTICES.txt is unexpectedly small");

  if (writeSha256) {
    fs.writeFileSync(path.join(directory, "SHA256SUMS"), sha256Text(directory, unsignedNames));
    return { assetCount: unsignedNames.length + 1, wroteSha256: true };
  }

  validateSha256Sums(directory, unsignedNames);
  const sumsSignature = fs.readFileSync(path.join(directory, "SHA256SUMS.sig"), "utf8").trim();
  verifyUpdaterSignature(
    fs.readFileSync(path.join(directory, "SHA256SUMS")),
    sumsSignature,
    publicKey,
  );
  return { assetCount: expectedReleaseAssetNames(contract).length, wroteSha256: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs();
    const result = verifyReleaseDirectory(args.directory, {
      version: args.version,
      writeSha256: args.writeSha256,
    });
    console.log(
      `[release-assets] PASS ${result.assetCount} exact assets${result.wroteSha256 ? "; wrote SHA256SUMS" : "; hashes and signatures verified"}`,
    );
  } catch (error) {
    console.error(`[release-assets] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
