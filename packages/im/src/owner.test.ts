import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerApprovalBroker } from "@penglai/runtime";
import {
  IM_OWNER_ACTIONS,
  consumeImOwnerProof,
  imBindingObjectId,
  imSourceDigest,
  requireImActionId,
} from "./owner.js";

test("R56-OWN-004 IM bind/remove consume a one-time owner receipt", async () => {
  assert.throws(() => requireImActionId("nope"), /IM_OWNER_ACTION/);
  const root = mkdtempSync(join(tmpdir(), "penglai-im-owner-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const objectId = imBindingObjectId({ channel: "weixin", accountId: "a", peerId: "p" });
  const sourceDigest = imSourceDigest({
    action: IM_OWNER_ACTIONS.bind,
    objectId,
    workspaceId: "w",
    sessionId: "s1",
  });
  const proposal = owner.createProposal({
    action: IM_OWNER_ACTIONS.bind,
    pluginId: "@penglai/im",
    objectId,
    sourceDigest,
    workspaceId: "w",
    sessionId: "s1",
  });
  const decided = await owner.requestOwnerApproval(proposal.actionId);
  assert.equal(decided.decision, "approved");
  const finish = consumeImOwnerProof(owner, {
    action: IM_OWNER_ACTIONS.bind,
    actionId: proposal.actionId,
    receipt: decided.decision === "approved" ? decided.receipt : "",
    objectId,
    workspaceId: "w",
    sessionId: "s1",
    resultDigest: sourceDigest,
  });
  assert.equal(owner.inspect(proposal.actionId).state, "reserved");
  finish();
  assert.equal(owner.inspect(proposal.actionId).state, "committed");
  assert.throws(
    () =>
      consumeImOwnerProof(owner, {
        action: IM_OWNER_ACTIONS.bind,
        actionId: proposal.actionId,
        receipt: decided.decision === "approved" ? decided.receipt : "",
        objectId,
        workspaceId: "w",
        sessionId: "s1",
        resultDigest: sourceDigest,
      }),
    /OWNER_RECEIPT_REPLAY|OWNER_PROPOSAL_STATE/,
  );
});

test("IM credential save and logout consume one-time owner receipts", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-im-owner-cred-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  for (const action of [
    IM_OWNER_ACTIONS.saveCredentials,
    IM_OWNER_ACTIONS.logout,
  ] as const) {
    const objectId = "telegram";
    const sourceDigest = imSourceDigest({ action, objectId });
    const proposal = owner.createProposal({
      action,
      pluginId: "@penglai/im",
      objectId,
      sourceDigest,
    });
    const decided = await owner.requestOwnerApproval(proposal.actionId);
    assert.equal(decided.decision, "approved");
    const finish = consumeImOwnerProof(owner, {
      action,
      actionId: proposal.actionId,
      receipt: decided.decision === "approved" ? decided.receipt : "",
      objectId,
      resultDigest: sourceDigest,
    });
    finish();
    assert.equal(owner.inspect(proposal.actionId).state, "committed");
    assert.throws(
      () =>
        consumeImOwnerProof(owner, {
          action,
          actionId: proposal.actionId,
          receipt: decided.decision === "approved" ? decided.receipt : "",
          objectId,
          resultDigest: sourceDigest,
        }),
      /OWNER_RECEIPT_REPLAY|OWNER_PROPOSAL_STATE/,
    );
  }
});
