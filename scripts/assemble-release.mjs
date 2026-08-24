#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";

function fail(message) {
  console.error(`assemble-release FAIL: ${message}`);
  process.exit(1);
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label}: ${String(error)}`);
  }
}

const stagingArg = option("--staging");
if (!stagingArg) fail("--staging is required");
mkdirSync(stagingArg, { recursive: true });
const staging = realpathSync(stagingArg);
if (staging === realpathSync(ROOT) || staging === "/" || staging === homedir()) {
  fail("unsafe staging directory");
}

const contract = readJson(join(ROOT, "release-contract.json"), "release contract");
const version = String(contract.version ?? "");
const tag = String(contract.publication?.tag ?? "");
const sourceSha = option("--source-sha");
if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail("--source-sha must be a full commit SHA");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
if (head !== sourceSha) fail(`source SHA ${sourceSha} does not match HEAD ${head}`);
if (tag !== `v${version}` || version !== "0.5.6") fail("release contract version/tag mismatch");

const installers = Array.isArray(contract.targets)
  ? contract.targets.map((row) => ({ target: String(row.key), name: String(row.installer) }))
  : [];
if (installers.length !== 3) fail("release contract must declare exactly three installers");
const installerNames = installers.map((row) => row.name).sort();
const startingFiles = readdirSync(staging).sort();
if (JSON.stringify(startingFiles) !== JSON.stringify(installerNames)) {
  fail(`staging must initially contain only the three installers: ${JSON.stringify(startingFiles)}`);
}

const publicExportPath = resolve(option("--public-export", join(ROOT, "evidence/generated/public-export-manifest.json")));
const publicExportEvidencePath = resolve(
  option("--public-export-evidence", join(ROOT, "evidence/generated/public-export.json")),
);
const sbomPath = resolve(option("--sbom", join(ROOT, "evidence/generated/sbom.json")));
const noticesPath = resolve(
  option("--notices", join(ROOT, "evidence/generated/THIRD_PARTY_NOTICES.txt")),
);
for (const [path, label] of [
  [publicExportPath, "public export manifest"],
  [publicExportEvidencePath, "public export evidence"],
  [sbomPath, "SBOM"],
  [noticesPath, "third-party notices"],
]) {
  if (!existsSync(path)) fail(`${label} missing`);
}
const publicExport = readJson(publicExportPath, "public export manifest");
const publicExportEvidence = readJson(publicExportEvidencePath, "public export evidence");
if (
  !/^[0-9a-f]{64}$/.test(String(publicExport.publicExportTreeSha256 ?? "")) ||
  publicExport.publicExportTreeSha256 !== publicExportEvidence.publicExportTreeSha256 ||
  publicExportEvidence.privateCandidateSourceSha !== sourceSha ||
  publicExportEvidence.treeDirty !== false ||
  publicExportEvidence.cleanRoom?.executed !== true
) {
  fail("public export is not a clean-room result bound to the source SHA");
}

let release;
const releaseJsonPath = option("--release-json");
if (releaseJsonPath) {
  release = readJson(resolve(releaseJsonPath), "GitHub release JSON");
} else {
  try {
    release = JSON.parse(
      execFileSync("gh", ["api", `repos/${contract.publication.repo}/releases/tags/${tag}`], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  } catch (error) {
    fail(`could not read the draft GitHub Release: ${String(error)}`);
  }
}
if (release.tag_name !== tag || release.draft !== true || release.prerelease === true || release.immutable === true) {
  fail("GitHub release must be the matching mutable draft");
}
const releaseAssets = Array.isArray(release.assets) ? release.assets : [];
const installerAssets = new Map(releaseAssets.map((asset) => [String(asset.name), asset]));
if (
  releaseAssets.length !== 3 ||
  releaseAssets.some((asset) => !installerNames.includes(String(asset.name)))
) {
  fail("draft Release must contain only the three exact installer assets");
}

const installerRows = installers.map(({ target, name }) => {
  const path = join(staging, name);
  const bytes = readFileSync(path);
  const asset = installerAssets.get(name);
  const digest = sha256(bytes);
  if (
    !asset ||
    !Number.isSafeInteger(asset.id) ||
    asset.id <= 0 ||
    Number(asset.size) !== bytes.length ||
    (asset.digest && String(asset.digest).replace(/^sha256:/, "") !== digest)
  ) {
    fail(`GitHub asset identity mismatch for ${name}`);
  }
  return { target, name, path, bytes, size: bytes.length, sha256: digest, assetId: asset.id };
});

copyFileSync(publicExportPath, join(staging, "public-export-manifest.json"));
copyFileSync(sbomPath, join(staging, "SBOM.cdx.json"));
copyFileSync(noticesPath, join(staging, "THIRD_PARTY_NOTICES.txt"));

const releaseManifest = {
  product: "Penglai",
  version,
  privateCandidateSourceSha: sourceSha,
  publicExportTreeSha256: publicExport.publicExportTreeSha256,
  artifacts: installerRows.map((row) => ({ name: row.name, bytes: row.size, sha256: row.sha256 })),
};
const releaseManifestBytes = Buffer.from(`${JSON.stringify(releaseManifest, null, 2)}\n`);
writeFileSync(join(staging, "release-manifest.json"), releaseManifestBytes);

const keyPath = resolve(
  process.env.PENGLAI_UPDATER_PRIVATE_KEY_FILE ||
    join(homedir(), "Library", "Application Support", "PenglaiReleaseKeys", "updater-ed25519-private.pem"),
);
if (!existsSync(keyPath)) fail("offline updater signing key is unavailable");
const { privateKeyFromPem, signBytes, verifyBytes } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/signature.ts")).href
);
const { parseAppUpdateManifest } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/app-update.ts")).href
);
const { EMBEDDED_UPDATER_PUBLIC_KEY } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/embedded-keys.ts")).href
);
const privateKey = privateKeyFromPem(readFileSync(keyPath, "utf8"));
const issuedAt = option("--issued-at", new Date().toISOString());
const issuedMs = Date.parse(issuedAt);
if (!Number.isFinite(issuedMs)) fail("--issued-at must be an ISO timestamp");
const expiresAt = new Date(issuedMs + 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
const updateManifest = {
  schema: "penglai.app-update.v1",
  sequence: 5,
  version,
  channel: "stable",
  releaseTag: tag,
  issuedAt: new Date(issuedMs).toISOString(),
  expiresAt,
  signingKeyId: EMBEDDED_UPDATER_PUBLIC_KEY.keyId,
  minimumSourceVersion: "0.5.1",
  notesUrl: `https://github.com/${contract.publication.repo}/releases/tag/${tag}`,
  candidateSourceSha: sha256(Buffer.from(sourceSha, "utf8")),
  publicExportTreeSha256: publicExport.publicExportTreeSha256,
  releaseManifestSha256: sha256(releaseManifestBytes),
  platforms: Object.fromEntries(
    installerRows.map((row) => [
      row.target,
      {
        assetId: row.assetId,
        url: `https://github.com/${contract.publication.repo}/releases/download/${tag}/${row.name}`,
        size: row.size,
        sha256: row.sha256,
        signature: signBytes(row.bytes, privateKey).toString("base64"),
      },
    ]),
  ),
  migration: { fromSchema: 3, toSchema: 3, backupRequired: true, rollbackCompatible: true },
};
const updateBytes = Buffer.from(`${JSON.stringify(updateManifest, null, 2)}\n`);
const updateSignature = signBytes(updateBytes, privateKey);
writeFileSync(join(staging, "update-manifest-v1.json"), updateBytes);
writeFileSync(join(staging, "update-manifest-v1.json.sig"), updateSignature);

