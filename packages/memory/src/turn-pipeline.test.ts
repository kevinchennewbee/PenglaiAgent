import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CallId } from "@deepseek-ai/dsh-llm";
import { MemoryV2Store } from "./v2/candidates.js";
import {
  curatorUsageTokens,
  ingestOfficialTurn,
  MemoryCuratorFailure,
  resolveSessionTurn,
  runHostCurator,
  runOfficialLlmCurator,
  sessionEventParts,
  withMemoryRecall,
  workspaceIdForSession,
} from "./turn-pipeline.js";

test("official turn/end ingest persists before accepted state and fails open on bad curator JSON", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-turn-"));
  const store = new MemoryV2Store(join(root, "v2.sqlite3"));
  store.setMode("auto-workspace");
  const bad = await ingestOfficialTurn({
    store,
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "1",
    raw: "not-json",
    summary: "user:\nprefer zh\nassistant:\nok",
  });
  assert.equal(bad.failOpen, true);
  assert.equal(store.listCandidates("ws-a").length, 0);
  const persisted: string[] = [];
  const ok = await ingestOfficialTurn({
    store,
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "2",
    raw: JSON.stringify({
      candidates: [
        {
          kind: "preference",
          text: "Use Simplified Chinese in this project",
          rationale: "user said so",
          sensitivity: "normal",
          confidence: 0.92,
          suggestedScope: "workspace",
        },
      ],
    }),
    summary: "user:\nI like Simplified Chinese here\nassistant:\nok",
    persist: async (candidate) => {
      persisted.push(candidate.text);
    },
  });
  assert.equal(ok.failOpen, false);
  assert.equal(ok.autoAccepted, 1);
  assert.deepEqual(persisted, ["Use Simplified Chinese in this project"]);
  assert.equal(store.listCandidates("ws-a").length, 0);
  store.close();
});

test("recall injects a host memory block into official pre-step messages", async () => {
  const messages = withMemoryRecall(
    [{ content: [{ type: "text", text: "hello" }] }],
    {
      used: 1,
      items: [{ id: "m1", scope: "workspace", text: "prefer zh", sourceDigest: "a".repeat(64) }],
    },
  );
  const first = messages[0]?.content?.[0] as { type?: string; text?: string };
  assert.equal(first.type, "text");
  assert.match(String(first.text), /PENGLAI TRUSTED MEMORY CONTEXT/);
  assert.match(String(first.text), /prefer zh/);
  assert.equal(workspaceIdForSession([{ id: "ws-a", sessionIds: ["s1"] }], "s1"), "ws-a");
  assert.equal(sessionEventParts([{ id: "s1" }, { type: "turn/end", data: { turn: 3 } }]).turn, 3);
  const empty = await runHostCurator({ summary: "user:\nhi" });
  assert.equal(JSON.parse(empty).candidates.length, 0);
  const generated = await runHostCurator({
    summary: "user:\nprefer zh",
    generate: async () =>
      JSON.stringify({
        candidates: [
          {
            kind: "preference",
            text: "prefer zh",
            rationale: "user",
            sensitivity: "normal",
            confidence: 0.9,
            suggestedScope: "workspace",
          },
        ],
      }),
  });
  assert.equal(JSON.parse(generated).candidates[0].text, "prefer zh");
  const failed = await runHostCurator({
    summary: "x",
    generate: async () => {
      throw new Error("rate limit");
    },
  });
  assert.equal(failed, "not-json");
});

test("official DSH user/message inherits its turn and data.content is curated", () => {
  const activeTurns = new Map<string, number>();
  const start = sessionEventParts([{ id: "s1" }, { type: "turn/start", data: { turn: 7 } }]);
  assert.equal(resolveSessionTurn(start, activeTurns), 7);

  const user = sessionEventParts([
    { id: "s1" },
    {
      type: "user/message",
      data: {
        role: "user",
        content: [{ type: "text", text: "The project codename is Lotus." }],
      },
    },
  ]);
  assert.equal(user.turn, undefined);
  assert.equal(user.text, "The project codename is Lotus.");
  assert.equal(resolveSessionTurn(user, activeTurns), 7);

  const end = sessionEventParts([{ id: "s1" }, { type: "turn/end", data: { turn: 7 } }]);
  assert.equal(resolveSessionTurn(end, activeTurns), 7);
  assert.equal(activeTurns.has("s1"), false);
});

