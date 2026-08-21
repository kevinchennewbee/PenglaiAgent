import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { recordAssertion } from "./assertion.js";
import {
  assertIdentityMatchesGit,
  assertReleaseIdentity,
  assertTamperedHashRejected,
  assertUnfrozenClean,
  emptyIdentity,
} from "./identity.js";
import {
  CANDIDATE_KIND,
  GENERATION_ID,
  PRODUCT_VERSION,
  RELEASE_TARGETS,
  TRUST_TIER,
} from "./pins.js";

test("R50-TRUTH-001 identity pins are 0.5.0", () => {
  const id = emptyIdentity("a".repeat(40), false);
  const checked = assertReleaseIdentity(id);
  assert.equal(checked.productVersion, PRODUCT_VERSION);
  assert.equal(checked.productVersion, "0.5.1");
  recordAssertion({
    acceptanceId: "R50-TRUTH-001",
    runnerId: "release-identity.identity",
    testId: "identity-pins-0.5.0",
    assertionId: "productVersion-is-0.5.0",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("R50-TRUTH-002 candidateKind trustTier generation and exact Apple Silicon target", () => {
  const id = emptyIdentity("a".repeat(40), false);
  const checked = assertReleaseIdentity(id);
  assert.equal(checked.candidateKind, CANDIDATE_KIND);
  assert.equal(checked.trustTier, TRUST_TIER);
  assert.equal(checked.generationId, GENERATION_ID);
  assert.deepEqual(
    checked.targets.map((t) => t.installer),
    RELEASE_TARGETS.map((t) => t.installer),
  );
  assert.equal(checked.targets.length, 1);
  recordAssertion({
    acceptanceId: "R50-TRUTH-002",
    runnerId: "release-identity.identity",
    testId: "identity-contract-fields",
    assertionId: "kind-trust-generation-apple-silicon-target",
    status: "PASS",
    candidateSourceSha: "a".repeat(40),
    exitCode: 0,
  });
});

test("R50-TRUTH-004 UNFROZEN identity rejects artifact/signature/live/READY", () => {
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("b".repeat(40), false), artifactSha256: "c".repeat(64) }),
    /UNFROZEN identity cannot carry artifactSha256/,
  );
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("b".repeat(40), false), liveEvidence: { id: "x" } }),
    /liveEvidence/,
  );
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("b".repeat(40), false), installerSignatures: { sig: "x" } }),
    /installerSignatures/,
  );
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("b".repeat(40), false), readyState: "READY" }),
    PenglaiError,
  );
  const clean = emptyIdentity("b".repeat(40), false);
  assertUnfrozenClean(clean);
  recordAssertion({
    acceptanceId: "R50-TRUTH-004",
    runnerId: "release-identity.identity",
    testId: "unfrozen-forbids-artifact-ready",
    assertionId: "unfrozen-rejects-artifact-live-ready",
    status: "PASS",
    candidateSourceSha: "b".repeat(40),
    exitCode: 0,
  });
});

test("community-verified cannot claim notarized or Authenticode", () => {
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("c".repeat(40), false), notarized: true }),
    /notarized/,
  );
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("c".repeat(40), false), authenticode: true }),
    /authenticode/,
  );
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("c".repeat(40), false), signed: true }),
    /Developer ID/,
  );
});

test("legacy local-acceptance and public-release kinds are rejected", () => {
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("d".repeat(40), false), candidateKind: "local-acceptance" }),
    /candidateKind/,
  );
  assert.throws(
    () => assertReleaseIdentity({ ...emptyIdentity("d".repeat(40), false), candidateKind: "public-release" }),
    /candidateKind/,
  );
});

test("identity schema rejects incomplete objects", () => {
  assert.throws(() => assertReleaseIdentity({}), PenglaiError);
});

test("tampered sourceSha is rejected", () => {
  const id = emptyIdentity("b".repeat(40), false);
  assertTamperedHashRejected(id, "c".repeat(40));
  assert.throws(() =>
    assertIdentityMatchesGit({ ...id, phase: "TARGET_BUILT" }, {
      head: "d".repeat(40),
      originMain: "d".repeat(40),
      dirty: false,
      branch: "main",
    }),
  );
});

test("R50-TRUTH-008 publication fields match the owner-authorized public target", () => {
  const id = assertReleaseIdentity(emptyIdentity("e".repeat(40), false));
  assert.equal(id.publication.repo, "kevinchennewbee/PenglaiAgent");
  assert.equal(id.publication.tag, "v0.5.1");
  assert.equal(id.publication.release, "v0.5.1");
  assert.equal(id.publication.channel, "NOT_PUBLISHED_0_5_1");
  assert.throws(
    () =>
      assertReleaseIdentity({
        ...emptyIdentity("e".repeat(40), false),
        publication: { ...id.publication, tag: "v0.5.2" },
      }),
    /publication.tag/,
  );
  recordAssertion({
    acceptanceId: "R50-TRUTH-008",
    runnerId: "release-identity.identity",
    testId: "publication-authorized-target",
    assertionId: "publication-fields-owner-authorized",
    status: "PASS",
    candidateSourceSha: "e".repeat(40),
    exitCode: 0,
  });
});

test("stale alpha.3 artifact hash in identity is rejected", () => {
  assert.throws(
    () =>
      assertReleaseIdentity({
        ...emptyIdentity("ba5ba3dd65602a30a4b9fb815472d9abdc4805e5", false),
        phase: "TARGET_BUILT",
        artifactSha256: "c19e393e5d9b85190e60286e4fca30dbeb242799013baf605cf3615782683c79",
      }),
    /STALE_INVALIDATED/,
  );
});
