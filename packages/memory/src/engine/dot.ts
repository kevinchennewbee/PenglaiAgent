const MAX_NODES = 500;
const MAX_EDGES = 2000;
const MAX_LABEL = 120;

export interface DotGraph {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string }>;
  truncated: boolean;
}

export function parseMnemonDot(dot: string): DotGraph {
  const nodes: Array<{ id: string; label: string }> = [];
  const edges: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const match of dot.matchAll(/"([^"]+)"\s*\[label="([^"]*)"/g)) {
    const id = match[1] ?? "";
    const label = (match[2] ?? "").slice(0, MAX_LABEL);
    if (!id || seen.has(id) || nodes.length >= MAX_NODES) continue;
    seen.add(id);
    nodes.push({ id, label });
  }
  for (const match of dot.matchAll(/"([^"]+)"\s*->\s*"([^"]+)"/g)) {
    const from = match[1] ?? "";
    const to = match[2] ?? "";
    if (!from || !to || edges.length >= MAX_EDGES) continue;
    edges.push({ from, to });
  }
  return {
    nodes,
    edges,
    truncated: nodes.length >= MAX_NODES || edges.length >= MAX_EDGES,
  };
}