test("memory curator uses one official LLM request without Session or tools", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const usage: number[] = [];
  const raw = await runOfficialLlmCurator({
    llm: {
      stream(options) {
        calls.push(options as unknown as Record<string, unknown>);
        return (async function* () {
          yield { type: "text-delta" as const, index: 0, text: '{"candidates":[]}' };
          yield { type: "usage" as const, usage: { inputTokens: 12, outputTokens: 3 } };
          yield { type: "finish" as const, reason: { kind: "stop" as const } };
        })();
      },
    },
    provider: "deepseek-official",
    model: "deepseek-chat",
    summary: "user:\nhello\nassistant:\nhi",
    signal: new AbortController().signal,
    onUsage: (tokens) => usage.push(tokens),
  });
  assert.deepEqual(JSON.parse(raw), { candidates: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.sessionId, undefined);
  assert.deepEqual(calls[0]?.tools, []);
  assert.deepEqual(usage, [15]);
  const message = (calls[0]?.messages as Array<{ source?: unknown }>)[0];
  assert.deepEqual(message?.source, { kind: "plugin", plugin: "@penglai/memory" });
});

test("memory curator rejects late tool blocks and an already-aborted request", async () => {
  await assert.rejects(
    () => runOfficialLlmCurator({
      llm: {
        stream() {
          return (async function* () {
            yield {
              type: "block-end" as const,
              index: 0,
              block: { type: "tool-call" as const, id: CallId("call-1"), name: "bash", arguments: "{}" },
            };
            yield { type: "finish" as const, reason: { kind: "stop" as const } };
          })();
        },
      },
      provider: "deepseek-official",
      model: "deepseek-chat",
      summary: "user:\nhello\nassistant:\nhi",
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof MemoryCuratorFailure && error.code === "PROTOCOL" && !error.retryable,
  );

  const controller = new AbortController();
  controller.abort();
  let entered = false;
  await assert.rejects(
    () => runOfficialLlmCurator({
      llm: {
        stream() {
          entered = true;
          return (async function* () {
            yield { type: "finish" as const, reason: { kind: "stop" as const } };
          })();
        },
      },
      provider: "deepseek-official",
      model: "deepseek-chat",
      summary: "user:\nhello\nassistant:\nhi",
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof MemoryCuratorFailure && error.code === "CANCELLED" && !error.retryable,
  );
  assert.equal(entered, false);
});

test("memory curator exposes only closed transient failures and counts both DSH usage shapes", async () => {
  assert.equal(curatorUsageTokens({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 3 }), 17);
  assert.equal(curatorUsageTokens({ inputTokens: 999, outputTokens: 999, totalTokens: 21 }), 21);
  await assert.rejects(
    () => runOfficialLlmCurator({
      llm: {
        stream() {
          return (async function* () {
            yield {
              type: "finish" as const,
              reason: {
                kind: "error" as const,
                failure: { code: "RATE_LIMIT", message: "private provider detail" },
              },
            };
          })();
        },
      },
      provider: "deepseek-official",
      model: "deepseek-chat",
      summary: "private turn text",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof MemoryCuratorFailure &&
      error.code === "RATE_LIMIT" &&
      error.retryable &&
      !error.message.includes("private provider detail") &&
      !error.message.includes("private turn text"),
  );
});

test("memory apply subscribes to turn/end without creating curator Agents or Sessions", async () => {
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const pipeline = readFileSync(new URL("./turn-pipeline.ts", import.meta.url), "utf8");
  const remote = readFileSync(new URL("./remote.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(index, /session\/event/);
  assert.match(index, /turn\/end/);
  assert.match(index, /agent\/pre-step/);
  assert.match(index, /ingestOfficialTurn/);
  assert.match(index, /InternalCuratorQueue/);
  assert.match(index, /withMemoryRecall/);
  assert.match(pipeline, /input\.llm\.stream/);
  assert.doesNotMatch(index, /agents\.create|origin:\s*["']subagent|penglai-memory-curator-/);
  assert.match(remote, /memory curator is host-only/);
  assert.doesNotMatch(remote, /ingestCurator,/);
  assert.doesNotMatch(client, /"ingestCurator"/);
  assert.match(client, /proposeAction/);
  assert.match(client, /requestOwnerApproval/);
});
