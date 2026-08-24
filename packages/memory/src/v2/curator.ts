import { MemoryV2Store } from "./candidates.js";
import { CANDIDATE_KINDS } from "./governance.js";

export const CURATOR_MAX_CANDIDATES = 8;
export const CURATOR_TEXT_MAX = 2000;
export const CURATOR_RATIONALE_MAX = 500;

const FIELDS = new Set(["kind", "text", "rationale", "sensitivity", "confidence", "suggestedScope"]);
const SENSITIVITIES = new Set(["normal", "sensitive", "prohibited"]);
const SCOPES = new Set(["workspace", "personal"]);

export interface CuratorIngestResult {
  failOpen: boolean;
  enqueued: number;
  skipped: number;
  code?: "CURATOR_JSON_INVALID" | "CURATOR_SCHEMA_INVALID";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseOne(value: unknown):
  | {
      kind: string;
      text: string;
      rationale: string;
      confidence: number;
    }
  | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const keys = Object.keys(row);
  if (keys.length !== FIELDS.size || keys.some((key) => !FIELDS.has(key))) return undefined;
  if (!CANDIDATE_KINDS.includes(row.kind as (typeof CANDIDATE_KINDS)[number])) return undefined;
  if (!SENSITIVITIES.has(String(row.sensitivity))) return undefined;
  if (!SCOPES.has(String(row.suggestedScope))) return undefined;
  if (typeof row.text !== "string" || row.text.length < 1 || row.text.length > CURATOR_TEXT_MAX) return undefined;
  if (typeof row.rationale !== "string" || row.rationale.length < 1 || row.rationale.length > CURATOR_RATIONALE_MAX) {
    return undefined;
  }
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
    return undefined;
  }
  return { kind: String(row.kind), text: row.text, rationale: row.rationale, confidence: row.confidence };
}

/** Host-validated curator JSON. Invalid output Fail Opens and never throws into the official Turn. */
export function ingestCuratorOutput(
  store: MemoryV2Store,
  raw: string,
  ctx: { workspaceId: string; sessionId: string; turnId: string; sourceDigest: string },
): CuratorIngestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { failOpen: true, enqueued: 0, skipped: 0, code: "CURATOR_JSON_INVALID" };
  }
  const root = asRecord(parsed);
  if (!root || Object.keys(root).join(",") !== "candidates" || !Array.isArray(root.candidates)) {
    return { failOpen: true, enqueued: 0, skipped: 0, code: "CURATOR_SCHEMA_INVALID" };
  }
  if (root.candidates.length > CURATOR_MAX_CANDIDATES) {
    return { failOpen: true, enqueued: 0, skipped: 0, code: "CURATOR_SCHEMA_INVALID" };
  }
  if (store.turnAlreadyProcessed(ctx.sessionId, ctx.turnId, ctx.sourceDigest)) {
    return { failOpen: false, enqueued: 0, skipped: root.candidates.length };
  }
  const drafts = [];
  for (const item of root.candidates) {
    const row = parseOne(item);
    if (!row) return { failOpen: true, enqueued: 0, skipped: 0, code: "CURATOR_SCHEMA_INVALID" };
    drafts.push(row);
  }
  let enqueued = 0;
  let skipped = 0;
  for (const draft of drafts) {
    try {
      const result = store.enqueue({
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        kind: draft.kind,
        text: draft.text,
        rationale: draft.rationale,
        confidence: draft.confidence,
        sourceDigest: ctx.sourceDigest,
      });
      if ("skipped" in result && result.skipped) skipped += 1;
      else enqueued += 1;
    } catch {
      return { failOpen: true, enqueued, skipped, code: "CURATOR_SCHEMA_INVALID" };
    }
  }
  store.markTurnProcessed(ctx.sessionId, ctx.turnId, ctx.sourceDigest);
  return { failOpen: false, enqueued, skipped };
}
