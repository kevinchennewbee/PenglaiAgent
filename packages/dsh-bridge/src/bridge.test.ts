import assert from "node:assert/strict";
import test from "node:test";
import { isJsonValue } from "@deepseek-ai/dsh-session";
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
import { hostFromCordis, listenOfficialEvents } from "./plugin.js";

test("R1-UP-001 rejects other versions", () => {
  assert.throws(() => assertDshVersion("9.9.9"), PenglaiError);
});

test("R1-UP-001 pinned official packages are 0.1.0-rc.8", () => {
  const pinned = probePinnedPackages();
  assert.equal(pinned.dsh, "0.1.0-rc.8");
  assert.equal(pinned.agent, "0.1.0-rc.8");
  assert.equal(pinned.llm, "0.1.0-rc.8");
  assert.equal(pinned.workspace, "0.1.0-rc.8");
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
    version: "0.1.0-rc.8",
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

test("bridge fails closed before waking an IM turn when the official model route is unavailable", async () => {
  const calls: string[] = [];
  const bridge = new DshBridge({
    version: "0.1.0-rc.8",
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
    version: "0.1.0-rc.8",
    getAgent: (id) => ({
      id,
      session: {
        events: [{
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

test("official apiProxy session.create is the only new-session seam", async () => {
  const requests: Array<{ rpcId: string; payload: { workspaceId: string } }> = [];
  const host = hostFromCordis({
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
  }, "0.1.0-rc.8");
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
  assert.doesNotThrow(() => hostFromCordis(proxied as never, "0.1.0-rc.8"));
});

test("official apiProxy session.models/selectModel are the only IM model command seams", async () => {
  const calls: string[] = [];
  const host = hostFromCordis({
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
  }, "0.1.0-rc.8");
  const bridge = new DshBridge(host);
  const directory = await bridge.describeSessionModels("session-1");
  assert.equal(directory.current.model, "deepseek-chat");
  assert.deepEqual(await bridge.selectSessionModel("session-1", { provider: "deepseek", model: "deepseek-reasoner" }), {
    provider: "deepseek",
    model: "deepseek-reasoner",
  });
  assert.deepEqual(calls, ["models:session-1", "select:session-1:deepseek/deepseek-reasoner"]);
});

test("official apiProxy is resolved through the live Cordis context proxy", async () => {
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
  const host = hostFromCordis(ctx as never, "0.1.0-rc.8");
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
      version: "0.1.0-rc.8",
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
