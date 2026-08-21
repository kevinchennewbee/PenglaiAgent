import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { assertEvidenceTextClean, assertNoFanOut, recordAssertion } from "./assertion.js";
import { buildEvidenceManifest } from "./evidence.js";

test("rejects hardcoded PASS", () => {
  assert.throws(
    () =>
      buildEvidenceManifest({
        release: "0.5.1",
        runId: "x",
        candidateSha: "a".repeat(40),
        registry: ["R50-TRUTH-001"],
        results: [
          {
            id: "R50-TRUTH-001",
            status: "PASS",
            candidateSha: "a".repeat(40),
            runId: "x",
            timestamp: "t",
            assertionId: "x",
            hardcoded: true,
          },
        ],
      }),
    PenglaiError,
  );
});

test("R50-E2E-005 one assertion cannot fan out to many IDs", () => {
  assert.throws(
    () =>
      assertNoFanOut([
        {
          acceptanceId: "R50-TRUTH-001",
          runnerId: "smoke",
          testId: "one-smoke",
          assertionId: "same-assert",
          status: "PASS",
          candidateSourceSha: "a".repeat(40),
          startedAt: "t",
          endedAt: "t",
          exitCode: 0,
          resultDigest: "d",
        },
        {
          acceptanceId: "R50-LIVE-001",
          runnerId: "smoke",
          testId: "one-smoke",
          assertionId: "same-assert",
          status: "PASS",
          candidateSourceSha: "a".repeat(40),
          startedAt: "t",
          endedAt: "t",
          exitCode: 0,
          resultDigest: "d",
        },
      ]),
    /fan-out/,
  );
  recordAssertion({
    acceptanceId: "R50-E2E-005",
    runnerId: "release-identity.evidence",
    testId: "fan-out-rejected",
    assertionId: "one-assertion-one-id",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("R50-E2E-007 translated-as-native is rejected", () => {
  assert.throws(
    () =>
      recordAssertion({
        acceptanceId: "R50-MAC-010",
        runnerId: "rosetta",
        testId: "x64",
        assertionId: "native-lie",
        status: "PASS",
        candidateSourceSha: "a".repeat(40),
        runnerNative: true,
        translated: true,
        exitCode: 0,
      }),
    /translated\/emulated/,
  );
  recordAssertion({
    acceptanceId: "R50-E2E-007",
    runnerId: "release-identity.evidence",
    testId: "translated-native-rejected",
    assertionId: "reject-translated-as-native",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("PASS without assertionId is rejected", () => {
  assert.throws(
    () =>
      buildEvidenceManifest({
        release: "0.5.1",
        runId: "x",
        candidateSha: "a".repeat(40),
        registry: ["R50-TRUTH-001"],
        results: [
          {
            id: "R50-TRUTH-001",
            status: "PASS",
            candidateSha: "a".repeat(40),
            runId: "x",
            timestamp: "t",
          },
        ],
      }),
    /assertionId/,
  );
});

test("secret and owner path evidence is rejected", () => {
  assert.throws(() => assertEvidenceTextClean("key sk-abcdefghijklmnop"), /secret/);
  assert.throws(() => assertEvidenceTextClean("path /Users/owner/penglai"), /owner absolute path/);
});
