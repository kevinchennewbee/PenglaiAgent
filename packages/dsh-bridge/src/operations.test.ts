import assert from "node:assert/strict";
import test from "node:test";
import { BRIDGE_DEFAULT_DEADLINE_MS, BridgeOperationGate } from "./operations.js";

test("R56-CORE-010 cancel, deadline, stale generation, and idempotent retry", async () => {
  const gate = new BridgeOperationGate();
  assert.equal(gate.currentGeneration(), 0);
  assert.equal(BRIDGE_DEFAULT_DEADLINE_MS, 30_000);

  const first = await gate.run({ operationId: "op-1" }, async () => "ok");
  const again = await gate.run({ operationId: "op-1" }, async () => "other");
  assert.equal(first, "ok");
  assert.equal(again, "ok");

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    () => gate.run({ signal: cancelled.signal }, async () => "no"),
    /cancelled/,
  );

  await assert.rejects(
    () => gate.run({ deadlineMs: 10 }, () => new Promise((resolve) => setTimeout(resolve, 50))),
    /deadline/,
  );

  const stale = gate.currentGeneration();
  const pending = gate.run({ generation: stale, deadlineMs: 200 }, () => new Promise((resolve) => setTimeout(() => resolve("late"), 30)));
  gate.bumpGeneration();
  assert.throws(() => gate.assertGeneration(stale), /stale bridge generation/);
  await assert.rejects(() => pending, /stale bridge generation/);
  await assert.rejects(() => gate.run({ generation: stale }, async () => "no"), /stale bridge generation/);
  const next = await gate.run({ operationId: "op-1" }, async () => "fresh");
  assert.equal(next, "fresh");
});
