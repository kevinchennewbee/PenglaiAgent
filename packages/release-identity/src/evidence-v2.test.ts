import assert from "node:assert/strict";
import test from "node:test";
import { recordAssertion } from "./assertion.js";
import {
  bindArtifactFreshness,
  evaluateEvidenceV2,
  evidenceKey,
  requiredSlots,
  resolveSubgateVerdict,
  soakSampleSetAccepted,
  tagCollection,
} from "./evidence-v2.js";
import type { AcceptanceEntry } from "./registry.js";

const HEAD = "ddcafb557652b01def03c62054cfcc4fa8944cb4";
const OTHER = "39fbdc2a7fa66d88a3ead23a1cd0f9fae2b0b022";
const SOAK_OLD = "01d26e6900ce3388a88f9d77b6baccf8ce16f8c0921bda4f05d1c9b3d4340141";
const DMG_NOW = "c1e19c54349c56537ea3ac4c908a2dc8fa5b673eea8882313beac10d0e880737";
const EXPORT_OLD = "c17c491f0368ae0e96e33a3f7cd78b16998333ab";

function entry(id: string, runner: string): AcceptanceEntry {
  const idx = runner.lastIndexOf("/");
  const classPart = idx >= 0 ? runner.slice(0, idx) : runner;
  const platformPart = idx >= 0 ? runner.slice(idx + 1) : "all";
  return {
    id,
    requirement: id,
    runner,
    runnerClasses: classPart.split("+").map((s) => s.trim()).filter(Boolean),
    platforms: platformPart.split("+").map((s) => s.trim()).filter(Boolean),
  };
}

function rec(partial: {
  acceptanceId: string;
  runnerClass: string;
  target: string;
  assertionId: string;
  candidateSourceSha?: string;
  collectionClass?: "unit-suite" | "installed-runner" | "soak-runner";
  artifactSha256?: string;
  runnerNative?: boolean;
  rawEvidencePointer?: string;
  status?: "PASS" | "FAIL";
}) {
  return {
    acceptanceId: partial.acceptanceId,
    runnerId: partial.runnerClass,
    runnerClass: partial.runnerClass,
    testId: "t",
    assertionId: partial.assertionId,
    status: partial.status ?? "PASS",
    candidateSourceSha: partial.candidateSourceSha ?? HEAD,
    target: partial.target,
    collectionClass: partial.collectionClass,
    artifactSha256: partial.artifactSha256,
    runnerNative: partial.runnerNative,
    rawEvidencePointer: partial.rawEvidencePointer,
    startedAt: "t",
    endedAt: "t",
    exitCode: 0,
    resultDigest: "d",
  };
}

test("recordAssertion keeps the caller source SHA when PENGLAI_CANDIDATE_SHA differs", () => {
  const prev = process.env.PENGLAI_CANDIDATE_SHA;
  process.env.PENGLAI_CANDIDATE_SHA = OTHER;
  try {
    const got = recordAssertion({
      acceptanceId: "R50-TRUTH-001",
      runnerId: "unit",
      testId: "env-must-not-overwrite",
      assertionId: "keep-runner-source-sha",
      status: "PASS",
      candidateSourceSha: HEAD,
      target: "source",
      exitCode: 0,
    });
    assert.equal(got.candidateSourceSha, HEAD);
    assert.notEqual(got.candidateSourceSha, process.env.PENGLAI_CANDIDATE_SHA);
  } finally {
    if (prev === undefined) delete process.env.PENGLAI_CANDIDATE_SHA;
    else process.env.PENGLAI_CANDIDATE_SHA = prev;
  }
});

test("one native arm64 assertion cannot close the three-target installed ID", () => {
  const installedAll = entry("R50-CORE-001", "installed/all");
  assert.deepEqual(
    requiredSlots(installedAll).map((s) => s.target),
    ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"],
  );
  const manifest = evaluateEvidenceV2({
    registry: [installedAll],
    candidateSha: HEAD,
    records: [
      rec({
        acceptanceId: "R50-CORE-001",
        runnerClass: "installed",
        target: "darwin-aarch64",
        assertionId: "arm64-only",
        collectionClass: "installed-runner",
        artifactSha256: DMG_NOW,
        runnerNative: true,
        rawEvidencePointer: "evidence/generated/installed-e2e.json",
      }),
    ],
  });
  assert.notEqual(manifest.results[0]?.status, "PASS");
  assert.deepEqual(manifest.ids[0]?.missingTargets, ["darwin-x86_64", "win32-x86_64"]);
});

