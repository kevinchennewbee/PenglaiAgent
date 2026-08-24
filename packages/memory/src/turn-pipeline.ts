import { createHash } from "node:crypto";
import { ingestCuratorOutput } from "./v2/curator.js";
import type { MemoryCandidateV1, MemoryV2Store } from "./v2/candidates.js";

const MEMORY_CONTEXT_PREFIX =
  "[PENGLAI TRUSTED MEMORY CONTEXT - NOT USER-AUTHORED]";

export interface MemoryTurnText {
  user?: string;
  assistant?: string;
}

export interface MemoryRecallItem {
  id: string;
  scope: string;
  text: string;
  sourceDigest: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const CURATOR_PROMPT =
  "Extract at most 8 closed JSON candidates for Penglai Memory. Return only {\"candidates\":[...]} with keys kind,text,rationale,sensitivity,confidence,suggestedScope. Do not invent secrets. Input:\n";

export async function runHostCurator(input: {
  summary: string;
  generate?: (prompt: string) => Promise<string>;
}): Promise<string> {
  if (!input.generate) return JSON.stringify({ candidates: [] });
  try {
    const raw = await input.generate(`${CURATOR_PROMPT}${input.summary}`);
    return typeof raw === "string" && raw.trim() ? raw : JSON.stringify({ candidates: [] });
  } catch {
    return "not-json";
  }
}

export function turnSummary(text: MemoryTurnText): string {
  const user = String(text.user ?? "").slice(0, 1200);
  const assistant = String(text.assistant ?? "").slice(0, 1200);
  return `user:\n${user}\nassistant:\n${assistant}`.slice(0, 2400);
}

export function turnSourceDigest(input: { workspaceId: string; sessionId: string; turnId: string; summary: string }): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export async function ingestOfficialTurn(input: {
  store: MemoryV2Store;
  workspaceId: string;
  sessionId: string;
  turnId: string;
  raw: string;
  summary: string;
  persist?: (candidate: MemoryCandidateV1) => Promise<unknown>;
}): Promise<{ failOpen: boolean; enqueued: number; autoAccepted: number }> {
  const sourceDigest = turnSourceDigest({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    summary: input.summary,
  });
  const ingested = ingestCuratorOutput(input.store, input.raw, {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    sourceDigest,
  });
  if (ingested.failOpen) {
    return { failOpen: true, enqueued: 0, autoAccepted: 0 };
  }
  let autoAccepted = 0;
  if (input.persist) {
    for (const candidate of input.store.listAutoAcceptEligible(input.workspaceId)) {
      try {
        // The confirmed engine is the recall source of truth. Commit there
        // before changing the candidate state so a renderer badge can never
        // claim a memory is accepted while the next Turn cannot recall it.
        await input.persist(candidate);
        input.store.decide(candidate.candidateId, "accepted");
        autoAccepted += 1;
      } catch {
        // Memory enrichment is fail-open for the conversation. The candidate
        // remains pending and can be retried on a later Turn or accepted by the
        // Owner; no false accepted state is recorded.
      }
    }
  }
  return { failOpen: false, enqueued: ingested.enqueued, autoAccepted };
}

export function withMemoryRecall<T extends { content?: readonly unknown[] }>(
  messages: readonly T[],
  recall: { used: number; items: MemoryRecallItem[] },
): T[] {
  if (recall.used <= 0 || recall.items.length === 0) return [...messages];
  const block = [
    MEMORY_CONTEXT_PREFIX,
    `used=${recall.used}`,
    ...recall.items.map((row) => `${row.scope}:${row.id}:${row.text.slice(0, 240)}`),
  ].join("\n");
  return messages.map((message, index) => {
    if (index !== 0 || !Array.isArray(message.content)) return message;
    const first = message.content[0];
    if (
      first &&
      typeof first === "object" &&
      (first as { type?: unknown }).type === "text" &&
      String((first as { text?: unknown }).text ?? "").startsWith(MEMORY_CONTEXT_PREFIX)
    ) {
      return message;
    }
    return {
      ...message,
      content: [{ type: "text", text: block }, ...message.content],
    };
  });
}

export function workspaceIdForSession(
  workspaces: Array<{ id: string; sessionIds?: readonly string[] }>,
  sessionId: string,
): string | undefined {
  return workspaces.find((row) => row.sessionIds?.includes(sessionId))?.id;
}

export function sessionEventParts(args: unknown[]): {
  sessionId?: string;
  type?: string;
  turn?: number;
  text?: string;
} {
  const session = asRecord(args[0]);
  const event = asRecord(args[1]) ?? asRecord(args[0]);
  const data = asRecord(event?.data);
  const message = asRecord(data?.message) ?? asRecord(event?.message);
  // Official DSH emits assistant content under data.message.content, while
  // user/message uses data.content and inherits its turn from turn/start.
  const content = Array.isArray(message?.content)
    ? message.content
    : Array.isArray(data?.content)
      ? data.content
      : [];
  const text = content
    .map((row) => asRecord(row))
    .filter((row) => row?.type === "text" && typeof row.text === "string")
    .map((row) => String(row?.text ?? ""))
    .join("");
  const turn = data?.turn ?? event?.turn;
  return {
    ...(typeof session?.id === "string" ? { sessionId: session.id } : {}),
    ...(typeof event?.type === "string" ? { type: event.type } : {}),
    ...(typeof turn === "number" ? { turn } : {}),
    ...(text ? { text } : {}),
  };
}

/** Resolve DSH events that inherit their turn number from turn/start. */
export function resolveSessionTurn(
  parts: ReturnType<typeof sessionEventParts>,
  activeTurns: Map<string, number>,
): number | undefined {
  if (!parts.sessionId) return undefined;
  if (parts.type === "turn/start" && typeof parts.turn === "number") {
    activeTurns.set(parts.sessionId, parts.turn);
  }
  const turn = parts.turn ?? activeTurns.get(parts.sessionId);
  if (parts.type === "turn/end") activeTurns.delete(parts.sessionId);
  return turn;
}
