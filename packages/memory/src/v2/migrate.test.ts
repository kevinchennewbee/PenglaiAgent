import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryJournal } from "../engine/journal.js";
import { MemoryV2Store } from "./candidates.js";
import { MEMORY_V2_SCHEMA, migrateJournalToV2 } from "./migrate.js";

test("R56-MEM-017 0.5.5 journal rows stay confirmed and never auto-personalize", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-mig-"));
  const journal = new MemoryJournal(join(root, "journal.sqlite3"));
  journal.upsert({
    id: "m1",
    scope: "workspace",
    workspaceId: "ws-a",
    content: "0.5.5 workspace fact",
    contentDigest: "d".repeat(64),
    status: "committed",
    source: "user",
    tags: "",
    createdAt: new Date().toISOString(),
    supersededBy: null,
  });
  const v2 = new MemoryV2Store(join(root, "v2.sqlite3"));
  const first = migrateJournalToV2(journal, v2, { userData: root });
  assert.equal(first.schema, MEMORY_V2_SCHEMA);
  assert.equal(first.confirmed, 1);
  assert.equal(first.pendingAttribution, 0);
  const again = migrateJournalToV2(journal, v2, { userData: root });
  assert.equal(again.confirmed, 1);
  assert.equal(v2.listCandidates("ws-a").length, 0);
  journal.close();
  v2.close();
});
