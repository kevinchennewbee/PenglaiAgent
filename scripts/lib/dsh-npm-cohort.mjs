import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const DSH_UPSTREAM = Object.freeze({
  version: "0.1.2-rc.1",
  tag: "dsh-v0.1.2-rc.1",
  commit: "a66e4702047846cdaa10c66c9d3df3951f5ea70d",
  packageCount: 242,
  rootIntegrity: "sha512-RPq48TzxvwpdT9/7W1tbhZDBMmeK+bxDrX9cqQC27Wx/LqtgJF8PSa3b3xriU8oxtvhwYmk21w2cej3uMQrnVA==",
  rootShasum: "fef213043313affc36ca2226d2637ad483b5e3f6",
  rootTarballSha256: "ca370668053ad6d0ac325e919ef5f65de53de00b7bad78008e6fb422dfce3530",
  welcomeNotice: Object.freeze({
    settingsNamespace: "ui-onboarding",
    ackField: "welcomeNoticeVersion",
    version: "2026-08-13.1",
    sourcePath: "packages/client/ui-settings-models/src/onboarding-copy.ts",
  }),
});

export const DSH_REQUIRED_PACKAGES = Object.freeze([
  "@deepseek-ai/dsh-session-turn-outline",
  "@deepseek-ai/dsh-client-ui-schedule",
  "@deepseek-ai/dsh-deque",
  "@deepseek-ai/dsh-util-time",
  "@deepseek-ai/dsh-util-values",
]);

export const DSH_VENDOR_VERSIONS = Object.freeze({
  "@deepseek-ai/cordis": "4.0.2",
  "@deepseek-ai/cordis-plugin-group": "1.0.2",
  "@deepseek-ai/cordis-plugin-hmr": "1.0.17",
  "@deepseek-ai/cordis-plugin-include": "1.0.7",
  "@deepseek-ai/cordis-plugin-loader": "1.0.3",
  "@deepseek-ai/cordis-plugin-logger-console": "1.0.2",
  "@deepseek-ai/cordis-plugin-timer": "1.1.4",
  "@deepseek-ai/cosmokit": "1.8.3",
  "@deepseek-ai/schemastery": "3.18.2",
});

export const DSH_LANDLOCK_VERSIONS = Object.freeze({
  "@deepseek-ai/node-addon-landlock-run": "0.1.1",
  "@deepseek-ai/node-addon-landlock-run-linux-arm64": "0.1.1",
  "@deepseek-ai/node-addon-landlock-run-linux-x64": "0.1.1",
});