const parsed = parseAppUpdateManifest(JSON.parse(updateBytes.toString("utf8")), issuedMs);
verifyBytes(updateBytes, updateSignature, EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex);
for (const row of installerRows) {
  verifyBytes(row.bytes, Buffer.from(parsed.platforms[row.target].signature, "base64"), EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex);
}

const expected = [...contract.exactAssets].sort();
const withoutSums = readdirSync(staging).sort();
const expectedWithoutSums = expected.filter((name) => name !== "SHA256SUMS");
if (JSON.stringify(withoutSums) !== JSON.stringify(expectedWithoutSums)) {
  fail(`assembled asset set mismatch: ${JSON.stringify(withoutSums)}`);
}
const sums = withoutSums
  .map((name) => `${sha256(readFileSync(join(staging, name)))}  ${basename(name)}`)
  .join("\n");
writeFileSync(join(staging, "SHA256SUMS"), `${sums}\n`);
const finalFiles = readdirSync(staging).sort();
if (JSON.stringify(finalFiles) !== JSON.stringify(expected)) fail("final exact asset set mismatch");

console.log(
  JSON.stringify({
    verdict: "PASS",
    command: "assemble-release",
    version,
    tag,
    sourceSha,
    publicExportTreeSha256: publicExport.publicExportTreeSha256,
    releaseId: release.id,
    assets: finalFiles.map((name) => ({ name, bytes: statSync(join(staging, name)).size })),
  }),
);
