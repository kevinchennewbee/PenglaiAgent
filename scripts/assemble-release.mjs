#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";

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
const nodeTest = Boolean(process.env.NODE_TEST_CONTEXT);
const candidate = requireCleanCandidateSource();
if (!nodeTest && (!candidate.ok || !candidate.frozen || candidate.git.head !== sourceSha)) {
  fail("release assembly requires a clean main checkout at exact origin/main");
}
if (tag !== `v${version}` || version !== PRODUCT_VERSION) fail("release contract version/tag mismatch");

const releaseGatePath = join(ROOT, "evidence", "generated", "verify-release.json");
if (!nodeTest) {
  if (!existsSync(releaseGatePath)) fail("complete verify:release evidence is missing");
  const releaseGate = readJson(releaseGatePath, "verify:release evidence");
  if (
    releaseGate.command !== "verify:release" ||
    releaseGate.verdict !== "PASS" ||
    releaseGate.exitCode !== 0 ||
    releaseGate.dryRun !== false ||
    releaseGate.sourceSha !== sourceSha ||
    !Array.isArray(releaseGate.records) ||
    releaseGate.records.some((record) => record.verdict !== "PASS" || record.exit !== 0)
  ) {
    fail("verify:release is not an exact non-dry-run PASS for this source");
  }
}

const installers = Array.isArray(contract.targets)
  ? contract.targets.map((row) => ({ target: String(row.key), name: String(row.installer) }))
  : [];
if (installers.length !== 3) fail("release contract must declare exactly three installers");
const installerNames = installers.map((row) => row.name).sort();
const startingFiles = readdirSync(staging).sort();
if (JSON.stringify(startingFiles) !== JSON.stringify(installerNames)) {
  fail(`staging must initially contain only the three installers: ${JSON.stringify(startingFiles)}`);
}
const nativeEvidenceDir = resolve(option("--native-evidence-dir", join(ROOT, "evidence/generated")));

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
const sbom = readJson(sbomPath, "SBOM");
const lockfileSha256 = sha256(readFileSync(join(ROOT, "pnpm-lock.yaml")));
const notices = readFileSync(noticesPath, "utf8");
if (
  !/^[0-9a-f]{64}$/.test(String(publicExport.publicExportTreeSha256 ?? "")) ||
  publicExport.publicExportTreeSha256 !== publicExportEvidence.publicExportTreeSha256 ||
  publicExportEvidence.privateCandidateSourceSha !== sourceSha ||
  publicExportEvidence.treeDirty !== false ||
  publicExportEvidence.cleanRoom?.executed !== true
) {
  fail("public export is not a clean-room result bound to the source SHA");
}
if (
  sbom.bomFormat !== "CycloneDX" ||
  sbom.release !== version ||
  sbom.sourceSha !== sourceSha ||
  sbom.target !== "release-set" ||
  sbom.lockfileSha256 !== lockfileSha256 ||
  !Number.isSafeInteger(sbom.componentCount) ||
  sbom.componentCount < 1 ||
  !Array.isArray(sbom.components) ||
  sbom.components.length !== sbom.componentCount
) {
  fail("SBOM is not the three-target aggregate bound to this source and lockfile");
}
if (
  !notices.includes(`Penglai ${version} Third-Party Notices`) ||
  !notices.includes(`Source SHA: ${sourceSha}`) ||
  !notices.includes("Audited target: release-set") ||
  !notices.includes("licenses/sharp/")
) {
  fail("third-party notices are not the source-bound three-target aggregate");
}

let release;
const releaseJsonPath = option("--release-json");
if (releaseJsonPath) {
  if (!nodeTest) fail("--release-json is available only inside the Node test runner");
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
if (
  release.tag_name !== tag ||
  release.target_commitish !== sourceSha ||
  release.draft !== true ||
  release.prerelease === true ||
  release.immutable === true
) {
  fail("GitHub release must be the matching exact-source mutable draft");
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
  if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0) {
    fail(`draft GitHub asset identity is missing for ${name}`);
  }
  if (!nodeTest) {
    const downloaded = join(staging, `.draft-asset-${asset.id}`);
    const output = openSync(downloaded, "wx", 0o600);
    let fetched;
    let remoteBytes = Buffer.alloc(0);
    try {
      fetched = spawnSync(
        "gh",
        ["api", "-H", "Accept: application/octet-stream", `repos/${contract.publication.repo}/releases/assets/${asset.id}`],
        { cwd: ROOT, stdio: ["ignore", output, "pipe"], encoding: "utf8" },
      );
      if (fetched.status === 0) {
        const stat = fstatSync(output);
        remoteBytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < remoteBytes.length) {
          const count = readSync(output, remoteBytes, offset, remoteBytes.length - offset, offset);
          if (count <= 0) fail(`short read from draft asset ${name}`);
          offset += count;
        }
      }
    } finally {
      closeSync(output);
      unlinkSync(downloaded);
    }
    if (fetched.status !== 0) {
      fail(`could not download draft asset ${name}: ${String(fetched.stderr ?? "")}`);
    }
    if (remoteBytes.length !== bytes.length || sha256(remoteBytes) !== digest) {
      fail(`draft GitHub asset bytes differ from staging for ${name}`);
    }
  }
  const evidencePath = join(nativeEvidenceDir, `local-installer-${target}.json`);
  if (!existsSync(evidencePath)) fail(`native installer evidence missing for ${target}`);
  const evidence = readJson(evidencePath, `native installer evidence for ${target}`);
  if (
    !asset ||
    !Number.isSafeInteger(asset.id) ||
    asset.id <= 0 ||
    Number(asset.size) !== bytes.length ||
    (asset.digest && String(asset.digest).replace(/^sha256:/, "") !== digest) ||
    evidence.target !== target ||
    evidence.sourceSha !== sourceSha ||
    evidence.installer !== name ||
    evidence.sha256 !== digest ||
    evidence.treeDirty !== false
  ) {
    fail(`GitHub asset or native evidence identity mismatch for ${name}`);
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
