import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectPackagedCandidate } from "../../../scripts/lib/packaged-candidate.mjs";
import { readReleaseIdentityPins } from "../../../scripts/lib/release-pins-source.mjs";

const sourceSha = "a".repeat(40);
const pins = readReleaseIdentityPins();

function fixture(
  overrides: {
    sourceSha?: string;
    target?: string;
    manifestTarget?: string;
    mutateManifest?: boolean;
    mutatePayload?: boolean;
    omitPublicExportTreeSha256?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "penglai-artifact-provenance-"));
  const app = join(root, "Penglai.app");
  const resources = join(app, "Contents/Resources");
  mkdirSync(join(resources, "runtime/node/bin"), { recursive: true });
  mkdirSync(join(resources, "runtime/dsh/lib"), { recursive: true });
  writeFileSync(join(app, "Contents/Info.plist"), "plist");
  writeFileSync(join(resources, "runtime/node/bin/node"), "node");
  writeFileSync(join(resources, "runtime/dsh/lib/bin.js"), "dsh");
  const legalFiles = [
    "libvips-LGPL-2.1.txt",
    "sharp-libvips-Apache-2.0.txt",
    "sharp-libvips-THIRD-PARTY-NOTICES.md",
  ].map((name) => {
    const bytes = readFileSync(join(process.cwd(), "third_party", "sharp", name));
    mkdirSync(join(resources, "licenses", "sharp"), { recursive: true });
    writeFileSync(join(resources, "licenses", "sharp", name), bytes);
    return {
      path: `licenses/sharp/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    };
  });
  const manifest = {
    release: pins.productVersion,
    target: overrides.manifestTarget ?? "darwin-aarch64",
    dsh: pins.dsh,
    files: [
      {
        path: "runtime/node/bin/node",
        sha256: createHash("sha256").update("node").digest("hex"),
        size: 4,
      },
      ...legalFiles,
    ],
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(resources, "runtime-manifest.json"), manifestText);
  writeFileSync(
    join(resources, "release-info.json"),
    `${JSON.stringify({
      productName: "Penglai",
      productVersion: pins.productVersion,
      generationId: "penglai-dsh-v0.5",
      trustTier: "community-verified",
      sourceSha: overrides.sourceSha ?? sourceSha,
      treeDirty: false,
      targetPlatform: "darwin-arm64",
      dsh: pins.dsh,
      dshSource: pins.dshSource,
      ...(overrides.omitPublicExportTreeSha256
        ? {}
        : { publicExportTreeSha256: "e".repeat(64) }),
    })}\n`,
  );
  writeFileSync(
    join(resources, "closure-credential.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      target: overrides.target ?? "darwin-aarch64",
      manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    })}\n`,
  );
  if (overrides.mutateManifest)
    writeFileSync(join(resources, "runtime-manifest.json"), `${manifestText} `);
  if (overrides.mutatePayload)
    writeFileSync(join(resources, "runtime/node/bin/node"), "evil");
  return app;
}

test("exact packaged candidate binds source, target, and manifest bytes", () => {
  const result = inspectPackagedCandidate({
    app: fixture(),
    candidateSha: sourceSha,
    expectedTarget: "darwin-aarch64",
  });
  assert.equal(result.verdict, "PASS");
});

test("old packaged source cannot inherit the current Git SHA", () => {
  const result = inspectPackagedCandidate({
    app: fixture({ sourceSha: "b".repeat(40) }),
    candidateSha: sourceSha,
    expectedTarget: "darwin-aarch64",
  });
  assert.equal(result.verdict, "STALE");
});

test("packaged candidate must bind the verified public export tree", () => {
  const result = inspectPackagedCandidate({
    app: fixture({ omitPublicExportTreeSha256: true }),
    candidateSha: sourceSha,
    expectedTarget: "darwin-aarch64",
  });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.reason, /public export tree hash/);
});

test("wrong target and post-closure manifest mutation fail closed", () => {
  assert.equal(
    inspectPackagedCandidate({
      app: fixture({ target: "darwin-x86_64" }),
      candidateSha: sourceSha,
      expectedTarget: "darwin-aarch64",
    }).verdict,
    "FAIL",
  );
  assert.equal(
    inspectPackagedCandidate({
      app: fixture({ mutateManifest: true }),
      candidateSha: sourceSha,
      expectedTarget: "darwin-aarch64",
    }).verdict,
    "STALE",
  );
});

test("sealed manifest cannot bless altered runtime bytes", () => {
  const result = inspectPackagedCandidate({
    app: fixture({ mutatePayload: true }),
    candidateSha: sourceSha,
    expectedTarget: "darwin-aarch64",
  });
  assert.equal(result.verdict, "STALE");
});
