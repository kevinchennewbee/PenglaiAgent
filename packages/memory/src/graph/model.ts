import type { MemoryRecord } from "../engine/protocol.js";

export type GraphEdgeKind = "temporal" | "entity" | "causal" | "semantic";

export interface MemoryGraphNode {
  id: string;
  type: MemoryRecord["type"];
  status: MemoryRecord["status"];
  summary: string;
  scope: MemoryRecord["scope"]["kind"];
}

export interface MemoryGraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  truncated: boolean;
}
