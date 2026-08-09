/**
 * ApprovalGate — the unified human-in-the-loop contract for EpisodeRunner.
 *
 * Modeled on Codex's oneshot approval pattern (core/state/turn.rs:
 * pending_approvals is a HashMap<call_id, oneshot::Sender<ReviewDecision>>):
 * when a tool call needs a decision, the runner calls `request()` and awaits;
 * some transport (CLI inline prompt, desktop card, Feishu button, or a
 * headless policy) calls `decide()` with the verdict, resolving the await.
 *
 * Both existing services implement this shape:
 *   - ApprovalService (task path): durable DB rows + run state machine
 *   - ConversationApprovalService (chat path): in-memory + 30-min timeout
 * EpisodeRunner depends only on this interface, not on either concrete
 * service. Persistence/rendering differences stay behind the contract.
 */

import type { PolicyDecision } from "../policy.js";

/** A tool call that needs a human decision. */
export interface ApprovalRequest {
  /** Opaque correlation id (the oneshot key). Unique per gate instance. */
  id: string;
  /** Tool being gated ("bash", "write", "edit", …). */
  toolName: string;
  /** The policy decision that triggered the gate (L2/L3). */
  decision: PolicyDecision;
  /** Truncated tool arguments for display. */
  argsExcerpt: string;
  /**
   * Scope: a task/run id (durable path) or conversation/episode id
   * (ephemeral path). Used by transports to route the decision back and
   * by persistence backends as a foreign-key-ish grouping.
   */
  scope: {
    kind: "task" | "conversation";
    taskId?: string;
    runId?: string;
    conversationId?: string;
    episodeId?: string | null;
  };
  /** Wall-clock time the request was created. */
  createdAt: number;
}

/** What the transporter decides. */
export interface ApprovalVerdict {
  approved: boolean;
  /** Fed back to the model on rejection. */
  note: string;
  /** L2 only: remember this approval for the scope (project or session). */
  remember?: boolean;
}

/**
 * Snapshot of a pending or recent decision, for UI/status rendering.
 * Carries transport-agnostic fields; concrete services may expose more.
 */
export interface ApprovalRecord {
  id: string;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  toolName: string;
  capability: string;
  action: string;
  level: "L1" | "L2" | "L3" | "L4";
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  note: string | null;
}

export interface ApprovalGate {
  /**
   * Park the tool call until a decision arrives. The gate MUST resolve
   * (never hang forever): on abort/cancel/timeout it resolves denied.
   */
  request(req: Omit<ApprovalRequest, "id" | "createdAt">): Promise<ApprovalVerdict>;

  /**
   * Resolve a pending request by id. Returns false if no pending request
   * matches (already decided, unknown id).
   */
  decide(id: string, verdict: ApprovalVerdict): boolean;

  /** List pending (or all recent) approvals visible to this gate scope. */
  list(filter?: { status?: "pending" | "all" }): ApprovalRecord[];

  /**
   * Cancel all pending requests in a scope (episode abort, run cancel,
   * shutdown). Resolves them as denied with the given note.
   */
  cancel(scopeFilter: { runId?: string; conversationId?: string }, note: string): number;
}

/**
 * The minimal gate function EpisodeRunner needs: park a tool call until a
 * transport returns a verdict. Concrete services (ApprovalService for tasks,
 * ConversationApprovalService for chat) implement this via their own
 * persistence; the runner only sees this callback.
 */
export type RequestApproval = (req: {
  toolName: string;
  action: string;
  capability: string;
  level: "L2" | "L3";
  argsExcerpt: string;
}) => Promise<ApprovalVerdict>;

/** A no-op gate for headless/test runs that auto-denies everything. */
export function denyAllGate(): RequestApproval {
  return async () => ({ approved: false, note: "headless: no approval gate" });
}
