import { PenglaiError } from "./errors.js";

export const CENTER_JOURNAL_SCHEMA = 3;

export interface CenterJournalHeader {
  schema: 2 | typeof CENTER_JOURNAL_SCHEMA;
  operationId: string;
  phase: "staging" | "activating" | "verifying" | "committed" | "rolled_back";
  id: string;
  previousEnabled: boolean;
  lastGoodPhase?: "snapshot" | "snapshot-ready" | "promote-prev" | "promote-next" | "promote-done";
}

/** Shared disk contract for transaction writers and preboot recovery. */
export function assertCenterJournalHeader(value: unknown): asserts value is CenterJournalHeader {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PenglaiError("STORE_CORRUPT", "Center recovery journal invalid");
  }
  const row = value as Record<string, unknown>;
  if (
    (row.schema !== 2 && row.schema !== CENTER_JOURNAL_SCHEMA) ||
    typeof row.operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row.operationId) ||
    typeof row.id !== "string" || !row.id || row.id.length > 160 ||
    typeof row.previousEnabled !== "boolean" ||
    (row.lastGoodPhase !== undefined && !["snapshot", "snapshot-ready", "promote-prev", "promote-next", "promote-done"].includes(String(row.lastGoodPhase))) ||
    !["staging", "activating", "verifying", "committed", "rolled_back"].includes(String(row.phase))
  ) throw new PenglaiError("STORE_CORRUPT", "Center recovery journal invalid");
}

/** Before activation, the live profile and desired state have not changed. */
export function centerProfileWasUntouched(journal: CenterJournalHeader): boolean {
  return journal.phase === "staging" && journal.lastGoodPhase !== undefined;
}
