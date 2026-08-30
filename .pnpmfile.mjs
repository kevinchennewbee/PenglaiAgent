import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLOSURE_ROOT = join(ROOT, "third_party/dsh/0.1.2-alpha.1");
const closure = JSON.parse(readFileSync(join(CLOSURE_ROOT, "closure-manifest.json"), "utf8"));
const packages = new Map();
for (const family of closure.families ?? []) {
  for (const entry of family.packages ?? []) {
    packages.set(entry.name, {
      version: entry.version,
      sha256: entry.sha256,
      tarballPath: `third_party/dsh/0.1.2-alpha.1/${family.id}/${entry.filename}`,
    });
  }
}
if (packages.size !== 251 || closure.source?.head !== "cd5ef8148158c3a752a658978873241fdf8e2bbc") {
  throw new Error("Penglai DSH local resolver refuses an incomplete or unexpected source closure");
}

export const penglaiDshSourceResolver = {
  canResolve(wantedDependency) {
    return packages.has(wantedDependency.alias);
  },
  resolve(wantedDependency) {
    const entry = packages.get(wantedDependency.alias);
    return {
      // Source builds may legitimately reseal same-version tarballs when the
      // reproducible build contract changes. Bind the package id to its bytes
      // so pnpm refreshes the lock instead of reusing a stale resolution.
      id: `penglai-dsh-source:${wantedDependency.alias}@${entry.version}+sha256.${entry.sha256.slice(0, 16)}`,
      resolution: {
        type: "custom:penglai-dsh-source",
        name: wantedDependency.alias,
        version: entry.version,
        sha256: entry.sha256,
        tarballPath: entry.tarballPath,
      },
    };
  },
};

export const penglaiDshSourceFetcher = {
  canFetch(_pkgId, resolution) {
    return resolution.type === "custom:penglai-dsh-source";
  },
  async fetch(cafs, resolution, opts, fetchers) {
    const entry = packages.get(resolution.name);
    if (!entry || entry.version !== resolution.version || entry.tarballPath !== resolution.tarballPath) {
      throw new Error(`Penglai DSH local fetcher refuses unknown package ${resolution.name}`);
    }
    const tarball = join(ROOT, entry.tarballPath);
    const bytes = readFileSync(tarball);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== entry.sha256 || actualSha256 !== resolution.sha256) {
      throw new Error(`Penglai DSH local fetcher detected modified bytes for ${resolution.name}`);
    }
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    return fetchers.localTarball(cafs, { tarball: `file:${tarball}`, integrity }, opts);
  },
};

export const resolvers = [penglaiDshSourceResolver];
export const fetchers = [penglaiDshSourceFetcher];
