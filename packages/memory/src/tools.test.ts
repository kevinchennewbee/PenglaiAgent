import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { Session } from "@deepseek-ai/dsh-session";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { PenglaiError } from "@penglai/contracts";
import { proveMemoryTurnFromOfficialExec, registerMemoryTools } from "./tools.js";

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

function officialSessionExec(input: {
  sessionId: string;
  callId: string;
  name: string;
  turn?: number;
  step?: number;
  nested?: { callId: string };
}) {
  const turn = input.turn ?? 1;
  const step = input.step ?? 1;
  const session = Session.create(input.sessionId);
  session.append("turn/start", { turn });
  session.append("step/start", { turn, step });
  session.append("tool/call", {
    turn,
    step,
    callId: input.callId as never,
    name: input.nested ? "run_code" : input.name,
    arguments: "{}",
  });
  if (input.nested) {
    session.append("tool/ptc-dispatch-start", {
      rootCallId: input.callId as never,
      parentCallId: input.callId as never,
      subCallId: input.nested.callId as never,
      name: input.name,
      arguments: { text: "nested" },
    });
  }
  return {
    session,
    exec: {
      callId: input.nested?.callId ?? input.callId,
      rootCallId: input.callId,
      name: input.name,
      arguments: {},
      agent: { id: input.sessionId, session },
      signal: new AbortController().signal,
    },
  };
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
  let directWrites = 0;
  const service = {
    async search(query: string, workspaceId?: string) {
      if (workspaceId === "ws1") return [{ id: "m1", content: "workspace fact", scope: "workspace", workspaceId }];
      if (workspaceId === undefined) return [{ id: "p1", content: query, scope: "personal" }];
      return [];
    },
    async why(id: string) {
      return { id, source: "journal" };
    },
    queueToolCandidate(input: { text: string; workspaceId: string; sessionId: string; turnId: string }) {
      directWrites += 0;
      return { candidateId: "candidate-1", status: "pending", ...input };
    },
  };
  registerMemoryTools(ctx, service);
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
  const { exec } = officialSessionExec({
    sessionId: "sess-1",
    callId: "call-remember",
    name: "penglai_memory_remember",
    turn: 7,
    step: 1,
  });
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
  const proposed = await registered
    .get("penglai_memory_remember")!
    .execute({ text: "remember this", scope: "workspace" }, exec);
  assert.equal((proposed as { pendingOwnerReview: boolean }).pendingOwnerReview, true);
  assert.equal(
    ((proposed as { candidate: { candidateId: string; turnId: string } }).candidate).candidateId,
    "candidate-1",
  );
  assert.equal(((proposed as { candidate: { turnId: string } }).candidate).turnId, "7");
  const correction = await registered
    .get("penglai_memory_correct")!
    .execute({ id: "memory-123", text: "replacement" }, exec);
  const forgetting = await registered
    .get("penglai_memory_forget")!
    .execute({ id: "memory-123" }, exec);
  assert.equal((correction as { pendingOwnerReview: boolean }).pendingOwnerReview, true);
  assert.equal((forgetting as { pendingOwnerReview: boolean }).pendingOwnerReview, true);
  assert.equal(directWrites, 0, "model tools must never directly mutate confirmed memory");
  await assert.rejects(
    () => registered.get("penglai_memory_remember")!.execute({ text: "x", scope: "workspace" }, { agent: { id: "sess-1" } }),
    /exec\.callId|snapshotEvents|provenance/,
  );
  await assert.rejects(
    () => registered.get("penglai_memory_remember")!.execute(
      { text: "x", scope: "workspace" },
      { agent: { id: "sess-1" }, turn: 7, step: 1 },
    ),
    /model-supplied turn\/step/,
  );
});

test("memory turn provenance matches official Session snapshotEvents including nested PTC calls", () => {
  const root = officialSessionExec({
    sessionId: "sess-1",
    callId: "root-call",
    name: "penglai_memory_remember",
    turn: 4,
    step: 2,
  });
  assert.deepEqual(proveMemoryTurnFromOfficialExec(root.exec), { turn: 4, step: 2 });

  const nested = officialSessionExec({
    sessionId: "sess-1",
    callId: "root-call",
    name: "penglai_memory_remember",
    turn: 4,
    step: 2,
    nested: { callId: "root-call:ptc:1" },
  });
  assert.deepEqual(proveMemoryTurnFromOfficialExec(nested.exec), { turn: 4, step: 2 });

  assert.throws(
    () => proveMemoryTurnFromOfficialExec({
      callId: "missing-call",
      agent: { id: "sess-1", session: root.session },
    }),
    (err: unknown) => err instanceof PenglaiError && /provenance/.test(err.message),
  );
  assert.throws(
    () => proveMemoryTurnFromOfficialExec({
      callId: "root-call:ptc:9",
      rootCallId: "root-call",
      agent: { id: "sess-1", session: root.session },
    }),
    /provenance/,
  );
  assert.throws(
    () => proveMemoryTurnFromOfficialExec({ agent: { id: "sess-1" }, turn: 0 }),
    /model-supplied turn\/step/,
  );
});

test("memory remember executes through pinned ToolRuntime with official Session provenance", async () => {
  const { exec } = officialSessionExec({
    sessionId: "sess-1",
    callId: "call-runtime",
    name: "penglai_memory_remember",
    turn: 3,
    step: 1,
  });
  let queuedTurn: string | undefined;
  class SystemPromptStub {
    static inject: string[] = [];
    tools() {
      return [];
    }
  }
  const app = new Context();
  app.provide("systemPrompt", new SystemPromptStub() as never, true);
  await app.plugin(ToolRuntime);
  const tools = ((app as unknown as { tools?: ToolRuntime }).tools
    ?? app.get("tools")
    ?? new ToolRuntime(app, { mode: "native" })) as ToolRuntime;
  assert.equal(typeof tools.register, "function");
  assert.equal(typeof tools.execute, "function");
  registerMemoryTools(
    {
      tools: {
        register(definition: Record<string, unknown>) {
          tools!.register(definition as never);
        },
      },
      workspaceRegistry: { list: () => [{ id: "ws1", sessionIds: ["sess-1"] }] },
    },
    {
      async search() { return []; },
      async why(id: string) { return { id }; },
      queueToolCandidate(input) {
        queuedTurn = input.turnId;
        return { candidateId: "candidate-runtime", status: "pending", ...input };
      },
    },
  );
  const result = await tools!.execute({
    callId: exec.callId as never,
    rootCallId: exec.rootCallId as never,
    name: "penglai_memory_remember",
    arguments: { text: "This project has acceptance code JADE-061-A.", scope: "workspace" },
    agent: exec.agent as never,
    signal: exec.signal,
  });
  assert.equal(result.isError, false);
  assert.equal(queuedTurn, "3");
});
