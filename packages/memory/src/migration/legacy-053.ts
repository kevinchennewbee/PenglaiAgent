import { existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "../store.js";
import type { IsolatedMemoryEngine } from "../engine/service.js";
import { digestText } from "../trust/governance.js";

export interface MigrationPreview {
  legacyPath: string;
  personal: number;
  workspace: number;
  candidate: number;
}

export function discoverLegacy(root: string): string | undefined {
  const path = join(root, "memory", "memory.sqlite3");
  return existsSync(path) ? path : undefined;
}

function countScope(store: MemoryStore, scope: "workspace" | "candidate"): number {
  return (store.db.prepare("SELECT COUNT(*) AS n FROM memory_rows WHERE scope = ?").get(scope) as { n: number }).n;
}

export function previewLegacy(root: string): MigrationPreview | undefined {
  const legacyPath = discoverLegacy(root);
  if (!legacyPath) return undefined;
  const store = new MemoryStore(legacyPath);
  try {
    return {
      legacyPath,
      personal: store.list("global").length,
      workspace: countScope(store, "workspace"),
      candidate: countScope(store, "candidate"),
    };
  } finally {
    store.close();
  }
}

export function importLegacy(root: string, engine: IsolatedMemoryEngine): MigrationPreview {
  const preview = previewLegacy(root);
  if (!preview) throw new Error("legacy memory sqlite missing");
  const store = new MemoryStore(preview.legacyPath);
  try {
    for (const row of store.list("global")) {
      engine.rememberExplicit({ text: row.text }, "legacy-053");
    }
    const workspaceRows = store.db
      .prepare("SELECT workspace_id AS workspaceId, text FROM memory_rows WHERE scope = 'workspace'")
      .all() as Array<{ workspaceId: string; text: string }>;
    for (const row of workspaceRows) {
      engine.rememberExplicit({ text: row.text, workspaceId: row.workspaceId }, "legacy-053");
    }
    const candidates = store.candidates();
    for (const row of candidates) {
      engine.propose({
        text: row.text,
        locator: `legacy:${row.id}`,
        digest: digestText(row.text),
        ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      });
    }
    return preview;
  } finally {
    store.close();
  }
}
