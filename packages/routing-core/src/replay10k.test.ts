import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "./index.js";

test("R2I-ROUTE-010 10k deterministic replay has no duplicate claim or wrong route", async () => {
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
  const routes = 400;
  const per = 24;
  for (let r = 0; r < routes; r += 1) {
    const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: `s${r}`, adapter: r % 2 === 0 ? "weixin" : "feishu" });
    await plane.submitInbound({
      adapter: r % 2 === 0 ? "weixin" : "feishu",
      adapterMessageKey: `bind-${r}`,
      accountRef: "a",
      peerRef: `p${r}`,
      chatKind: "private",
      bodyKind: "text",
      text: `/绑定 ${token}`,
      receivedAt: clock.now(),
    });
    for (let i = 0; i < per; i += 1) {
      await plane.submitInbound({
        adapter: r % 2 === 0 ? "weixin" : "feishu",
        adapterMessageKey: `m${r}-${i}`,
        accountRef: "a",
        peerRef: `p${r}`,
        chatKind: "private",
        bodyKind: "text",
        text: `msg ${i}`,
        receivedAt: clock.now(),
      });
    }
  }
  const leaked = store.db.prepare(
    `SELECT COUNT(*) AS c FROM correlations c
     JOIN inbounds i ON i.inbound_id=c.inbound_id
     WHERE c.route_id != i.route_id`,
  ).get() as { c: number };
  assert.equal(Number(leaked.c), 0);
  const inboundCount = store.db.prepare("SELECT COUNT(*) AS c FROM inbounds").get() as { c: number };
  assert.equal(Number(inboundCount.c), routes * (per + 1));
  const dupKeys = store.db.prepare(
    "SELECT COUNT(*) AS c FROM (SELECT adapter_message_key, route_id FROM inbounds GROUP BY adapter_message_key, route_id HAVING COUNT(*)>1)",
  ).get() as { c: number };
  assert.equal(Number(dupKeys.c), 0);
});
