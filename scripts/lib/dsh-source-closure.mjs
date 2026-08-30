import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`DSH source closure contract requires ${field}`);
  }
  return value;
}

export function validateDshSourceClosureContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("DSH source closure contract must be an object");
  }
  if (contract.schemaVersion !== 1) throw new Error("unsupported DSH source closure schema");
  if (!["source-closure-bootstrap", "source-closure-integrated"].includes(contract.stage)) {
    throw new Error(`unsupported DSH source closure stage ${JSON.stringify(contract.stage)}`);
  }

  const upstream = contract.upstream ?? {};
  requireString(upstream.repository, "upstream.repository");
  requireString(upstream.tag, "upstream.tag");
  requireString(upstream.version, "upstream.version");
  if (!HEX_40.test(String(upstream.commit ?? ""))) throw new Error("upstream.commit must be a lowercase Git SHA");
  if (!HEX_40.test(String(upstream.tree ?? ""))) throw new Error("upstream.tree must be a lowercase Git tree SHA");
  if (!HEX_64.test(String(upstream.archiveSha256 ?? ""))) {
    throw new Error("upstream.archiveSha256 must be a lowercase SHA-256");
  }

  const toolchain = contract.toolchain ?? {};
  requireString(toolchain.nodeRange, "toolchain.nodeRange");
  requireString(toolchain.verifiedNode, "toolchain.verifiedNode");
  requireString(toolchain.packageManager, "toolchain.packageManager");
  requireString(toolchain.archivePacker, "toolchain.archivePacker");

  const officialClientBuild = contract.officialClientBuild ?? {};
  if (officialClientBuild.profile !== "official") {
    throw new Error("the source closure requires the official DSH client build profile");
  }
  if (officialClientBuild.title !== "DeepSeek Harness") {
    throw new Error("the official DSH client title must remain unmodified");
  }

  const canonicalHost = contract.build?.canonicalHost ?? {};
  if (
    canonicalHost.platform !== "darwin" ||
    canonicalHost.sourceRoot !==
      `/private/tmp/penglai-dsh-source-closure-${upstream.commit.slice(0, 12)}/source`
  ) {
    throw new Error("the DSH client build must use the fixed canonical Darwin source root");
  }

  const families = contract.build?.families;
  if (!Array.isArray(families) || families.length !== 2) {
    throw new Error("build.families must contain the vendor and dsh release families");
  }
  const byId = new Map(families.map((family) => [family.id, family]));
  for (const id of ["vendor", "dsh"]) {
    const family = byId.get(id);
    if (!family || !Number.isSafeInteger(family.expectedTarballs) || family.expectedTarballs < 1) {
      throw new Error(`build family ${id} requires a positive expectedTarballs count`);
    }
    if (family.publishOrder !== true) {
      throw new Error(`build family ${id} must bind its upstream publish-order file`);
    }
  }
  const auxiliaryPackages = contract.build?.auxiliaryPackages;
  if (!Array.isArray(auxiliaryPackages) || auxiliaryPackages.length !== 1) {
    throw new Error("build.auxiliaryPackages must contain the Landlock entry package");
  }
  const landlock = auxiliaryPackages[0];
  if (
    landlock.id !== "landlock-entry" ||
    landlock.name !== "@deepseek-ai/node-addon-landlock-run" ||
    landlock.directory !== "native/landlock-run/packages/entry" ||
    !Array.isArray(landlock.build) ||
    landlock.build.length === 0 ||
    landlock.expectedTarballs !== 1 ||
    landlock.publishOrder !== false
  ) {
    throw new Error("the exact Landlock entry package build must be part of the closure");
  }
  if (contract.build?.packedInstallFamily !== "dsh") {
    throw new Error("the installed readback must drive the dsh release family");
  }
  const darwinPackedInstallEnvironment = contract.build?.packedInstallEnvironment?.darwin;
  if (
    !darwinPackedInstallEnvironment ||
    Object.keys(darwinPackedInstallEnvironment).length !== 1 ||
    darwinPackedInstallEnvironment.LDFLAGS !== "-undefined dynamic_lookup"
  ) {
    throw new Error("the Darwin packed-install readback must bind the Node addon dynamic lookup linker flag");
  }

  const transport = contract.transport ?? {};
  if (transport.kind !== "local-tarball-closure") throw new Error("unsupported DSH source transport");
  if (transport.officialNpmRequired !== false) throw new Error("official npm must not be a source-closure prerequisite");
  if (transport.publicNpmPublication !== false) throw new Error("Penglai must not publish the official DSH npm scope");
  if (transport.preserveOfficialPackageNames !== true) throw new Error("local tarballs must preserve official package names");
  if (transport.upstreamPatchPolicy !== "none") throw new Error("the fixed official DSH source must remain unpatched");
  const normalization = transport.artifactNormalization ?? {};
  if (
    normalization.packageJson !== "recursive-key-sort" ||
    normalization.repack !== "npm-pack-ignore-scripts" ||
    !Number.isSafeInteger(normalization.sourceDateEpoch) ||
    normalization.sourceDateEpoch < 0
  ) {
    throw new Error("the deterministic archive normalization contract is incomplete");
  }
  requireString(transport.outputRoot, "transport.outputRoot");
  if (transport.promotedRoot !== `third_party/dsh/${upstream.version}`) {
    throw new Error("the promoted DSH closure path must be version-scoped under third_party/dsh");
  }

  const integration = contract.productIntegration ?? {};
  requireString(integration.activeDshVersion, "productIntegration.activeDshVersion");
  requireString(integration.targetDshVersion, "productIntegration.targetDshVersion");
  requireString(integration.switchRule, "productIntegration.switchRule");
  if (integration.targetDshVersion !== upstream.version) {
    throw new Error("target DSH version must match the fixed source version");
  }
  return contract;
}

export function readDshSourceClosureContract(root) {
  const path = resolve(root, "docs/0.5.8/DSH_SOURCE_CLOSURE.json");
  return validateDshSourceClosureContract(JSON.parse(readFileSync(path, "utf8")));
}

export function resolveClosureOutput(root, requested, contract) {
  const allowedRoot = resolve(root, contract.transport.outputRoot);
  const output = resolve(root, requested ?? `${contract.transport.outputRoot}/${contract.upstream.commit.slice(0, 12)}`);
  const rel = relative(allowedRoot, output);
  if (rel === "" || rel.startsWith("..") || rel.includes("../") || rel.includes("..\\")) {
    throw new Error(`DSH closure output must be a child of ${contract.transport.outputRoot}`);
  }
  return output;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeRepositoryUrl(value) {
  return String(value).trim().replace(/^git\+/, "").replace(/\/$/, "").replace(/\.git$/, "").toLowerCase();
}
