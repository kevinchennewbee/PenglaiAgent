import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createDurableMemoryService } from "./index.js";
import { createMemorySettingsApi } from "./remote.js";

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
  assert.throws(
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
  svc.acceptCandidate({
    candidateId: enqueued.candidateId,
    actionId: proposed.actionId,
    receipt: decided.receipt,
  });
  const api = createMemorySettingsApi(svc as never, { list: () => [{ id: "ws-a", title: "A" }] });
  await assert.rejects(
    () => api.forget({ id: "missing", workspaceId: "ws-a", ownerConfirmed: true }),
    /broker receipt/,
  );
  svc.close();
});
