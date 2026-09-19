import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import {
  assertExpectedCount,
  assertR50Only,
  assertRegistryConsistent,
  assertRequiredFamilies,
  documentDeclaredHardCount,
  isStaleCompletionMap,
  parseAcceptanceIds,
  parseAcceptanceRegistry,
  readyBlocked,
  requiredFamilyIds,
  tally,
} from "./registry.js";
import { negativeSelfTest } from "./evidence.js";
import { evaluateEvidenceV2, legacyEvidenceGeneration } from "./evidence-v2.js";
import { LEGACY_HARD_COUNT_STALE } from "./pins.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("acceptance registry parses unique R50 Hard IDs dynamically from the document", () => {
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const entries = assertRegistryConsistent(md);
  const ids = entries.map((e) => e.id);
  const declared = documentDeclaredHardCount(md);
  assert.equal(ids.length, declared);
  assert.equal(new Set(ids).size, declared);
  assert.equal(isStaleCompletionMap(declared), false);
  assert.equal(isStaleCompletionMap(LEGACY_HARD_COUNT_STALE), true);
  assert.throws(() => assertExpectedCount(ids, LEGACY_HARD_COUNT_STALE), /STALE/);
  assertR50Only(ids);
  assertRequiredFamilies(ids);
  // Family membership is asserted against the emitter registry rather than a
  // hand-written id list. The previous list named R50-VOICE/R50-CTXMEM/R50-LIVE/
  // R50-BUDGET/R50-COMP families, whose ids were emitted by nothing.
  const declaredFamilies = [...new Set(ids.map((id) => /^(R5[05]-[A-Z0-9]+)-\d+$/.exec(id)?.[1]).filter(Boolean))];
  assert.ok(declaredFamilies.length >= 15, `expected a broad registry, saw ${declaredFamilies.length} families`);
  assert.ok(ids.includes("R50-TRUTH-001"));
  assert.ok(ids.includes("R50-PREP-010"));
  assert.ok(ids.includes("R50-DRIFT-001"));
  assert.ok(ids.includes("R50-DOC-001"));
  assert.ok(ids.includes("R50-ABSENT-001"));
  assert.equal(ids.includes("R2I-BASE-001"), false);
  const truth = entries.find((e) => e.id === "R50-TRUTH-001");
  assert.ok(truth?.platforms.includes("all"));
  const src = readFileSync(new URL("./registry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /EXPECTED_HARD_COUNT/);
  assert.doesNotMatch(readFileSync(new URL("./pins.ts", import.meta.url), "utf8"), /EXPECTED_HARD_COUNT\s*=\s*202/);
  // R50-TRUTH-005 asserts the registry itself is a unique, dynamically parsed,
  // non-stale Hard set. It is emitted here because this is the only place that
  // actually checks those properties end to end.
  recordAssertion({
    acceptanceId: "R50-TRUTH-005",
    runnerId: "release-identity.registry",
    testId: "parse-r50-registry",
    assertionId: "registry-dynamic-unique-and-emittable",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
  });
});

test("legacy 202-ID summaries and wrong-SHA evidence are STALE", () => {
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const entries = parseAcceptanceRegistry(md);
  assert.equal(legacyEvidenceGeneration({ claimedHardCount: LEGACY_HARD_COUNT_STALE }), "STALE");
  assert.equal(legacyEvidenceGeneration({ claimedIds: Array.from({ length: 202 }, (_, i) => `R50-OLD-${String(i + 1).padStart(3, "0")}`) }), "STALE");
  // A synthetic legacy registry, not `entries.slice(...)`. The current registry
  // is shorter than LEGACY_HARD_COUNT_STALE, so slicing it yielded the current
  // registry and the stale-generation branch was never exercised.
  const legacyRegistry = Array.from({ length: LEGACY_HARD_COUNT_STALE }, (_, i) => ({
    id: `R50-OLD-${String(i + 1).padStart(3, "0")}`,
    requirement: "legacy",
    runner: "legacy/all",
    runnerClasses: ["legacy"],
    platforms: ["all"],
  }));
  const staleReg = evaluateEvidenceV2({
    registry: legacyRegistry,
    records: [],
    candidateSha: "a".repeat(40),
  });
  assert.equal(staleReg.verdict, "STALE");
  assert.equal(staleReg.totals.stale, LEGACY_HARD_COUNT_STALE);
  const current = evaluateEvidenceV2({
    registry: entries,
    records: [
      {
        acceptanceId: "R50-TRUTH-001",
        runnerId: "unit",
        runnerClass: "unit",
        target: "source",
        testId: "old",
        assertionId: "old-sha",
        status: "PASS",
        candidateSourceSha: "b".repeat(40),
        startedAt: "t",
        endedAt: "t",
        exitCode: 0,
        resultDigest: "d",
      },
    ],
    candidateSha: "a".repeat(40),
  });
  assert.equal(current.results.find((r) => r.id === "R50-TRUTH-001")?.status, "NOT_RUN");
  assert.equal(current.results.find((r) => r.id === "R50-ONB-001")?.status, "NOT_RUN");
  assert.equal(readyBlocked(current.totals), true);
});

test("negative self-test rejects missing duplicate unknown stale hardcoded", () => {
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const ids = parseAcceptanceIds(md);
  negativeSelfTest(ids, "f".repeat(40));
});

test("incomplete totals block READY", () => {
  const ids = ["R50-TRUTH-001", "R50-TRUTH-002"];
  const totals = tally(
    ids,
    [
      {
        id: "R50-TRUTH-001",
        status: "PASS",
        candidateSha: "a".repeat(40),
        runId: "t",
        timestamp: "t",
        assertionId: "one",
      },
      {
        id: "R50-TRUTH-002",
        status: "NOT_RUN",
        candidateSha: "a".repeat(40),
        runId: "t",
        timestamp: "t",
      },
    ],
    "a".repeat(40),
  );
  assert.equal(totals.notRun, 1);
  assert.equal(readyBlocked(totals), true);
});

test("required families cannot be omitted from a forged registry", () => {
  assert.throws(() => assertRequiredFamilies(["R50-TRUTH-001"]), PenglaiError);
  // The required set is asserted against ids that survive in the current
  // registry. It used to name R50-LIVE-009, a member of a family whose ids were
  // emitted by nothing.
  const required = requiredFamilyIds();
  assert.ok(required.includes("R50-TRUTH-005"));
  assert.ok(required.includes("R50-DRIFT-005"));
  assert.ok(required.includes("R50-DOC-005"));
  assert.ok(required.includes("R50-ABSENT-001"));
  assert.ok(!required.includes("R50-LIVE-009"));
});
