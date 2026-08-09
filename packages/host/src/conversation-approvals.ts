/**
 * Conversation-path L2/L3 approvals (no durable task/run required).
 *
 * TaskRunner still uses ApprovalService + product DB rows. The chat surface
 * holds tool calls in-process until the owner decides via RPC / desktop card.
 */

import type { PolicyDecision } from "./policy.js";
import type { ApprovalGateRequest, ApprovalVerdict } from "./approvals.js";
import { redactSensitiveText } from "./security/redaction.js";

export interface ConversationApproval {
  id: string;
  conversationId: string;
  episodeId: string | null;
  toolName: string;
  capability: string;
  action: string;
  reason: string;
  level: "L2" | "L3";
  argsExcerpt: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  note: string | null;
}

interface Pending {
  row: ConversationApproval;
  resolve: (verdict: ApprovalVerdict) => void;
  /** Auto-denial deadline; cleared on any decision. */
  timer: NodeJS.Timeout;
}

const MAX_ARGS = 400;

/**
 * A pending L2/L3 approval that the owner never answers would otherwise hold
 * the kernel's tool call forever (leaked episode). After this window the gate
 * auto-denies with a traceable reason; the owner can re-run the action.
 */
const APPROVAL_GATE_TIMEOUT_MS = 30 * 60_000;

function excerpt(args: Record<string, unknown>): string {
  try {
    const text = redactSensitiveText(JSON.stringify(args)).text;
    return text.length <= MAX_ARGS ? text : `${text.slice(0, MAX_ARGS - 1)}…`;
  } catch {
    return "(unserializable)";
  }
}

function newId(): string {
  return `capp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ConversationApprovalService {
  private readonly pending = new Map<string, Pending>();
  private readonly history: ConversationApproval[] = [];
  /** Session-scoped auto-allow for L2 capabilities (Grok-style "allow for session"). */
  private readonly sessionGrants = new Map<string, Set<string>>();

  constructor(
    private readonly publish: (channelId: string, event: unknown) => void = () => {},
  ) {}

  /** True if this conversation already granted this capability for the session. */
  hasSessionGrant(conversationId: string, capability: string): boolean {
    return this.sessionGrants.get(conversationId)?.has(capability) === true;
  }

  grantSession(conversationId: string, capability: string): void {
    const set = this.sessionGrants.get(conversationId) ?? new Set<string>();
    set.add(capability);
    this.sessionGrants.set(conversationId, set);
  }

  clearSessionGrants(conversationId: string): void {
    this.sessionGrants.delete(conversationId);
  }

  list(filter: { conversationId?: string; status?: "pending" | "all" } = {}): ConversationApproval[] {
    const status = filter.status ?? "pending";
    const rows = [
      ...[...this.pending.values()].map((p) => p.row),
      ...this.history,
    ];
    return rows.filter((row) => {
      if (filter.conversationId && row.conversationId !== filter.conversationId) return false;
      if (status === "pending" && row.status !== "pending") return false;
      return true;
    });
  }

  /**
   * Hold an L2/L3 decision for a conversation episode until owner decides.
   */
  request(
    conversationId: string,
    episodeId: string | null,
    request: ApprovalGateRequest,
  ): Promise<ApprovalVerdict> {
    const decision: PolicyDecision = request.decision;
    const capability =
      decision.approval?.capability ??
      (decision.level === "L3" ? "l3:conversation" : "l2:conversation");
    // Session grant (allow for this conversation) short-circuits L2 only.
    if (
      decision.level !== "L3" &&
      !capability.startsWith("l3:") &&
      this.hasSessionGrant(conversationId, capability)
    ) {
      return Promise.resolve({
        approved: true,
        note: "session grant (allow for conversation)",
      });
    }
    const action = decision.approval?.action ?? `${request.toolName}`;
    const level: "L2" | "L3" =
      decision.level === "L3" || capability.startsWith("l3:") ? "L3" : "L2";
    const row: ConversationApproval = {
      id: newId(),
      conversationId,
      episodeId,
      toolName: request.toolName,
      capability,
      action: redactSensitiveText(action).text,
      reason: redactSensitiveText(decision.reason).text,
      level,
      argsExcerpt: excerpt(request.args),
      status: "pending",
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
      note: null,
    };
    this.publish(conversationId, {
      event: "conversation.approval.requested",
      conversationId,
      approval: row,
    });
    this.publish("approvals", {
      event: "conversation.approval.requested",
      conversationId,
      approval: row,
    });
    const timer = setTimeout(() => {
      const held = this.pending.get(row.id);
      if (!held) return; // already decided
      this.pending.delete(row.id);
      const timedOut: ConversationApproval = {
        ...row,
        status: "denied",
        decidedAt: Date.now(),
        decidedBy: "system",
        note: "approval timed out (no decision within 30 minutes)",
      };
      this.history.unshift(timedOut);
      if (this.history.length > 200) this.history.length = 200;
      held.resolve({
        approved: false,
        note: "approval timed out (no decision within 30 minutes)",
      });
      this.publish(row.conversationId, {
        event: "conversation.approval.denied",
        conversationId: row.conversationId,
        approval: timedOut,
      });
      this.publish("approvals", {
        event: "conversation.approval.denied",
        conversationId: row.conversationId,
        approval: timedOut,
      });
    }, APPROVAL_GATE_TIMEOUT_MS);
    return new Promise<ApprovalVerdict>((resolve) => {
      this.pending.set(row.id, { row, resolve, timer });
    });
  }

  approve(input: {
    approvalId: string;
    decidedBy: string;
    note?: string | null;
    /** Remember for this conversation only (L2). */
    rememberSession?: boolean;
  }): ConversationApproval {
    const row = this.decide(input.approvalId, true, input.decidedBy, input.note ?? null);
    if (input.rememberSession && row.level === "L2") {
      this.grantSession(row.conversationId, row.capability);
    }
    return row;
  }

  reject(input: {
    approvalId: string;
    decidedBy: string;
    note?: string | null;
  }): ConversationApproval {
    return this.decide(input.approvalId, false, input.decidedBy, input.note ?? "denied by owner");
  }

  /** Abort all pending gates for a conversation (episode aborted). */
  cancelForConversation(conversationId: string, note: string): number {
    let n = 0;
    for (const [id, pending] of [...this.pending]) {
      if (pending.row.conversationId !== conversationId) continue;
      this.decide(id, false, "system", note);
      n += 1;
    }
    return n;
  }

  private decide(
    approvalId: string,
    approved: boolean,
    decidedBy: string,
    note: string | null,
  ): ConversationApproval {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      throw new Error(`conversation approval not found or already decided: ${approvalId}`);
    }
    clearTimeout(pending.timer);
    this.pending.delete(approvalId);
    const row: ConversationApproval = {
      ...pending.row,
      status: approved ? "approved" : "denied",
      decidedAt: Date.now(),
      decidedBy: redactSensitiveText(decidedBy).text,
      note: note ? redactSensitiveText(note).text : null,
    };
    this.history.unshift(row);
    if (this.history.length > 200) this.history.length = 200;
    pending.resolve({
      approved,
      note: note ?? (approved ? "approved" : "denied"),
    });
    this.publish(row.conversationId, {
      event: approved
        ? "conversation.approval.approved"
        : "conversation.approval.denied",
      conversationId: row.conversationId,
      approval: row,
    });
    this.publish("approvals", {
      event: approved
        ? "conversation.approval.approved"
        : "conversation.approval.denied",
      conversationId: row.conversationId,
      approval: row,
    });
    return row;
  }
}
