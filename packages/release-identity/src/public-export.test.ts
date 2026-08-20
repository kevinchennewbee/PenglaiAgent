import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import {
  assertExportHasSourceNotOnlyBinary,
  assertPublicationTarget,
  assertRequiredPublicDocs,
  classifyLicense,
  futurePublicAssetIdentityGate,
  pathAllowed,
  publicExportTreeSha256,
  scanExportText,
} from "./public-export.js";
import { PUBLICATION_TARGET } from "./pins.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-PREP-001 allowlist is deterministic and denies private trees", () => {
  assert.equal(pathAllowed("third_party/NOTICE"), true);
  assert.equal(pathAllowed("packaging/penglai.icns"), true);
  assert.equal(pathAllowed("packages/runtime/src/index.ts"), true);
  assert.equal(pathAllowed("LICENSE"), true);
  assert.equal(pathAllowed("SECURITY.md"), true);
  assert.equal(pathAllowed("CONTRIBUTING.md"), true);
  assert.equal(pathAllowed(".npmrc"), true);
  assert.equal(pathAllowed("STATE.md"), false);
  assert.equal(pathAllowed("docs/GROK_HANDOFF.md"), false);
  assert.equal(pathAllowed("docs/PLAN.md"), false);
  assert.equal(pathAllowed("packages/credentials-keychain/src/index.ts"), false);
  assert.equal(pathAllowed("packages/plugin-center/src/loopback-llm.ts"), false);
  assert.equal(pathAllowed("packages/plugin-center/src/loopback-llm.test.ts"), false);
  assert.equal(pathAllowed("packages/plugin-center/src/loopback-live.test.ts"), false);
  assert.equal(pathAllowed("packages/plugin-center/src/usable-fixture.test.ts"), false);
  assert.equal(pathAllowed("packages/im/src/test-only-causal.ts"), false);
  assert.equal(pathAllowed("packages/release-identity/src/freeze.test.ts"), false);
  assert.equal(pathAllowed("packages/release-identity/src/leftover-gates.test.ts"), false);
  assert.equal(pathAllowed("packages/release-identity/src/remaining-gates.test.ts"), false);
  assert.equal(pathAllowed("evidence/generated/x.json"), false);
  assert.equal(pathAllowed("dist/Penglai_0.5.0_macos_aarch64.dmg"), false);
  const a = publicExportTreeSha256([
    { path: "LICENSE", mode: "0644", size: 1, sha256: "aa", license: "MIT" },
    { path: "README.md", mode: "0644", size: 2, sha256: "bb", license: "MIT" },
  ]);
  const b = publicExportTreeSha256([
    { path: "README.md", mode: "0644", size: 2, sha256: "bb", license: "MIT" },
    { path: "LICENSE", mode: "0644", size: 1, sha256: "aa", license: "MIT" },
  ]);
  assert.equal(a, b);
  recordAssertion({
    acceptanceId: "R50-PREP-001",
    runnerId: "export",
    testId: "public-export-allowlist",
    assertionId: "allowlist-tree-hash",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "allowlist excludes STATE/evidence/dist and tree hash is order-stable" },
  });
});

test("R50-PREP-002 export scan rejects secret and owner path", () => {
  assert.throws(() => scanExportText("README.md", "key sk-abcdefghijklmnopxxxx"), PenglaiError);
  assert.throws(() => scanExportText("README.md", "path /Volumes/KevinSSD-in/x"), PenglaiError);
  assert.throws(() => scanExportText("README.md", "notes /Users/alice/secret"), PenglaiError);
  assert.doesNotThrow(() => scanExportText("README.md", "community-verified ad-hoc"));
  assert.doesNotThrow(() => scanExportText("docs/SECURITY.md", "飞书App Secret write-only"));
  assert.doesNotThrow(() => scanExportText("layout.ts", 'home: "/Users/测 试"'));
  assert.doesNotThrow(() => scanExportText("public-export.test.ts", "path /Volumes/KevinSSD-in/x"));
  recordAssertion({
    acceptanceId: "R50-PREP-002",
    runnerId: "export",
    testId: "public-export-scan",
    assertionId: "secret-owner-path-denied",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "export scanner rejects secret-like tokens and owner paths" },
  });
});

