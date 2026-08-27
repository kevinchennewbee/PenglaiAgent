import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import type { CompanionConfig, CompanionEnableInput } from "./service.js";

export const COMPANION_OWNER_ACTIONS = {
  enable: "companion.enable",
  disable: "companion.disable",
  scheduleReminder: "companion.schedule-reminder",
} as const;

export type CompanionOwnerAction =
  (typeof COMPANION_OWNER_ACTIONS)[keyof typeof COMPANION_OWNER_ACTIONS];

export interface CompanionOwnerBrokerPort {
  createProposal(input: {
    action: CompanionOwnerAction;
    pluginId: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
  }): { actionId: string };
  inspect(actionId: string): {
    action: string;
    objectId: string;
    sourceDigest: string;
    pluginId: string;
    intentDigest: string;
    workspaceId?: string;
    sessionId?: string;
  };
  consumeApproval(input: {
    receipt: unknown;
    intentDigest: string;
    actionId: string;
  }): { reservationId: string };
  completeApproval(input: {
    actionId: string;
    reservationId: string;
    resultDigest: string;
  }): void;
}

export interface CompanionOwnerProof {
  actionId: string;
  receipt: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function companionEnableDigest(input: CompanionEnableInput): string {
  return sha256({
    action: COMPANION_OWNER_ACTIONS.enable,
    bindingId: input.bindingId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    quietStartHour: input.quietStartHour,
    quietEndHour: input.quietEndHour,
    dailyCap: input.dailyCap,
    recentInteractionMinutes: input.recentInteractionMinutes,
    intensity: input.intensity,
    deliveryMode: input.deliveryMode,
    locale: input.locale,
    signals: [...input.signals].sort(),
  });
}

export function companionDisableDigest(config: CompanionConfig): string {
  return sha256({
    action: COMPANION_OWNER_ACTIONS.disable,
    revision: config.revision,
    bindingId: config.bindingId ?? "",
    workspaceId: config.workspaceId ?? "",
    sessionId: config.boundSessionId ?? "",
  });
}

export function companionReminderDigest(input: {
  at: unknown;
  opaqueReminderId: string;
  configRevision: number;
}): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(input.at);
  } catch {
    throw new PenglaiError("INVALID_INPUT", "companion reminder time must be JSON");
  }
  if (encoded === undefined || encoded.length > 4096) {
    throw new PenglaiError("INVALID_INPUT", "companion reminder time invalid");
  }
  return sha256({
    action: COMPANION_OWNER_ACTIONS.scheduleReminder,
    at: JSON.parse(encoded) as unknown,
    opaqueReminderId: input.opaqueReminderId,
    configRevision: input.configRevision,
  });
}

export function consumeCompanionOwnerProof(
  owner: CompanionOwnerBrokerPort | undefined,
  input: CompanionOwnerProof & {
    action: CompanionOwnerAction;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
  },
): (result: unknown) => void {
  if (!owner) throw new PenglaiError("DSH_UNAVAILABLE", "companion owner broker required");
  if (
    typeof input.actionId !== "string" ||
    input.actionId.length === 0 ||
    typeof input.receipt !== "string" ||
    !input.receipt.includes(".")
  ) {
    throw new PenglaiError("SECURITY_POLICY", "companion broker receipt required");
  }
  const inspected = owner.inspect(input.actionId);
  if (
    inspected.pluginId !== "@penglai/companion" ||
    inspected.action !== input.action ||
    inspected.objectId !== input.objectId ||
    inspected.sourceDigest !== `sha256:${input.sourceDigest}` ||
    inspected.workspaceId !== input.workspaceId ||
    inspected.sessionId !== input.sessionId
  ) {
    throw new PenglaiError("SECURITY_POLICY", "companion broker intent mismatch");
  }
  const reserved = owner.consumeApproval({
    receipt: input.receipt,
    intentDigest: inspected.intentDigest,
    actionId: input.actionId,
  });
  return (result) =>
    owner.completeApproval({
      actionId: input.actionId,
      reservationId: reserved.reservationId,
      resultDigest: sha256(result),
    });
}
