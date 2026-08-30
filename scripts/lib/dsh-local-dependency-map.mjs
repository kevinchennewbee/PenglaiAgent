import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { readDshSourceClosureContract, sha256 } from "./dsh-source-closure.mjs";

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  );
}

export function stringifyCanonicalJson(value) {
  return `${JSON.stringify(canonicalJson(value), null, 2)}\n`;
}

export function buildDshLocalDependencyMap(root) {
  const contract = readDshSourceClosureContract(root);
  const closureRoot = resolve(root, contract.transport.promotedRoot);
  const closureManifestPath = join(closureRoot, "closure-manifest.json");
  const closureManifestBytes = readFileSync(closureManifestPath);
  const closure = JSON.parse(closureManifestBytes.toString("utf8"));
  const packages = [];
  for (const family of closure.families ?? []) {
    for (const entry of family.packages ?? []) {
      const archivePath = join(closureRoot, family.id, entry.filename);
      const archiveBytes = readFileSync(archivePath);
      if (archiveBytes.length !== entry.size || sha256(archiveBytes) !== entry.sha256) {
        throw new Error(`vendored DSH package differs from closure manifest: ${entry.name}`);
      }
      const repositoryPath = relative(root, archivePath).split(sep).join("/");
      packages.push({
        name: entry.name,
        version: entry.version,
        family: family.id,
        file: `file:${repositoryPath}`,
        size: entry.size,
        sha256: entry.sha256,
      });
    }
  }
  packages.sort((left, right) => left.name.localeCompare(right.name));
  if (packages.length !== closure.packageCount || new Set(packages.map((row) => row.name)).size !== packages.length) {
    throw new Error("vendored DSH dependency map is duplicate or incomplete");
  }
  return {
    schemaVersion: 1,
    source: {
      repository: contract.upstream.repository,
      tag: contract.upstream.tag,
      commit: contract.upstream.commit,
      version: contract.upstream.version,
      closureManifest: relative(root, closureManifestPath).split(sep).join("/"),
      closureManifestSha256: sha256(closureManifestBytes),
    },
    policy: {
      transport: "local-tarball-closure",
      officialNpmRequired: false,
      registryFallbackAllowed: false,
      publicNpmPublication: false,
      workspaceResolution: "audited-pnpm-custom-resolver-and-fetcher",
    },
    packageCount: packages.length,
    packages,
  };
}

export function dependencyOverrides(map) {
  return Object.fromEntries(map.packages.map((row) => [row.name, row.file]));
}

export function dependencyVersions(map) {
  return new Map(map.packages.map((row) => [row.name, row.version]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function dshLocalPackageId(row) {
  return `penglai-dsh-source:${row.name}@${row.version}+sha256.${row.sha256.slice(0, 16)}`;
}

export function resealDshLocalDependencyLock(lockBytes, map) {
  const rows = new Map(map.packages.map((row) => [row.name, row]));
  let lock = String(lockBytes);
  const customResolutionPattern =
    /resolution: \{name: '?([^,']+)'?, version: ([^, }]+), sha256: ([0-9a-f]{64}), tarballPath: ([^, }]+), type: custom:penglai-dsh-source\}/g;
  const resolutions = [...lock.matchAll(customResolutionPattern)];
  if (resolutions.length === 0) throw new Error("pnpm lock contains no Penglai DSH source resolutions to reseal");
  for (const match of resolutions) {
    const [, name, version, , tarballPath] = match;
    const row = rows.get(name);
    if (!row || row.version !== version || row.file.slice("file:".length) !== tarballPath) {
      throw new Error(`pnpm lock cannot reseal an unknown DSH source resolution: ${name}`);
    }
  }
  for (const row of rows.values()) {
    const base = `penglai-dsh-source:${row.name}@${row.version}`;
    lock = lock.replace(
      new RegExp(`${escapeRegExp(base)}(?:\\+sha256\\.[0-9a-f]{16})?`, "g"),
      dshLocalPackageId(row),
    );
  }
  return lock.replace(customResolutionPattern, (whole, name, version, _digest, tarballPath) => {
    const row = rows.get(name);
    if (!row || row.version !== version || row.file.slice("file:".length) !== tarballPath) return whole;
    return `resolution: {name: '${name}', version: ${version}, sha256: ${row.sha256}, tarballPath: ${tarballPath}, type: custom:penglai-dsh-source}`;
  });
}

export function verifyDshLocalDependencyLock(lockBytes, map) {
  const lock = String(lockBytes);
  if (/0\.1\.1-rc\.2|registry\.npmjs\.org\/@deepseek-ai|https?:\/\/[^\s]*deepseek-ai/i.test(lock)) {
    throw new Error("pnpm lock contains a legacy or remote DeepSeek dependency source");
  }
  const rows = new Map(map.packages.map((row) => [row.name, row]));
  const customResolutions = [...lock.matchAll(
    /resolution: \{name: '?([^,']+)'?, version: ([^, }]+), sha256: ([0-9a-f]{64}), tarballPath: ([^, }]+), type: custom:penglai-dsh-source\}/g,
  )];
  if (customResolutions.length === 0) {
    throw new Error("pnpm lock contains no Penglai DSH source resolutions");
  }
  const seen = new Set();
  for (const match of customResolutions) {
    const [, name, version, digest, tarballPath] = match;
    const expected = rows.get(name);
    if (
      !expected ||
      version !== expected.version ||
      digest !== expected.sha256 ||
      tarballPath !== expected.file.slice("file:".length)
    ) {
      throw new Error(`pnpm lock DSH source resolution differs from the audited closure: ${name}`);
    }
    const base = `penglai-dsh-source:${expected.name}@${expected.version}`;
    if (
      !lock.includes(dshLocalPackageId(expected)) ||
      new RegExp(`${escapeRegExp(base)}(?!\\+sha256\\.[0-9a-f]{16})`).test(lock)
    ) {
      throw new Error(`pnpm lock DSH source package id is not content-addressed: ${name}`);
    }
    seen.add(name);
  }
  for (const name of [
    "@deepseek-ai/dsh",
    "@deepseek-ai/dsh-api-remotes",
    "@deepseek-ai/dsh-api-session-controller",
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-client-ui-settings-general",
    "@deepseek-ai/dsh-client-ui-slots",
  ]) {
    if (!seen.has(name)) throw new Error(`pnpm lock is missing required DSH source resolution: ${name}`);
  }
  return { resolvedPackageCount: seen.size };
}
