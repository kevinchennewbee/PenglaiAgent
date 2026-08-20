import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { CONFIG } from "@penglai/contracts";
import { RoutingControlPlane, type AgentPort, type DirectoryPort } from "./index.js";

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
