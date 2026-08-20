import { PenglaiError } from "@penglai/contracts";
import type { DshAgentLike } from "./index.js";

export const LIVE_CLAIMED_EVENT = "agent/inbox/claimed";
export const DURABLE_SESSION_EVENT = "session/event";
export const SESSION_ASSISTANT_MESSAGE = "assistant/message";
export const SESSION_TURN_END = "turn/end";

export interface OfficialAgentHandle {
  agent: DshAgentLike;
  dispose(): Promise<void>;
}

export function isAgentHandle(value: unknown): value is OfficialAgentHandle {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o.dispose === "function" && o.agent !== undefined && typeof o.agent === "object";
}

export function unwrapAgent(value: unknown): DshAgentLike {
  if (isAgentHandle(value)) return value.agent;
  if (value && typeof value === "object" && typeof (value as DshAgentLike).followup === "function") {
    return value as DshAgentLike;
  }
  throw new PenglaiError("DSH_CONTRACT_DRIFT", "value is neither Agent nor AgentHandle");
}

export interface DurableSessionEvent {
  type: string;
  turn?: number;
  message?: { content?: { type?: string; text?: string }[] };
}

export function finalAssistantText(events: DurableSessionEvent[], sessionTurn: number): string | undefined {
  const matching = events.filter((e) => e.type === SESSION_ASSISTANT_MESSAGE && e.turn === sessionTurn);
  const closed = events.some((e) => e.type === SESSION_TURN_END && e.turn === sessionTurn);
  if (!closed) return undefined;
  const texts = matching
    .flatMap((e) => e.message?.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "");
  const joined = texts.join("");
  return joined.trim() ? joined : undefined;
}

export const REQUIRED_DSH_ENV = ["DSH_HOME", "PENGLAI_USER_DATA", "PENGLAI_DSH_PIN"] as const;
