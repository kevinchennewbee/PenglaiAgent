import { PenglaiError } from "@penglai/contracts";

export const MAX_BOT_ALIAS_LENGTH = 80;

export function validateBotAlias(value: unknown): string {
  if (typeof value !== "string" || value.trim().length > MAX_BOT_ALIAS_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PenglaiError("INVALID_INPUT", "IM_BOT_ALIAS_INVALID");
  }
  return value.trim();
}
