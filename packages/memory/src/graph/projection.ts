import { GRAPH_NODE_CAP } from "../engine/protocol.js";
import type { MemoryRecord } from "../engine/protocol.js";
import type { MemoryGraph, MemoryGraphEdge } from "./model.js";

export function projectGraph(records: MemoryRecord[], cap = GRAPH_NODE_CAP): MemoryGraph {
  const sliced = records.slice(0, cap);
  const nodes = sliced.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    summary: row.text.slice(0, 80),
    scope: row.scope.kind,
  }));
  const edges: MemoryGraphEdge[] = [];
  const byType = new Map<string, string>();
  for (const row of sliced) {
    if (row.supersedesId) edges.push({ from: row.id, to: row.supersedesId, kind: "temporal" });
    const prev = byType.get(`${row.scope.kind}:${row.type}`);
    if (prev) edges.push({ from: prev, to: row.id, kind: "entity" });
    byType.set(`${row.scope.kind}:${row.type}`, row.id);
  }
  return { nodes, edges, truncated: records.length > cap };
}
