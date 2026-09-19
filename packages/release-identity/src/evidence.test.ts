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

test("one assertion cannot fan out to many acceptance ids", () => {
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
  // This test deliberately records nothing against the registry. It used to
  // record R50-E2E-005 against a placeholder source SHA, which tallied as STALE
  // and proved only that a fake record can be written. The fan-out guard is a
  // property of every id, so it is asserted here and applied to real evidence by
  // `assertNoFanOut` inside `verify-evidence.mjs`.
});

test("translated-as-native is rejected", () => {
  assert.throws(
    () =>
      recordAssertion({
        acceptanceId: "R50-MAC-009",
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
