import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OwnerApprovalBroker } from "@penglai/runtime/owner-broker";
import { BudgetLedger } from "./ledger.js";
import { createBudgetSettingsApi } from "./remote.js";
import { BUDGET_OWNER_ACTION, budgetSourceDigest } from "./owner.js";

test("budget setPolicy rejects forged UUID/receipt and requires a consumed broker receipt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-owner-"));
  const ledger = new BudgetLedger(join(dir, "budget.sqlite3"));
  const owner = new OwnerApprovalBroker(dir, { dialog: async () => "approved" });
  const service = {
    status: () => ledger.status(Date.now()),
    setPolicy: (input: Parameters<BudgetLedger["setPolicy"]>[0]) => ledger.setPolicy(input),
    owner,
    proposePolicy(input: { scope: "global"; key: string; hardTokens: number | null; warnRatio?: number }) {
      const objectId = `${input.scope}:${input.key}`;
      const sourceDigest = budgetSourceDigest(input);
      return owner.createProposal({
        action: BUDGET_OWNER_ACTION,
        pluginId: "@penglai/budget",
        objectId,
        sourceDigest,
      });
    },
  };
  const api = createBudgetSettingsApi(service, {
    agents: { list: () => [{ options: { provider: "deepseek", model: "chat" } }] },
    workspaceRegistry: { list: () => [{ id: "w1", title: "Workspace" }] },
  });
  try {
    await assert.rejects(
      async () => api.setPolicy({ scope: "global", key: "*", hardTokens: 100, ownerConfirmed: true }),
      /Owner confirmation/,
    );
    await assert.rejects(
      async () =>
        api.setPolicy({
          scope: "global",
          key: "*",
          hardTokens: 100,
          ownerConfirmed: true,
          actionId: "11111111-1111-4111-8111-111111111111",
          receipt: "forged.receipt",
        }),
      /OWNER_|budget broker/,
    );
    const proposed = api.proposePolicy({ scope: "global", key: "*", hardTokens: 250 });
    const decided = await owner.requestOwnerApproval(proposed.actionId);
    assert.equal(decided.decision, "approved");
    if (decided.decision !== "approved") throw new Error("expected receipt");
    const saved = api.setPolicy({
      scope: "global",
      key: "*",
      hardTokens: 250,
      ownerConfirmed: false,
      actionId: proposed.actionId,
      receipt: decided.receipt,
    });
    assert.equal(saved.hardTokens, 250);
    await assert.rejects(
      async () =>
        api.setPolicy({
          scope: "global",
          key: "*",
          hardTokens: 250,
          ownerConfirmed: true,
          actionId: proposed.actionId,
          receipt: decided.receipt,
        }),
      /OWNER_RECEIPT_REPLAY|OWNER_PROPOSAL_STATE|budget broker/,
    );
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
