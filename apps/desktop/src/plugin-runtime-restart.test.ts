import assert from "node:assert/strict";
import test from "node:test";
import {
  issuePluginRuntimeRestart,
  verifyPluginRuntimeRestart,
} from "./plugin-runtime-restart.js";

const sha256 = "a".repeat(64);

test("plugin runtime restart requires the exact committed update journal", () => {
  const pending = issuePluginRuntimeRestart({
    id: "@penglai/office-reader",
    version: "0.1.2",
    sha256,
    nowMs: 1_000,
  });
  assert.deepEqual(
    verifyPluginRuntimeRestart({
      pending,
      requestedId: "@penglai/office-reader",
      journal: {
        phase: "committed",
        action: "update",
        id: "@penglai/office-reader",
        version: "0.1.2",
        packageSha256: sha256,
      },
      nowMs: 1_001,
    }),
    pending,
  );
});

test("plugin runtime restart fails closed for stale or mismatched evidence", () => {
  const pending = issuePluginRuntimeRestart({
    id: "@penglai/office-reader",
    version: "0.1.2",
    sha256,
    nowMs: 1_000,
    ttlMs: 100,
  });
  const journal = {
    phase: "committed",
    action: "update",
    id: "@penglai/office-reader",
    version: "0.1.2",
    packageSha256: sha256,
  };
  assert.throws(
    () => verifyPluginRuntimeRestart({ pending, requestedId: pending.id, journal, nowMs: 1_101 }),
    /expired/,
  );
  assert.throws(
    () => verifyPluginRuntimeRestart({
      pending,
      requestedId: pending.id,
      journal: { ...journal, phase: "rolled_back" },
      nowMs: 1_050,
    }),
    /mismatch/,
  );
});
