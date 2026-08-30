import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  readReleaseIdentityPins,
  RELEASE_PINS_SOURCE,
} from "./release-pins-source.mjs";

test("release identity copies resolve from the one authoritative pins source", () => {
  const pins = readReleaseIdentityPins();
  assert.equal(pins.productVersion, "0.5.8");
  assert.equal(pins.dsh, "0.1.2-alpha.1");
  assert.equal(
    pins.dshSource.commit,
    "cd5ef8148158c3a752a658978873241fdf8e2bbc",
  );
  assert.equal(pins.dshSource.packageCount, 251);
  assert.equal(pins.node, "22.22.2");
  assert.equal(pins.targets.length, 3);
  assert.deepEqual(
    pins.targets.map((row) => row.key),
    ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"],
  );
});

test("version verifier consumes the authority instead of declaring a second expected version", () => {
  const source = readFileSync(
    new URL("../verify-versions.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /readReleaseIdentityPins\(\)/);
  assert.match(source, /const EXPECT = pins\.productVersion/);
  assert.doesNotMatch(source, /const EXPECT = "0\.5\.8"/);
});

test("release pin reader fails closed when an authority is duplicated", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-release-pins-"));
  const target = join(root, RELEASE_PINS_SOURCE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${readFileForTest()}\nexport const PRODUCT_VERSION = "forged";\n`,
  );
  try {
    assert.throws(
      () => readReleaseIdentityPins(root),
      /PRODUCT_VERSION must have one closed source declaration/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readFileForTest() {
  const pins = readReleaseIdentityPins();
  return [
    `export const PRODUCT_NAME = "${pins.productName}";`,
    `export const PRODUCT_VERSION = "${pins.productVersion}";`,
    `export const CANDIDATE_KIND = "${pins.candidateKind}";`,
    `export const TRUST_TIER = "${pins.trustTier}";`,
    `export const GENERATION_ID = "${pins.generationId}";`,
    `export const SIGNATURE_KIND = "${pins.signatureKind}";`,
    `export const PINNED_NODE = "${pins.node}";`,
    `export const PINNED_PNPM = "${pins.pnpm}";`,
    `export const PINNED_ELECTRON = "${pins.electron}";`,
    `export const PINNED_DSH = "${pins.dsh}";`,
    `export const PINNED_DSH_REPOSITORY = "${pins.dshSource.repository}";`,
    `export const PINNED_DSH_TAG = "${pins.dshSource.tag}";`,
    `export const PINNED_DSH_COMMIT = "${pins.dshSource.commit}";`,
    `export const PINNED_DSH_CLOSURE_MANIFEST_SHA256 = "${pins.dshSource.closureManifestSha256}";`,
    `export const PINNED_DSH_TARBALL_SHA256 = "${pins.dshSource.cliTarballSha256}";`,
    `export const PINNED_DSH_CLOSURE_PACKAGE_COUNT = ${pins.dshSource.packageCount};`,
    `export const PROFILE_SCHEMA = ${pins.profileSchema};`,
    `export const CATALOG_SCHEMA = ${pins.catalogSchema};`,
    `export const IM_SCHEMA = ${pins.imSchema};`,
    "export const PUBLICATION_TARGET = Object.freeze({",
    `  repo: "${pins.publication.repo}",`,
    `  tag: "${pins.publication.tag}",`,
    `  release: "${pins.publication.release}",`,
    `  channel: "${pins.publication.channel}",`,
    "});",
    "export const RELEASE_TARGETS = [",
    ...pins.targets.flatMap((row) => [
      "  {",
      `    key: "${row.key}",`,
      `    platform: "${row.platform}",`,
      `    arch: "${row.arch}",`,
      `    installer: "${row.installer}",`,
      "  }",
    ]),
    "] as const;",
  ].join("\n");
}
