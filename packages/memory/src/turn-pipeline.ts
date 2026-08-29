import { createHash } from "node:crypto";
import { createUserMessage, type LlmRuntime, type TokenUsage } from "@deepseek-ai/dsh-llm";
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
export const CURATOR_OUTPUT_MAX_BYTES = 32_768;
export const CURATOR_ESTIMATED_TOKENS = 4_000;

const RETRYABLE_CURATOR_CODES = new Set(["RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"]);

export class MemoryCuratorFailure extends Error {
  override readonly name = "MemoryCuratorFailure";

  constructor(
    readonly code:
      | "RATE_LIMIT"
      | "SERVER"
      | "TIMEOUT"
      | "TRANSPORT"
      | "EMPTY_RESPONSE"
      | "OUTPUT_INVALID"
      | "PROTOCOL"
      | "BUDGET_BLOCKED"
      | "BUDGET_ACCOUNTING"
      | "WORKSPACE_CHANGED"
      | "CANCELLED"
      | "PROVIDER_TERMINAL"
      | "UNKNOWN",
    readonly retryable: boolean,
  ) {
    super(`memory curator ${code.toLowerCase()}`);
  }
}

export function classifyMemoryCuratorFailure(error: unknown): { code: string; retry: boolean } {
  return error instanceof MemoryCuratorFailure
    ? { code: error.code, retry: error.retryable }
    : { code: "UNKNOWN", retry: false };
}

export function curatorUsageTokens(usage: TokenUsage): number {
  const alphaTotal = (usage as TokenUsage & { totalTokens?: number }).totalTokens;
  if (alphaTotal !== undefined) {
    if (!Number.isSafeInteger(alphaTotal) || alphaTotal < 0) throw new MemoryCuratorFailure("PROTOCOL", false);
    return alphaTotal;
  }
  const fields = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
  let total = 0;
  for (const field of fields) {
    if (field === undefined) continue;
    if (!Number.isSafeInteger(field) || field < 0) throw new MemoryCuratorFailure("PROTOCOL", false);
    total += field;
  }
  if (!Number.isSafeInteger(total)) throw new MemoryCuratorFailure("PROTOCOL", false);
  return total;
}

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

/** One auxiliary official DSH LLM call with no Agent, Session, tools, or durable projection. */
export async function runOfficialLlmCurator(input: {
  llm: Pick<LlmRuntime, "stream">;
  provider: string;
  model: string;
  summary: string;
  signal: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<string> {
  const prompt = `${CURATOR_PROMPT}${input.summary}`;
  try {
      input.signal.throwIfAborted();
      let raw = "";
      let finished = false;
      let usageSeen = false;
      for await (const chunk of input.llm.stream({
        provider: input.provider,
        model: input.model,
        messages: [
          createUserMessage({
            content: [{ type: "text", text: prompt }],
            source: { kind: "plugin", plugin: "@penglai/memory" },
          }),
        ],
        tools: [],
        temperature: 0,
        maxTokens: 1200,
        signal: input.signal,
      })) {
        if (finished) throw new MemoryCuratorFailure("PROTOCOL", false);
        if (chunk.type === "tool-call-delta") throw new MemoryCuratorFailure("PROTOCOL", false);
        if (chunk.type === "block-end" && chunk.block.type === "tool-call") {
          throw new MemoryCuratorFailure("PROTOCOL", false);
        }
        if (chunk.type === "text-delta") {
          raw += chunk.text;
          if (Buffer.byteLength(raw, "utf8") > CURATOR_OUTPUT_MAX_BYTES) {
            throw new MemoryCuratorFailure("OUTPUT_INVALID", false);
          }
        }
        if (chunk.type === "usage") {
          if (usageSeen) throw new MemoryCuratorFailure("PROTOCOL", false);
          usageSeen = true;
          input.onUsage?.(curatorUsageTokens(chunk.usage));
        }
        if (chunk.type === "finish") {
          if (chunk.reason.kind !== "stop") {
            if (chunk.reason.kind === "aborted") throw new MemoryCuratorFailure("CANCELLED", false);
            if (chunk.reason.kind === "error") {
              const code = String(chunk.reason.failure.code ?? "").toUpperCase();
              if (RETRYABLE_CURATOR_CODES.has(code)) {
                throw new MemoryCuratorFailure(code as "RATE_LIMIT" | "SERVER" | "TIMEOUT" | "TRANSPORT" | "EMPTY_RESPONSE", true);
              }
            }
            throw new MemoryCuratorFailure("PROVIDER_TERMINAL", false);
          }
          finished = true;
        }
      }
      if (!finished || !usageSeen) throw new MemoryCuratorFailure("PROTOCOL", false);
      if (!raw.trim()) throw new MemoryCuratorFailure("EMPTY_RESPONSE", true);
      return raw;
  } catch (error: unknown) {
    if (error instanceof MemoryCuratorFailure) throw error;
    if (input.signal.aborted) throw new MemoryCuratorFailure("CANCELLED", false);
    throw new MemoryCuratorFailure("TRANSPORT", true);
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
