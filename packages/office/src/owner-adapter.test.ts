import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OwnerApprovalBroker } from "../../runtime/src/owner-broker.js";
import {
  approveOfficeAction,
  consumeOfficeBrokerReceipt,
  isOwnerBrokerReceipt,
  officeOwnerAction,
  proposeOfficeAction,
} from "./owner-adapter.js";

function broker(root: string, decide: "approved" | "denied" = "approved") {
  return new OwnerApprovalBroker(root, {
    dialog: async () => decide,
  });
}

test("R56-OWN-001 office adapter maps actions and consumes broker receipts once", async () => {
  assert.equal(officeOwnerAction("commit-to-path"), "office.commit-path");
  assert.equal(officeOwnerAction("return-to-channel"), "office.return");
  const root = mkdtempSync(join(tmpdir(), "penglai-office-broker-"));
  const owner = broker(root);
  const proposed = proposeOfficeAction(owner, {
    action: "commit",
    jobId: "job-1",
    sourceDigest: "a".repeat(64),
    workspaceId: "ws-a",
    destinationLabel: "note.docx",
  });
  const receipt = await approveOfficeAction(owner, proposed.actionId);
  assert.equal(isOwnerBrokerReceipt(receipt), true);
  const reserved = consumeOfficeBrokerReceipt(owner, {
    receipt,
    actionId: proposed.actionId,
    action: "commit",
    jobId: "job-1",
    sourceDigest: "a".repeat(64),
    workspaceId: "ws-a",
  });
  owner.completeApproval({
    actionId: proposed.actionId,
    reservationId: reserved.reservationId,
    resultDigest: "b".repeat(64),
  });
  assert.throws(
    () =>
      consumeOfficeBrokerReceipt(owner, {
        receipt,
        actionId: proposed.actionId,
        action: "commit",
        jobId: "job-1",
        sourceDigest: "a".repeat(64),
        workspaceId: "ws-a",
      }),
    /REPLAY/,
  );
});

test("R56-OWN-005 office adapter deny has no consume side effect", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-office-deny-"));
  const owner = broker(root, "denied");
  const proposed = proposeOfficeAction(owner, {
    action: "export",
    jobId: "job-2",
    sourceDigest: "a".repeat(64),
  });
  await assert.rejects(() => approveOfficeAction(owner, proposed.actionId), /denied/);
  assert.equal(owner.inspect(proposed.actionId).state, "denied");
});
