import { PenglaiError } from "@penglai/contracts";
import type { OfficeReceiptAction } from "./receipt.js";

export const OFFICE_TO_OWNER_ACTION = {
  commit: "office.commit",
  "commit-to-path": "office.commit-path",
  undo: "office.undo",
  discard: "office.discard",
  export: "office.export",
  "return-to-channel": "office.return",
} as const;

export interface OfficeOwnerBrokerPort {
  createProposal(input: {
    action: string;
    pluginId: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
    resultDigest?: string;
    destinationLabel?: string;
  }): { actionId: string };
  requestOwnerApproval(actionId: string): Promise<{ decision: "denied" } | { decision: "approved"; receipt: string }>;
  consumeApproval(input: { receipt: unknown; intentDigest: string; actionId: string }): { reservationId: string };
  completeApproval(input: { actionId: string; reservationId: string; resultDigest: string }): void;
  inspect(actionId: string): {
    intentDigest: string;
    action: string;
    state: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    pluginId: string;
  };
}

export function officeOwnerAction(action: OfficeReceiptAction): (typeof OFFICE_TO_OWNER_ACTION)[OfficeReceiptAction] {
  return OFFICE_TO_OWNER_ACTION[action];
}

export function ownerBrokerActionId(receipt: string): string {
  if (!isOwnerBrokerReceipt(receipt)) {
    throw new PenglaiError("SECURITY_POLICY", "office broker receipt required");
  }
  const payload = receipt.slice(0, receipt.lastIndexOf("."));
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { actionId: string };
  return claims.actionId;
}

export function isOwnerBrokerReceipt(receipt: string): boolean {
  if (typeof receipt !== "string" || !receipt.includes(".")) return false;
  try {
    const payload = receipt.slice(0, receipt.lastIndexOf("."));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      schema?: unknown;
      actionId?: unknown;
      decision?: unknown;
    };
    return claims.schema === 1 && typeof claims.actionId === "string" && claims.decision === "approved";
  } catch {
    return false;
  }
}

export function proposeOfficeAction(
  broker: OfficeOwnerBrokerPort,
  input: {
    action: OfficeReceiptAction;
    jobId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
    resultDigest?: string;
    destinationLabel?: string;
  },
): { actionId: string; action: string } {
  const intent = broker.createProposal({
    action: officeOwnerAction(input.action),
    pluginId: "@penglai/office",
    objectId: input.jobId,
    sourceDigest: input.sourceDigest,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
    ...(input.destinationLabel ? { destinationLabel: input.destinationLabel } : {}),
  });
  return { actionId: intent.actionId, action: officeOwnerAction(input.action) };
}

export async function approveOfficeAction(
  broker: OfficeOwnerBrokerPort,
  actionId: string,
): Promise<string> {
  const decided = await broker.requestOwnerApproval(actionId);
  if (decided.decision !== "approved") {
    throw new PenglaiError("SECURITY_POLICY", "owner denied office action");
  }
  return decided.receipt;
}

export function consumeOfficeBrokerReceipt(
  broker: OfficeOwnerBrokerPort,
  input: {
    receipt: string;
    actionId: string;
    action: OfficeReceiptAction;
    jobId: string;
    sourceDigest: string;
    workspaceId?: string;
  },
): { reservationId: string; intentDigest: string } {
  const inspected = broker.inspect(input.actionId);
  if (
    inspected.pluginId !== "@penglai/office" ||
    inspected.action !== officeOwnerAction(input.action) ||
    inspected.objectId !== input.jobId ||
    inspected.sourceDigest !== `sha256:${input.sourceDigest.replace(/^sha256:/, "")}` ||
    (inspected.workspaceId ?? "") !== (input.workspaceId ?? "")
  ) {
    throw new PenglaiError("SECURITY_POLICY", "office broker intent mismatch");
  }
  const reserved = broker.consumeApproval({
    receipt: input.receipt,
    intentDigest: inspected.intentDigest,
    actionId: input.actionId,
  });
  return { reservationId: reserved.reservationId, intentDigest: inspected.intentDigest };
}
