import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import { MockAdapter } from "./index.js";

test("mock adapter never calls agent itself", async () => {
  const store = new Store(":memory:");
  let agentCalls = 0;
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    {
      async followup() { agentCalls += 1; return { dshMessageId: "d" }; },
      async steer() { return { dshMessageId: "d" }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const mock = new MockAdapter(plane);
  await mock.receive({
    adapter: "mock", adapterMessageKey: "1", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: "hi", receivedAt: 1,
  });
  assert.equal(agentCalls, 0);
});

test("scenario two routes do not leak", async () => {
  const { runIsolationScenario } = await import("./scenario.js");
  const r = await runIsolationScenario();
  assert.equal(r.leaked, 0);
});
