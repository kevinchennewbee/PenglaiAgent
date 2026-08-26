import assert from "node:assert/strict";
import test from "node:test";
import { runReaction } from "./reactions.js";

test("reactions are serialized, idempotent, and failures do not throw", async () => {
  const order: string[] = [];
  const key = `slack:B1:msg-1:${Date.now()}`;
  const first = await runReaction({
    key,
    kind: "processing",
    send: async () => {
      order.push("processing");
    },
  });
  const again = await runReaction({
    key,
    kind: "processing",
    send: async () => {
      order.push("again");
    },
  });
  const failed = await runReaction({
    key,
    kind: "error",
    send: async () => {
      throw new Error("reaction refused");
    },
  });
  assert.equal(first, "ok");
  assert.equal(again, "skipped");
  assert.equal(failed, "failed");
  assert.deepEqual(order, ["processing"]);
});
