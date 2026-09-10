import { parseClosedEnum } from "@penglai/contracts";

/** Pinned Mnemon 0.2.8 `remember --cat` vocabulary. Not Penglai CandidateKind. */
export const MNEMON_CATEGORIES = ["preference", "decision", "fact", "insight", "context", "general"] as const;
export type MnemonCategory = (typeof MNEMON_CATEGORIES)[number];

export function requireMnemonCategory(value: unknown): MnemonCategory {
  return parseClosedEnum(value, MNEMON_CATEGORIES, "MNEMON_CATEGORY", "INVALID_INPUT");
}
