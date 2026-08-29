import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";

export const IM_OWNER_ACTIONS = {
  bind: "im.bind",
  rebind: "im.rebind",
  remove: "im.remove",
  enableGroup: "im.enableGroup",
  saveCredentials: "im.saveCredentials",
  deleteCredentials: "im.deleteCredentials",
  logout: "im.logout",
} as const;

export type ImOwnerAction = (typeof IM_OWNER_ACTIONS)[keyof typeof IM_OWNER_ACTIONS];

export interface ImOwnerBrokerPort {
  createProposal(input: {
    action: string;
    pluginId: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
  }): { actionId: string };
  inspect(actionId: string): {
    action: string;
    state: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
    pluginId: string;
    intentDigest: string;
  };
  consumeApproval(input: { receipt: unknown; intentDigest: string; actionId: string }): { reservationId: string };
  completeApproval(input: { actionId: string; reservationId: string; resultDigest: string }): void;
}

export function requireImActionId(actionId: string | undefined, label = "IM_OWNER_ACTION"): string {
  if (!actionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)) {
    throw new PenglaiError("SECURITY_POLICY", label);
  }
  return actionId;
}

export function imBindingObjectId(input: {
  channel: string;
  accountId: string;
  peerId: string;
}): string {
  return `${input.channel}:${input.accountId}:${input.peerId}`;
}

export function imSourceDigest(input: {
  action: ImOwnerAction;
  objectId: string;
  workspaceId?: string;
  sessionId?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ action: input.action, objectId: input.objectId, workspaceId: input.workspaceId ?? "", sessionId: input.sessionId ?? "" }))
    .digest("hex");
}

export function consumeImOwnerProof(
  owner: ImOwnerBrokerPort | undefined,
  input: {
    action: ImOwnerAction;
    actionId: string;
    receipt?: string;
    objectId: string;
    workspaceId?: string;
    sessionId?: string;
    resultDigest: string;
  },
): () => void {
  const actionId = requireImActionId(input.actionId);
  if (!owner) return () => undefined;
  if (!input.receipt) throw new PenglaiError("SECURITY_POLICY", "IM_OWNER_RECEIPT");
  const inspected = owner.inspect(actionId);
  if (
    inspected.pluginId !== "@penglai/im" ||
    inspected.action !== input.action ||
    inspected.objectId !== input.objectId ||
    inspected.sourceDigest !== `sha256:${imSourceDigest({
      action: input.action,
      objectId: input.objectId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    })}` ||
    (inspected.workspaceId ?? "") !== (input.workspaceId ?? "") ||
    (inspected.sessionId ?? "") !== (input.sessionId ?? "")
  ) {
    throw new PenglaiError("SECURITY_POLICY", "IM_OWNER_INTENT");
  }
  const reserved = owner.consumeApproval({
    receipt: input.receipt,
    intentDigest: inspected.intentDigest,
    actionId,
  });
  return () =>
    owner.completeApproval({
      actionId,
      reservationId: reserved.reservationId,
      resultDigest: input.resultDigest.startsWith("sha256:") ? input.resultDigest : `sha256:${input.resultDigest}`,
    });
}
