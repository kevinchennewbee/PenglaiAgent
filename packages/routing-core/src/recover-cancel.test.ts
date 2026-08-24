import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "@penglai/persistence";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { RoutingControlPlane } from "./index.js";

test("R56-CORE-010 recoverQueuedInbounds cancels without dropping the queue", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  let boom = true;
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    {
      async followup(input) {
        if (boom) throw new Error("DSH down");
        return { dshMessageId: `dsh_${input.inboundId}` };
      },
      async steer(input) { return { dshMessageId: input.inboundId }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "weixin" });
  await plane.submitInbound({
    adapter: "weixin",
    adapterMessageKey: "bind",
    accountRef: "a",
    peerRef: "p",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: `/绑定 ${token}`,
    receivedAt: 1,
  });
  await plane.submitInbound({
    adapter: "weixin",
    adapterMessageKey: "m",
    accountRef: "a",
    peerRef: "p",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: "hi",
    receivedAt: 2,
  });
  assert.equal(store.queuedWithoutDshId().length, 1);
  const ac = new AbortController();
  ac.abort();
  const cancelled = await plane.recoverQueuedInbounds({ signal: ac.signal });
  assert.equal(cancelled.failed, 1);
  assert.equal(store.queuedWithoutDshId().length, 1);
  boom = false;
  const replayed = await plane.recoverQueuedInbounds();
  assert.equal(replayed.dispatched, 1);
  assert.equal(store.queuedWithoutDshId().length, 0);
  store.close();
});
