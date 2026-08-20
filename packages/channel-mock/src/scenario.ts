import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import { MockAdapter } from "./index.js";

export async function runIsolationScenario(): Promise<{ leaked: number; delivered: number }> {
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
  const mock = new MockAdapter(plane);
  for (const peer of ["p1", "p2"]) {
    const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: `s-${peer}`, adapter: "mock" });
    await mock.receive({
      adapter: "mock", adapterMessageKey: `b-${peer}`, accountRef: "a", peerRef: peer,
      chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: clock.now(),
    });
    await mock.receive({
      adapter: "mock", adapterMessageKey: `m-${peer}`, accountRef: "a", peerRef: peer,
      chatKind: "private", bodyKind: "text", text: `work-${peer}`, receivedAt: clock.now(),
    });
  }
  const leaked = Number((store.db.prepare(
    `SELECT COUNT(*) AS c FROM correlations c JOIN inbounds i ON i.inbound_id=c.inbound_id WHERE c.route_id != i.route_id`,
  ).get() as { c: number }).c);
  return { leaked, delivered: 0 };
}
