import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLiveEvidence } from "./live-evidence.js";

function validEvidence() {
  return {
    schemaVersion: 1,
    scope: "declared-platform-cases",
    productVersion: "0.5.7",
    sourceSha: "a".repeat(40),
    installerSha256: "b".repeat(64),
    redacted: true,
    cases: [
      {
        platform: "weixin",
        runnerClass: "owner-live-account",
        connected: true,
        inboundPrivateText: true,
        boundOfficialWorkspaceSession: true,
        outboundReply: true,
        restartRestore: true,
        safeLogout: true,
      },
    ],
  };
}

test("owner live evidence passes only with complete redacted declared cases", () => {
  assert.deepEqual(evaluateLiveEvidence(validEvidence(), "0.5.7"), {
    verdict: "PASS",
    reason: "accepted 1 redacted owner live case(s)",
    acceptedPlatforms: ["weixin"],
  });
});

test("missing owner checks remain incomplete rather than becoming a fake PASS", () => {
  const evidence = validEvidence();
  evidence.cases[0]!.safeLogout = false;
  assert.equal(evaluateLiveEvidence(evidence, "0.5.7").verdict, "INCOMPLETE");
});

test("stale, duplicate, unknown, or sensitive live evidence is rejected", () => {
  assert.equal(evaluateLiveEvidence({ ...validEvidence(), productVersion: "0.5.6" }, "0.5.7").verdict, "STALE");
  assert.equal(evaluateLiveEvidence({ ...validEvidence(), accessToken: "must-not-appear" }, "0.5.7").verdict, "FAIL");
  const duplicate = validEvidence();
  duplicate.cases.push({ ...duplicate.cases[0]! });
  assert.equal(evaluateLiveEvidence(duplicate, "0.5.7").verdict, "FAIL");
  const unknown = validEvidence();
  unknown.cases[0]!.platform = "whatsapp";
  assert.equal(evaluateLiveEvidence(unknown, "0.5.7").verdict, "FAIL");
});
