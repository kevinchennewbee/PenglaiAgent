import type { MemoryRecord, MemoryScopeRef } from "../engine/protocol.js";

export function exportJson(scope: MemoryScopeRef, records: MemoryRecord[]): string {
  return `${JSON.stringify({ scope, records }, null, 2)}\n`;
}

export function parseJsonExport(text: string): { scope: MemoryScopeRef; records: MemoryRecord[] } {
  const parsed = JSON.parse(text) as { scope: MemoryScopeRef; records: MemoryRecord[] };
  if (!parsed?.scope || !Array.isArray(parsed.records)) throw new Error("memory json export invalid");
  return parsed;
}
