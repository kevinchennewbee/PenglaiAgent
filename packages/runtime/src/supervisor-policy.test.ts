import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOT_PHASES,
  redactSupervisorDiagnostic,
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
  assert.equal(shouldRestartAfterExit({ intentional: true, state: "healthy", stamps: [] }), false);
  assert.equal(shouldRestartAfterExit({ intentional: false, state: "healthy", stamps: [] }), true);
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
