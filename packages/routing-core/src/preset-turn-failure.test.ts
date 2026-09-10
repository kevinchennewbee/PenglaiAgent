import assert from "node:assert/strict";
import test from "node:test";
import {
  officialFileDigest,
  presetUnavailableUserText,
  sanitizeOfficialFileName,
  type InboundEnvelope,
  type ModelInput,
} from "@penglai/contracts";
import { Store } from "@penglai/persistence";
import { SeqIds, VirtualClock, tmpDb } from "@penglai/testkit";
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

function directory(): DirectoryPort {
  return {
    async listWorkspaces() {
      return [{ id: "ws", title: "WS" }];
    },
    async listSessions() {
      return [{ id: "sess" }];
    },
  };
}

function makePlane(store: Store, agent: AgentPort): RoutingControlPlane {
  return new RoutingControlPlane(store, new VirtualClock(), new SeqIds(), directory(), agent);
}

async function bind(p: RoutingControlPlane): Promise<void> {
  const { token } = p.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  await p.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}` }));
}

function assertSafePresetNotice(text: string): void {
  assert.match(text, /\/projects/);
  assert.match(text, /\/new/);
  assert.match(text, /\/项目/);
  assert.match(text, /\/新建/);
  assert.doesNotMatch(text, /presetlist|preset missing|stack|neutral preset|not-found/i);
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

test("recoverQueuedInbounds classifies nested agent-preset RemoteError after file receipt reopen", async () => {
  const path = tmpDb();
  const bytes = Buffer.from("CORAL-061-REPLAY");
  const file = {
    attachmentId: `sha256:${officialFileDigest(bytes)}`,
    name: sanitizeOfficialFileName("coral.txt"),
    bytes: bytes.byteLength,
  };
  const firstInputs: ModelInput[] = [];
  let store = new Store(path);
  let current = makePlane(store, {
    async followup(input) {
      firstInputs.push(input);
      throw new Error("temporary offline");
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(current);
  const first = await current.submitInbound(
    env({
      adapterMessageKey: "neutral-file",
      bodyKind: "media",
      text: "read this file",
      media: {
        kind: "file",
        source: "weixin",
        sourceMessageId: "neutral-file",
        sourceResourceId: "neutral-resource",
        mime: "text/plain",
        filename: file.name,
        size: file.bytes,
        sha256: file.attachmentId.slice(7),
        opaqueHandle: "media-neutral-admitted-fixture",
        officialFile: file,
      },
    }),
  );
  assert.equal(first.kind, "rejected");
  assert.equal(firstInputs[0]?.files?.[0]?.attachmentId, file.attachmentId);
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  const pending = store.queuedWithoutDshId().map((row) => row.inboundId);
  assert.equal(pending.length, 1);
  store.close();

  store = new Store(path);
  const recoveryInputs: ModelInput[] = [];
  current = makePlane(store, {
    async followup(input) {
      recoveryInputs.push(input);
      throw new Error("neutral wrapper", { cause: remoteError("agent-preset/not-found", "neutral preset disappeared") });
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  const recovery = await current.recoverQueuedInbounds();
  assert.equal(recovery.dispatched, 0);
  assert.equal(recovery.failed, 0);
  assert.equal(recovery.rejected, 1);
  assert.equal(recoveryInputs[0]?.files?.[0]?.attachmentId, file.attachmentId);
  assert.equal(recoveryInputs[0]?.recovery, true);
  const notices = store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText());
  assert.equal(notices.length, 1);
  assertSafePresetNotice(notices[0]!.payloadText!);
  assert.equal(store.getInbound(pending[0]!)?.state, "no_delivery");
  assert.equal(store.getInbound(pending[0]!)?.dshMessageId, undefined);
  assert.equal(store.queuedWithoutDshId().length, 0);
  const again = await current.recoverQueuedInbounds();
  assert.equal(again.dispatched, 0);
  assert.equal(again.failed, 0);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    1,
  );
  store.close();

  store = new Store(path);
  let recoveredFollowups = 0;
  current = makePlane(store, {
    async followup() {
      recoveredFollowups += 1;
      throw new Error("neutral wrapper", { cause: remoteError("agent-preset/not-found") });
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  const reopened = await current.recoverQueuedInbounds();
  assert.equal(reopened.dispatched, 0);
  assert.equal(reopened.failed, 0);
  assert.equal(recoveredFollowups, 0);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    1,
  );
  assert.equal(store.getInbound(pending[0]!)?.state, "no_delivery");
  store.close();
});

test("recoverQueuedInbounds steer uses the same preset classifier and outbox path", async () => {
  const store = new Store(":memory:");
  let boom: "offline" | "preset" | "ok" = "offline";
  const control = makePlane(store, {
    async followup(input) {
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer() {
      if (boom === "offline") throw new Error("temporary offline");
      if (boom === "preset") throw remoteError("agent-preset/locked");
      return { dshMessageId: "steered" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(control);
  const first = await control.submitInbound(env({ adapterMessageKey: "steer", text: "/插话 later" }));
  assert.equal(first.errorClass, "DSH_UNAVAILABLE");
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  const pending = store.queuedWithoutDshId();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.dispatchMode, "steer");
  boom = "preset";
  const recovery = await control.recoverQueuedInbounds();
  assert.equal(recovery.failed, 0);
  assert.equal(recovery.rejected, 1);
  const notices = store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText());
  assert.equal(notices.length, 1);
  assertSafePresetNotice(notices[0]!.payloadText!);
  assert.equal(store.getInbound(pending[0]!.inboundId)?.state, "no_delivery");
  assert.equal(store.getInbound(pending[0]!.inboundId)?.dshMessageId, undefined);
  const again = await control.recoverQueuedInbounds();
  assert.equal(again.dispatched, 0);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    1,
  );
  store.close();
});

test("recovery preserves transient retry, session-not-found ownership, and unknown errors", async () => {
  const store = new Store(":memory:");
  let mode: "offline" | "unknown" | "missing-session" | "ok" = "offline";
  const inputs: ModelInput[] = [];
  const control = makePlane(store, {
    async followup(input) {
      inputs.push(input);
      if (mode === "offline") throw new Error("temporary offline");
      if (mode === "unknown") throw new Error("mystery gateway");
      if (mode === "missing-session") throw remoteError("session-not-found", "gone");
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer() {
      return { dshMessageId: "x" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(control);
  await control.submitInbound(env({ adapterMessageKey: "m-offline", text: "hello" }));
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  const inboundId = store.queuedWithoutDshId()[0]!.inboundId;
  const deferred = await control.recoverQueuedInbounds();
  assert.equal(deferred.failed, 1);
  assert.equal(store.getInbound(inboundId)?.state, "queued");
  mode = "unknown";
  const unknown = await control.recoverQueuedInbounds();
  assert.equal(unknown.failed, 1);
  assert.equal(store.getInbound(inboundId)?.state, "queued");
  mode = "missing-session";
  const missing = await control.recoverQueuedInbounds();
  assert.equal(missing.failed, 1);
  assert.equal(store.getInbound(inboundId)?.state, "queued");
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    0,
  );
  mode = "ok";
  const recovered = await control.recoverQueuedInbounds();
  assert.equal(recovered.dispatched, 1);
  assert.equal(store.getInbound(inboundId)?.state, "queued");
  assert.ok(store.getInbound(inboundId)?.dshMessageId);
  assert.equal(inputs.at(-1)?.text, "hello");
  store.close();
});

test("preset notice and no_delivery are all-or-none across an injected state-write failure and reopen", async () => {
  const path = tmpDb();
  const bytes = Buffer.from("CORAL-061-ATOMIC");
  const file = {
    attachmentId: `sha256:${officialFileDigest(bytes)}`,
    name: sanitizeOfficialFileName("coral.txt"),
    bytes: bytes.byteLength,
  };
  let store = new Store(path);
  let current = makePlane(store, {
    async followup() {
      throw new Error("temporary offline");
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(current);
  await current.submitInbound(
    env({
      adapterMessageKey: "atomic-file",
      bodyKind: "media",
      text: "read this file",
      media: {
        kind: "file",
        source: "weixin",
        sourceMessageId: "atomic-file",
        sourceResourceId: "atomic-resource",
        mime: "text/plain",
        filename: file.name,
        size: file.bytes,
        sha256: file.attachmentId.slice(7),
        opaqueHandle: "media-atomic-admitted-fixture",
        officialFile: file,
      },
    }),
  );
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  const pending = store.queuedWithoutDshId().map((row) => row.inboundId);
  assert.equal(pending.length, 1);
  store.close();

  store = new Store(path);
  const originalSet = store.setInboundState.bind(store);
  store.setInboundState = ((inboundId: string, state: string, dshMessageId?: string) => {
    if (state === "no_delivery") {
      throw new Error("injected crash after outbox persistence before terminal state");
    }
    return originalSet(inboundId, state as Parameters<typeof originalSet>[1], dshMessageId);
  }) as typeof store.setInboundState;
  current = makePlane(store, {
    async followup() {
      throw new Error("neutral wrapper", { cause: remoteError("agent-preset/not-found", "neutral preset disappeared") });
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await assert.rejects(
    () => current.recoverQueuedInbounds(),
    /injected crash after outbox persistence before terminal state/,
  );
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    0,
  );
  assert.equal(store.getInbound(pending[0]!)?.state, "queued");
  assert.equal(
    store.listAudit().some((row) => row.event === "inbound_preset_unavailable"),
    false,
  );
  store.close();

  store = new Store(path);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    0,
  );
  assert.equal(store.getInbound(pending[0]!)?.state, "queued");
  current = makePlane(store, {
    async followup() {
      throw new Error("neutral wrapper", { cause: remoteError("agent-preset/not-found", "neutral preset disappeared") });
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  const recovered = await current.recoverQueuedInbounds();
  assert.equal(recovered.rejected, 1);
  assert.equal(recovered.failed, 0);
  assert.equal(recovered.dispatched, 0);
  const notices = store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText());
  assert.equal(notices.length, 1);
  assertSafePresetNotice(notices[0]!.payloadText!);
  assert.equal(store.getInbound(pending[0]!)?.state, "no_delivery");
  assert.equal(store.getInbound(pending[0]!)?.dshMessageId, undefined);
  const again = await current.recoverQueuedInbounds();
  assert.equal(again.dispatched, 0);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    1,
  );
  store.close();

  store = new Store(path);
  let acceptedAfterNotice = 0;
  current = makePlane(store, {
    async followup() {
      acceptedAfterNotice += 1;
      return { dshMessageId: "must-not-dispatch" };
    },
    async steer() {
      return { dshMessageId: "unused" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  const afterReopen = await current.recoverQueuedInbounds();
  assert.equal(afterReopen.dispatched, 0);
  assert.equal(acceptedAfterNotice, 0);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    1,
  );
  assert.equal(store.getInbound(pending[0]!)?.state, "no_delivery");
  store.close();
});

test("missing vendor target fail-closes the outbox and still terminals the inbound atomically", async () => {
  const store = new Store(":memory:");
  const control = makePlane(store, {
    async followup() {
      throw remoteError("agent-preset/not-found");
    },
    async steer() {
      return { dshMessageId: "x" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  const { token } = control.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  await control.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}`, vendorTarget: undefined }));
  const reply = await control.submitInbound(env({ adapterMessageKey: "m-novendor", text: "hello", vendorTarget: undefined }));
  assert.equal(reply.failureCode, "PRESET_UNAVAILABLE");
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  assert.equal(store.getVendorReplyTarget(routeId), undefined);
  assert.equal(
    store.pendingOutbox(routeId).filter((row) => row.payloadText === presetUnavailableUserText()).length,
    0,
  );
  assert.equal(store.queuedWithoutDshId().length, 0);
  const inbound = store.listAudit().find((row) => row.event === "inbound_preset_unavailable");
  assert.ok(inbound);
  store.close();
});
