import type { MemoryRecord, MemoryScopeRef } from "../engine/protocol.js";

export function exportMarkdown(scope: MemoryScopeRef, records: MemoryRecord[]): string {
  const title = scope.kind === "personal" ? "personal" : `workspace:${scope.workspaceId}`;
  const lines = [`# Penglai Memory (${title})`, ""];
  for (const row of records) {
    lines.push(`## ${row.id}`);
    lines.push(`- type: ${row.type}`);
    lines.push(`- status: ${row.status}`);
    lines.push(`- source: ${row.source.kind} ${row.source.locator}`);
    lines.push(`- digest: ${row.source.digest}`);
    lines.push("");
    lines.push(row.text);
    lines.push("");
  }
  return lines.join("\n");
}
