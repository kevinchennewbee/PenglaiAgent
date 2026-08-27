import assert from "node:assert/strict";
import test from "node:test";
import { beginStatusReaction, runReaction } from "./reactions.js";

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

test("status reactions replace processing with success and absorb failures", async () => {
  const calls: string[] = [];
  const handle = beginStatusReaction({
    key: `discord:bot:1:${Date.now()}`,
    emojis: { processing: "👀", success: "✅", error: "❌" },
    add: async (emoji) => {
      calls.push(`add:${emoji}`);
    },
    remove: async (emoji) => {
      calls.push(`remove:${emoji}`);
    },
  });
  await handle.settled();
  handle.success();
  await handle.settled();
  assert.deepEqual(calls, ["add:👀", "remove:👀", "add:✅"]);
});
