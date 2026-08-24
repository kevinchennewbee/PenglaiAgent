import { PenglaiError } from "@penglai/contracts";
import { MEMORY_OWNER_ACTIONS } from "./owner.js";

export interface MemoryOwnerBrokerPort {
  createProposal(input: {
    action: string;
    pluginId: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
  }): { actionId: string };
  consumeApproval(input: { receipt: unknown; intentDigest: string; actionId: string }): { reservationId: string };
  completeApproval(input: { actionId: string; reservationId: string; resultDigest: string }): void;
  inspect(actionId: string): {
    intentDigest: string;
    action: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
    pluginId: string;
  };
}

export interface MemoryOwnerReservation {
  complete(resultDigest: string): void;
}

/**
 * Reserve a one-time Owner approval after revalidating the exact action,
 * object, scope and source bytes. The caller must perform the mutation and
 * only then call complete(); a failed mutation must never be logged as a
 * committed Owner action.
 */
export function reserveMemoryOwnerProof(
  owner: MemoryOwnerBrokerPort | undefined,
  input: {
    action: (typeof MEMORY_OWNER_ACTIONS)[keyof typeof MEMORY_OWNER_ACTIONS];
    actionId: string;
    receipt: string;
    objectId: string;
    workspaceId?: string;
    sessionId?: string;
    sourceDigest: string;
  },
): MemoryOwnerReservation {
  if (!owner) throw new PenglaiError("DSH_UNAVAILABLE", "owner broker required");
  if (typeof input.receipt !== "string" || !input.receipt.includes(".")) {
    throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
  }
  const inspected = owner.inspect(input.actionId);
  if (
    inspected.pluginId !== "@penglai/memory" ||
    inspected.action !== input.action ||
    inspected.objectId !== input.objectId ||
    (inspected.workspaceId ?? "") !== (input.workspaceId ?? "") ||
    (inspected.sessionId ?? "") !== (input.sessionId ?? "") ||
    inspected.sourceDigest !== normalizeDigest(input.sourceDigest)
  ) {
    throw new PenglaiError("SECURITY_POLICY", "memory broker intent mismatch");
  }
  const reserved = owner.consumeApproval({
    receipt: input.receipt,
    intentDigest: inspected.intentDigest,
    actionId: input.actionId,
  });
  return {
    complete(resultDigest: string) {
      owner.completeApproval({
        actionId: input.actionId,
        reservationId: reserved.reservationId,
        resultDigest,
      });
    },
  };
}

function normalizeDigest(value: string): string {
  const hex = value.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new PenglaiError("SECURITY_POLICY", "memory source digest required");
  }
  return `sha256:${hex}`;
}

export function proposeMemoryAction(
  owner: MemoryOwnerBrokerPort,
  input: {
    action: (typeof MEMORY_OWNER_ACTIONS)[keyof typeof MEMORY_OWNER_ACTIONS];
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
  },
): { actionId: string; action: string } {
  const proposal = owner.createProposal({
    action: input.action,
    pluginId: "@penglai/memory",
    objectId: input.objectId,
    sourceDigest: input.sourceDigest,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  return { actionId: proposal.actionId, action: input.action };
}
