import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectPackagedCandidate } from "../../../scripts/lib/packaged-candidate.mjs";

const sourceSha = "a".repeat(40);

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
  const manifest = {
    release: "0.5.1",
    target: overrides.manifestTarget ?? "darwin-aarch64",
    dsh: "0.1.0-rc.8",
    files: [
      {
        path: "runtime/node/bin/node",
        sha256: createHash("sha256").update("node").digest("hex"),
        size: 4,
      },
    ],
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(resources, "runtime-manifest.json"), manifestText);
  writeFileSync(
    join(resources, "release-info.json"),
    `${JSON.stringify({
      productName: "Penglai",
      productVersion: "0.5.1",
      generationId: "penglai-dsh-v0.5",
      trustTier: "community-verified",
      sourceSha: overrides.sourceSha ?? sourceSha,
      treeDirty: false,
      targetPlatform: "darwin-arm64",
      dsh: "0.1.0-rc.8",
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