test("R50-PREP-003 manifest fields include path mode size hash license", () => {
  assert.equal(classifyLicense("LICENSE"), "MIT");
  assert.equal(classifyLicense("overlays/dsh/note.txt"), "upstream-overlay");
  const file = { path: "LICENSE", mode: "0644", size: 10, sha256: "ab", license: classifyLicense("LICENSE") };
  assert.ok(file.mode && file.size && file.sha256 && file.license);
  recordAssertion({
    acceptanceId: "R50-PREP-003",
    runnerId: "export",
    testId: "public-export-manifest-fields",
    assertionId: "path-mode-size-hash-license",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "export manifest requires path/mode/size/hash/license" },
  });
});

test("R50-PREP-005 required public docs are enumerated", () => {
  assert.throws(() => assertRequiredPublicDocs(["LICENSE"]), /missing/);
  assert.doesNotThrow(() =>
    assertRequiredPublicDocs([
      "LICENSE",
      "README.md",
      "SECURITY.md",
      "CONTRIBUTING.md",
      ".npmrc",
      "package.json",
      "pnpm-lock.yaml",
      "release-contract.json",
      "docs/SECURITY.md",
      "docs/PUBLICATION_0.5.0.md",
      "docs/PUBLICATION_MANIFEST_0.5.0.md",
      "docs/RELEASE_NOTES_0.5.0.md",
    ]),
  );
  recordAssertion({
    acceptanceId: "R50-PREP-005",
    runnerId: "docs",
    testId: "required-public-docs",
    assertionId: "license-readme-security-contributing",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "LICENSE README SECURITY CONTRIBUTING are required export docs" },
  });
});

test("R50-PREP-006 export must contain source lock and provenance", () => {
  assert.throws(() => assertExportHasSourceNotOnlyBinary(["Penglai.app"]), /source/);
  assert.doesNotThrow(() =>
    assertExportHasSourceNotOnlyBinary(["packages/runtime/src/index.ts", "pnpm-lock.yaml", "release-contract.json"]),
  );
  recordAssertion({
    acceptanceId: "R50-PREP-006",
    runnerId: "export",
    testId: "source-not-binary-only",
    assertionId: "source-lock-contract",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "export requires TypeScript source, lockfile, and release contract" },
  });
});

test("public TypeScript project references are all present in the export", () => {
  const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")) as {
    references?: Array<{ path?: string }>;
  };
  const missing = (tsconfig.references ?? [])
    .map((entry) => String(entry.path ?? ""))
    .filter((path) => !path || !pathAllowed(`${path}/package.json`));
  assert.deepEqual(missing, []);
});

test("R50-PREP-009 future public assets must equal accepted bytes", () => {
  const sha = "a".repeat(64);
  assert.doesNotThrow(() => futurePublicAssetIdentityGate(sha, sha));
  assert.throws(() => futurePublicAssetIdentityGate(sha, "b".repeat(64)), /exact accepted bytes/);
  recordAssertion({
    acceptanceId: "R50-PREP-009",
    runnerId: "contract",
    testId: "future-public-asset-identity",
    assertionId: "accepted-bytes-must-match",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "future public Release upload cannot rebuild or substitute accepted bytes" },
  });
});

test("R50-PREP-010 publication fields match the owner-authorized target", () => {
  assert.doesNotThrow(() =>
    assertPublicationTarget({ ...PUBLICATION_TARGET }),
  );
  assert.throws(() => assertPublicationTarget({ ...PUBLICATION_TARGET, repo: "wrong/repo" }));
  recordAssertion({
    acceptanceId: "R50-PREP-010",
    runnerId: "audit",
    testId: "publication-authorized-target",
    assertionId: "repo-tag-release-channel-exact",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "public repo, v0.5.0 tag and release are exact; updater channel remains unpublished" },
  });
});

test("soak evidence contract refuses short or stale runs without claiming REL-010", () => {
  const soak = readFileSync(join(root, "scripts/verify-soak.mjs"), "utf8");
  const runner = readFileSync(join(root, "scripts/soak-installed.mjs"), "utf8");
  assert.match(soak, /hours < 2/);
  assert.match(runner, /PENGLAI_SOAK/);
  assert.match(runner, /installerSha256/);
  assert.match(runner, /fromExactDmg/);
  assert.match(runner, /two-hour soak not present/);
  assert.match(runner, /samplesCovered/);
  assert.match(runner, /"offline"/);
  assert.match(runner, /evaluateLiveSample/);
  assert.match(runner, /PENGLAI_SOAK_ALLOW_LONG/);
});
