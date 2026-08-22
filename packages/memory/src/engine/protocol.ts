export type MemoryScopeRef =
  | { kind: "personal" }
  | { kind: "workspace"; workspaceId: string };

export type MemoryStatus = "candidate" | "active" | "superseded" | "rejected" | "revoked" | "quarantined";

export type MemoryType = "profile" | "preference" | "project" | "fact" | "episode" | "procedure" | "source";

export interface MemorySource {
  kind: "user" | "turn" | "file" | "import";
  locator: string;
  digest: string;
}

export interface MemoryRecord {
  id: string;
  rowId: number;
  type: MemoryType;
  scope: MemoryScopeRef;
  status: MemoryStatus;
  text: string;
  source: MemorySource;
  observedAt: string;
  validFrom?: string;
  validTo?: string;
  supersedesId?: string;
  authority: "owner-explicit" | "agent-proposed" | "imported";
  sensitivity: "normal" | "private" | "restricted";
}

export interface MemoryWhy {
  id: string;
  text: string;
  status: MemoryStatus;
  source: MemorySource;
  authority: MemoryRecord["authority"];
}

export interface ForgetReceipt {
  id: string;
  status: "revoked";
}

export const AUTO_PRUNE_DEFAULT = false;
export const GRAPH_NODE_CAP = 500;
export const SEARCH_RESULT_CAP = 200;
export const PROMPT_TOKEN_BUDGET = 2048;
