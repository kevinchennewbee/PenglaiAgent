import assert from "node:assert/strict";
import test from "node:test";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { PRODUCT_VERSION } from "./pins.js";
import { inspectReleaseFacts } from "./release-facts.js";

/**
 * The DOC domain: documentation must agree with release facts.
 *
 * This is the only emitter for the `R50-DOC-*` registry ids. It records a result
 * for every declared id on every run, because a check that silently emits
 * nothing is the failure mode this domain exists to remove. A finding becomes a
 * FAIL assertion, so a document contradicting the release blocks publication
 * instead of hiding behind a missing record.
 *
 * The checks are pure source comparisons and never touch the network. The live
 * half of "is this actually published?" is drift probe `published-facts`, which
 * records `R50-DRIFT-004`.
 */

const REQUIRED_DOC_IDS = [
  "R50-DOC-001",
  "R50-DOC-002",
  "R50-DOC-003",
  "R50-DOC-004",
  "R50-DOC-005",
] as const;

const findings = inspectReleaseFacts();

test("R50-DOC every declared documentation id is inspected on every run", () => {
  assert.deepEqual(
    findings.map((f) => f.id).sort(),
    [...REQUIRED_DOC_IDS].sort(),
    "release-facts inspection must cover every declared R50-DOC id",
  );
  for (const finding of findings) {
    assert.notEqual(
      finding.documents.length,
      0,
      `${finding.id} inspected no documents, so it cannot produce evidence`,
    );
  }
});

test(`R50-DOC declarations agree with Penglai ${PRODUCT_VERSION}`, () => {
  assert.equal(PRODUCT_VERSION, "0.6.3");
});

/*
 * Each finding is emitted once, keyed on its own id, with a distinct runner and
 * test pair so `assertNoFanOut` cannot be satisfied by one test claiming several
 * ids.
 */
for (const finding of findings) {
  test(`R50-DOC emits ${finding.id} from the documentation inspection`, () => {
    const clean = finding.problems.length === 0;
    recordAssertion({
      acceptanceId: finding.id,
      runnerId: "docs",
      testId: `release-facts-${finding.id}`,
      assertionId: `release-facts-${finding.id}`,
      status: clean ? "PASS" : "FAIL",
      candidateSourceSha: declaredSourceSha(),
      exitCode: clean ? 0 : 1,
      details: {
        safe: clean
          ? `${finding.detail}; no contradiction found`
          : `${finding.detail}; ${finding.problems.join(" | ")}`.slice(0, 900),
      },
    });
    assert.ok(
      clean,
      `${finding.id} found documentation that contradicts the release: ${finding.problems.join("; ")}`,
    );
  });
}
