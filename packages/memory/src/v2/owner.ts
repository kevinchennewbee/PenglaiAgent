import { PenglaiError } from "@penglai/contracts";

export const MEMORY_OWNER_ACTIONS = {
  accept: "memory.accept",
  personal: "memory.personal",
  personalize: "memory.personalize",
  correct: "memory.correct",
  forget: "memory.forget",
} as const;

export function requireMemoryActionId(actionId: string | undefined, label = "MEMORY_OWNER_ACTION"): string {
  if (!actionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)) {
    throw new PenglaiError("SECURITY_POLICY", label);
  }
  return actionId;
}
