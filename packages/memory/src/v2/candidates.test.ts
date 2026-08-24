import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_MEMORY_MODE } from "./governance.js";
import { MemoryV2Store, RECALL_MAX_ITEMS, RECALL_MAX_TOKENS } from "./candidates.js";
import { ingestCuratorOutput } from "./curator.js";

function store(now = { t: 1_700_000_000_000 }) {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-v2-"));
  return new MemoryV2Store(join(root, "v2.sqlite3"), { now: () => now.t });
}

const digest = "a".repeat(64);

test("R56-MEM-002 default mode is suggest and off skips extraction", () => {
  const v2 = store();
  assert.equal(v2.mode(), DEFAULT_MEMORY_MODE);
  v2.setMode("off");
  const skipped = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t1",
    kind: "preference",
    text: "喜欢简体中文",
    rationale: "user said so",
    confidence: 0.9,
    sourceDigest: digest,
  });
  assert.deepEqual(skipped, { skipped: true, reason: "MEMORY_MODE_OFF" });
  v2.close();
});

test("R56-MEM-004/007/009 candidates are idempotent, isolated, and never recalled", () => {
  const v2 = store();
  const first = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t1",
    kind: "project_fact",
    text: "0.5.6 keeps official DSH as the only core",
    rationale: "turn fact",
    confidence: 0.9,
    sourceDigest: digest,
  });
  assert.equal("candidateId" in first, true);
  const again = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t1",
    kind: "project_fact",
    text: "0.5.6 keeps official DSH as the only core",
    rationale: "turn fact",
    confidence: 0.9,
    sourceDigest: digest,
  });
  assert.deepEqual(again, { skipped: true, reason: "MEMORY_CANDIDATE_DUP_TURN" });
  assert.equal(v2.listCandidates("ws-b").length, 0);
  assert.equal(v2.listCandidates("ws-a").length, 1);
  const secret = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t2",
    kind: "constraint",
    text: "password=hunter2",
    rationale: "leak",
    confidence: 0.9,
    sourceDigest: "b".repeat(64),
  });
  assert.deepEqual(secret, { skipped: true, reason: "MEMORY_CANDIDATE_PROHIBITED" });
  const recall = v2.recallSet({
    workspaceId: "ws-a",
    confirmed: [{ id: "m1", scope: "workspace", text: "official DSH only", sourceDigest: digest }],
  });
  assert.equal(recall.used, 1);
  assert.equal(v2.listCandidates("ws-a").every((row) => row.status === "pending"), true);
  v2.close();
});

test("R56-MEM-003 personal accept needs an owner action and is not inferred", () => {
  const v2 = store();
  const row = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t3",
    kind: "preference",
    text: "永远在所有工作区用英文",
    rationale: "claim",
    confidence: 0.95,
    sourceDigest: digest,
  });
  assert.equal("candidateId" in row, true);
  if (!("candidateId" in row)) throw new Error("expected candidate");
  assert.throws(
    () => v2.decide(row.candidateId, "accepted", { personal: true }),
    /PERSONAL_RECEIPT/,
  );
  assert.throws(
    () =>
      v2.decide(row.candidateId, "accepted", {
        personal: true,
        actionId: "11111111-1111-4111-8111-111111111111",
      }),
    /NOT_INFERRED/,
  );
  v2.close();
});

test("R56-MEM-004 curator can enqueue several drafts from one official turn", () => {
  const v2 = store();
  const result = ingestCuratorOutput(
    v2,
    JSON.stringify({
      candidates: [
        {
          kind: "project_fact",
          text: "Office writes still need Owner confirmation",
          rationale: "turn fact",
          sensitivity: "normal",
          confidence: 0.91,
          suggestedScope: "workspace",
        },
        {
          kind: "preference",
          text: "Prefer concise commit titles",
          rationale: "style",
          sensitivity: "normal",
          confidence: 0.8,
          suggestedScope: "workspace",
        },
      ],
    }),
    { workspaceId: "ws-a", sessionId: "s1", turnId: "t8", sourceDigest: digest },
  );
  assert.equal(result.failOpen, false);
  assert.equal(result.enqueued, 2);
  const replay = ingestCuratorOutput(
    v2,
    JSON.stringify({
      candidates: [
        {
          kind: "project_fact",
          text: "Office writes still need Owner confirmation",
          rationale: "turn fact",
          sensitivity: "normal",
          confidence: 0.91,
          suggestedScope: "workspace",
        },
      ],
    }),
    { workspaceId: "ws-a", sessionId: "s1", turnId: "t8", sourceDigest: digest },
  );
  assert.equal(replay.enqueued, 0);
  v2.close();
});

test("R56-MEM-006/020 curator parse failures fail open and do not enqueue", () => {
  const v2 = store();
  const ctx = {
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t9",
    sourceDigest: digest,
  };
  const bad = ingestCuratorOutput(v2, "not-json", ctx);
  assert.equal(bad.failOpen, true);
  assert.equal(bad.enqueued, 0);
  const schema = ingestCuratorOutput(v2, JSON.stringify({ surprise: true }), ctx);
  assert.equal(schema.failOpen, true);
  assert.equal(v2.listCandidates("ws-a").length, 0);
  v2.close();
});

test("R56-MEM-014/015/018 conflicts, negatives, and tombstones stay out of recall", () => {
  const v2 = store();
  const first = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t4",
    kind: "decision",
    text: "keep Weixin adapter",
    rationale: "existing",
    confidence: 0.9,
    sourceDigest: digest,
  });
  const second = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t5",
    kind: "decision",
    text: "replace Weixin adapter",
    rationale: "conflict",
    confidence: 0.9,
    sourceDigest: "c".repeat(64),
  });
  assert.equal("candidateId" in first && "candidateId" in second, true);
  assert.equal(v2.listConflicts("ws-a").length >= 2, true);
  if (!("candidateId" in first)) throw new Error("expected candidate");
  v2.decide(first.candidateId, "rejected");
  const again = v2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s2",
    turnId: "t6",
    kind: "decision",
    text: "keep Weixin adapter",
    rationale: "repeat",
    confidence: 0.9,
    sourceDigest: digest,
  });
  assert.deepEqual(again, { skipped: true, reason: "MEMORY_NEGATIVE" });
  v2.recordTombstone("m-forgotten", digest);
  const recall = v2.recallSet({
    workspaceId: "ws-a",
    confirmed: [{ id: "m-forgotten", scope: "workspace", text: "gone", sourceDigest: digest }],
  });
  assert.equal(recall.used, 0);
  v2.close();
});

test("R56-MEM-012 recall set stays within 20 items and 2048 tokens", () => {
  const v2 = store();
  const confirmed = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    scope: "workspace" as const,
    text: "x".repeat(200),
    sourceDigest: digest,
  }));
  const recall = v2.recallSet({ workspaceId: "ws-a", confirmed });
  assert.equal(recall.items.length <= RECALL_MAX_ITEMS, true);
  assert.equal(recall.tokens <= RECALL_MAX_TOKENS, true);
  assert.equal(v2.lastRecallUsed("ws-a"), recall.used);
  v2.close();
});
