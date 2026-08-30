import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readDshSourceClosureContract, sha256 } from "./lib/dsh-source-closure.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { ROOT } from "./lib/repo.mjs";
import { readVerifiedRegularFile } from "./lib/verified-file.mjs";

function fail(reason) {
  finish("FAIL", { command: "verify:dsh-vendored-closure", reason });
}

function tarballManifest(bytes, label) {
  const entries = execFileSync("tar", ["-tf", "-"], { input: bytes, encoding: "utf8" }).trim().split("\n");
  if (!entries.includes("package/LICENSE")) fail(`${label} is missing package/LICENSE`);
  const raw = execFileSync("tar", ["-xOf", "-", "package/package.json"], {
    input: bytes,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  };
  if (raw !== `${JSON.stringify(canonicalize(parsed), null, 2)}\n`) {
    fail(`${label} package.json is not in canonical source-closure form`);
  }
  return parsed;
}

const contract = readDshSourceClosureContract(ROOT);
const closureRoot = resolve(ROOT, contract.transport.promotedRoot);
const manifestPath = join(closureRoot, "closure-manifest.json");
if (!existsSync(manifestPath)) fail(`${contract.transport.promotedRoot}/closure-manifest.json is missing`);

const manifest = JSON.parse(readVerifiedRegularFile(manifestPath).bytes.toString("utf8"));
const expectedCount = [...contract.build.families, ...contract.build.auxiliaryPackages].reduce(
  (sum, family) => sum + family.expectedTarballs,
  0,
);
if (
  manifest.schemaVersion !== 1 ||
  manifest.version !== contract.upstream.version ||
  manifest.packageManager !== contract.toolchain.packageManager ||
  manifest.archivePacker !== contract.toolchain.archivePacker ||
  manifest.transport !== contract.transport.kind ||
  manifest.officialNpmRequired !== false ||
  manifest.publicNpmPublication !== false ||
  manifest.patched !== false ||
  JSON.stringify(manifest.buildHost) !== JSON.stringify(contract.build.canonicalHost) ||
  JSON.stringify(manifest.artifactNormalization) !==
    JSON.stringify(contract.transport.artifactNormalization) ||
  manifest.packageCount !== expectedCount
) {
  fail("vendored closure header differs from the fixed source contract");
}
for (const field of ["head", "tree", "archiveSha256"]) {
  const expected =
    field === "head" ? contract.upstream.commit : contract.upstream[field];
  if (manifest.source?.[field] !== expected) fail(`vendored source ${field} differs from the contract`);
}
if (
  JSON.stringify(manifest.source?.welcomeNotice) !==
  JSON.stringify(contract.productClientBuild.welcomeNotice)
) {
  fail("vendored source welcome-notice binding differs from the contract");
}
if (
  manifest.packedInstallReadback?.passed !== true ||
  manifest.packedInstallReadback?.package !== "@deepseek-ai/dsh" ||
  manifest.packedInstallReadback?.version !== contract.upstream.version
) {
  fail("packed-install readback is absent or inconsistent");
}
const expectedClientEnvironment = {
  DSH_CLIENT_BUILD_PROFILE: contract.productClientBuild.profile,
  DSH_CLIENT_COMMIT_HASH: contract.upstream.commit.slice(0, 7),
  DSH_CLIENT_TITLE: contract.productClientBuild.title,
  DSH_CLIENT_VERSION: contract.upstream.version,
};
if (
  JSON.stringify(manifest.productClientBuild?.environment) !==
  JSON.stringify(expectedClientEnvironment) ||
  !Number.isSafeInteger(manifest.productClientBuild?.artifacts?.fileCount) ||
  !/^[0-9a-f]{64}$/.test(String(manifest.productClientBuild?.artifacts?.sha256 ?? ""))
) {
  fail("product client build record is absent or inconsistent");
}

const expectedUnits = [...contract.build.families, ...contract.build.auxiliaryPackages];
const expectedUnitIds = expectedUnits.map((unit) => unit.id).sort();
const declaredUnitIds = manifest.families?.map((unit) => unit.id).sort();
if (JSON.stringify(declaredUnitIds) !== JSON.stringify(expectedUnitIds)) {
  fail("vendored closure units differ from the fixed source contract");
}
const expectedRootEntries = ["closure-manifest.json", ...expectedUnitIds].sort();
if (JSON.stringify(readdirSync(closureRoot).sort()) !== JSON.stringify(expectedRootEntries)) {
  fail("vendored closure root contains missing or unexpected entries");
}
const allNames = [];
let layoutClient;
let settingsModelsClient;
for (const expectedUnit of expectedUnits) {
  const unit = manifest.families?.find((row) => row.id === expectedUnit.id);
  if (!unit || unit.packages?.length !== expectedUnit.expectedTarballs) {
    fail(`${expectedUnit.id} package count differs from the contract`);
  }
  const directory = join(closureRoot, expectedUnit.id);
  const actualFiles = readdirSync(directory).filter((name) => name.endsWith(".tgz")).sort();
  const declaredFiles = unit.packages.map((row) => row.filename).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
    fail(`${expectedUnit.id} tarball set differs from closure-manifest.json`);
  }
  const expectedDirectoryEntries = [
    ...declaredFiles,
    ...(expectedUnit.publishOrder ? ["publish-order.txt"] : []),
  ].sort();
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expectedDirectoryEntries)) {
    fail(`${expectedUnit.id} contains missing or unexpected entries`);
  }
  if (expectedUnit.publishOrder) {
    const publishOrderPath = join(directory, "publish-order.txt");
    const { bytes } = readVerifiedRegularFile(publishOrderPath);
    if (
      unit.publishOrder?.filename !== "publish-order.txt" ||
      unit.publishOrder?.size !== bytes.length ||
      unit.publishOrder?.sha256 !== sha256(bytes)
    ) {
      fail(`${expectedUnit.id}/publish-order.txt differs from closure-manifest.json`);
    }
  } else if (unit.publishOrder !== undefined) {
    fail(`${expectedUnit.id} declares an unexpected publish-order file`);
  }
  for (const row of unit.packages) {
    const path = join(directory, row.filename);
    const { bytes } = readVerifiedRegularFile(path);
    if (bytes.length !== row.size || sha256(bytes) !== row.sha256) {
      fail(`${row.filename} bytes differ from closure-manifest.json`);
    }
    const packageManifest = tarballManifest(bytes, path);
    if (
      packageManifest.name !== row.name ||
      packageManifest.version !== row.version ||
      packageManifest.license !== row.license
    ) {
      fail(`${row.filename} identity differs from closure-manifest.json`);
    }
    if (row.license !== "MIT" && row.license !== "BSD-3-Clause") {
      fail(`${row.filename} has an unapproved license ${JSON.stringify(row.license)}`);
    }
    allNames.push(row.name);
    if (row.name === "@deepseek-ai/dsh-client-ui-layout") {
      layoutClient = execFileSync("tar", ["-xOf", "-", "package/lib/client.js"], {
        input: bytes,
        encoding: "utf8",
      });
    }
    if (row.name === "@deepseek-ai/dsh-client-ui-settings-models") {
      settingsModelsClient = execFileSync("tar", ["-xOf", "-", "package/lib/client.js"], {
        input: bytes,
        encoding: "utf8",
      });
    }
  }
}
if (new Set(allNames).size !== allNames.length || allNames.length !== expectedCount) {
  fail("vendored closure package identities are duplicate or incomplete");
}
if (
  typeof layoutClient !== "string" ||
  !layoutClient.includes(`productTitle: ${JSON.stringify(contract.productClientBuild.title)}`) ||
  layoutClient.includes('productTitle: "DeepSeek Harness"')
) {
  fail("vendored DSH layout does not bind the Penglai product title");
}
const welcome = contract.productClientBuild.welcomeNotice;
if (
  typeof settingsModelsClient !== "string" ||
  !settingsModelsClient.includes(`WELCOME_NOTICE_ACK_FIELD = ${JSON.stringify(welcome.ackField)}`) ||
  !settingsModelsClient.includes(`WELCOME_NOTICE_VERSION = ${JSON.stringify(welcome.version)}`)
) {
  fail("vendored DSH settings-models package differs from the welcome-notice contract");
}

finish("PASS", {
  command: "verify:dsh-vendored-closure",
  sourceCommit: contract.upstream.commit,
  version: contract.upstream.version,
  packageCount: allNames.length,
  licenses: { MIT: allNames.length - 1, "BSD-3-Clause": 1 },
});
