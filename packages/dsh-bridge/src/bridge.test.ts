import assert from "node:assert/strict";
import test from "node:test";
import { Session } from "@deepseek-ai/dsh-session";
import { isJsonValue } from "@deepseek-ai/dsh-util-values";
import { PenglaiError } from "@penglai/contracts";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import {
  DshBridge,
  assertDshVersion,
  claimedFromOfficial,
  extractPenglaiSource,
  probePinnedPackages,
  withPenglaiVoiceContext,
} from "./index.js";
import {
  hostFromRc2Cordis,
  listenOfficialEvents,
  recoverOfficialDeliveriesFromHost,
  recoverOfficialTurnDelivery,
} from "./plugin.js";

test("R1-UP-001 rejects other versions", () => {
  assert.throws(() => assertDshVersion("9.9.9"), PenglaiError);
});

test("R1-UP-001 pinned official packages are 0.1.5-rc.1", () => {
  const pinned = probePinnedPackages();
  assert.equal(pinned.dsh, "0.1.5-rc.1");
  assert.equal(pinned.agent, "0.1.5-rc.1");
  assert.equal(pinned.llm, "0.1.5-rc.1");
  assert.equal(pinned.workspace, "0.1.5-rc.1");
});

test("R1-UP-002/003 legacy IM source is normalized to an official visible user source", () => {
  const src = {
    kind: "penglai-im",
    schema: 1,
    routeId: "r",
    inboundId: "i",
    adapter: "mock" as const,
    voice: { language: "zh" as const, emotion: "HAPPY" as const },
  };
  assert.deepEqual(extractPenglaiSource(src), { ...src, kind: "user" });
  const fact = claimedFromOfficial({ message: { id: "m", source: src }, turn: 4, sessionId: "s" });
  assert.equal(fact?.turnId, "4");
  assert.equal(fact && "kind" in fact.source && fact.source.kind === "user" && fact.source.inboundId, "i");
});

test("every shipped IM adapter preserves official claimed-turn correlation", () => {
  for (const adapter of ["mock", "weixin", "feishu", "dingtalk", "wecom", "qq", "slack", "telegram", "discord"] as const) {
    const fact = claimedFromOfficial({
      message: { id: `message-${adapter}`, source: { kind: "user", schema: 1, routeId: "route", inboundId: "inbound", adapter } },
      turn: 1,
      sessionId: "session",
    });
    assert.equal(fact?.source.adapter, adapter);
    assert.equal(fact?.source.routeId, "route");
    assert.equal(fact?.source.inboundId, "inbound");
  }
});

test("voice source metadata is strict and enters only the model pre-step view", () => {
  const source = {
    kind: "penglai-im",
    schema: 1,
    routeId: "r",
    inboundId: "voice-1",
    adapter: "weixin" as const,
    voice: { language: "zh" as const, emotion: "HAPPY" as const },
  };
  const durable = {
    id: "voice-1",
    role: "user" as const,
    content: [{ type: "text", text: "今天很开心" }],
    source,
  };
  const entered = withPenglaiVoiceContext([durable]);
  assert.notEqual(entered[0], durable);
  assert.equal(durable.content.length, 1);
  assert.equal(durable.content[0]?.text, "今天很开心");
  assert.match(entered[0]?.content[0] && (entered[0].content[0] as { text: string }).text, /NOT USER-AUTHORED/);
  assert.match(entered[0]?.content[0] && (entered[0].content[0] as { text: string }).text, /language=zh; emotion=HAPPY/);
  assert.equal((entered[0]?.content[1] as { text?: string } | undefined)?.text, "今天很开心");
  assert.equal(entered[0]?.id, durable.id);
  assert.equal(entered[0]?.source, durable.source);
  assert.equal(isJsonValue(entered[0]), true);
  assert.deepEqual(Reflect.ownKeys(entered[0] ?? {}), ["id", "role", "content", "source"]);
  assert.deepEqual(withPenglaiVoiceContext(entered), entered);

  const invalidMarker = Symbol("non-json-marker");
  const invalid = { ...entered[0] };
  Object.defineProperty(invalid, invalidMarker, { value: true });
  assert.equal(isJsonValue(invalid), false);

  assert.equal(
    extractPenglaiSource({ ...source, voice: { language: "zh", emotion: "USER_SUPPLIED" } }),
    undefined,
  );
  const textOnly = { ...durable, source: { ...source, voice: undefined } };
  assert.equal(withPenglaiVoiceContext([textOnly])[0], textOnly);
});

