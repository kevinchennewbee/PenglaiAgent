import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  buildDshLocalDependencyMap,
  dependencyOverrides,
  dshLocalPackageId,
  resealDshLocalDependencyLock,
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

test("fixed DSH closure manifest keeps release-identity bytes on Windows", () => {
  const attributes = readFileSync(`${ROOT}/.gitattributes`, "utf8");
  assert.match(
    attributes,
    /^third_party\/dsh\/\*\*\/closure-manifest\.json text eol=lf$/m,
  );
});

test("same-version DSH tarballs reseal lock identities without resolving unrelated packages", () => {
  const row = {
    name: "@deepseek-ai/dsh-example",
    version: "0.1.2-alpha.1",
    file: "file:third_party/dsh/0.1.2-alpha.1/dsh/example.tgz",
    sha256: "a".repeat(64),
  };
  const previous = [
    `'@deepseek-ai/dsh-example@penglai-dsh-source:@deepseek-ai/dsh-example@0.1.2-alpha.1':`,
    `  resolution: {name: '@deepseek-ai/dsh-example', version: 0.1.2-alpha.1, sha256: ${"b".repeat(64)}, tarballPath: third_party/dsh/0.1.2-alpha.1/dsh/example.tgz, type: custom:penglai-dsh-source}`,
    "  unrelated: js-yaml@4.3.1",
    "",
  ].join("\n");
  const resealed = resealDshLocalDependencyLock(previous, { packages: [row] });
  assert.match(resealed, new RegExp(dshLocalPackageId(row).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(resealed, new RegExp(`sha256: ${"a".repeat(64)}`));
  assert.match(resealed, /unrelated: js-yaml@4\.3\.1/);
});

test("0.5.9 retires the active source resolver without deleting 0.5.8 history", () => {
  assert.equal(existsSync(`${ROOT}/.pnpmfile.mjs`), false);
  const lock = readFileSync(`${ROOT}/pnpm-lock.yaml`, "utf8");
  assert.doesNotMatch(lock, /penglai-dsh-source|0\.1\.2-alpha\.1/);
  assert.match(lock, /@deepseek-ai\/dsh@0\.1\.2-alpha\.2/);
});
