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
  consumeImOwnerProof(owner, {
    action: IM_OWNER_ACTIONS.bind,
    actionId: proposal.actionId,
    receipt: decided.decision === "approved" ? decided.receipt : "",
    objectId,
    workspaceId: "w",
    sessionId: "s1",
    resultDigest: sourceDigest,
  });
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