const INSTALL_LIFECYCLE_KEYS = ["preinstall", "install", "postinstall"];
const EXPECTED_INSTALL_LIFECYCLE = Object.freeze({
  "@deepseek-ai/dsh-subprocess-local": {
    postinstall: "node scripts/ensure-spawn-helper.mjs",
  },
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedRepositoryUrl(repository) {
  const value = typeof repository === "string" ? repository : repository?.url;
  return String(value ?? "").replace(/^git\+/, "").replace(/\.git$/, "").toLowerCase();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function selectedRegistryMetadata(manifest) {
  return stableObject({
    dependencies: manifest.dependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    peerDependenciesMeta: manifest.peerDependenciesMeta ?? {},
    engines: manifest.engines ?? {},
    bin: manifest.bin ?? {},
    exports: manifest.exports ?? {},
  });
}

function installLifecycleScripts(manifest) {
  return Object.fromEntries(
    INSTALL_LIFECYCLE_KEYS.filter((key) => typeof manifest.scripts?.[key] === "string").map((key) => [key, manifest.scripts[key]]),
  );
}

function walkPackageJsonFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walkPackageJsonFiles(path, output);
    else if (entry.isFile() && entry.name === "package.json") output.push(path);
  }
  return output;
}

function expectedCategoryAndVersion(manifest, sourcePath) {
  if (manifest.version === DSH_UPSTREAM.version && manifest.name?.startsWith("@deepseek-ai/dsh")) {
    return { category: "dsh", version: DSH_UPSTREAM.version };
  }
  if (sourcePath.startsWith("vendor/")) {
    const version = DSH_VENDOR_VERSIONS[manifest.name];
    return version ? { category: "vendor", version } : null;
  }
  const landlockVersion = DSH_LANDLOCK_VERSIONS[manifest.name];
  return landlockVersion ? { category: "landlock", version: landlockVersion } : null;
}

export function discoverSourcePackages(upstreamRoot) {
  const root = resolve(upstreamRoot);
  invariant(existsSync(resolve(root, "package.json")), `missing upstream package.json: ${root}`);
  const searchRoots = ["apps", "native", "packages", "vendor"].map((name) => resolve(root, name));
  const packages = [];
  for (const searchRoot of searchRoots) {
    for (const packageJson of walkPackageJsonFiles(searchRoot)) {
      const bytes = readFileSync(packageJson);
      const manifest = JSON.parse(bytes.toString("utf8"));
      if (manifest.private === true || !manifest.name?.startsWith("@deepseek-ai/")) continue;
      const sourcePath = relative(root, packageJson).replaceAll("\\", "/");
      const expected = expectedCategoryAndVersion(manifest, sourcePath);
      if (!expected) continue;
      invariant(manifest.version === expected.version, `${manifest.name} source version ${manifest.version}, expected ${expected.version}`);
      packages.push({
        name: manifest.name,
        version: manifest.version,
        category: expected.category,
        sourcePath,
        sourceManifestSha256: sha256(bytes),
      });
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  invariant(new Set(packages.map((item) => item.name)).size === packages.length, "duplicate public package name in upstream source");
  return packages;
}

function registryVersionUrl(name, version) {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

async function fetchJson(url, fetchImpl, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
    }
  }
  throw new Error(`registry request failed for ${url}: ${lastError?.message ?? lastError}`);
}

async function fetchBytes(url, fetchImpl, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
    }
  }
  throw new Error(`request failed for ${url}: ${lastError?.message ?? lastError}`);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

export async function resolveRegistryEntries(sourcePackages, { fetchImpl = fetch, concurrency = 12 } = {}) {
  return mapLimit(sourcePackages, concurrency, async (sourcePackage) => {
    const manifest = await fetchJson(registryVersionUrl(sourcePackage.name, sourcePackage.version), fetchImpl);
    invariant(manifest.name === sourcePackage.name, `${sourcePackage.name} registry name mismatch`);
    invariant(manifest.version === sourcePackage.version, `${sourcePackage.name} registry version mismatch`);
    const signatures = Array.isArray(manifest.dist?.signatures) ? manifest.dist.signatures : [];
    return stableObject({
      ...sourcePackage,
      license: manifest.license ?? null,
      repositoryUrl: normalizedRepositoryUrl(manifest.repository),
      integrity: manifest.dist?.integrity ?? null,
      shasum: manifest.dist?.shasum ?? null,
      tarball: manifest.dist?.tarball ?? null,
      signatures,
      gitHead: manifest.gitHead ?? null,
      attestations: manifest.dist?.attestations ?? null,
      installLifecycleScripts: installLifecycleScripts(manifest),
      metadata: selectedRegistryMetadata(manifest),
    });
  });
}

export async function readRootDistTags({ fetchImpl = fetch } = {}) {
  const packument = await fetchJson("https://registry.npmjs.org/%40deepseek-ai%2Fdsh", fetchImpl);
  return {
    distTags: stableObject(packument["dist-tags"] ?? {}),
    publishedAt: packument.time?.[DSH_UPSTREAM.version] ?? null,
  };
}

export async function readRegistrySigningKeys({ fetchImpl = fetch } = {}) {
  const response = await fetchJson("https://registry.npmjs.org/-/npm/v1/keys", fetchImpl);
  const keys = Array.isArray(response.keys) ? response.keys : [];
  invariant(keys.length > 0, "npm registry returned no signing keys");
  return keys;
}

export function verifyRegistrySignatures(entry, keys) {
  const signatures = Array.isArray(entry.signatures) ? entry.signatures : [];
  invariant(signatures.length > 0, `${entry.name} is missing npm registry signatures`);
  const payload = Buffer.from(`${entry.name}@${entry.version}:${entry.integrity}`, "utf8");
  const verified = signatures.some((signature) => {
    const key = keys.find((candidate) => candidate.keyid === signature.keyid);
    if (
      !key ||
      key.keytype !== "ecdsa-sha2-nistp256" ||
      key.scheme !== "ecdsa-sha2-nistp256" ||
      typeof key.key !== "string" ||
      typeof signature.sig !== "string"
    ) return false;
    try {
      const der = Buffer.from(key.key, "base64");
      const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
      return verifySignature("sha256", payload, publicKey, Buffer.from(signature.sig, "base64"));
    } catch {
      return false;
    }
  });
  invariant(verified, `${entry.name} npm registry signature verification failed`);
  return true;
}

export async function readTarballSha256(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`tarball request failed for ${url}: ${response.status} ${response.statusText}`);
  return sha256(Buffer.from(await response.arrayBuffer()));
}