test("a unit-suite record cannot satisfy an installed/soak/live ID", () => {
  const installed = entry("R50-ONB-001", "installed/all");
  const soak = entry("R50-REL-010", "soak/all");
  const live = entry("R50-LIVE-001", "live/live");
  const unitHits = tagCollection(
    [
      rec({ acceptanceId: "R50-ONB-001", runnerClass: "installed", target: "darwin-aarch64", assertionId: "unit-lie" }),
      rec({ acceptanceId: "R50-REL-010", runnerClass: "soak", target: "darwin-aarch64", assertionId: "unit-soak" }),
      rec({ acceptanceId: "R50-LIVE-001", runnerClass: "live", target: "live", assertionId: "unit-live" }),
    ],
    "unit-suite",
  );
  const manifest = evaluateEvidenceV2({
    registry: [installed, soak, live],
    candidateSha: HEAD,
    records: unitHits,
  });
  assert.equal(manifest.results.find((r) => r.id === "R50-ONB-001")?.status, "NOT_RUN");
  assert.equal(manifest.results.find((r) => r.id === "R50-REL-010")?.status, "NOT_RUN");
  assert.equal(manifest.results.find((r) => r.id === "R50-LIVE-001")?.status, "NOT_RUN");
});

test("contract/all can close from a single source-level assertion", () => {
  const contract = entry("R50-TRUTH-001", "contract/all");
  assert.deepEqual(requiredSlots(contract).map((s) => `${s.runnerFamily}/${s.target}`), ["contract/source"]);
  const manifest = evaluateEvidenceV2({
    registry: [contract],
    candidateSha: HEAD,
    records: [
      rec({
        acceptanceId: "R50-TRUTH-001",
        runnerClass: "contract",
        target: "source",
        assertionId: "versions-0-5-0",
      }),
    ],
  });
  assert.equal(manifest.results[0]?.status, "PASS");
});

test("evidence bound to 39fbdc2, soak 01d26e, or dirty export c17c491 is STALE against HEAD", () => {
  const staleSource = bindArtifactFreshness({
    candidateSha: HEAD,
    evidenceSourceSha: OTHER,
    evidenceArtifactSha256: DMG_NOW,
    currentArtifactSha256: DMG_NOW,
  });
  assert.equal(staleSource.verdict, "STALE");
  const staleSoak = bindArtifactFreshness({
    candidateSha: HEAD,
    evidenceSourceSha: HEAD,
    currentArtifactSha256: DMG_NOW,
    soakArtifactSha256: SOAK_OLD,
    soakSamples: ["im", "offline", "sleep", "update", "uninstall"],
  });
  assert.equal(staleSoak.verdict, "STALE");
  const dirtyExport = bindArtifactFreshness({
    candidateSha: HEAD,
    exportSourceSha: EXPORT_OLD,
    exportDirty: true,
  });
  assert.equal(dirtyExport.verdict, "STALE");
  assert.equal(soakSampleSetAccepted(["http", "ws", "process"]), false);
  assert.equal(soakSampleSetAccepted(["im", "offline", "sleep", "update", "uninstall"]), true);

  const installed = entry("R50-E2E-001", "installed/mac-arm");
  const manifest = evaluateEvidenceV2({
    registry: [installed],
    candidateSha: HEAD,
    currentArtifactByTarget: { "darwin-aarch64": DMG_NOW },
    records: [
      rec({
        acceptanceId: "R50-E2E-001",
        runnerClass: "installed",
        target: "darwin-aarch64",
        assertionId: "old-source",
        candidateSourceSha: OTHER,
        collectionClass: "installed-runner",
        artifactSha256: DMG_NOW,
        runnerNative: true,
        rawEvidencePointer: "evidence/generated/installed-e2e.json",
      }),
    ],
  });
  assert.equal(manifest.results[0]?.status, "STALE");
  assert.equal(manifest.verdict, "STALE");
});

test("leftover installed evidence without a current artifact is NOT_RUN, not STALE", () => {
  const installed = entry("R50-E2E-001", "installed/mac-arm");
  const manifest = evaluateEvidenceV2({
    registry: [installed],
    candidateSha: HEAD,
    records: [
      rec({
        acceptanceId: "R50-E2E-001",
        runnerClass: "installed",
        target: "darwin-aarch64",
        assertionId: "old-source",
        candidateSourceSha: OTHER,
        collectionClass: "installed-runner",
        artifactSha256: DMG_NOW,
        runnerNative: true,
        rawEvidencePointer: "evidence/generated/installed-e2e.json",
      }),
    ],
  });
  assert.equal(manifest.results[0]?.status, "NOT_RUN");
  assert.equal(manifest.verdict, "INCOMPLETE");
});

test("verify:release prefers JSON INCOMPLETE/FAIL over a process that printed PASS", () => {
  const incomplete = resolveSubgateVerdict({
    processExit: 0,
    processVerdict: "PASS",
    json: { verdict: "INCOMPLETE" },
  });
  assert.equal(incomplete.verdict, "INCOMPLETE");
  assert.equal(incomplete.exit, 2);
  const fail = resolveSubgateVerdict({
    processExit: 0,
    processVerdict: "PASS",
    json: { verdict: "FAIL" },
  });
  assert.equal(fail.verdict, "FAIL");
  assert.equal(fail.exit, 1);
});

test("evidence key is acceptanceId+runnerClass+target+assertionId", () => {
  assert.equal(
    evidenceKey({
      acceptanceId: "R50-CORE-001",
      runnerClass: "installed",
      target: "darwin-aarch64",
      assertionId: "embedded-node",
    }),
    "R50-CORE-001+installed+darwin-aarch64+embedded-node",
  );
});
