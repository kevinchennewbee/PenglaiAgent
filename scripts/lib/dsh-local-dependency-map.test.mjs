import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  penglaiDshSourceFetcher,
  penglaiDshSourceResolver,
} from "../../.pnpmfile.mjs";
import {
  buildDshLocalDependencyMap,
  dependencyOverrides,
  verifyDshLocalDependencyLock,
} from "./dsh-local-dependency-map.mjs";
import { ROOT } from "./repo.mjs";

test("fixed DSH source closure produces an exhaustive no-registry dependency map", () => {
  const map = buildDshLocalDependencyMap(ROOT);
  assert.equal(map.source.version, "0.1.2-alpha.1");
  assert.equal(map.source.commit, "cd5ef8148158c3a752a658978873241fdf8e2bbc");
  assert.equal(map.policy.officialNpmRequired, false);
  assert.equal(map.policy.registryFallbackAllowed, false);
  assert.equal(map.packageCount, 251);
  assert.equal(new Set(map.packages.map((row) => row.name)).size, 251);
  assert.match(map.source.closureManifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(map.packages.find((row) => row.name === "@deepseek-ai/dsh")?.version, "0.1.2-alpha.1");
  assert.match(dependencyOverrides(map)["@deepseek-ai/dsh"], /^file:third_party\/dsh\/0\.1\.2-alpha\.1\/dsh\//);
});

test("pnpm resolver recognizes every audited package and no unrelated package", () => {
  const map = buildDshLocalDependencyMap(ROOT);
  for (const row of map.packages) {
    const request = { alias: row.name };
    assert.equal(penglaiDshSourceResolver.canResolve(request), true, row.name);
    assert.deepEqual(penglaiDshSourceResolver.resolve(request).resolution, {
      type: "custom:penglai-dsh-source",
      name: row.name,
      version: row.version,
      sha256: row.sha256,
      tarballPath: row.file.slice("file:".length),
    });
  }
  assert.equal(penglaiDshSourceResolver.canResolve({ alias: "react" }), false);
});

test("pnpm fetcher verifies bytes before delegating to the local tarball fetcher", async () => {
  const map = buildDshLocalDependencyMap(ROOT);
  const row = map.packages.find((entry) => entry.name === "@deepseek-ai/dsh");
  assert.ok(row);
  const resolution = penglaiDshSourceResolver.resolve({ alias: row.name }).resolution;
  let delegated;
  const result = await penglaiDshSourceFetcher.fetch(
    {},
    resolution,
    { lockfileDir: ROOT },
    {
      localTarball(_cafs, spec, opts) {
        delegated = { spec, opts };
        return "verified-local-tarball";
      },
    },
  );
  assert.equal(result, "verified-local-tarball");
  assert.match(delegated.spec.tarball, /third_party\/dsh\/0\.1\.2-alpha\.1\/dsh\//);
  assert.match(delegated.spec.integrity, /^sha512-/);
});

test("pnpm lock binds every required DSH integration root to the source closure", () => {
  const map = buildDshLocalDependencyMap(ROOT);
  const result = verifyDshLocalDependencyLock(readFileSync(`${ROOT}/pnpm-lock.yaml`, "utf8"), map);
  assert.ok(result.resolvedPackageCount > 200);
});
