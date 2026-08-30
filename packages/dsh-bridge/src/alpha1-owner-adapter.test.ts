import assert from "node:assert/strict";
import test from "node:test";
import { foldAlpha1ModelSelection, hostFromAlpha1Cordis } from "./alpha1-owner-adapter.js";

test("alpha.1 adapter uses the official sessionController for list, create, rename, and model operations", async () => {
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
          } },
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
      async inspect() { throw new Error("projected selection must avoid a cold inspection"); },
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
  const host = hostFromAlpha1Cordis(ctx, "0.1.2-alpha.1");
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

test("alpha.1 model-selection fallback folds official durable events exactly", () => {
  assert.deepEqual(foldAlpha1ModelSelection([
    { type: "model/selection", data: { provider: "p", model: "pending" } },
    { type: "request/header", data: { header: { config: { provider: "p", model: "used" } } } },
  ]), { provider: "p", model: "pending" });
  assert.deepEqual(foldAlpha1ModelSelection([
    { type: "model/selection", data: { provider: "p", model: "same" } },
    { type: "request/header", data: { header: { config: { provider: "p", model: "same" } } } },
  ]), { provider: "p", model: "same" });
});

test("alpha.1 adapter has no apiProxy access path", () => {
  const ctx = new Proxy(
    { on() {}, agents: { get() { return undefined; } }, workspaceRegistry: { list: () => [] } },
    { get(target, property, receiver) {
      if (property === "apiProxy") throw new Error("apiProxy must not be read");
      return Reflect.get(target, property, receiver);
    } },
  );
  assert.doesNotThrow(() => hostFromAlpha1Cordis(ctx, "0.1.2-alpha.1"));
});
