import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "./index.js";

test("R1-STATE-002 duplicate claimed is idempotent", async () => {
  const clock = new VirtualClock();
  const ids = new SeqIds();
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    clock,
    ids,
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    {
      async followup(i) { return { dshMessageId: `dsh_${i.inboundId}` }; },
      async steer(i) { return { dshMessageId: `dsh_${i.inboundId}` }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "mock" });
  await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "b", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: 1,
  });
  await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "m", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: "hi", receivedAt: 2,
  });
  const inbound = store.db.prepare("SELECT inbound_id, route_id FROM inbounds WHERE body_kind='text'").get() as {
    inbound_id: string;
    route_id: string;
  };
  const fact = {
    dshMessageId: `dsh_${inbound.inbound_id}`,
    turnId: "9",
    sessionId: "s",
    source: { kind: "penglai-im" as const, schema: 1 as const, routeId: inbound.route_id, inboundId: inbound.inbound_id, adapter: "mock" as const },
  };
  plane.onClaimed(fact);
  plane.onClaimed(fact);
  const n = store.db.prepare("SELECT COUNT(*) AS c FROM correlations").get() as { c: number };
  assert.equal(Number(n.c), 1);
});

test("R1-STATE-015 followup throw leaves uncertain queued not rewritten", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  let boom = true;
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    {
      async followup() {
        if (boom) throw new Error("killed");
        return { dshMessageId: "later" };
      },
      async steer() { return { dshMessageId: "x" }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "mock" });
  await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "b", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: 1,
  });
  const r = await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "m", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: "hi", receivedAt: 2,
  });
  assert.equal(r.errorClass, "DSH_UNAVAILABLE");
  boom = false;
  const rec = plane.recoverAfterCrash();
  assert.equal(rec.uncertainQueued, 1);
  const replayed = await plane.recoverQueuedInbounds();
  assert.equal(replayed.dispatched, 1);
  assert.equal(store.queuedWithoutDshId().length, 0);
  const again = await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "m", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: "hi", receivedAt: 3,
  });
  assert.equal(again.text, "duplicate ignored");
});

test("voice crash recovery preserves the exact durable ASR context", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  let fail = true;
  const inputs: Array<{ text: string; source: { voice?: { language: string; emotion: string } } }> = [];
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    {
      async followup(input) {
        inputs.push(input);
        if (fail) throw new Error("killed after durable voice transcript");
        return { dshMessageId: `dsh_${input.inboundId}` };
      },
      async steer(input) { return { dshMessageId: input.inboundId }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "weixin" });
  await plane.submitInbound({
    adapter: "weixin", adapterMessageKey: "bind", accountRef: "a", peerRef: "p", vendorTarget: "owner",
    chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: 1,
  });
  const claim = await plane.claimVoiceInbound(
    {
      adapter: "weixin", adapterMessageKey: "voice", accountRef: "a", peerRef: "p", vendorTarget: "owner",
      chatKind: "private", bodyKind: "voice", receivedAt: 2,
    },
    { mediaRefJson: JSON.stringify({ kind: "silk", ref: "opaque" }), durationMs: 1_000 },
  );
  assert.equal(claim.kind, "voice_claim");
  if (claim.kind !== "voice_claim") return;
  const first = await plane.completeVoiceInbound(
    claim,
    { text: "恢复语音", language: "zh", emotion: "SURPRISED" },
    "c".repeat(64),
  );
  assert.equal(first.errorClass, "DSH_UNAVAILABLE");
  fail = false;
  const recovered = await plane.recoverQueuedInbounds();
  assert.equal(recovered.dispatched, 1);
  assert.equal(inputs[1]?.text, "恢复语音");
  assert.deepEqual(inputs[1]?.source.voice, { language: "zh", emotion: "SURPRISED", durationMs: 1_000 });
});

test("queued recovery rejects stale binding instead of retargeting a new session", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  let fail = true;
  const dispatched: string[] = [];
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    {
      async followup(input) {
        if (fail) throw new Error("crash");
        dispatched.push(input.sessionId);
        return { dshMessageId: input.inboundId };
      },
      async steer(input) { return { dshMessageId: input.inboundId }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "mock" });
  await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "bind", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: 1,
  });
  await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "work", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: "payload", receivedAt: 2,
  });
  const routeId = store.listRoutes()[0]!.routeId;
  plane.rebind(routeId, "w", "new-session");
  fail = false;
  const recovered = await plane.recoverQueuedInbounds();
  assert.equal(recovered.rejected, 1);
  assert.deepEqual(dispatched, []);
  assert.equal(store.queuedWithoutDshId().length, 0);
});
