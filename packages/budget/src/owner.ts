import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import type { BudgetScope } from "./ledger.js";

export const BUDGET_OWNER_ACTION = "budget.set-policy" as const;

export interface BudgetOwnerBrokerPort {
  createProposal(input: {
    action: string;
    pluginId: string;
    objectId: string;
    sourceDigest: string;
  }): { actionId: string };
  inspect(actionId: string): {
    action: string;
    objectId: string;
    sourceDigest: string;
    pluginId: string;
    intentDigest: string;
  };
  consumeApproval(input: { receipt: unknown; intentDigest: string; actionId: string }): { reservationId: string };
  completeApproval(input: { actionId: string; reservationId: string; resultDigest: string }): void;
}

export function budgetPolicyObjectId(input: { scope: BudgetScope; key: string }): string {
  return `${input.scope}:${input.key}`;
}

export function budgetSourceDigest(input: {
  scope: BudgetScope;
  key: string;
  hardTokens: number | null;
  warnRatio?: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: BUDGET_OWNER_ACTION,
        scope: input.scope,
        key: input.key,
        hardTokens: input.hardTokens,
        warnRatio: input.warnRatio ?? 0.8,
      }),
    )
    .digest("hex");
}

export function consumeBudgetOwnerProof(
  owner: BudgetOwnerBrokerPort | undefined,
  input: {
    actionId: string;
    receipt: string;
    scope: BudgetScope;
    key: string;
    hardTokens: number | null;
    warnRatio?: number;
  },
): () => void {
  if (!owner) throw new PenglaiError("DSH_UNAVAILABLE", "owner broker required");
  if (!input.receipt.includes(".")) throw new PenglaiError("SECURITY_POLICY", "budget broker receipt required");
  const objectId = budgetPolicyObjectId({ scope: input.scope, key: input.key });
  const sourceDigest = `sha256:${budgetSourceDigest(input)}`;
  const inspected = owner.inspect(input.actionId);
  if (
    inspected.pluginId !== "@penglai/budget" ||
    inspected.action !== BUDGET_OWNER_ACTION ||
    inspected.objectId !== objectId ||
    inspected.sourceDigest !== sourceDigest
  ) {
    throw new PenglaiError("SECURITY_POLICY", "budget broker intent mismatch");
  }
  const reserved = owner.consumeApproval({
    receipt: input.receipt,
    intentDigest: inspected.intentDigest,
    actionId: input.actionId,
  });
  return () =>
    owner.completeApproval({
      actionId: input.actionId,
      reservationId: reserved.reservationId,
      resultDigest: sourceDigest,
    });
}
