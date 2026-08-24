import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryV2Store } from "./v2/candidates.js";
import {
  ingestOfficialTurn,
  runHostCurator,
  sessionEventParts,
  withMemoryRecall,
  workspaceIdForSession,
} from "./turn-pipeline.js";

test("official turn/end ingest is host-only and fail-open on bad curator JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-turn-"));
  const store = new MemoryV2Store(join(root, "v2.sqlite3"));
  store.setMode("auto-workspace");
  const bad = ingestOfficialTurn({
    store,
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "1",
    raw: "not-json",
    summary: "user:\nprefer zh\nassistant:\nok",
  });
  assert.equal(bad.failOpen, true);
  assert.equal(store.listCandidates("ws-a").length, 0);
  const ok = ingestOfficialTurn({
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
  });
  assert.equal(ok.failOpen, false);
  assert.equal(ok.enqueued + ok.autoAccepted >= 1, true);
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

test("memory apply source subscribes to official turn/end and pre-step and does not expose ingestCurator", async () => {
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const remote = readFileSync(new URL("./remote.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(index, /session\/event/);
  assert.match(index, /turn\/end/);
  assert.match(index, /agent\/pre-step/);
  assert.match(index, /ingestOfficialTurn/);
  assert.match(index, /withMemoryRecall/);
  assert.match(remote, /memory curator is host-only/);
  assert.doesNotMatch(remote, /ingestCurator,/);
  assert.doesNotMatch(client, /"ingestCurator"/);
  assert.match(client, /proposeAction/);
  assert.match(client, /requestOwnerApproval/);
});
