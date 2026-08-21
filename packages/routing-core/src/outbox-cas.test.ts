import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import type { InboundEnvelope, ModelInput } from "@penglai/contracts";
import { RoutingControlPlane, type AgentPort, type DirectoryPort } from "./index.js";

function env(over: Partial<InboundEnvelope> = {}): InboundEnvelope {
  return {
    adapter: "mock",
    adapterMessageKey: over.adapterMessageKey ?? "k1",
    accountRef: "acct",
    peerRef: "peer",
    chatKind: "private",
    bodyKind: "text",
    text: "hello",
    receivedAt: 1,
    vendorTarget: "owner",
    ...over,
  };
}

async function worker(
  plane: RoutingControlPlane,
  routeId: string,
  workerId: string,
  sent: string[],
): Promise<void> {
  for (const item of plane.dueOutbox(routeId)) {
    const token = plane.markSending(item.outboxId, workerId);
    if (!token) continue;
    sent.push(item.outboxId);
    plane.markDelivered(item.outboxId, token);
  }
}

test("P51-IM-001 dual real adapter workers send an outbox item once", async () => {
  const clock = new VirtualClock();
  const ids = new SeqIds();
  const store = new Store(":memory:");
  const inputs: ModelInput[] = [];
  const agent: AgentPort = {
    async followup(input) {
      inputs.push(input);
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer(input) {
      inputs.push(input);
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  };
  const directory: DirectoryPort = {
    async listWorkspaces() {
      return [{ id: "ws1", title: "Alpha", sessionIds: ["sess1"] }];
    },
    async listSessions() {
      return [{ id: "sess1" }];
    },
  };
  const plane = new RoutingControlPlane(store, clock, ids, directory, agent);
  const accepted = await plane.submitInbound(env({ text: "task", adapterMessageKey: "work" }));
  assert.equal(accepted.kind, "accepted");
  const inboundId = inputs[0]!.inboundId;
  const routeId = inputs[0]!.routeId;
  plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "t-cas",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  plane.onAssistantFinal({ sessionId: "sess1", turnId: "t-cas", text: "once" });
  const item = store.pendingOutbox(routeId).find((row) => row.payloadText === "once")!;
  assert.ok(item);
  const weixinSent: string[] = [];
  const feishuSent: string[] = [];
  await Promise.all([
    worker(plane, routeId, "weixin", weixinSent),
    worker(plane, routeId, "feishu", feishuSent),
  ]);
  assert.equal(
    weixinSent.filter((id) => id === item.outboxId).length +
      feishuSent.filter((id) => id === item.outboxId).length,
    1,
  );
  assert.equal(store.getOutbox(item.outboxId)?.state, "delivered");
  plane.markDelivered(item.outboxId, "deadbeefdeadbeefdeadbeefdeadbeef");
  plane.markSendResult(item.outboxId, "transient", "deadbeefdeadbeefdeadbeefdeadbeef");
  assert.equal(store.getOutbox(item.outboxId)?.state, "delivered");
  store.close();
});
