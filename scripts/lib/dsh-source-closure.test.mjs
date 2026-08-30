import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  normalizeRepositoryUrl,
  readDshSourceClosureContract,
  resolveClosureOutput,
  validateDshSourceClosureContract,
} from "./dsh-source-closure.mjs";
import { ROOT } from "./repo.mjs";

test("fixed DSH source closure contract is internally consistent", () => {
  const contract = readDshSourceClosureContract(ROOT);
  assert.equal(contract.upstream.version, "0.1.2-alpha.1");
  assert.equal(contract.transport.officialNpmRequired, false);
  assert.equal(contract.transport.publicNpmPublication, false);
  assert.equal(contract.toolchain.archivePacker, "npm@10.9.7");
  assert.equal(contract.officialClientBuild.title, "DeepSeek Harness");
  assert.equal(contract.build.canonicalHost.platform, "darwin");
  assert.equal(
    contract.build.canonicalHost.sourceRoot,
    "/private/tmp/penglai-dsh-source-closure-cd5ef8148158/source",
  );
  assert.equal(contract.build.packedInstallEnvironment.darwin.LDFLAGS, "-undefined dynamic_lookup");
  assert.equal(contract.transport.artifactNormalization.packageJson, "recursive-key-sort");
  assert.equal(
    contract.transport.artifactNormalization.compression,
    "fflate-gzip-level-9-mtime-zero",
  );
  assert.equal(
    [...contract.build.families, ...contract.build.auxiliaryPackages].reduce(
      (sum, row) => sum + row.expectedTarballs,
      0,
    ),
    251,
  );
});

test("source closure output is confined to the ignored cache root", () => {
  const contract = readDshSourceClosureContract(ROOT);
  assert.equal(
    resolveClosureOutput(ROOT, undefined, contract),
    resolve(ROOT, ".cache/dsh-source-closure/cd5ef8148158"),
  );
  assert.throws(() => resolveClosureOutput(ROOT, ".cache", contract), /must be a child/);
  assert.throws(() => resolveClosureOutput(ROOT, "dist/dsh", contract), /must be a child/);
});

test("contract rejects npm impersonation and upstream patches", () => {
  const contract = structuredClone(readDshSourceClosureContract(ROOT));
  contract.transport.publicNpmPublication = true;
  assert.throws(() => validateDshSourceClosureContract(contract), /must not publish/);
  contract.transport.publicNpmPublication = false;
  contract.transport.upstreamPatchPolicy = "local-patches";
  assert.throws(() => validateDshSourceClosureContract(contract), /must remain unpatched/);
});

test("contract keeps the official DSH client profile byte-identical", () => {
  const contract = structuredClone(readDshSourceClosureContract(ROOT));
  contract.officialClientBuild.title = "蓬莱 Penglai";
  assert.throws(() => validateDshSourceClosureContract(contract), /must remain unmodified/);
});

test("repository URL comparison ignores transport spelling only", () => {
  assert.equal(
    normalizeRepositoryUrl("git+https://github.com/deepseek-ai/deepseek-harness.git"),
    normalizeRepositoryUrl("https://github.com/deepseek-ai/deepseek-harness/"),
  );
});
