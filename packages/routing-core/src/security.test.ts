import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { CONFIG } from "@penglai/contracts";
import { RoutingControlPlane, type AgentPort, type DirectoryPort } from "./index.js";

test("IM pairing and local rebind reject a session outside its official Workspace", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    {
      async listWorkspaces() { return [{ id: "workspace-a", title: "A" }, { id: "workspace-b", title: "B" }]; },
      async listSessions(workspaceIdentity) {
        return workspaceIdentity === "workspace-a" ? [{ id: "session-a" }] : [{ id: "session-b" }];
      },
    } satisfies DirectoryPort,
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} } satisfies AgentPort,
  );
  const result = await plane.rebindVerified("route", "workspace-a", "session-b");
  assert.equal(result.errorClass, "SECURITY_POLICY");
  assert.equal(store.activeBinding("route"), undefined);
  const { token } = plane.createPairing({ workspaceIdentity: "workspace-a", sessionId: "session-b", adapter: "mock" });
  const pairing = await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "cross-workspace-pairing", accountRef: "account", peerRef: "peer",
    chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: clock.now(),
  });
  assert.equal(pairing.errorClass, "SECURITY_POLICY");
});

test("IM refuses an existing binding after its Session leaves the official Workspace", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  let stillMember = true;
  const plane = new RoutingControlPlane(
    store, clock, new SeqIds(),
    {
      async listWorkspaces() { return [{ id: "workspace", title: "Workspace" }]; },
      async listSessions() { return stillMember ? [{ id: "session" }] : []; },
    } satisfies DirectoryPort,
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} } satisfies AgentPort,
  );
  store.upsertRoute({ routeId: "route", adapter: "mock", accountRef: "account", peerRef: "peer", status: "active" });
  const bound = await plane.rebindVerified("route", "workspace", "session");
  assert.equal(bound.kind, "control");
  stillMember = false;
  const inbound = await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "moved-session", accountRef: "account", peerRef: "peer",
    chatKind: "private", bodyKind: "text", text: "hello", receivedAt: clock.now(),
  });
  assert.equal(inbound.errorClass, "UNAUTHORIZED");
});

test("R1-AUTH-006 pairing brute force locks", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } } satisfies DirectoryPort,
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} } satisfies AgentPort,
  );
  for (let i = 0; i < CONFIG.pairingMaxAttempts + 1; i += 1) {
    await plane.submitInbound({
      adapter: "mock",
      adapterMessageKey: `t${i}`,
      accountRef: "a",
      peerRef: "p",
      chatKind: "private",
      bodyKind: "text",
      text: "/绑定 deadbeefdeadbeefdeadbeefdeadbeef",
      receivedAt: clock.now(),
    });
  }
  const last = await plane.submitInbound({
    adapter: "mock",
    adapterMessageKey: "final",
    accountRef: "a",
    peerRef: "p",
    chatKind: "private",
    bodyKind: "text",
    text: "/绑定 deadbeefdeadbeefdeadbeefdeadbeef",
    receivedAt: clock.now(),
  });
  assert.equal(last.errorClass, "SECURITY_POLICY");
});

test("R1-SEC-003 oversized payload rejected", async () => {
  const clock = new VirtualClock();
  const plane = new RoutingControlPlane(
    new Store(":memory:"),
    clock,
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const r = await plane.submitInbound({
    adapter: "mock",
    adapterMessageKey: "big",
    accountRef: "a",
    peerRef: "p",
    chatKind: "private",
    bodyKind: "text",
    text: "x".repeat(CONFIG.maxInboundUtf8Bytes + 10),
    receivedAt: 1,
  });
  assert.equal(r.errorClass, "INVALID_INPUT");
});

test("R1-SEC-003 rate limit rejects after budget", async () => {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "w", title: "w" }]; }, async listSessions() { return [{ id: "s" }]; } },
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "mock" });
  await plane.submitInbound({
    adapter: "mock", adapterMessageKey: "b", accountRef: "a", peerRef: "p",
    chatKind: "private", bodyKind: "text", text: `/绑定 ${token}`, receivedAt: 1,
  });
  let last = { errorClass: "" };
  for (let i = 0; i < CONFIG.routeRatePerMinute + 2; i += 1) {
    last = await plane.submitInbound({
      adapter: "mock", adapterMessageKey: `m${i}`, accountRef: "a", peerRef: "p",
      chatKind: "private", bodyKind: "text", text: `n${i}`, receivedAt: clock.now(),
    });
  }
  assert.equal(last.errorClass, "INVALID_INPUT");
});
