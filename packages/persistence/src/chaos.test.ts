import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { Store } from "./index.js";

test("transaction rolls back on throw", () => {
  const store = new Store(":memory:");
  store.upsertRoute({
    routeId: "r1",
    adapter: "mock",
    accountRef: "a",
    peerRef: "p",
    status: "active",
  });
  assert.throws(() => {
    store.tx(() => {
      store.revokeBinding("r1", "t");
      throw new PenglaiError("STORE_CORRUPT", "boom");
    });
  }, PenglaiError);
  store.close();
});
