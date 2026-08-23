import assert from "node:assert/strict";
import test from "node:test";
import { registerMemoryTools } from "./tools.js";

function assertOfficialOutput(def: Record<string, unknown>) {
  const output = def.output as { schema?: unknown; render?: unknown; presentationMeta?: unknown } | undefined;
  if (
    output === undefined ||
    typeof output !== "object" ||
    typeof output.render !== "function" ||
    (output.presentationMeta !== undefined && typeof output.presentationMeta !== "function")
  ) {
    throw new TypeError(`tool "${String(def.name)}" must declare output { schema, render, presentationMeta? }`);
  }
  const schema = output.schema as { type?: unknown } | undefined;
  if (!schema || schema.type !== "object") {
    throw new TypeError(`tool "${String(def.name)}" output.schema must be an object root`);
  }
}

test("memory conversation tools declare DSH output and wrap search as an object", async () => {
  const registered = new Map<
    string,
    {
      output: { schema: { type: string }; render: (args: unknown, value: unknown) => unknown };
      execute: (args: unknown, exec?: unknown) => Promise<unknown>;
    }
  >();
  let preExecute: ((...args: unknown[]) => unknown) | undefined;
  const ctx = {
    tools: {
      register(def: Record<string, unknown>) {
        assertOfficialOutput(def);
        registered.set(String(def.name), def as never);
      },
    },
    workspaceRegistry: {
      list: () => [{ id: "ws1", sessionIds: ["sess-1"] }],
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      if (event === "tools/pre-execute") preExecute = listener;
    },
  };
  const engine = {
    async search(query: string, workspaceId?: string, includePersonal?: boolean) {
      if (workspaceId === "ws1") return [{ id: "m1", content: "workspace fact", scope: "workspace", workspaceId }];
      if (includePersonal) return [{ id: "p1", content: query, scope: "personal" }];
      return [];
    },
    async why(id: string) {
      return { id, source: "journal" };
    },
    async remember(input: { text: string }) {
      return { id: "n1", content: input.text };
    },
    async correct(id: string, text: string) {
      return { id: "n2", content: text, superseded: id };
    },
    async forget(id: string) {
      return { id, forgotten: true };
    },
  };
  registerMemoryTools(ctx, engine as never);
  assert.deepEqual(
    [...registered.keys()],
    [
      "penglai_memory_search",
      "penglai_memory_why",
      "penglai_memory_remember",
      "penglai_memory_correct",
      "penglai_memory_forget",
    ],
  );
  const exec = { agent: { id: "sess-1" } };
  const search = await registered.get("penglai_memory_search")!.execute({ query: "fact" }, exec);
  assert.equal(Array.isArray(search), false);
  assert.deepEqual((search as { results: Array<{ id: string }> }).results.map((row) => row.id), ["m1", "p1"]);
  const rendered = registered.get("penglai_memory_search")!.output.render({}, search);
  assert.equal(Array.isArray(rendered), true);
  await assert.rejects(
    () => registered.get("penglai_memory_search")!.execute({ query: "x", workspace_id: "evil" }, exec),
    /workspace_id/,
  );
  await assert.rejects(
    () => registered.get("penglai_memory_why")!.execute({ id: "missing-id" }, { agent: { id: "unbound" } }),
    /official Workspace/,
  );
  assert.ok(preExecute);
  for (const name of ["penglai_memory_remember", "penglai_memory_correct", "penglai_memory_forget"]) {
    const decision = await preExecute!({ name }, async () => ({ kind: "continue" }));
    assert.equal((decision as { kind: string }).kind, "ask");
  }
  const readDecision = await preExecute!({ name: "penglai_memory_search" }, async () => ({ kind: "continue" }));
  assert.equal((readDecision as { kind: string }).kind, "continue");
});
