import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MemoryJournal } from "../engine/journal.js";
import { MemoryStore } from "../store.js";
import type { MemoryV2Store } from "./candidates.js";

export const MEMORY_V2_SCHEMA = "2";

export function migrateJournalToV2(
  journal: MemoryJournal,
  v2: MemoryV2Store,
  opts: { userData?: string } = {},
): { schema: string; confirmed: number; pendingAttribution: number } {
  if (v2.meta("schema") === MEMORY_V2_SCHEMA) {
    return {
      schema: MEMORY_V2_SCHEMA,
      confirmed: Number(v2.meta("confirmed") ?? 0),
      pendingAttribution: Number(v2.meta("pendingAttribution") ?? 0),
    };
  }
  const confirmed = journal.countCommitted();
  let pendingAttribution = 0;
  if (opts.userData) {
    const legacyPath = join(opts.userData, "memory.sqlite3");
    if (existsSync(legacyPath)) {
      const store = new MemoryStore(legacyPath);
      try {
        pendingAttribution = (
          store.db.prepare("SELECT workspace_id AS workspaceId FROM memory_rows WHERE scope = 'workspace'").all() as Array<{
            workspaceId: string | null;
          }>
        ).filter((row) => !row.workspaceId).length;
      } finally {
        store.close();
      }
    }
  }
  v2.setMeta("schema", MEMORY_V2_SCHEMA);
  v2.setMeta("confirmed", String(confirmed));
  v2.setMeta("pendingAttribution", String(pendingAttribution));
  return { schema: MEMORY_V2_SCHEMA, confirmed, pendingAttribution };
}