test("bridge followup uses host agent only", async () => {
  const calls: string[] = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: (id) => ({
      id,
      followup(m) { calls.push(m.source.inboundId); },
      steer() {},
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    async describeSessionModels(id) {
      calls.push(`models:${id}`);
      return {
        current: { provider: "deepseek", model: "deepseek-chat" },
        routable: true,
        groups: [],
      };
    },
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  await bridge.followup({
    sessionId: "s",
    inboundId: "in1",
    routeId: "r",
    text: "hi",
    source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "in1", adapter: "mock" },
    mode: "followup",
  });
  assert.deepEqual(calls, ["models:s", "in1"]);
});

test("bridge followup submits official DSH image blocks instead of media captions", async () => {
  const sent: Array<{ type: string; text?: string; attachment?: { attachmentId: string } }> = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: (id) => ({
      id,
      followup(m) {
        sent.push(...m.content);
      },
      steer() {},
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    async describeSessionModels() {
      return {
        current: { provider: "deepseek", model: "deepseek-v4-flash-vision-exp" },
        routable: true,
        groups: [],
      };
    },
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  const attachment = {
    attachmentId: "att-1",
    mediaType: "image/png" as const,
    bytes: 67,
    width: 1,
    height: 1,
  };
  await bridge.followup({
    sessionId: "s",
    inboundId: "in-img",
    routeId: "r",
    text: "用户发送了一张图片。",
    images: [attachment],
    source: { kind: "user", schema: 1, routeId: "r", inboundId: "in-img", adapter: "weixin" },
    mode: "followup",
  });
  assert.equal(sent.some((row) => row.type === "image" && row.attachment?.attachmentId === "att-1"), true);
  assert.equal(sent.some((row) => row.type === "text" && String(row.text).includes("penglai-media")), false);
});

test("bridge supplies the session-bound opaque office handle to the official DSH turn", async () => {
  const sent: Array<{ type: string; text?: string }> = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: (id) => ({
      id,
      followup(message) { sent.push(...message.content); },
      steer() {},
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    async describeSessionModels() {
      return { current: { provider: "deepseek", model: "deepseek-chat" }, routable: true, groups: [] };
    },
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  await bridge.followup({
    sessionId: "s",
    inboundId: "in-office",
    routeId: "r",
    text: "用户发送了一份文档。请检查附件。",
    officeHandle: "obj-0123456789abcdef01234567",
    source: { kind: "user", schema: 1, routeId: "r", inboundId: "in-office", adapter: "feishu" },
    mode: "followup",
  });
  const context = sent.find((part) => part.type === "text" && part.text?.includes("office_handle="));
  assert.match(context?.text ?? "", /office_handle=obj-0123456789abcdef01234567/);
  assert.doesNotMatch(context?.text ?? "", /[/\\](Users|Volumes|home|tmp)[/\\]/);
});

test("bridge submits official FileBlock plus office handle text and never a host path", async () => {
  const sent: Array<{ type: string; text?: string; attachment?: { attachmentId?: string; name?: string } }> = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: (id) => ({
      id,
      followup(message) { sent.push(...message.content); },
      steer() {},
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    async describeSessionModels() {
      return { current: { provider: "deepseek", model: "deepseek-chat" }, routable: true, sessionExists: true, groups: [] };
    },
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  const file = {
    attachmentId: `sha256:${"ab".repeat(32)}`,
    name: "note.pdf",
    bytes: 12,
  };
  await bridge.followup({
    sessionId: "s",
    inboundId: "in-file",
    routeId: "r",
    text: "用户发送了一份文档。请检查附件。",
    officeHandle: "obj-0123456789abcdef01234567",
    files: [file],
    source: { kind: "user", schema: 1, routeId: "r", inboundId: "in-file", adapter: "weixin" },
    mode: "followup",
  });
  assert.equal(sent.some((row) => row.type === "file" && row.attachment?.attachmentId === file.attachmentId), true);
  assert.equal(sent.some((row) => row.type === "text" && String(row.text).includes("office_handle=")), true);
  assert.equal(sent.some((row) => String(row.text ?? "").includes("/Users/") || String(row.attachment?.name ?? "").includes("/")), false);
});

test("bridge fails closed before waking an IM turn when the official model route is unavailable", async () => {
  const calls: string[] = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: (id) => ({
      id,
      followup() { calls.push("followup"); },
      steer() { calls.push("steer"); },
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    async describeSessionModels() {
      return {
        current: { provider: "missing", model: "missing" },
        routable: false,
        groups: [],
      };
    },
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  await assert.rejects(
    () => bridge.followup({
      sessionId: "s",
      inboundId: "in-no-model",
      routeId: "r",
      text: "hi",
      source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "in-no-model", adapter: "mock" },
      mode: "followup",
    }),
    /official session model route unavailable/,
  );
  assert.deepEqual(calls, []);
});

test("bridge treats a durable DSH inbox message id as an idempotent replay", async () => {
  const calls: string[] = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: (id) => ({
      id,
      session: {
        snapshotEvents: () => [{
          type: "agent/inbox/spliced",
          data: { inserted: [{ id: "already-durable" }] },
        }],
      },
      followup(m) { calls.push(m.id ?? ""); },
      steer(m) { calls.push(m.id ?? ""); },
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  const input = {
    sessionId: "s",
    inboundId: "already-durable",
    routeId: "r",
    text: "do not duplicate",
    source: { kind: "penglai-im" as const, schema: 1 as const, routeId: "r", inboundId: "already-durable", adapter: "mock" as const },
    mode: "followup" as const,
    recovery: true as const,
  };
  assert.deepEqual(await bridge.followup(input), { dshMessageId: "already-durable" });
  assert.deepEqual(await bridge.steer({ ...input, mode: "steer" }), { dshMessageId: "already-durable" });
  assert.deepEqual(calls, []);
});

test("bridge joins official Workspace membership to Session-owner titles", async () => {
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent() { return undefined; },
    listWorkspaces: () => [
      { id: "workspace-1", title: "One", sessionIds: ["session-2", "session-1"] },
      { id: "workspace-2", title: "Two", sessionIds: ["session-3"] },
    ],
    async listSessions() {
      return [
        { id: "session-1", title: "Durable title" },
        { id: "session-3", title: "Other workspace" },
        { id: "session-2" },
      ];
    },
  });
  assert.deepEqual(await bridge.listSessions("workspace-1"), [
    { id: "session-2" },
    { id: "session-1", title: "Durable title" },
  ]);
});

test("session projection refreshes rename, deletion, Unicode, duplicates, and large owner lists", async () => {
  let workspaceSessionIds = ["session-a", "session-b", "session-c"];
  let sessionRows: Array<{ id: string; title?: string }> = [
    { id: "session-a", title: "同名" },
    { id: "session-b", title: "同名" },
    { id: "session-c", title: "研究 🩷 漢字" },
  ];
  const owner = {
    version: "0.1.5-rc.1",
    getAgent() { return undefined; },
    listWorkspaces: () => [
      { id: "workspace-1", title: "One", sessionIds: workspaceSessionIds },
    ],
    async listSessions() {
      return sessionRows;
    },
  };
  const bridge = new DshBridge(owner);
  assert.deepEqual(await bridge.listSessions("workspace-1"), sessionRows);

  workspaceSessionIds = ["session-b", ...Array.from({ length: 150 }, (_, index) => `many-${index}`)];
  sessionRows = [
    { id: "session-b", title: "重命名后的会话" },
    ...Array.from({ length: 150 }, (_, index) => ({
      id: `many-${index}`,
      title: `会话 ${index + 1}`,
    })),
  ];
  const afterReconnect = new DshBridge(owner);
  const refreshed = await afterReconnect.listSessions("workspace-1");
  assert.equal(refreshed.length, 151);
  assert.deepEqual(refreshed[0], { id: "session-b", title: "重命名后的会话" });
  assert.equal(refreshed.some((session) => session.id === "session-a"), false);
  assert.deepEqual(refreshed.at(-1), { id: "many-149", title: "会话 150" });
});

test("bridge forwards a new-session title only to the Session owner", async () => {
  const calls: Array<{ workspaceIdentity: string; title?: string }> = [];
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent() { return undefined; },
    listWorkspaces: () => [],
    async createSession(workspaceIdentity, title) {
      calls.push({ workspaceIdentity, ...(title === undefined ? {} : { title }) });
      return { id: "session-created" };
    },
  });
  assert.deepEqual(await bridge.createSession("workspace-1", "Penglai"), { id: "session-created" });
  assert.deepEqual(calls, [{ workspaceIdentity: "workspace-1", title: "Penglai" }]);
});

test("rc.2 adapter contains apiProxy session.create as the historical new-session seam", async () => {
  const requests: Array<{ rpcId: string; payload: { workspaceId: string } }> = [];
  const host = hostFromRc2Cordis({
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [{ id: "workspace-1", title: "W", sessionIds: [] }] },
    apiProxy: {
      sessions: {
        async create(request) {
          requests.push(request);
          return { result: { ok: true as const, value: { sessionId: "official-session-1" } } };
        },
      },
    },
  }, "0.1.1-rc.2");
  assert.deepEqual(await host.createSession?.("workspace-1"), { id: "official-session-1" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.payload.workspaceId, "workspace-1");
  assert.match(requests[0]?.rpcId ?? "", /^[0-9a-f-]{36}$/);
  const proxied = new Proxy(
    {
      on() {},
      agents: { get() { return undefined; } },
      workspaceRegistry: { list: () => [] },
    },
    {
      get(target, prop, receiver) {
        if (prop === "apiProxy") throw new Error("cannot get property \"apiProxy\" without inject");
        return Reflect.get(target, prop, receiver);
      },
    },
  );
  assert.doesNotThrow(() => hostFromRc2Cordis(proxied as never, "0.1.1-rc.2"));
});

test("rc.2 adapter contains apiProxy session.models/selectModel as historical IM seams", async () => {
  const calls: string[] = [];
  const host = hostFromRc2Cordis({
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [{ id: "workspace-1", title: "W", sessionIds: ["session-1"] }] },
    apiProxy: {
      sessions: {
        async create() { return { result: { ok: true as const, value: { sessionId: "session-2" } } }; },
        async models(request) {
          calls.push(`models:${request.payload.sessionId}`);
          return { result: { ok: true as const, value: {
            current: { provider: "deepseek", model: "deepseek-chat" },
            routable: true,
            groups: [{ id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }, { id: "deepseek-reasoner", name: "DeepSeek Reasoner" }] }],
          } } };
        },
        async selectModel(request) {
          calls.push(`select:${request.payload.sessionId}:${request.payload.provider}/${request.payload.model}`);
          return { result: { ok: true as const, value: { selected: { provider: request.payload.provider, model: request.payload.model } } } };
        },
      },
    },
  }, "0.1.1-rc.2");
  const directory = await host.describeSessionModels?.("session-1");
  assert.equal(directory?.current.model, "deepseek-chat");
  assert.deepEqual(await host.selectSessionModel?.("session-1", { provider: "deepseek", model: "deepseek-reasoner" }), {
    provider: "deepseek",
    model: "deepseek-reasoner",
  });
  assert.deepEqual(calls, ["models:session-1", "select:session-1:deepseek/deepseek-reasoner"]);
});

test("rc.2 adapter resolves apiProxy through the live Cordis context proxy", async () => {
  const calls: string[] = [];
  const apiProxy = {
    sessions: {
      async models(request: { rpcId: string; payload: { sessionId: string } }) {
        calls.push(request.payload.sessionId);
        return { result: { ok: true as const, value: {
          current: { provider: "deepseek", model: "deepseek-chat" },
          routable: true,
          groups: [],
        } } };
      },
    },
  };
  const ctx = new Proxy(
    {
      on() {},
      agents: { get() { return undefined; } },
      workspaceRegistry: { list: () => [] },
    },
    {
      get(target, prop, receiver) {
        if (prop === "apiProxy") return apiProxy;
        return Reflect.get(target, prop, receiver);
      },
    },
  );
  assert.equal(Object.getOwnPropertyDescriptor(ctx, "apiProxy"), undefined);
  const host = hostFromRc2Cordis(ctx as never, "0.1.1-rc.2");
  const directory = await host.describeSessionModels?.("session-proxy");
  assert.equal(directory?.current.model, "deepseek-chat");
  assert.deepEqual(calls, ["session-proxy"]);
});

test("budget hard limit blocks official followup before the agent", async () => {
  const { BudgetGate } = await import("@penglai/budget");
  const calls: string[] = [];
  const gate = new BudgetGate({ hardTokens: 1 }, () => Date.now());
  gate.reserve({ tokens: 1, priceTrusted: false });
  const bridge = new DshBridge(
    {
      version: "0.1.5-rc.1",
      getAgent: (id) => ({
        id,
        followup(m) {
          calls.push(m.source.inboundId);
        },
        steer() {},
        cancel() {},
        inbox: { remove() { return true; } },
      }),
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
    gate,
  );
  await assert.rejects(
    () =>
      bridge.followup({
        sessionId: "s",
        inboundId: "in2",
        routeId: "r",
        text: "hi",
        source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "in2", adapter: "mock" },
        mode: "followup",
      }),
    /hard block/,
  );
  assert.deepEqual(calls, []);
});

test("official claimed then turn/end only delivers matching IM turn", () => {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  store.upsertRoute({ routeId: "r", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  store.putBinding({
    routeId: "r", workspaceIdentity: "w", sessionId: "s", revision: 1, status: "active",
    createdAt: "t", updatedAt: "t",
  });
  store.insertInbound({
    inboundId: "in1", adapterMessageKey: "k", routeId: "r", bindingRevision: 1,
    bodyKind: "text", redactedDigest: "d", state: "queued",
  }, "hi", 1);
  const listeners = new Map<string, (p: Record<string, unknown>) => void>();
  listenOfficialEvents(
    {
      on(event, fn) { listeners.set(event, fn); },
    },
    plane,
  );
  listeners.get("agent/inbox/claimed")?.({
    agent: { id: "s" },
    message: { id: "mid", source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "in1", adapter: "mock" } },
    turn: 8,
  });
  listeners.get("assistant/message")?.({
    turn: 8,
    agent: { id: "s" },
    message: { content: [{ type: "text", text: "final" }] },
  });
  listeners.get("turn/end")?.({ turn: 8, agent: { id: "s" } });
  assert.equal(store.pendingOutbox("r")[0]?.payloadText, "final");
});

test("official session/event pair delivers assistant final to the IM route", () => {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  store.upsertRoute({ routeId: "r", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  store.putBinding({
    routeId: "r", workspaceIdentity: "w", sessionId: "s", revision: 1, status: "active",
    createdAt: "t", updatedAt: "t",
  });
  store.insertInbound({
    inboundId: "in1", adapterMessageKey: "k", routeId: "r", bindingRevision: 1,
    bodyKind: "text", redactedDigest: "d", state: "queued",
  }, "hi", 1);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  listenOfficialEvents(
    {
      on(event, fn) { listeners.set(event, fn); },
    },
    plane,
  );
  listeners.get("agent/inbox/claimed")?.({
    agent: { id: "s" },
    message: { id: "mid", source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "in1", adapter: "mock" } },
    turn: 2,
  });
  listeners.get("session/event")?.(
    { id: "s" },
    { type: "assistant/message", data: { turn: 2, message: { content: [{ type: "text", text: "penglai-causal-ok" }] } } },
  );
  listeners.get("session/event")?.({ id: "s" }, { type: "turn/end", data: { turn: 2 } });
  assert.equal(store.pendingOutbox("r")[0]?.payloadText, "penglai-causal-ok");
});

function recoveryPlane() {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "x" }; }, async steer() { return { dshMessageId: "x" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  store.upsertRoute({ routeId: "r", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  store.putBinding({
    routeId: "r", workspaceIdentity: "w", sessionId: "s", revision: 1, status: "active",
    createdAt: "t", updatedAt: "t",
  });
  store.insertInbound({
    inboundId: "in1", adapterMessageKey: "k", routeId: "r", bindingRevision: 1,
    bodyKind: "text", redactedDigest: "d", state: "queued",
  }, "hi", 1);
  const source = { kind: "user", schema: 1, routeId: "r", inboundId: "in1", adapter: "mock" };
  return { store, plane, source };
}

test("official durable session recovery closes claimed-turn/final/outbox without duplicate delivery", () => {
  const first = recoveryPlane();
  const claimed = {
    type: "agent/inbox/claimed",
    data: { turn: 3, message: { id: "mid", source: first.source } },
  };
  const assistant = {
    type: "assistant/message",
    data: { turn: 3, message: { content: [{ type: "text", text: "durable-final" }] } },
  };
  const crashWindow = recoverOfficialTurnDelivery(first.plane, {
    sessionId: "s",
    events: [claimed, assistant],
  });
  assert.equal(crashWindow.incomplete, 1);
  assert.equal(crashWindow.delivered, 0);
  assert.equal(first.store.pendingOutbox("r").length, 0);

  const closed = recoverOfficialTurnDelivery(first.plane, {
    sessionId: "s",
    events: [claimed, assistant, { type: "turn/end", data: { turn: 3 } }],
  });
  assert.equal(closed.claimed, 1);
  assert.equal(closed.delivered, 1);
  assert.equal(first.store.pendingOutbox("r")[0]?.payloadText, "durable-final");
  const outboxId = first.store.pendingOutbox("r")[0]?.outboxId;

  const replay = recoverOfficialTurnDelivery(first.plane, {
    sessionId: "s",
    events: [claimed, assistant, { type: "turn/end", data: { turn: 3 } }],
  });
  assert.equal(replay.delivered, 1);
  assert.equal(first.store.pendingOutbox("r").length, 1);
  assert.equal(first.store.pendingOutbox("r")[0]?.outboxId, outboxId);

  const spliced = recoveryPlane();
  recoverOfficialTurnDelivery(spliced.plane, {
    sessionId: "s",
    events: [
      { type: "turn/start", data: { turn: 4 } },
      { type: "agent/inbox/spliced", data: { inserted: [{ id: "mid-2", source: spliced.source }] } },
      { type: "assistant/message", data: { turn: 4, message: { content: [{ type: "text", text: "from-snapshot" }] } } },
      { type: "turn/end", data: { turn: 4 } },
    ],
  });
  assert.equal(spliced.store.pendingOutbox("r")[0]?.payloadText, "from-snapshot");
});

test("host recovery reads official snapshotEvents and does not duplicate outbox", async () => {
  const { store, plane, source } = recoveryPlane();
  const events = [
    { type: "agent/inbox/claimed", data: { turn: 5, message: { id: "mid", source } } },
    { type: "assistant/message", data: { turn: 5, message: { content: [{ type: "text", text: "host-final" }] } } },
    { type: "turn/end", data: { turn: 5 } },
  ];
  const host = {
    version: "0.1.5-rc.1",
    getAgent: (id: string) =>
      id === "s"
        ? {
            id,
            session: { snapshotEvents: () => events },
            followup() {},
            steer() {},
            cancel() {},
            inbox: { remove() { return true; } },
          }
        : undefined,
    listWorkspaces: () => [],
    listSessions: async () => [{ id: "s" }],
  };
  const first = await recoverOfficialDeliveriesFromHost(host as never, plane);
  const second = await recoverOfficialDeliveriesFromHost(host as never, plane);
  assert.equal(first.delivered, 1);
  assert.equal(second.delivered, 1);
  assert.equal(store.pendingOutbox("r").length, 1);
  assert.equal(store.pendingOutbox("r")[0]?.payloadText, "host-final");
});

test("host recovery reads official inspect events for cold sessions without a live Agent", async () => {
  const { store, plane, source } = recoveryPlane();
  const events = [
    { type: "turn/start", data: { turn: 7 } },
    { type: "step/start", data: { turn: 7, step: 1 } },
    {
      type: "user/message",
      data: {
        id: "mid-cold",
        role: "user",
        content: [{ type: "text", text: "cold inbound" }],
        source,
      },
    },
    { type: "assistant/message", data: { turn: 7, step: 1, message: { content: [{ type: "text", text: "cold-final" }] }, stream: [] } },
    { type: "step/end", data: { turn: 7, step: 1 } },
    { type: "turn/end", data: { turn: 7, reason: { kind: "completed" } } },
  ];
  const host = {
    version: "0.1.5-rc.1",
    getAgent: () => undefined,
    inspectSession: async (id: string) => (id === "cold" ? { events } : undefined),
    listWorkspaces: () => [],
    listSessions: async () => [{ id: "cold" }],
  };
  const first = await recoverOfficialDeliveriesFromHost(host as never, plane);
  const second = await recoverOfficialDeliveriesFromHost(host as never, plane);
  assert.equal(first.sessions, 1);
  assert.equal(first.delivered, 1);
  assert.equal(second.delivered, 1);
  assert.equal(store.pendingOutbox("r").length, 1);
  assert.equal(store.pendingOutbox("r")[0]?.payloadText, "cold-final");
});

test("followup classifies a proven missing official session as INVALID_INPUT", async () => {
  const bridge = new DshBridge({
    version: "0.1.5-rc.1",
    getAgent: () => undefined,
    async describeSessionModels() {
      return {
        current: { provider: "deepseek", model: "deepseek-flash" },
        routable: false,
        sessionExists: false,
        groups: [],
      };
    },
    listWorkspaces: () => [],
  });
  await assert.rejects(
    () => bridge.followup({
      sessionId: "missing",
      inboundId: "in-missing",
      routeId: "r",
      text: "hi",
      source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "in-missing", adapter: "mock" },
      mode: "followup",
    }),
    (err: unknown) => err instanceof PenglaiError && err.errorClass === "INVALID_INPUT" && /session does not exist/.test(err.message),
  );
});

test("recoverOfficialTurnDelivery uses pinned Session.append/snapshotEvents envelopes", () => {
  const { plane, store, source } = recoveryPlane();
  const session = Session.create("s");
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  session.append(
    "user/message",
    {
      id: "pm-inbound-message",
      role: "user",
      content: [{ type: "text", text: "neutral recovery fixture" }],
      source,
    } as never,
    { surfaceOp: "append" },
  );
  session.append(
    "assistant/message",
    {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [{ type: "text", text: "PM-COLD-COMPLETED" }] },
      stream: [],
    } as never,
    { surfaceOp: "append" },
  );
  session.append("step/end", { turn: 1, step: 1 });
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  const result = recoverOfficialTurnDelivery(plane, { sessionId: session.id, events: session.snapshotEvents() });
  assert.deepEqual(result, { claimed: 1, delivered: 1, incomplete: 0 });
  assert.equal(store.pendingOutbox("r")[0]?.payloadText, "PM-COLD-COMPLETED");
});

test("recoverOfficialTurnDelivery associates pre-turn splices, injections, incomplete and closed turns", () => {
  const first = recoveryPlane();
  const second = recoveryPlane();
  const spliceThenTurn = recoverOfficialTurnDelivery(first.plane, {
    sessionId: "s",
    events: [
      { type: "agent/inbox/spliced", data: { target: "next-turn", start: 0, inserted: [{ id: "mid-pre", source: first.source }] } },
      { type: "turn/start", data: { turn: 2 } },
      { type: "user/message", data: { id: "mid-pre", role: "user", content: [{ type: "text", text: "claimed" }], source: first.source } },
      { type: "user/message", data: { id: "inject-1", role: "user", content: [{ type: "text", text: "notice" }], source: { kind: "plugin", plugin: "fs" } } },
      { type: "assistant/message", data: { turn: 2, message: { content: [{ type: "text", text: "from-splice" }] } } },
      { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } },
    ],
  });
  assert.deepEqual(spliceThenTurn, { claimed: 1, delivered: 1, incomplete: 0 });
  assert.equal(first.store.pendingOutbox("r")[0]?.payloadText, "from-splice");

  const incomplete = recoverOfficialTurnDelivery(second.plane, {
    sessionId: "s",
    events: [
      { type: "turn/start", data: { turn: 9 } },
      { type: "user/message", data: { id: "mid-open", role: "user", content: [{ type: "text", text: "open" }], source: second.source } },
      { type: "assistant/message", data: { turn: 9, message: { content: [{ type: "text", text: "partial" }] } } },
    ],
  });
  assert.equal(incomplete.incomplete, 1);
  assert.equal(incomplete.delivered, 0);
  assert.equal(second.store.pendingOutbox("r").length, 0);

  const replay = recoverOfficialTurnDelivery(first.plane, {
    sessionId: "s",
    events: [
      { type: "turn/start", data: { turn: 2 } },
      { type: "user/message", data: { id: "mid-pre", role: "user", content: [{ type: "text", text: "claimed" }], source: first.source } },
      { type: "assistant/message", data: { turn: 2, message: { content: [{ type: "text", text: "from-splice" }] } } },
      { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } },
    ],
  });
  assert.equal(replay.delivered, 1);
  assert.equal(first.store.pendingOutbox("r").length, 1);
});
