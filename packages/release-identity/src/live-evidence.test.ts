import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { evaluateLiveEvidence } from "./live-evidence.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const runId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function validEvidence() {
  const nativeInstallers = [
    "darwin-aarch64",
    "darwin-x86_64",
    "win32-x86_64",
  ].map((target, index) => ({ target, installerSha256: String(index + 1).repeat(64) }));
  return {
    schemaVersion: 3,
    scope: "release-native-live-set",
    productVersion: "0.5.9",
    sourceSha: "a".repeat(40),
    nativeInstallers,
    officialModel: {
      target: "darwin-aarch64",
      runnerClass: "owner-live-account",
      runnerVersion: "installed-live-v1",
      runId: runId(1),
      startedAt: "2026-08-31T01:00:00.000Z",
      completedAt: "2026-08-31T01:01:00.000Z",
      installerSha256: nativeInstallers[0]!.installerSha256,
      credentialNoEcho: true,
      nonceDigest: digest("model-nonce"),
      apiTestFinalDigest: digest("model-api-final"),
      firstMessageDigest: digest("model-first-message"),
      firstTurnFinalDigest: digest("model-first-final"),
      officialSessionDigest: digest("model-sessions"),
      evidenceSha256: digest("model-evidence"),
    },
    redacted: true,
    cases: ["weixin", "feishu", "dingtalk", "wecom", "qq", "slack", "telegram", "discord"].map(
      (platform, index) => ({
        platform,
        target: nativeInstallers[index % nativeInstallers.length]!.target,
        runnerClass: "owner-live-account",
        runnerVersion: "im-live-v1",
        runId: runId(index + 2),
        startedAt: `2026-08-31T02:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-08-31T02:${String(index).padStart(2, "0")}:30.000Z`,
        installerSha256: nativeInstallers[index % nativeInstallers.length]!.installerSha256,
        challengeDigest: digest(`${platform}-challenge`),
        connectionDigest: digest(`${platform}-connection`),
        inboundDigest: digest(`${platform}-inbound`),
        workspaceSessionDigest: digest(`${platform}-workspace-session`),
        outboundDigest: digest(`${platform}-outbound`),
        restartDigest: digest(`${platform}-restart`),
        logoutDigest: digest(`${platform}-logout`),
        evidenceSha256: digest(`${platform}-evidence`),
      }),
    ),
  };
}

test("owner live evidence passes only with complete redacted declared cases", () => {
  assert.deepEqual(evaluateLiveEvidence(validEvidence(), "0.5.9"), {
    verdict: "PASS",
    reason: "accepted 8 redacted owner live runner record(s)",
    acceptedPlatforms: ["weixin", "feishu", "dingtalk", "wecom", "qq", "slack", "telegram", "discord"],
  });
});

test("missing or repeated runner transcript digests cannot become PASS", () => {
  const evidence = validEvidence();
  evidence.cases[0]!.logoutDigest = evidence.cases[0]!.restartDigest;
  assert.equal(evaluateLiveEvidence(evidence, "0.5.9").verdict, "FAIL");
});

test("stale, duplicate, unknown, or sensitive live evidence is rejected", () => {
  assert.equal(evaluateLiveEvidence({ ...validEvidence(), productVersion: "0.5.8" }, "0.5.9").verdict, "STALE");
  assert.equal(evaluateLiveEvidence({ ...validEvidence(), accessToken: "must-not-appear" }, "0.5.9").verdict, "FAIL");
  const duplicate = validEvidence();
  duplicate.cases.push({ ...duplicate.cases[0]! });
  assert.equal(evaluateLiveEvidence(duplicate, "0.5.9").verdict, "FAIL");
  const unknown = validEvidence();
  unknown.cases[0]!.platform = "unknown-platform";
  assert.equal(evaluateLiveEvidence(unknown, "0.5.9").verdict, "FAIL");
});

test("live evidence is bound to exact source and all three installer hashes", () => {
  const evidence = validEvidence();
  const expected = {
    sourceSha: "a".repeat(40),
    nativeInstallers: Object.fromEntries(
      evidence.nativeInstallers.map((row) => [row.target, row.installerSha256]),
    ),
  };
  assert.equal(evaluateLiveEvidence(evidence, "0.5.9", expected).verdict, "PASS");
  assert.equal(
    evaluateLiveEvidence(evidence, "0.5.9", { ...expected, sourceSha: "f".repeat(40) }).verdict,
    "STALE",
  );
  const staleInstallers = { ...expected.nativeInstallers, "win32-x86_64": "f".repeat(64) };
  assert.equal(
    evaluateLiveEvidence(evidence, "0.5.9", { ...expected, nativeInstallers: staleInstallers }).verdict,
    "STALE",
  );
});
