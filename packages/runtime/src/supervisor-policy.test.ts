import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BOOT_PHASES,
  nextSupervisorHealthDecision,
  redactSupervisorDiagnostic,
  reusableSupervisorPort,
  shouldRestartAfterExit,
  supervisorBackoffMs,
  supervisorRestartAllowed,
} from "./supervisor-policy.js";

test("R56-CORE-006/007/008 supervisor restart budget and boot phases are explicit", () => {
  assert.deepEqual([...BOOT_PHASES], [
    "boot",
    "checking-private-data",
    "verifying-runtime",
    "starting-dsh",
    "waiting-http",
    "verifying-required-plugins",
    "ready",
  ]);
  const now = 1_000_000;
  assert.equal(supervisorRestartAllowed([], now), true);
  assert.equal(supervisorRestartAllowed([now - 1000, now - 2000, now - 3000], now), false);
  assert.equal(supervisorRestartAllowed([now - 6 * 60_000, now - 1000], now), true);
  assert.equal(supervisorBackoffMs(0, 0), 1000);
  assert.equal(supervisorBackoffMs(2, 0), 10_000);
  assert.equal(reusableSupervisorPort(41_234), 41_234);
  assert.equal(reusableSupervisorPort(0), undefined);
  assert.equal(reusableSupervisorPort(65_536), undefined);
  assert.equal(reusableSupervisorPort(12.5), undefined);
  assert.equal(shouldRestartAfterExit({ intentional: true, state: "healthy", stamps: [] }), false);
  assert.equal(shouldRestartAfterExit({ intentional: false, state: "healthy", stamps: [] }), true);
});

test("supervisor health requires consecutive failures and recovers on a good probe", () => {
  const first = nextSupervisorHealthDecision(0, false);
  assert.deepEqual(first, { consecutiveFailures: 1, state: "degraded", restart: false });
  const recovered = nextSupervisorHealthDecision(first.consecutiveFailures, true);
  assert.deepEqual(recovered, { consecutiveFailures: 0, state: "healthy", restart: false });
  const second = nextSupervisorHealthDecision(1, false);
  assert.equal(second.restart, false);
  const third = nextSupervisorHealthDecision(second.consecutiveFailures, false);
  assert.deepEqual(third, { consecutiveFailures: 3, state: "degraded", restart: true });
  assert.equal(nextSupervisorHealthDecision(0, false, 1).restart, true);
});

test("R56-CORE-009 recovery diagnostics omit home, token, and command", () => {
  const redacted = redactSupervisorDiagnostic({
    appVersion: "0.5.7",
    sourceSha: "a".repeat(40),
    platform: "darwin",
    arch: "arm64",
    dsh: "0.1.1-rc.2",
    phase: "waiting-http",
    phaseMs: 1200,
    exitCode: 1,
    requiredPlugins: [{ id: "@penglai/office", ok: true }],
    errorCodes: ["DSH_UNAVAILABLE"],
    home: "/Users/secret",
    token: "sk-secret",
    command: "/app/runtime/node/bin/node",
  });
  const text = JSON.stringify(redacted);
  assert.equal(text.includes("/Users/secret"), false);
  assert.equal(text.includes("sk-secret"), false);
  assert.equal(text.includes("/app/runtime/node"), false);
  assert.equal(redacted.phase, "waiting-http");
  assert.equal(redacted.dsh, "0.1.1-rc.2");
});

test("supervisor restart preserves required child paths and stop cancels restart", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /private lastStartEnv: NodeJS\.ProcessEnv/);
  assert.match(src, /const restartPort = this\.port/);
  assert.match(src, /this\.start\(user, restartEnv, restartPort\)/);
  assert.match(src, /reusableSupervisorPort\(preferredPort\) \?\? await freePort\(\)/);
  assert.match(src, /scheduleHealthProbe\(user, generation\)/);
  assert.match(src, /nextSupervisorHealthDecision\(this\.healthFailures, healthy\)/);
  assert.match(src, /terminateUnhealthyChild\(generation\)/);
  assert.match(src, /healthProbeAbort\?\.abort\(\)/);
  assert.match(src, /if \(this\.state === "stopping" \|\| this\.state === "stopped"\) return/);
  assert.match(src, /async stop\(\): Promise<void> \{[\s\S]*clearTimeout\(this\.restartTimer\)/);
});
