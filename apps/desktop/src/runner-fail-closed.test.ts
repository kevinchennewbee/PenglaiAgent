import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAIL_CLOSED_DEADLINE_MS,
  RUNNER_FAULTS,
  evaluateLiveSample,
  heartbeatAgeMs,
  identityMatches,
  parseProcessIdentityLine,
} from "../../../scripts/lib/runner-live.mjs";
import { gitState } from "../../../scripts/lib/repo.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const soak = join(root, "scripts/soak-installed.mjs");
const e2e = join(root, "scripts/e2e-installed.mjs");

function lastJson(text: string): Record<string, unknown> {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.includes("verdict"));
  const raw = lines.at(-1);
  assert.ok(raw, `expected verdict JSON, got: ${String(text).slice(-500)}`);
  return JSON.parse(raw) as Record<string, unknown>;
}

function runRunner(script: string, fault: string) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    timeout: FAIL_CLOSED_DEADLINE_MS + 5_000,
    env: {
      ...process.env,
      PENGLAI_RUNNER_FAULT: fault,
    },
  });
  return { ...result, elapsedMs: Date.now() - started };
}

test("shipped evaluateLiveSample fails closed on injected faults and ignores stale green health", () => {
  const identity = parseProcessIdentityLine("1234 Sun Aug 16 22:05:15 2026 node scripts/soak-installed.mjs");
  assert.deepEqual(identity, {
    pid: 1234,
    startedAt: "Sun Aug 16 22:05:15 2026",
    command: "node scripts/soak-installed.mjs",
  });
  assert.equal(identityMatches(identity, identity), true);
  assert.equal(
    identityMatches(identity, { pid: 1234, startedAt: "Sun Aug 16 22:05:15 2026", command: "other" }),
    false,
  );

  const greenHealth = {
    at: new Date().toISOString(),
    pid: 1234,
    sourceSha: "aa".repeat(20),
    installerSha256: "11".repeat(32),
    target: "darwin-aarch64",
    http: { official: true },
    websocket: { opened: true },
  };
  const expected = {
    sourceSha: "aa".repeat(20),
    artifactSha: "11".repeat(32),
    target: "darwin-aarch64",
    heartbeatMaxAgeMs: 1_000,
  };

  const killed = evaluateLiveSample({
    now: Date.now(),
    health: greenHealth,
    observed: null,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: true },
  });
  assert.equal(killed.ok, false);
  assert.ok(killed.reasons.includes("kill-target"));

  const stale = evaluateLiveSample({
    now: Date.now(),
    health: { ...greenHealth, at: new Date(Date.now() - 60_000).toISOString() },
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: true },
  });
  assert.equal(stale.ok, false);
  assert.ok(stale.reasons.includes("stale-heartbeat"));
  assert.ok(heartbeatAgeMs(stale && { at: new Date(Date.now() - 60_000).toISOString() }) > 1_000);

  const httpDown = evaluateLiveSample({
    now: Date.now(),
    health: greenHealth,
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: false, wsOpened: true },
  });
  assert.equal(httpDown.ok, false);
  assert.ok(httpDown.reasons.includes("http-down"));

  const wizardPhase = evaluateLiveSample({
    now: Date.now(),
    health: greenHealth,
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: false, wsOpened: false },
    requireOfficialLive: false,
  });
  assert.equal(wizardPhase.ok, true);

  const wsDown = evaluateLiveSample({
    now: Date.now(),
    health: greenHealth,
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: false },
  });
  assert.equal(wsDown.ok, false);
  assert.ok(wsDown.reasons.includes("ws-down"));

  const reused = evaluateLiveSample({
    now: Date.now(),
    health: greenHealth,
    observed: { pid: 1234, startedAt: "Mon Aug 17 01:00:00 2026", command: "unrelated-process" },
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: true },
  });
  assert.equal(reused.ok, false);
  assert.ok(reused.reasons.includes("pid-reuse"));

  const wrongSource = evaluateLiveSample({
    now: Date.now(),
    health: { ...greenHealth, sourceSha: "bb".repeat(20) },
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: true },
  });
  assert.equal(wrongSource.ok, false);
  assert.ok(wrongSource.reasons.includes("wrong-source"));

  const wrongArtifact = evaluateLiveSample({
    now: Date.now(),
    health: { ...greenHealth, installerSha256: "ff".repeat(32) },
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: true },
  });
  assert.equal(wrongArtifact.ok, false);
  assert.ok(wrongArtifact.reasons.includes("wrong-artifact"));

  const wrongTarget = evaluateLiveSample({
    now: Date.now(),
    health: { ...greenHealth, target: "windows-x86_64" },
    observed: identity,
    expectedIdentity: identity,
    expected,
    liveHttpWs: { httpOfficial: true, wsOpened: true },
  });
  assert.equal(wrongTarget.ok, false);
  assert.ok(wrongTarget.reasons.includes("wrong-target"));
});

for (const script of [soak, e2e]) {
  const name = script.endsWith("soak-installed.mjs") ? "soak" : "e2e";
  for (const fault of RUNNER_FAULTS) {
    test(`${name} runner fail-closed ${fault} exits non-zero within 30s`, () => {
      const result = runRunner(script, fault);
      assert.notEqual(result.status, 0, result.stderr || result.stdout);
      assert.ok(result.elapsedMs < FAIL_CLOSED_DEADLINE_MS, `elapsed ${result.elapsedMs}`);
      const rec = lastJson(`${result.stderr}\n${result.stdout}`);
      assert.equal(rec.verdict, "FAIL");
      assert.notEqual(rec.stayedGreen, true);
      const blob = `${rec.reason ?? ""} ${(rec.reasons ?? []).toString()}`;
      assert.match(blob, new RegExp(fault));
    });
  }
}

test("soak runner refuses a dirty candidate before evaluating ALLOW_LONG", () => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [soak], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env },
  });
  assert.ok(Date.now() - started < 15_000);
  assert.notEqual(result.status, 0);
  const rec = lastJson(`${result.stderr}\n${result.stdout}`);
  const git = gitState();
  if (git.branch !== "main" || git.head !== git.originMain || git.dirty) {
    assert.equal(rec.verdict, "STALE");
    assert.match(String(rec.reason), /clean main at origin\/main/);
  } else {
    assert.equal(rec.verdict, "INCOMPLETE");
    assert.match(String(rec.reason), /two-hour soak not present/);
  }
});
