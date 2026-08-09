/**
 * Conversation Goal service (Codex-style ThreadGoal).
 *
 * SSOT: ~/.penglai/conversations/<id>/goal.json
 * Mirror: conversation.goal string (active objective or null)
 *
 * Budget identity-level circuit breaker is separate (budget.ts) and stays.
 * Per-goal budget is optional soft ceiling on the ThreadGoal itself.
 */

import * as path from "node:path";
import type { ThreadGoal, ThreadGoalStatus } from "@penglai/protocol";
import { SCHEMA_VERSION } from "@penglai/protocol";
import { penglaiHome } from "./conversation-store.js";
import {
  appendPrivateLine,
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  readPrivateTextFile,
} from "./security/private-file.js";

const MAX_GOAL_BYTES = 2 * 1024 * 1024;
export const HOST_TOOL_UPDATE_GOAL = "update_goal";

function goalPath(conversationId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(conversationId)) {
    throw new Error(`invalid conversationId: ${conversationId}`);
  }
  return path.join(penglaiHome(), "conversations", conversationId, "goal.json");
}

function historyPath(conversationId: string): string {
  return path.join(penglaiHome(), "conversations", conversationId, "goal-history.jsonl");
}

function now(): number {
  return Date.now();
}

function newGoalId(): string {
  return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadGoal(conversationId: string): ThreadGoal | null {
  const file = goalPath(conversationId);
  try {
    const raw = JSON.parse(readPrivateTextFile(file, MAX_GOAL_BYTES, true).text) as ThreadGoal;
    if (!raw || raw.conversationId !== conversationId) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveGoal(goal: ThreadGoal): void {
  const file = goalPath(goal.conversationId);
  ensurePrivateDirectory(path.dirname(file));
  atomicWritePrivateJson(file, goal, MAX_GOAL_BYTES);
}

function appendHistory(goal: ThreadGoal): void {
  try {
    const file = historyPath(goal.conversationId);
    appendPrivateLine(file, JSON.stringify(goal));
  } catch {
    /* best-effort */
  }
}

/** Mirror string for Conversation.goal / meta.goal */
export function mirrorGoalText(goal: ThreadGoal | null): string | null {
  if (!goal) return null;
  return goal.status === "active" ? goal.objective : null;
}

/**
 * Hydrate from meta: prefer goal.json; if only legacy string exists, synthesize.
 */
export function hydrateGoal(
  conversationId: string,
  legacyGoal: string | null | undefined,
): ThreadGoal | null {
  const existing = loadGoal(conversationId);
  if (existing) return existing;
  const text = typeof legacyGoal === "string" ? legacyGoal.trim() : "";
  if (!text) return null;
  const synthesized: ThreadGoal = {
    schemaVersion: SCHEMA_VERSION,
    id: newGoalId(),
    conversationId,
    objective: text,
    status: "active",
    blockedReason: null,
    completionSummary: null,
    budget: null,
    usage: { turns: 0, inputTokens: 0, outputTokens: 0, episodes: 0, autoContinues: 0 },
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
  };
  saveGoal(synthesized);
  return synthesized;
}

export function setActiveGoal(input: {
  conversationId: string;
  objective: string;
  budget?: ThreadGoal["budget"];
}): ThreadGoal {
  const objective = input.objective.trim();
  if (!objective) throw new Error("goal objective must be non-empty");
  const prev = loadGoal(input.conversationId);
  if (prev && prev.status === "active") {
    // Replace active goal — archive previous as cancelled.
    const archived: ThreadGoal = {
      ...prev,
      status: "cancelled",
      updatedAt: now(),
      completedAt: now(),
    };
    appendHistory(archived);
  }
  const goal: ThreadGoal = {
    schemaVersion: SCHEMA_VERSION,
    id: newGoalId(),
    conversationId: input.conversationId,
    objective,
    status: "active",
    blockedReason: null,
    completionSummary: null,
    budget: input.budget ?? null,
    usage: { turns: 0, inputTokens: 0, outputTokens: 0, episodes: 0, autoContinues: 0 },
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
  };
  saveGoal(goal);
  return goal;
}

export function clearGoal(conversationId: string): ThreadGoal | null {
  const prev = loadGoal(conversationId);
  if (!prev) return null;
  if (prev.status === "active" || prev.status === "blocked") {
    const cancelled: ThreadGoal = {
      ...prev,
      status: "cancelled",
      updatedAt: now(),
      completedAt: now(),
    };
    saveGoal(cancelled);
    appendHistory(cancelled);
    return cancelled;
  }
  return prev;
}

/**
 * update_goal: the model's own status transitions.
 *
 * Soft-budget governance: once a goal is BLOCKED (budget exceeded or episode
 * failure), the model may NOT un-block itself with
 * update_goal(active) — that would let it self-lift the cost ceiling. Reactivating
 * a blocked goal is the owner's decision (CLI/RPC `conversation.goal.continue`).
 * `complete` / `failed` from an active goal stay model-visible (they are
 * honest evidence-based claims the prompt contract demands).
 */
export function updateGoalStatus(input: {
  conversationId: string;
  status: "complete" | "blocked" | "active" | "failed";
  summary?: string;
  reason?: string;
  /** Set by owner channels (RPC/CLI) to allow re-activating a blocked goal. */
  ownerUnblock?: boolean;
}): ThreadGoal {
  const prev = loadGoal(input.conversationId);
  if (!prev) throw new Error("no goal on this conversation");
  let status: ThreadGoalStatus;
  if (input.status === "complete") status = "completed";
  else if (input.status === "blocked") status = "blocked";
  else if (input.status === "failed") status = "failed";
  else status = "active";

  // A blocked/failed goal can only be re-activated by the owner.
  if (
    status === "active" &&
    (prev.status === "blocked" || prev.status === "failed") &&
    input.ownerUnblock !== true
  ) {
    throw new Error(
      `goal is ${prev.status} and may only be re-activated by the owner (` +
        `conversation.goal.continue); the model cannot un-block its own budget ceiling`,
    );
  }
  // A completed goal cannot be silently re-activated by the model either.
  if (status === "active" && prev.status === "completed" && input.ownerUnblock !== true) {
    throw new Error(
      `goal is completed; re-activating requires the owner (` +
        `conversation.goal.continue)`,
    );
  }

  if (status === "completed" && !input.summary?.trim()) {
    throw new Error("completion summary is required");
  }
  if (status === "blocked" && !input.reason?.trim()) {
    throw new Error("blocked reason is required");
  }

  const next: ThreadGoal = {
    ...prev,
    status,
    completionSummary:
      status === "completed" ? (input.summary ?? "").trim() : prev.completionSummary ?? null,
    blockedReason:
      status === "blocked" || status === "failed"
        ? (input.reason ?? "").trim()
        : status === "active"
          ? null
          : prev.blockedReason ?? null,
    updatedAt: now(),
    completedAt: status === "completed" || status === "failed" ? now() : prev.completedAt ?? null,
  };
  saveGoal(next);
  if (status === "completed" || status === "failed") {
    appendHistory(next);
  }
  return next;
}

export function recordGoalEpisodeUsage(
  conversationId: string,
  usage: { turns: number; inputTokens: number; outputTokens: number },
): ThreadGoal | null {
  const prev = loadGoal(conversationId);
  if (!prev || prev.status !== "active") return prev;
  const u = prev.usage ?? {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    episodes: 0,
    autoContinues: 0,
  };
  const next: ThreadGoal = {
    ...prev,
    usage: {
      turns: u.turns + Math.max(0, usage.turns),
      inputTokens: u.inputTokens + Math.max(0, usage.inputTokens),
      outputTokens: u.outputTokens + Math.max(0, usage.outputTokens),
      episodes: u.episodes + 1,
      autoContinues: u.autoContinues,
    },
    updatedAt: now(),
  };
  // Soft per-goal budget → block
  const b = next.budget;
  const tokens = (next.usage?.inputTokens ?? 0) + (next.usage?.outputTokens ?? 0);
  if (b?.maxTokens && tokens >= b.maxTokens) {
    next.status = "blocked";
    next.blockedReason = `goal token budget exceeded (${tokens}/${b.maxTokens})`;
  } else if (b?.maxTurns && (next.usage?.turns ?? 0) >= b.maxTurns) {
    next.status = "blocked";
    next.blockedReason = `goal turn budget exceeded (${next.usage?.turns}/${b.maxTurns})`;
  }
  saveGoal(next);
  return next;
}

export type GoalContinueDecision =
  | { action: "none"; reason: string; goal: ThreadGoal | null }
  | { action: "blocked"; goal: ThreadGoal };

/**
 * Called after an episode settles. Records usage and updates terminal safety
 * state only. Automatic continuation is intentionally disabled: another
 * episode must be started by an explicit owner action.
 */
export function onEpisodeEnd(input: {
  conversationId: string;
  stopReason: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
}): GoalContinueDecision {
  let goal = recordGoalEpisodeUsage(input.conversationId, {
    turns: input.turns,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });
  if (!goal) return { action: "none", reason: "no goal", goal: null };
  if (goal.status !== "active") {
    return { action: "none", reason: `goal status=${goal.status}`, goal };
  }
  if (input.stopReason === "aborted") {
    return { action: "none", reason: "aborted", goal };
  }
  if (input.stopReason === "failed" || input.stopReason === "budget") {
    goal = updateGoalStatus({
      conversationId: input.conversationId,
      status: "blocked",
      reason:
        input.stopReason === "budget"
          ? "episode safety rail tripped (budget)"
          : "episode failed",
    });
    return { action: "blocked", goal };
  }
  return {
    action: "none",
    reason: "automatic goal continuation is disabled; owner action required",
    goal,
  };
}

export function buildActiveGoalPromptBlock(
  goal: ThreadGoal | null | undefined,
  options: { allowModelStatusUpdate?: boolean } = {},
): string {
  if (!goal || goal.status !== "active") return "";
  const usage = goal.usage;
  const usageLine = usage
    ? `progress: episodes=${usage.episodes} turns=${usage.turns} tokens=${usage.inputTokens + usage.outputTokens}`
    : "";
  const statusContract =
    options.allowModelStatusUpdate === false
      ? [
          "This episode is read-only plan mode. Do not change the goal status; return the plan to the owner.",
        ]
      : [
          `When the objective is actually achieved, call tool ${HOST_TOOL_UPDATE_GOAL} with status=complete and a factual summary.`,
          `If blocked by missing owner input or external constraints, call ${HOST_TOOL_UPDATE_GOAL} with status=blocked and reason.`,
        ];
  return [
    "ACTIVE GOAL (Codex-style — keep working until honestly complete or blocked):",
    goal.objective,
    usageLine,
    ...statusContract,
    "Do not claim completion without evidence (files, command results, tests).",
  ]
    .filter(Boolean)
    .join("\n");
}