export function validateCohortSnapshot(snapshot) {
  invariant(snapshot?.schemaVersion === 1, "DSH npm cohort schemaVersion must be 1");
  invariant(snapshot.source?.repository === "https://github.com/deepseek-ai/DeepSeek-Harness.git", "unexpected DSH source repository");
  invariant(snapshot.source?.tag === DSH_UPSTREAM.tag, `unexpected DSH tag: ${snapshot.source?.tag}`);
  invariant(snapshot.source?.commit === DSH_UPSTREAM.commit, `unexpected DSH commit: ${snapshot.source?.commit}`);
  invariant(snapshot.version === DSH_UPSTREAM.version, `unexpected DSH version: ${snapshot.version}`);
  invariant(snapshot.rootTarballSha256 === DSH_UPSTREAM.rootTarballSha256, "@deepseek-ai/dsh tarball SHA-256 mismatch");
  invariant(JSON.stringify(snapshot.upstreamFacts?.welcomeNotice) === JSON.stringify(DSH_UPSTREAM.welcomeNotice), "DSH welcome notice identity mismatch");
  invariant(snapshot.distTags?.next === DSH_UPSTREAM.version, "snapshot npm next tag must select the fixed rc.1 cohort");
  invariant(snapshot.distTags?.latest === "0.1.1-rc.2", "npm latest must remain 0.1.1-rc.2 in snapshot");
  const entries = Array.isArray(snapshot.packages) ? snapshot.packages : [];
  invariant(new Set(entries.map((entry) => entry.name)).size === entries.length, "duplicate package in DSH npm cohort");
  const dsh = entries.filter((entry) => entry.category === "dsh");
  const vendor = entries.filter((entry) => entry.category === "vendor");
  const landlock = entries.filter((entry) => entry.category === "landlock");
  invariant(dsh.length === DSH_UPSTREAM.packageCount, `DSH package count ${dsh.length}, expected ${DSH_UPSTREAM.packageCount}`);
  invariant(vendor.length === Object.keys(DSH_VENDOR_VERSIONS).length, `vendor package count ${vendor.length}, expected 9`);
  invariant(landlock.length === Object.keys(DSH_LANDLOCK_VERSIONS).length, `Landlock package count ${landlock.length}, expected 3`);
  for (const entry of entries) {
    invariant(entry.version === (entry.category === "dsh" ? DSH_UPSTREAM.version : (DSH_VENDOR_VERSIONS[entry.name] ?? DSH_LANDLOCK_VERSIONS[entry.name])), `${entry.name} has unexpected version ${entry.version}`);
    invariant(entry.license === "MIT" || entry.license === "BSD-3-Clause", `${entry.name} has unexpected license ${entry.license}`);
    invariant(/^sha512-/.test(entry.integrity ?? ""), `${entry.name} is missing sha512 integrity`);
    invariant(/^[a-f0-9]{40}$/.test(entry.shasum ?? ""), `${entry.name} has invalid npm shasum`);
    invariant(
      /^https:\/\/registry\.npmjs\.org\//.test(entry.tarball ?? "") && entry.tarball.endsWith(`-${entry.version}.tgz`),
      `${entry.name} has unexpected tarball URL`,
    );
    invariant(Array.isArray(entry.signatures) && entry.signatures.length > 0, `${entry.name} is missing npm registry signatures`);
    const officialRepository = entry.repositoryUrl === "https://github.com/deepseek-ai/deepseek-harness";
    const legacyLandlockRepository = entry.category === "landlock" && entry.repositoryUrl === "https://github.com/deepseek-harness/deepseek-harness";
    invariant(officialRepository || legacyLandlockRepository, `${entry.name} has unexpected repository ${entry.repositoryUrl}`);
  }
  const names = new Set(entries.map((entry) => entry.name));
  for (const name of DSH_REQUIRED_PACKAGES) invariant(names.has(name), `required cohort package missing: ${name}`);
  invariant(!names.has("@deepseek-ai/dsh-client-runtime"), "removed dsh-client-runtime must not enter the cohort");
  const root = entries.find((entry) => entry.name === "@deepseek-ai/dsh");
  invariant(root?.integrity === DSH_UPSTREAM.rootIntegrity, "@deepseek-ai/dsh integrity mismatch");
  invariant(root?.shasum === DSH_UPSTREAM.rootShasum, "@deepseek-ai/dsh shasum mismatch");
  const withLifecycle = entries.filter((entry) => Object.keys(entry.installLifecycleScripts ?? {}).length > 0);
  invariant(withLifecycle.length === 1, `unexpected install lifecycle scripts in ${withLifecycle.map((entry) => entry.name).join(", ") || "none"}`);
  invariant(JSON.stringify(withLifecycle[0]?.installLifecycleScripts) === JSON.stringify(EXPECTED_INSTALL_LIFECYCLE[withLifecycle[0]?.name]), "unexpected DSH install lifecycle command");
  return { dsh: dsh.length, vendor: vendor.length, landlock: landlock.length, total: entries.length };
}

