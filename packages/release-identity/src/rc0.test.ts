import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { recordAssertion } from "./assertion.js";
import {
  ARM64_DEFERRED_GATES,
  assertRequiredKindsPresent,
  assertResultClassNotSubstituted,
  evaluateApplicableDomain,
  evaluateReleaseAggregation,
  listedSubgateKinds,
  listedSubgateNames,
  releaseVerdictFrom,
} from "./candidate.js";
import { EXIT_BY_VERDICT, exitCodeForVerdict } from "./exit.js";
import { assertRegistryConsistent, documentDeclaredHardCount, parseAcceptanceIds } from "./registry.js";
import {
  assertArtifactNotStale,
  assertBuildInputsNotStale,
  assertStateArtifactConsistent,
} from "./stale.js";
import { assertProductPathClean, assertUserCatalogAllowlist, historicalClassification } from "./product-path.js";
import {
  GITHUB_ACTIONS_STATUS,
  HARD_SUBGATES,
  PRODUCT_VERSION,
  REQUIRED_SUBGATE_KINDS,
} from "./pins.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-TRUTH-003 stale alpha.3 and alpha.2 artifacts are rejected", () => {
  assert.throws(
    () =>
      assertArtifactNotStale({
        sourceSha: "ba5ba3dd65602a30a4b9fb815472d9abdc4805e5",
        artifactSha256: "c19e393e5d9b85190e60286e4fca30dbeb242799013baf605cf3615782683c79",
        path: "dist/Penglai_0.2.0-alpha.3_macos_aarch64.dmg",
      }),
    /STALE_INVALIDATED/,
  );
  assert.throws(
    () =>
      assertArtifactNotStale({
        sourceSha: "6c2183f519dddf9014b454955476994580341500",
        sha256: "8c31fac644ed4042bf5091fb72a9655d087827483a3801f7364b3b1fe5a3af3f",
        path: "dist/Penglai_0.2.0_macos_aarch64.dmg",
      }),
    /STALE_INVALIDATED/,
  );
  assert.throws(
    () =>
      assertArtifactNotStale({
        artifactSha256: "ee28dafdddca543d8af9ac423b3328da544c0b3236322aaee73db78edb053f2e",
      }),
    /STALE_INVALIDATED/,
  );
  recordAssertion({
    acceptanceId: "R50-TRUTH-003",
    runnerId: "release-identity.rc0",
    testId: "stale-alpha-rejected",
    assertionId: "alpha-hashes-stale-invalidated",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("forged STATE hash vs disk hash fails", () => {
  const state = [
    "磁盘文件：`dist/Penglai_0.2.0_macos_aarch64.dmg`",
    "实际 SHA-256：`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`",
  ].join("\n");
  assert.throws(
    () =>
      assertStateArtifactConsistent(state, {
        "dist/Penglai_0.2.0_macos_aarch64.dmg":
          "8c31fac644ed4042bf5091fb72a9655d087827483a3801f7364b3b1fe5a3af3f",
      }),
    PenglaiError,
  );
});

test("keychain in product-path text fails", () => {
  assert.throws(
    () =>
      assertProductPathClean({
        "scripts/pack-plugins.mjs": 'id: "@penglai/credentials-keychain"',
      }),
    /credentials-keychain/,
  );
  assert.throws(() => assertUserCatalogAllowlist(["@penglai/credentials-keychain"]), PenglaiError);
  assert.equal(historicalClassification("@penglai/credentials-keychain"), "historical/not-product");
});

test("R50-TRUTH-007 / R50-E2E-008 aggregator lists all hard kinds and propagates failure", () => {
  assertRequiredKindsPresent();
  for (const kind of REQUIRED_SUBGATE_KINDS) {
    assert.ok(listedSubgateKinds().includes(kind), kind);
  }
  assert.ok(listedSubgateNames().includes("verify:fuses"));
  assert.ok(listedSubgateNames().includes("verify:installed"));
  assert.ok(listedSubgateNames().includes("audit:secrets"));
  assert.equal(HARD_SUBGATES.length >= 18, true);

  const incomplete = evaluateReleaseAggregation({
    records: HARD_SUBGATES.map((g) => ({
      name: g.name,
      exit: g.name === "verify:fuses" ? 2 : 0,
      verdict: g.name === "verify:fuses" ? "INCOMPLETE" : "PASS",
    })),
    summaryVerdict: "INCOMPLETE",
  });
  assert.equal(incomplete.verdict, "INCOMPLETE");
  assert.notEqual(incomplete.exitCode, 0);

  const injected = evaluateReleaseAggregation({
    records: HARD_SUBGATES.map((g) => ({
      name: g.name,
      exit: g.name === "verify:identity" ? 1 : 0,
      verdict: g.name === "verify:identity" ? "FAIL" : "PASS",
    })),
    summaryVerdict: "PASS",
  });
  assert.equal(injected.verdict, "FAIL");
  assert.notEqual(injected.exitCode, 0);

  const missing = evaluateReleaseAggregation({
    records: [{ name: "test:unit", exit: 0, verdict: "PASS" }],
    requireAllSubgates: true,
  });
  assert.equal(missing.verdict, "INCOMPLETE");
  assert.notEqual(missing.exitCode, 0);
  assert.ok(missing.missingGates.includes("verify:fuses"));

  const deferred = new Set<string>(ARM64_DEFERRED_GATES);
  const applicable = evaluateApplicableDomain({
    records: HARD_SUBGATES.map((g) => ({
      name: g.name,
      exit: deferred.has(g.name) ? 2 : 0,
      verdict: deferred.has(g.name) ? "INCOMPLETE" : "PASS",
    })),
    summaryVerdict: "INCOMPLETE",
    summaryTotals: { fail: 0, stale: 0 },
  });
  // The arm64 domain can PASS while deferred gates are incomplete, but the
  // release verdict must still be INCOMPLETE (a domain PASS never masks
  // incomplete deferred gates into a release PASS).
  assert.equal(applicable.verdict, "PASS");
  assert.ok(applicable.deferred.includes("verify:installed"));
  const masked = releaseVerdictFrom(applicable, {
    verdict: "INCOMPLETE",
    exitCode: EXIT_BY_VERDICT.INCOMPLETE,
  });
  assert.equal(masked.verdict, "INCOMPLETE");
  assert.equal(masked.exitCode, EXIT_BY_VERDICT.INCOMPLETE);
  const escalated = releaseVerdictFrom({ verdict: "FAIL" }, {
    verdict: "INCOMPLETE",
    exitCode: EXIT_BY_VERDICT.INCOMPLETE,
  });
  assert.equal(escalated.verdict, "FAIL");
  assert.equal(escalated.exitCode, EXIT_BY_VERDICT.FAIL);
  const staleInstalled = evaluateApplicableDomain({
    records: HARD_SUBGATES.map((g) => ({
      name: g.name,
      exit: g.name === "verify:installed" ? 3 : 0,
      verdict: g.name === "verify:installed" ? "STALE" : "PASS",
    })),
    summaryVerdict: "INCOMPLETE",
    summaryTotals: { fail: 0, stale: 0 },
  });
  assert.equal(staleInstalled.verdict, "FAIL");

  recordAssertion({
    acceptanceId: "R50-TRUTH-007",
    runnerId: "release-identity.rc0",
    testId: "aggregator-nonzero",
    assertionId: "incomplete-or-fail-subgate-nonzero",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
  recordAssertion({
    acceptanceId: "R50-E2E-008",
    runnerId: "release-identity.rc0",
    testId: "aggregator-lists-kinds",
    assertionId: "all-hard-kinds-listed-and-propagated",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("INCOMPLETE exit contract is non-zero unless --report", () => {
  assert.equal(exitCodeForVerdict("PASS"), 0);
  assert.equal(exitCodeForVerdict("FAIL"), 1);
  assert.equal(exitCodeForVerdict("INCOMPLETE"), 2);
  assert.equal(exitCodeForVerdict("STALE"), 3);
  assert.equal(exitCodeForVerdict("BLOCKED"), 4);
  assert.equal(exitCodeForVerdict("INCOMPLETE", true), 0);
});

test("community-verified cannot Waive missing notary into PASS", () => {
  const waived = evaluateReleaseAggregation({
    records: HARD_SUBGATES.map((g) => ({
      name: g.name,
      exit: 0,
      verdict: g.name === "verify:signing" ? "WAIVED" : "PASS",
    })),
    notaryEvidence: "claimed-waived",
    summaryVerdict: "PASS",
  });
  assert.equal(waived.verdict, "FAIL");
});

test("mock cannot substitute live", () => {
  assert.throws(() => assertResultClassNotSubstituted("R50-LIVE-002", "live", "test:unit mock fixture"), PenglaiError);
  assert.doesNotThrow(() => assertResultClassNotSubstituted("R50-WX-007", "contract", "pnpm test:contract"));
});

test("build inputs reject dirty named SHA and HEAD drift", () => {
  assert.throws(
    () =>
      assertBuildInputsNotStale({
        dirty: true,
        head: "a".repeat(40),
        originMain: "a".repeat(40),
        sourceSha: "b".repeat(40),
      }),
    /dirty/,
  );
  assert.throws(
    () =>
      assertBuildInputsNotStale({
        dirty: false,
        head: "a".repeat(40),
        originMain: "b".repeat(40),
      }),
    /origin\/main/,
  );
});

test("GitHub Actions is AVAILABLE for the 0.5.7 source candidate", () => {
  assert.equal(GITHUB_ACTIONS_STATUS, "AVAILABLE");
});

test("product version is 0.5.7 and registry count matches the document", () => {
  assert.equal(PRODUCT_VERSION, "0.5.7");
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const ids = parseAcceptanceIds(md);
  const entries = assertRegistryConsistent(md);
  assert.equal(ids.length, documentDeclaredHardCount(md));
  assert.equal(entries.length, ids.length);
});

test("live product-path files reject keychain/smoke", () => {
  const files: Record<string, string> = {
    "scripts/pack-plugins.mjs": readFileSync(join(root, "scripts/pack-plugins.mjs"), "utf8"),
    "profile-seed/web/package.json": readFileSync(join(root, "profile-seed/web/package.json"), "utf8"),
    "profile-seed/web/cordis.patch.yml": readFileSync(join(root, "profile-seed/web/cordis.patch.yml"), "utf8"),
    "packages/plugin-center/src/index.ts": readFileSync(join(root, "packages/plugin-center/src/index.ts"), "utf8"),
  };
  assertProductPathClean(files);
});
