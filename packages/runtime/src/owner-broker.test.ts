import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  OWNER_RECEIPT_TTL_MS,
  OwnerApprovalBroker,
  requestOwnerApprovalArgs,
} from "./owner-broker.js";

function broker(root: string, decide: "approved" | "denied" = "approved", now = { t: 1_700_000_000_000 }) {
  const logs: Array<Record<string, unknown>> = [];
  const owner = new OwnerApprovalBroker(root, {
    now: () => now.t,
    dialog: async (req) => {
      assert.match(req.noticeEn, /not a sandbox/i);
      assert.match(req.noticeZh, /不是.*沙箱/);
      return decide;
    },
    onLog: (log) => logs.push({ ...log }),
  });
  return { owner, logs, now };
}

test("R56-OWN-005 deny expiry replay mutation and workspace drift have no side effects", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-broker-"));
  const denied = broker(root, "denied");
  const proposal = denied.owner.createProposal({
    action: "office.commit",
    pluginId: "@penglai/office",
    objectId: "office-1",
    sourceDigest: "a".repeat(64),
    resultDigest: "b".repeat(64),
    workspaceId: "ws-a",
    destinationLabel: "note.docx",
  });
  const deny = await denied.owner.requestOwnerApproval(proposal.actionId);
  assert.equal(deny.decision, "denied");
  assert.equal(denied.owner.inspect(proposal.actionId).state, "denied");
  assert.equal("receipt" in deny, false);

  const clock = { t: 1_700_000_000_000 };
  const live = broker(root, "approved", clock);
  const fresh = live.owner.createProposal({
    action: "office.commit",
    pluginId: "@penglai/office",
    objectId: "office-2",
    sourceDigest: "a".repeat(64),
    workspaceId: "ws-a",
  });
  const approved = await live.owner.requestOwnerApproval(fresh.actionId);
  assert.equal(approved.decision, "approved");
  if (approved.decision !== "approved") throw new Error("expected receipt");
  clock.t += OWNER_RECEIPT_TTL_MS + 1;
  assert.throws(
    () => live.owner.consumeApproval({ receipt: approved.receipt, intentDigest: live.owner.inspect(fresh.actionId).intentDigest, actionId: fresh.actionId }),
    /EXPIRED/,
  );
  assert.equal(live.owner.inspect(fresh.actionId).state, "approved");

  clock.t = 1_700_000_000_000;
  const replayed = live.owner.createProposal({
    action: "office.export",
    pluginId: "@penglai/office",
    objectId: "office-3",
    sourceDigest: "a".repeat(64),
  });
  const once = await live.owner.requestOwnerApproval(replayed.actionId);
  if (once.decision !== "approved") throw new Error("expected receipt");
  const digest = live.owner.inspect(replayed.actionId).intentDigest;
  const reserved = live.owner.consumeApproval({ receipt: once.receipt, intentDigest: digest, actionId: replayed.actionId });
  assert.throws(
    () => live.owner.consumeApproval({ receipt: once.receipt, intentDigest: digest, actionId: replayed.actionId }),
    /REPLAY/,
  );
  live.owner.completeApproval({ actionId: replayed.actionId, reservationId: reserved.reservationId, resultDigest: "c".repeat(64) });
  assert.equal(live.owner.inspect(replayed.actionId).state, "committed");

  const mutated = live.owner.createProposal({
    action: "im.bind",
    pluginId: "@penglai/im",
    objectId: "bind-1",
    sourceDigest: "a".repeat(64),
    workspaceId: "ws-a",
  });
  const mutReceipt = await live.owner.requestOwnerApproval(mutated.actionId);
  if (mutReceipt.decision !== "approved") throw new Error("expected receipt");
  const path = join(root, "owner-broker", "proposals", `${mutated.actionId}.json`);
  const stored = JSON.parse(readFileSync(path, "utf8")) as { intent: { workspaceId?: string }; intentDigest: string; state: string };
  stored.intent.workspaceId = "ws-b";
  writeFileSync(path, `${JSON.stringify(stored)}\n`);
  assert.throws(
    () =>
      live.owner.consumeApproval({
        receipt: mutReceipt.receipt,
        intentDigest: stored.intentDigest,
        actionId: mutated.actionId,
      }),
    /TAMPER|MISMATCH/,
  );

  assert.equal(JSON.stringify(live.logs).includes(once.receipt), false);
  assert.equal(JSON.stringify(live.logs).includes("hmac"), false);
  assert.doesNotMatch(JSON.stringify(live.logs), /sk-|token|secret/i);
});

test("R56-OWN-007 renderer may pass only actionId and Main rejects substitute fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-broker-ipc-"));
  const { owner } = broker(root);
  const proposal = owner.createProposal({
    action: "plugin.disable",
    pluginId: "@penglai/plugin-pilot",
    objectId: "pilot",
    sourceDigest: "a".repeat(64),
  });
  assert.equal(requestOwnerApprovalArgs({ actionId: proposal.actionId }), proposal.actionId);
  assert.throws(() => requestOwnerApprovalArgs({ actionId: proposal.actionId, destPath: "/tmp/x" }), /RENDERER_CONTRACT/);
  assert.throws(() => requestOwnerApprovalArgs(proposal.actionId), /RENDERER_CONTRACT/);
  assert.throws(() => {
    void owner.requestOwnerApproval(proposal.actionId, "extra" as never);
  }, /RENDERER_CONTRACT/);
});

test("R56-OWN-008 destination labels cannot carry paths or secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-broker-label-"));
  const { owner } = broker(root);
  assert.throws(
    () =>
      owner.createProposal({
        action: "office.commit",
        pluginId: "@penglai/office",
        objectId: "job",
        sourceDigest: "a".repeat(64),
        destinationLabel: "/Users/test-owner/secret.docx",
      }),
    (error: unknown) => error instanceof PenglaiError && error.message === "OWNER_DESTINATION_LABEL",
  );
});
