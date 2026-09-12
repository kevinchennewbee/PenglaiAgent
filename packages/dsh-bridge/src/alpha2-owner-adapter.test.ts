import assert from "node:assert/strict";
import test from "node:test";
import {
  foldAlpha2ModelSelection,
  foldAlpha2Title,
  hostFromAlpha2Cordis,
  V3_SESSION_EVENT_TYPE_EXTRAS,
} from "./alpha2-owner-adapter.js";

test("alpha.2 adapter uses the official sessionController for list, create, rename, and model operations", async () => {
  const calls: string[] = [];
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [{ id: "workspace-1", title: "Workspace", sessionIds: ["session-1"] }] },
    sessionController: {
      async list() {
        calls.push("list");
        return { items: [{
          sessionId: "session-1",
          projections: { values: {
            title: "Official title",
            modelSelection: { next: { provider: "deepseek", model: "deepseek-reasoner" } },
          }, asOfSeq: 0 },
        }] };
      },
      async create(request: { workspaceId?: string }) {
        calls.push(`create:${request.workspaceId}`);
        return { sessionId: "session-2" };
      },
      async rename(request: { sessionId: string; title: string }) {
        calls.push(`rename:${request.sessionId}:${request.title}`);
        return { title: request.title, seq: 1 };
      },
      async inspect() { return { events: [{ type: "model/selection", seq: 0, time: 1, data: { provider: "deepseek", model: "deepseek-reasoner" } }] }; },
      async modelCatalog() {
        calls.push("catalog");
        return {
          default: { provider: "deepseek", model: "deepseek-chat" },
          routableProviders: ["deepseek"],
          groups: [{
            id: "deepseek",
            name: "DeepSeek",
            models: [
              { id: "deepseek-chat", name: "DeepSeek Chat" },
              { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
            ],
          }],
        };
      },
      async selectModel(request: { sessionId: string; provider: string; model: string }) {
        calls.push(`select:${request.sessionId}:${request.provider}/${request.model}`);
        return { selected: { provider: request.provider, model: request.model } };
      },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  assert.deepEqual(await host.listSessions?.(), [{ id: "session-1", title: "Official title" }]);
  assert.deepEqual(await host.createSession?.("workspace-1", "Penglai"), { id: "session-2" });
  const directory = await host.describeSessionModels?.("session-1");
  assert.equal(directory?.current.model, "deepseek-reasoner");
  assert.equal(directory?.routable, true);
  assert.deepEqual(
    await host.selectSessionModel?.("session-1", { provider: "deepseek", model: "deepseek-chat" }),
    { provider: "deepseek", model: "deepseek-chat" },
  );
  assert.deepEqual(calls, [
    "list",
    "create:workspace-1",
    "rename:session-2:Penglai",
    "catalog",
    "list",
    "select:session-1:deepseek/deepseek-chat",
  ]);
});

test("alpha.2 model-selection fallback folds official durable events exactly", () => {
  assert.deepEqual(foldAlpha2ModelSelection([
    { type: "model/selection", data: { provider: "p", model: "pending" } },
    { type: "request/header", data: { header: { config: { provider: "p", model: "used" } } } },
  ]), { provider: "p", model: "pending" });
  assert.deepEqual(foldAlpha2ModelSelection([
    { type: "model/selection", data: { provider: "p", model: "same" } },
    { type: "request/header", data: { header: { config: { provider: "p", model: "same" } } } },
  ]), { provider: "p", model: "same" });
  assert.deepEqual(foldAlpha2ModelSelection([
    { type: "extension/future", seq: 1, time: 1, data: {}, ignorable: true },
    { type: "model/selection", seq: 2, time: 2, data: { provider: "p", model: "safe" } },
  ]), { provider: "p", model: "safe" });
  assert.throws(
    () => foldAlpha2ModelSelection([{ type: "extension/required", seq: 1, time: 1, data: {} }]),
    /required alpha\.2 Session event is unknown/,
  );
});

test("alpha.2 listSessions trusts title projections and does not inspect cold logs", async () => {
  let inspected = 0;
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() {
        return {
          items: [
            { sessionId: "session-1", projections: { asOfSeq: 1, values: { title: "Projected" } } },
            { sessionId: "session-2" },
          ],
        };
      },
      async inspect() {
        inspected += 1;
        return { events: [{ type: "session/title", seq: 1, time: 1, data: { title: "Inspected" } }] };
      },
      async create() { return { sessionId: "unused" }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
      async modelCatalog() { return { default: { provider: "p", model: "m" }, routableProviders: [], groups: [] }; },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  assert.deepEqual(await host.listSessions?.(), [
    { id: "session-1", title: "Projected" },
    { id: "session-2" },
  ]);
  assert.equal(inspected, 0);
});

test("alpha.2 listSessions trusts the official title projection and does not inspect to refresh it", async () => {
  assert.equal(foldAlpha2Title([
    { type: "session/title", seq: 1, time: 1, data: { title: "Old" } },
    { type: "session/title", seq: 2, time: 2, data: { title: "Current" } },
  ]), "Current");
  let inspected = 0;
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() {
        return { items: [{ sessionId: "session-1", projections: { asOfSeq: 1, values: { title: "Old" } } }] };
      },
      async inspect() {
        inspected += 1;
        return { events: [
          { type: "session/title", seq: 1, time: 1, data: { title: "Old" } },
          { type: "session/title", seq: 2, time: 2, data: { title: "Current" } },
        ] };
      },
      async create() { return { sessionId: "unused" }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 2 }; },
      async modelCatalog() { return { default: { provider: "p", model: "m" }, routableProviders: [], groups: [] }; },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  assert.deepEqual(await host.listSessions?.(), [{ id: "session-1", title: "Old" }]);
  assert.equal(inspected, 0);
  assert.equal(foldAlpha2Title([
    { type: "session/title", seq: 1, time: 1, data: { title: "Old" } },
    { type: "session/title", seq: 2, time: 2, data: { title: "Current" } },
  ]), "Current");
});

test("alpha.2 adapter uses list model projections and does not inspect cold logs", async () => {
  let inspected = 0;
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() {
        return { items: [{
          sessionId: "session-1",
          projections: {
            asOfSeq: 4,
            values: { modelSelection: { next: { provider: "deepseek", model: "projected" } } },
          },
        }] };
      },
      async create() { return { sessionId: "unused" }; },
      async inspect() {
        inspected += 1;
        return { events: [
          { type: "model/selection", seq: 5, time: 2, data: { provider: "deepseek", model: "log-only" } },
        ] };
      },
      async modelCatalog() {
        return {
          default: { provider: "deepseek", model: "default" },
          routableProviders: ["deepseek"],
          groups: [{ id: "deepseek", name: "DeepSeek", models: [{ id: "projected", name: "Projected" }] }],
        };
      },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  assert.deepEqual((await host.describeSessionModels?.("session-1"))?.current, {
    provider: "deepseek",
    model: "projected",
  });
  assert.equal(inspected, 0);
});

test("alpha.2 resume reuses an in-process live Agent on SessionAlreadyOwnedError", async () => {
  const live = { id: "session-1" };
  const ctx = {
    on() {},
    agents: {
      get(id: string) { return id === "session-1" ? live : undefined; },
      async resume() {
        const error = new Error("session already owned");
        error.name = "SessionAlreadyOwnedError";
        throw error;
      },
    },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() { return { items: [] }; },
      async create() { return { sessionId: "unused" }; },
      async inspect() { return { events: [] }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
      async modelCatalog() { return { default: { provider: "p", model: "m" }, routableProviders: [], groups: [] }; },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  assert.equal(await host.resumeAgent("session-1"), live);
});

test("alpha.2 resume fails closed when SessionAlreadyOwnedError has no live Agent", async () => {
  const ctx = {
    on() {},
    agents: {
      get() { return undefined; },
      async resume() {
        const error = new Error("session already owned");
        error.name = "SessionAlreadyOwnedError";
        throw error;
      },
    },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() { return { items: [] }; },
      async create() { return { sessionId: "unused" }; },
      async inspect() { return { events: [] }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
      async modelCatalog() { return { default: { provider: "p", model: "m" }, routableProviders: [], groups: [] }; },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  await assert.rejects(() => host.resumeAgent("session-1"), /already owned by another handle/);
});

test("owner adapter admits V3 catalog event types and still refuses assistant/chunk", () => {
  assert.deepEqual(
    [...V3_SESSION_EVENT_TYPE_EXTRAS].sort(),
    ["assistant/attempt", "system/message", "tool/ptc-dispatch", "tool/ptc-dispatch-start"],
  );
  assert.equal(
    (V3_SESSION_EVENT_TYPE_EXTRAS as readonly string[]).includes("assistant/chunk"),
    false,
  );
  assert.doesNotThrow(() =>
    foldAlpha2Title([
      { type: "system/message", seq: 1, time: 1, data: {} },
      { type: "assistant/attempt", seq: 2, time: 2, data: {} },
      { type: "tool/ptc-dispatch-start", seq: 3, time: 3, data: {} },
      { type: "tool/ptc-dispatch", seq: 4, time: 4, data: {} },
      { type: "session/title", seq: 5, time: 5, data: { title: "V3" } },
    ]),
  );
  assert.equal(
    foldAlpha2Title([
      { type: "system/message", seq: 1, time: 1, data: {} },
      { type: "assistant/attempt", seq: 2, time: 2, data: {} },
      { type: "tool/ptc-dispatch-start", seq: 3, time: 3, data: {} },
      { type: "tool/ptc-dispatch", seq: 4, time: 4, data: {} },
      { type: "session/title", seq: 5, time: 5, data: { title: "V3" } },
    ]),
    "V3",
  );
  assert.doesNotThrow(() =>
    foldAlpha2ModelSelection([
      { type: "system/message", seq: 1, time: 1, data: {} },
      { type: "assistant/attempt", seq: 2, time: 2, data: {} },
      { type: "tool/ptc-dispatch", seq: 3, time: 3, data: {} },
      { type: "model/selection", seq: 4, time: 4, data: { provider: "p", model: "v3" } },
    ]),
  );
  assert.throws(
    () => foldAlpha2Title([{ type: "assistant/chunk", seq: 1, time: 1, data: {} }]),
    /required alpha\.2 Session event is unknown/,
  );
  assert.throws(
    () => foldAlpha2ModelSelection([{ type: "assistant/chunk", seq: 1, time: 1, data: {} }]),
    /required alpha\.2 Session event is unknown/,
  );
});

test("describeSessionModels does not make a missing session routable via the global default", async () => {
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() {
        return { items: [{ sessionId: "real-session", projections: { values: {}, asOfSeq: 0 } }] };
      },
      async inspect(sessionId: string) {
        if (sessionId === "real-session") return { events: [] };
        const error = new Error(`session "${sessionId}" not found`);
        error.name = "ApiSessionNotFound";
        throw error;
      },
      async modelCatalog() {
        return {
          default: { provider: "deepseek", model: "deepseek-flash" },
          routableProviders: ["deepseek"],
          groups: [{ id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash" }] }],
        };
      },
      async create() { return { sessionId: "unused" }; },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  const missing = await host.describeSessionModels?.("no-such-session");
  assert.equal(missing?.sessionExists, false);
  assert.equal(missing?.routable, false);
  const present = await host.describeSessionModels?.("real-session");
  assert.equal(present?.sessionExists, true);
  assert.equal(present?.current.model, "deepseek-flash");
  assert.equal(present?.routable, true);
});

test("listSessions uses the reserved empty list request and returns every visible row once", async () => {
  const requests: unknown[] = [];
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list(request: { cursor?: string }) {
        requests.push(request);
        return {
          items: [
            { sessionId: "s1", projections: { values: { title: "One" }, asOfSeq: 0 } },
            { sessionId: "s2", projections: { values: { title: "Two" }, asOfSeq: 0 } },
            { sessionId: "s1", projections: { values: { title: "Dup" }, asOfSeq: 1 } },
          ],
          nextCursor: "search-provider-seam-must-be-ignored",
        };
      },
      async inspect() { return { events: [] }; },
      async modelCatalog() {
        return { default: { provider: "deepseek", model: "deepseek-flash" }, routableProviders: ["deepseek"], groups: [] };
      },
      async create() { return { sessionId: "unused" }; },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.5-rc.2");
  assert.deepEqual(await host.listSessions?.(), [
    { id: "s1", title: "One" },
    { id: "s2", title: "Two" },
  ]);
  assert.deepEqual(requests, [{}]);
});

test("alpha.2 adapter has no apiProxy access path", () => {
  const ctx = new Proxy(
    { on() {}, agents: { get() { return undefined; } }, workspaceRegistry: { list: () => [] } },
    { get(target, property, receiver) {
      if (property === "apiProxy") throw new Error("apiProxy must not be read");
      return Reflect.get(target, property, receiver);
    } },
  );
  assert.doesNotThrow(() => hostFromAlpha2Cordis(ctx, "0.1.5-rc.2"));
});
