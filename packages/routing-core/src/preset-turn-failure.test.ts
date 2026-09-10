import assert from "node:assert/strict";
import test from "node:test";
import { presetUnavailableUserText, type InboundEnvelope, type ModelInput } from "@penglai/contracts";
import { Store } from "@penglai/persistence";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { RoutingControlPlane, type AgentPort, type DirectoryPort } from "./index.js";

function env(over: Partial<InboundEnvelope> = {}): InboundEnvelope {
  return {
    adapter: "weixin",
    adapterMessageKey: over.adapterMessageKey ?? "k1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: "hello",
    receivedAt: 1,
    ...over,
  };
}

function remoteError(code: string, message = "preset missing"): Error {
  const error = new Error(message) as Error & { isDSHRemoteError: true; code: string };
  error.isDSHRemoteError = true;
  error.code = code;
  return error;
}

test("followup agent-preset RemoteError enqueues bilingual /projects /new copy and is not accepted", async () => {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    {
      async listWorkspaces() {
        return [{ id: "ws", title: "WS" }];
      },
      async listSessions() {
        return [{ id: "sess" }];
      },
    } satisfies DirectoryPort,
    {
      async followup() {
        throw remoteError("agent-preset/not-found");
      },
      async steer() {
        return { dshMessageId: "x" };
      },
      async cancelCurrent() {},
      async removeInbox() {},
    } satisfies AgentPort,
  );
  const { token } = plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  await plane.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}` }));
  const reply = await plane.submitInbound(env({ adapterMessageKey: "m", text: "hello" }));
  assert.equal(reply.kind, "control");
  assert.equal(reply.failureCode, "PRESET_UNAVAILABLE");
  assert.notEqual(reply.errorClass, "DSH_UNAVAILABLE");
  assert.match(reply.text, /\/projects/);
  assert.match(reply.text, /\/new/);
  assert.match(reply.text, /\/项目/);
  assert.match(reply.text, /\/新建/);
  assert.doesNotMatch(reply.text, /presetlist|preset missing|stack/i);
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  const presetItems = store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText());
  assert.equal(presetItems.length, 1);
  assert.equal(presetItems[0]?.state, "pending");
  const inbound = store.queuedWithoutDshId();
  assert.equal(inbound.length, 0);
  const audit = store.listAudit().find((row) => row.event === "inbound_preset_unavailable");
  assert.equal(audit?.payload.code, "agent-preset/not-found");
  const again = await plane.recoverQueuedInbounds();
  assert.equal(again.dispatched, 0);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    1,
  );
  store.close();
});

test("Error.cause wrapping an official RemoteError still delivers preset copy", async () => {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    {
      async listWorkspaces() {
        return [{ id: "ws", title: "WS" }];
      },
      async listSessions() {
        return [{ id: "sess" }];
      },
    },
    {
      async followup() {
        throw new Error("gateway wrapped", { cause: remoteError("agent-preset/unavailable") });
      },
      async steer() {
        return { dshMessageId: "x" };
      },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  await plane.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}` }));
  const reply = await plane.submitInbound(env({ adapterMessageKey: "m2", text: "hello" }));
  assert.equal(reply.failureCode, "PRESET_UNAVAILABLE");
  assert.match(reply.text, /\/projects/);
  store.close();
});

test("non-preset followup errors stay DSH_UNAVAILABLE and do not enqueue command copy", async () => {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    {
      async listWorkspaces() {
        return [{ id: "ws", title: "WS" }];
      },
      async listSessions() {
        return [{ id: "sess" }];
      },
    },
    {
      async followup() {
        throw new Error("DSH down");
      },
      async steer() {
        return { dshMessageId: "x" };
      },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  await plane.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}` }));
  const reply = await plane.submitInbound(env({ adapterMessageKey: "m3", text: "hello" }));
  assert.equal(reply.kind, "rejected");
  assert.equal(reply.errorClass, "DSH_UNAVAILABLE");
  assert.doesNotMatch(reply.text, /\/projects|\/new|\/项目|\/新建/);
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  assert.equal(
    store.pendingOutbox(routeId).some((row) => /\/projects|\/项目/.test(row.payloadText ?? "")),
    false,
  );
  assert.equal(store.queuedWithoutDshId().length, 1);
  store.close();
});

test("steer agent-preset RemoteError uses the same classifier and outbox path", async () => {
  const inputs: ModelInput[] = [];
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    {
      async listWorkspaces() {
        return [{ id: "ws", title: "WS" }];
      },
      async listSessions() {
        return [{ id: "sess" }];
      },
    },
    {
      async followup(input) {
        inputs.push(input);
        return { dshMessageId: `dsh_${input.inboundId}` };
      },
      async steer() {
        throw remoteError("agent-preset/locked");
      },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const { token } = plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  await plane.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}` }));
  const reply = await plane.submitInbound(env({ adapterMessageKey: "steer", text: "/插话 later" }));
  assert.equal(reply.failureCode, "PRESET_UNAVAILABLE");
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  assert.equal(
    store.pendingOutbox(routeId).some((row) => /\/projects/.test(row.payloadText ?? "")),
    true,
  );
  store.close();
});