export function verifyCohortLock(snapshot, lockText) {
  const expected = new Map(
    (snapshot.packages ?? []).map((entry) => [
      `${entry.name}@${entry.version}`,
      entry.integrity,
    ]),
  );
  const installed = new Map();
  const packageBlock =
    /^  ['"]?(@deepseek-ai\/[^@'"\r\n]+)@([^:'"\r\n]+)['"]?:\r?\n    resolution: \{integrity: ([^,}\r\n]+)/gm;
  for (const match of lockText.matchAll(packageBlock)) {
    const spec = `${match[1]}@${match[2]}`;
    invariant(expected.has(spec), `pnpm lock contains an out-of-cohort package ${spec}`);
    invariant(expected.get(spec) === match[3], `pnpm lock integrity drift for ${spec}`);
    installed.set(match[1], match[2]);
  }
  for (const required of ["@deepseek-ai/dsh", ...DSH_REQUIRED_PACKAGES]) {
    invariant(installed.get(required) === DSH_UPSTREAM.version, `pnpm lock is missing required ${required}@${DSH_UPSTREAM.version}`);
  }
  invariant(!lockText.includes("0.1.2-alpha.1"), "pnpm lock still contains alpha.1");
  invariant(!lockText.includes("@deepseek-ai/dsh-client-runtime"), "pnpm lock contains removed dsh-client-runtime");
  return { packages: installed.size };
}

export async function verifySnapshotAgainstRegistry(snapshot, options = {}) {
  const sourcePackages = snapshot.packages.map(({ name, version, category, sourcePath, sourceManifestSha256 }) => ({
    name, version, category, sourcePath, sourceManifestSha256,
  }));
  const liveEntries = await resolveRegistryEntries(sourcePackages, options);
  for (let index = 0; index < liveEntries.length; index += 1) {
    invariant(JSON.stringify(liveEntries[index]) === JSON.stringify(stableObject(snapshot.packages[index])), `${liveEntries[index].name} registry metadata drift`);
  }
  const liveRoot = await readRootDistTags(options);
  invariant(typeof liveRoot.publishedAt === "string" && liveRoot.publishedAt.length > 0, "@deepseek-ai/dsh rc.1 publication time missing");
  options.observeDistTags?.(liveRoot.distTags);
  const fetchImpl = options.fetchImpl ?? fetch;
  const signingKeys = await readRegistrySigningKeys(options);
  for (const entry of liveEntries) verifyRegistrySignatures(entry, signingKeys);
  await mapLimit(liveEntries, options.tarballConcurrency ?? 6, async (entry) => {
    const bytes = await fetchBytes(entry.tarball, fetchImpl);
    const shasum = createHash("sha1").update(bytes).digest("hex");
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    invariant(shasum === entry.shasum, `${entry.name} live tarball shasum drift`);
    invariant(integrity === entry.integrity, `${entry.name} live tarball integrity drift`);
    if (entry.name === "@deepseek-ai/dsh") {
      invariant(sha256(bytes) === snapshot.rootTarballSha256, "@deepseek-ai/dsh live tarball SHA-256 drift");
    }
  });
  await mapLimit(snapshot.packages, options.sourceConcurrency ?? 12, async (entry) => {
    let bytes;
    if (options.sourceRoot) {
      const sourceRoot = resolve(options.sourceRoot);
      const sourcePath = resolve(sourceRoot, entry.sourcePath);
      const relativePath = relative(sourceRoot, sourcePath);
      invariant(
        relativePath && !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../") && !relativePath.startsWith("..\\"),
        `${entry.name} source path escapes the fixed checkout`,
      );
      invariant(existsSync(sourcePath), `${entry.name} source manifest is missing from the fixed checkout`);
      bytes = readFileSync(sourcePath);
    } else {
      const url = `https://raw.githubusercontent.com/deepseek-ai/DeepSeek-Harness/${snapshot.source.commit}/${entry.sourcePath}`;
      bytes = await fetchBytes(url, fetchImpl);
    }
    invariant(sha256(bytes) === entry.sourceManifestSha256, `${entry.name} source manifest drift`);
    const manifest = JSON.parse(bytes.toString("utf8"));
    invariant(manifest.name === entry.name && manifest.version === entry.version, `${entry.name} source identity drift`);
  });
  return validateCohortSnapshot(snapshot);
}
