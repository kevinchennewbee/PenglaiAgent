/** Personal Context V1 types (Host-local). Named context.* per 0.4.1 spec. */

export type ContextScopeType = "global" | "project";

export type ContextSourceStatus =
  | "ready"
  | "indexing"
  | "stale"
  | "error"
  | "removed";

/** R3 lifecycle for verified context references. */
export type ContextRefStatus =
  | "current"
  | "stale"
  | "revoked"
  | "unavailable"
  | "unknown";

export interface ContextLocation {
  headingPath?: string | null;
  page?: number | null;
  slide?: number | null;
  sheet?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  keyPath?: string | null;
  offsetStart?: number | null;
  offsetEnd?: number | null;
}

export interface ContextSource {
  id: string;
  scopeType: ContextScopeType;
  projectId: string | null;
  displayName: string;
  rootPath: string;
  status: ContextSourceStatus;
  generation: number;
  fileCount: number;
  successCount: number;
  failureCount: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  indexedAt: number | null;
}

export interface ContextDocument {
  id: string;
  sourceId: string;
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  title: string;
  parseStatus: "ok" | "skipped" | "error";
  errorCode: string | null;
  chunkCount: number;
}

export interface ContextChunk {
  id: string;
  documentId: string;
  ordinal: number;
  headingPath: string | null;
  text: string;
  contentHash: string;
  tokenEstimate: number;
}

export interface ContextHit {
  contextRef: string;
  sourceId: string;
  documentId: string;
  chunkId: string;
  relativePath: string;
  title: string;
  headingPath: string | null;
  snippet: string;
  score: number;
  documentSha256: string;
  chunkSha256: string;
  scopeType: ContextScopeType;
  projectId: string | null;
  location: ContextLocation | null;
}

export interface ContextReadResult {
  contextRef: string;
  sourceId: string;
  documentId: string;
  chunkId: string;
  relativePath: string;
  title: string;
  headingPath: string | null;
  /** Body text when status is current or stale; empty for revoked/unavailable. */
  text: string;
  documentSha256: string;
  chunkSha256: string;
  location: ContextLocation | null;
  status: ContextRefStatus;
  /** @deprecated use status === "stale" */
  stale: boolean;
}

export interface ContextAddSourceInput {
  rootPath: string;
  scopeType: ContextScopeType;
  projectId?: string | null;
  displayName?: string | null;
}

export interface ContextSearchInput {
  query: string;
  /** When set, include this project's sources + global. */
  projectId?: string | null;
  /** floating chat: only global. */
  globalOnly?: boolean;
  limit?: number;
  allowedSourceIds?: string[] | null;
}

export interface ContextMintRefInput {
  sourceId: string;
  documentId: string;
  chunkId: string;
  documentSha256: string;
  chunkSha256: string;
  relativePath: string;
  title: string;
  headingPath: string | null;
  location?: ContextLocation | null;
  episodeId?: string | null;
  conversationId?: string | null;
  runId?: string | null;
}
