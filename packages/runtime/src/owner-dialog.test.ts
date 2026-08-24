import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OwnerApprovalBroker } from "./owner-broker.js";
import { createHostOwnerDialog, drainOwnerDialogRequests } from "./owner-dialog.js";

test("host owner dialog is Main-backed and deny has no consume side effect", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-owner-dialog-"));
  const owner = new OwnerApprovalBroker(root, {
    dialog: createHostOwnerDialog(root, { timeoutMs: 2_000, pollMs: 10 }),
  });
  const proposal = owner.createProposal({
    action: "office.commit",
    pluginId: "@penglai/office",
    objectId: "job-1",
    sourceDigest: "a".repeat(64),
  });
  const pending = owner.requestOwnerApproval(proposal.actionId);
  const handled = await drainOwnerDialogRequests(root, async () => "denied");
  assert.equal(handled, 1);
  const decided = await pending;
  assert.equal(decided.decision, "denied");
  assert.equal(owner.inspect(proposal.actionId).state, "denied");
});

test("host owner dialog allow yields a one-shot receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-owner-dialog-ok-"));
  const owner = new OwnerApprovalBroker(root, {
    dialog: createHostOwnerDialog(root, { timeoutMs: 2_000, pollMs: 10 }),
  });
  const proposal = owner.createProposal({
    action: "memory.accept",
    pluginId: "@penglai/memory",
    objectId: "cand-1",
    sourceDigest: "b".repeat(64),
    workspaceId: "ws-a",
  });
  const pending = owner.requestOwnerApproval(proposal.actionId);
  assert.equal(await drainOwnerDialogRequests(root, async () => "approved"), 1);
  const decided = await pending;
  assert.equal(decided.decision, "approved");
  if (decided.decision !== "approved") throw new Error("expected receipt");
  const reserved = owner.consumeApproval({
    receipt: decided.receipt,
    intentDigest: owner.inspect(proposal.actionId).intentDigest,
    actionId: proposal.actionId,
  });
  owner.completeApproval({
    actionId: proposal.actionId,
    reservationId: reserved.reservationId,
    resultDigest: "c".repeat(64),
  });
  assert.equal(owner.inspect(proposal.actionId).state, "committed");
});
