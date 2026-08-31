import assert from "node:assert/strict";
import test from "node:test";
import { foldAlpha2ModelSelection, foldAlpha2Title, hostFromAlpha2Cordis } from "./alpha2-owner-adapter.js";

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
  const host = hostFromAlpha2Cordis(ctx, "0.1.2-alpha.2");
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

test("alpha.2 title fallback rejects stale projections and folds the durable rename", async () => {
  assert.equal(foldAlpha2Title([
    { type: "session/title", seq: 1, time: 1, data: { title: "Old" } },
    { type: "session/title", seq: 2, time: 2, data: { title: "Current" } },
  ]), "Current");
  const ctx = {
    on() {},
    agents: { get() { return undefined; } },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      async list() {
        return { items: [{ sessionId: "session-1", projections: { asOfSeq: 1, values: { title: "Old" } } }] };
      },
      async inspect() {
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
  const host = hostFromAlpha2Cordis(ctx, "0.1.2-alpha.2");
  assert.deepEqual(await host.listSessions?.(), [{ id: "session-1", title: "Current" }]);
});

test("alpha.2 adapter rejects a stale model projection and folds the current log", async () => {
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
            values: { modelSelection: { next: { provider: "deepseek", model: "stale" } } },
          },
        }] };
      },
      async create() { return { sessionId: "unused" }; },
      async inspect() {
        return { events: [
          { type: "model/selection", seq: 4, time: 1, data: { provider: "deepseek", model: "stale" } },
          { type: "model/selection", seq: 5, time: 2, data: { provider: "deepseek", model: "current" } },
        ] };
      },
      async modelCatalog() {
        return {
          default: { provider: "deepseek", model: "default" },
          routableProviders: ["deepseek"],
          groups: [{ id: "deepseek", name: "DeepSeek", models: [{ id: "current", name: "Current" }] }],
        };
      },
      async selectModel(request: { provider: string; model: string }) { return { selected: request }; },
      async rename(request: { title: string }) { return { title: request.title, seq: 1 }; },
    },
  };
  const host = hostFromAlpha2Cordis(ctx, "0.1.2-alpha.2");
  assert.deepEqual((await host.describeSessionModels?.("session-1"))?.current, {
    provider: "deepseek",
    model: "current",
  });
});

test("alpha.2 adapter has no apiProxy access path", () => {
  const ctx = new Proxy(
    { on() {}, agents: { get() { return undefined; } }, workspaceRegistry: { list: () => [] } },
    { get(target, property, receiver) {
      if (property === "apiProxy") throw new Error("apiProxy must not be read");
      return Reflect.get(target, property, receiver);
    } },
  );
  assert.doesNotThrow(() => hostFromAlpha2Cordis(ctx, "0.1.2-alpha.2"));
});
