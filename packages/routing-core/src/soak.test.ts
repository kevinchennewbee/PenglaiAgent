import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG } from "@penglai/contracts";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "./index.js";

test("R1-STATE-018 soak isolated routes", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    {
      async followup(i) { return { dshMessageId: `dsh_${i.inboundId}` }; },
      async steer(i) { return { dshMessageId: `dsh_${i.inboundId}` }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const routes = CONFIG.soakMinRoutes;
  const per = Math.ceil(CONFIG.soakMinInbounds / routes);
  for (let r = 0; r < routes; r += 1) {
    const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: `s${r}`, adapter: "mock" });
    await plane.submitInbound({
      adapter: "mock", adapterMessageKey: `b${r}`, accountRef: "a", peerRef: `p${r}`,
      chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: clock.now(),
    });
    for (let i = 0; i < per; i += 1) {
      await plane.submitInbound({
        adapter: "mock", adapterMessageKey: `m${r}-${i}`, accountRef: "a", peerRef: `p${r}`,
        chatKind: "private", bodyKind: "text", text: `msg ${i}`, receivedAt: clock.now(),
      });
    }
  }
  const leaked = store.db.prepare(
    `SELECT COUNT(*) AS c FROM correlations c
     JOIN inbounds i ON i.inbound_id=c.inbound_id
     WHERE c.route_id != i.route_id`,
  ).get() as { c: number };
  assert.equal(Number(leaked.c), 0);
  const deliveredDup = store.db.prepare(
    "SELECT COUNT(*) AS c FROM outbox WHERE state='delivered' GROUP BY inbound_id, fragment_index HAVING COUNT(*)>1",
  ).all();
  assert.equal(deliveredDup.length, 0);
});
