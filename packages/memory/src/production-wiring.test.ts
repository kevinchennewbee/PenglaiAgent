import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createDurableMemoryService } from "./index.js";
import { createMemorySettingsApi } from "./remote.js";

test("memory production apply imports the plugin-safe owner broker", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /from "@penglai\/runtime\/owner-broker"/);
  assert.doesNotMatch(src, /from "@penglai\/runtime["']/);
});

test("memory accept/forget cannot be satisfied by a UUID or ownerConfirmed boolean", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-prod-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const svc = createDurableMemoryService({
    userData: root,
    skills: { snapshot: async () => ({ skills: [], complete: true }) },
    owner,
  });
  svc.setMemoryMode("suggest");
  const enqueued = svc.memoryV2.enqueue({
    workspaceId: "ws-a",
    sessionId: "s1",
    turnId: "t1",
    kind: "preference",
    text: "Prefer concise commit titles",
    rationale: "style",
    confidence: 0.9,
    sourceDigest: "a".repeat(64),
  });
  assert.equal("candidateId" in enqueued, true);
  if (!("candidateId" in enqueued)) throw new Error("expected candidate");
  await assert.rejects(
    () =>
      svc.acceptCandidate({
        candidateId: enqueued.candidateId,
        actionId: "11111111-1111-4111-8111-111111111111",
        receipt: "",
      }),
    /broker receipt/,
  );
  const proposed = svc.proposeAction({
    action: "memory.accept",
    objectId: enqueued.candidateId,
    workspaceId: "ws-a",
  });
  const decided = await owner.requestOwnerApproval(proposed.actionId);
  assert.equal(decided.decision, "approved");
  if (decided.decision !== "approved") throw new Error("expected receipt");
  await assert.rejects(
    () => svc.acceptCandidate({
      candidateId: enqueued.candidateId,
      actionId: proposed.actionId,
      receipt: decided.receipt,
    }),
    /mnemon binary missing/,
  );
  assert.equal(svc.memoryV2.getCandidate(enqueued.candidateId)?.status, "pending");
  assert.equal(owner.inspect(proposed.actionId).state, "reserved", "failed persistence must not be recorded committed");
  const api = createMemorySettingsApi(svc as never, { list: () => [{ id: "ws-a", title: "A" }] });
  await assert.rejects(
    () => api.forget({ id: "missing", workspaceId: "ws-a", ownerConfirmed: true }),
    /broker receipt/,
  );
  await assert.rejects(
    () => api.correct({ id: "missing", text: "revised", workspaceId: "ws-a" }),
    /broker receipt/,
  );
  svc.close();
});

test("rejected personal candidate is checked before engine materialization or receipt reservation", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-policy-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const svc = createDurableMemoryService({
    userData: root, skills: { snapshot: async () => ({ skills: [], complete: true }) }, owner,
  });
  svc.setMemoryMode("suggest");
  const candidate = svc.memoryV2.enqueue({
    workspaceId: "ws-a", sessionId: "s1", turnId: "t1", kind: "preference",
    text: "Always remember to use English in every workspace", rationale: "claim",
    confidence: 0.9, sourceDigest: "b".repeat(64),
  });
  if (!("candidateId" in candidate)) throw new Error("expected candidate");
  const proposed = svc.proposeAction({ action: "memory.personal", objectId: candidate.candidateId, workspaceId: "ws-a" });
  const decision = await owner.requestOwnerApproval(proposed.actionId);
  if (decision.decision !== "approved") throw new Error("expected receipt");
  let writes = 0;
  svc.engine.remember = async () => { writes++; throw new Error("unexpected engine write"); };
  await assert.rejects(svc.acceptCandidate({
    candidateId: candidate.candidateId, actionId: proposed.actionId, receipt: decision.receipt, personal: true,
  }), /MEMORY_PERSONAL_NOT_INFERRED/);
  assert.equal(writes, 0);
  assert.equal(svc.memoryV2.getCandidate(candidate.candidateId)?.status, "pending");
  assert.notEqual(owner.inspect(proposed.actionId).state, "reserved");
  svc.close();
});
