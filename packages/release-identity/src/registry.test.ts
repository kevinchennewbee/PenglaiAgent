import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { recordAssertion } from "./assertion.js";
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
  assert.ok(ids.includes("R50-TRUTH-001"));
  assert.ok(ids.includes("R50-E2E-008"));
  assert.ok(ids.includes("R50-LIVE-008"));
  assert.ok(ids.includes("R50-LIVE-016"));
  assert.ok(ids.includes("R50-VOICE-001"));
  assert.ok(ids.includes("R50-VOICE-016"));
  assert.ok(ids.includes("R50-CTXMEM-001"));
  assert.ok(ids.includes("R50-CTXMEM-016"));
  assert.ok(ids.includes("R50-BUDGET-001"));
  assert.ok(ids.includes("R50-BUDGET-006"));
  assert.ok(ids.includes("R50-COMP-001"));
  assert.ok(ids.includes("R50-COMP-008"));
  assert.ok(ids.includes("R50-PREP-010"));
  assert.equal(ids.includes("R2I-BASE-001"), false);
  const live = entries.find((e) => e.id === "R50-LIVE-001");
  assert.ok(live?.platforms.includes("live"));
  const src = readFileSync(new URL("./registry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /EXPECTED_HARD_COUNT/);
  assert.doesNotMatch(readFileSync(new URL("./pins.ts", import.meta.url), "utf8"), /EXPECTED_HARD_COUNT\s*=\s*202/);
  recordAssertion({
    acceptanceId: "R50-E2E-006",
    runnerId: "release-identity.registry",
    testId: "parse-r50-registry",
    assertionId: "registry-dynamic-unique-r50",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("legacy 202-ID summaries and wrong-SHA evidence are STALE", () => {
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const entries = parseAcceptanceRegistry(md);
  assert.equal(legacyEvidenceGeneration({ claimedHardCount: LEGACY_HARD_COUNT_STALE }), "STALE");
  assert.equal(legacyEvidenceGeneration({ claimedIds: Array.from({ length: 202 }, (_, i) => `R50-OLD-${String(i + 1).padStart(3, "0")}`) }), "STALE");
  const staleReg = evaluateEvidenceV2({
    registry: entries.slice(0, LEGACY_HARD_COUNT_STALE),
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
  assert.equal(current.results.find((r) => r.id === "R50-VOICE-001")?.status, "NOT_RUN");
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
  assert.ok(requiredFamilyIds().includes("R50-LIVE-009"));
});
