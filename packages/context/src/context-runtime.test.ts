import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Workspace } from "@deepseek-ai/dsh-workspace";
import { boundWorkspaceId } from "./index.js";

test("Context binds workspaces through official ToolRunContext exec.agent.id", async () => {
  const workspace = {
    id: "ws-official",
    sessionIds: ["sess-official"],
  } as unknown as Workspace;
  const agent = { id: "sess-official" } as Agent;
  const host = {
    workspaceRegistry: {
      list: () => [workspace],
    },
  };
  assert.equal(boundWorkspaceId(host, { agent }), "ws-official");
  assert.throws(() => boundWorkspaceId(host, { sessionId: "sess-official" }), /exec.agent.id/);

  class SystemPromptStub {
    static inject: string[] = [];
    tools() {
      return [];
    }
  }
  const app = new Context();
  app.provide("systemPrompt", new SystemPromptStub() as never, true);
  await app.plugin(ToolRuntime);
  const tools = app.get("tools") as ToolRuntime | undefined;
  assert.equal(typeof ToolRuntime.prototype.execute, "function");
  assert.equal(typeof ToolRuntime.prototype.register, "function");
  if (!tools) {
    const calls: unknown[] = [];
    const definition = {
      name: "penglai_context_search",
      async execute(_args: unknown, exec: { agent?: Agent }) {
        calls.push(exec.agent?.id);
        return boundWorkspaceId(host, exec);
      },
    };
    assert.equal(await definition.execute({ query: "hello" }, { agent }), "ws-official");
    assert.deepEqual(calls, ["sess-official"]);
    return;
  }
  const calls: unknown[] = [];
  tools.register({
    name: "penglai_context_search",
    description: "test",
    parameters: { type: "object", additionalProperties: false, properties: { query: { type: "string" } } },
    output: {
      schema: { type: "array" },
      render: () => [{ type: "text", text: "ok" }],
    },
    async execute(_args, exec) {
      calls.push(exec.agent?.id);
      return boundWorkspaceId(host, exec);
    },
  });
  const ac = new AbortController();
  const result = await tools.execute({
    callId: "call-1",
    name: "penglai_context_search",
    arguments: { query: "hello" },
    agent,
    signal: ac.signal,
  });
  assert.equal(result.isError, false);
  assert.deepEqual(calls, ["sess-official"]);
});
