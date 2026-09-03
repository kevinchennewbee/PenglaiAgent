import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { assertSafeArchive } from "./archive.js";
import {
  EXACT_RELEASE_ASSETS,
  assertCanonicalDownloadUrl,
  assertCanonicalUpdaterManifestUrl,
  assertReleaseContract,
  updaterRequiresIndependentSignature,
} from "./contract.js";
import { assertNoFakeArtifact, evaluateTargetPreflight } from "./preflight.js";
import { recordAssertion } from "./assertion.js";
import { GENERATION_ID } from "./pins.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-DIST-001 committed release-contract pins three targets and hashed downloads", () => {
  const raw = JSON.parse(readFileSync(join(root, "release-contract.json"), "utf8"));
  const contract = assertReleaseContract(raw);
  assert.equal(contract.dshVersion, "0.1.2-rc.1");
  assert.deepEqual(
    contract.targets.map((row) => row.key),
    ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"],
  );
  assert.equal(contract.targets.length, 3);
  assert.equal(contract.runtimeInputs.length, 6);
  assert.ok(updaterRequiresIndependentSignature(contract));
  assert.deepEqual(contract.exactAssets, [...EXACT_RELEASE_ASSETS]);
  assert.doesNotThrow(() => assertCanonicalUpdaterManifestUrl(contract.updaterManifestUrl));
  assert.doesNotThrow(() => assertCanonicalUpdaterManifestUrl(contract.updaterManifestSignatureUrl, true));
  for (const input of contract.runtimeInputs) {
    assert.doesNotThrow(() => assertCanonicalDownloadUrl(input.url));
    assert.equal(input.url.includes("latest"), false);
  }
  recordAssertion({
    acceptanceId: "R50-DIST-001",
    runnerId: "release-identity.contract",
    testId: "release-contract-pins",
    assertionId: "three-targets-hashed-downloads-exact-set",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("latest or HTTP download URLs are rejected", () => {
  assert.throws(() => assertCanonicalDownloadUrl("https://nodejs.org/dist/latest/node.tar.gz"), /non-canonical|latest/);
  assert.throws(() => assertCanonicalDownloadUrl("http://nodejs.org/dist/v22.22.2/node.tar.gz"), /https|non-canonical/);
});

test("updater manifest accepts only the pinned desktop-v0.5 GitHub URLs", () => {
  assert.throws(
    () => assertCanonicalUpdaterManifestUrl("https://evil.example/desktop-v0.5/latest.json"),
    /canonical/,
  );
  assert.throws(
    () => assertCanonicalUpdaterManifestUrl("https://github.com/x/y/releases/latest/download/latest.json"),
    /canonical/,
  );
});

test("R50-DIST-003 unsafe archives are refused", () => {
  assert.throws(() => assertSafeArchive([{ name: "../etc/passwd", type: "file" }]), /escape/);
  assert.throws(() => assertSafeArchive([{ name: "/tmp/x", type: "file" }]), /absolute/);
  assert.throws(() => assertSafeArchive([{ name: "bin", type: "symlink", linkTarget: "/bin/sh" }]), /symlink/);
  assert.throws(
    () =>
      assertSafeArchive([
        { name: "Foo", type: "file" },
        { name: "foo", type: "file" },
      ]),
    /case collision/,
  );
  recordAssertion({
    acceptanceId: "R50-DIST-003",
    runnerId: "release-identity.contract",
    testId: "safe-archive",
    assertionId: "zip-slip-symlink-case-reserved-refused",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("translated preflight is BLOCKED and cannot claim native", () => {
  const translated = evaluateTargetPreflight(
    { platform: "darwin", arch: "x64", native: false, translated: true },
    "darwin-aarch64",
  );
  assert.equal(translated.verdict, "BLOCKED");
  assert.equal(translated.nativeEvidenceAllowed, false);
  assert.throws(() => assertNoFakeArtifact(translated, true), PenglaiError);
  const arm = evaluateTargetPreflight({ platform: "darwin", arch: "arm64", native: true }, "darwin-aarch64");
  assert.equal(arm.verdict, "READY");
  const intelOnArm = evaluateTargetPreflight(
    { platform: "darwin", arch: "arm64", native: true },
    "darwin-x86_64",
  );
  assert.equal(intelOnArm.verdict, "BLOCKED");
  assert.equal(intelOnArm.nativeEvidenceAllowed, false);
  const windowsOnMac = evaluateTargetPreflight(
    { platform: "darwin", arch: "arm64", native: true },
    "win32-x86_64",
  );
  assert.equal(windowsOnMac.verdict, "BLOCKED");
  assert.equal(windowsOnMac.nativeEvidenceAllowed, false);
});

test("generation id is isolated from 0.4 data roots", () => {
  assert.equal(GENERATION_ID, "penglai-dsh-v0.5");
  assert.equal(GENERATION_ID.includes("0.4"), false);
  const adr = readFileSync(join(root, "docs/adr/0026-generation-and-product-id.md"), "utf8");
  assert.match(adr, /penglai-dsh-v0\.5/);
  assert.match(adr, /0\.4\.1/);
  assert.doesNotMatch(adr, /migrate 0\.4\.1 secrets/i);
});

test("packaging and update ADRs exist and reject silent auto-update / Squirrel as product", () => {
  const pack = readFileSync(join(root, "docs/adr/0024-canonical-packaging-maker.md"), "utf8");
  const upd = readFileSync(join(root, "docs/adr/0025-assisted-update.md"), "utf8");
  assert.match(pack, /canonical/);
  assert.match(pack, /NSIS/);
  assert.doesNotMatch(pack, /Squirrel\.Windows is the user installer/);
  assert.match(upd, /assisted/);
  assert.match(upd, /不实现|不得写静默|不得伪装/);
  assert.match(upd, /minisign|Ed25519/);
});
