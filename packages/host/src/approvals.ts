/**
 * Approval service (审批四级制 L2/L3, design §5/§9).
 *
 * The kernel policy gate holds an L2/L3 tool call and asks this service for
 * a human verdict. The run pauses at `waiting_approval`; the owner decides
 * through `approval.list / approval.approve / approval.reject` (CLI or any
 * thin client); the gate resolves and the SAME run continues — no new run
 * is needed (the gate holds the tool call in place; the existing
 * "new run + checkpoint" resume convention stays untouched for
 * pause/budget stops).
 *
 * Provenance (决策溯源): every request and every decision lands in THREE
 * durable places — the approvals row (who asked / who decided / when /
 * note), the task evidence trail (request + decision entries linked by
 * approvalId), and the append-only product event log
 * (approval.requested / approved / denied / expired). L2 approvals may
 * carry remember=true, persisting a per-project 同类免问 grant; L3 is
 * never grantable.
 */

import type {
  Approval,
  PolicyGrant,
  Project,
  Run,
  Task,
} from "@penglai/protocol";
import type { PolicyDecision } from "./policy.js";
import type { ProductStore } from "./storage/product-store.js";
import { redactSensitiveText } from "./security/redaction.js";

/** What the kernel gate hands over when checkPolicy returns L2/L3. */
export interface ApprovalGateRequest {
  toolName: string;
  args: Record<string, unknown>;
  decision: PolicyDecision;
}

/** Run-scoped context the TaskRunner binds into the gate. */
export interface ApprovalGateContext {
  task: Task;
  run: Run;
  project: Project;
  /** The run's active step (evidence rows attach here). */
  stepId: string | null;
}

export interface ApprovalVerdict {
  approved: boolean;
  /** Fed back to the model as the block reason on rejection. */
  note: string;
}

export interface DecideInput {
  approvalId: string;
  decidedBy: string;
  note?: string | null;
  /** L2 only: persist a per-project 同类免问 grant. */
  remember?: boolean;
}

interface PendingGate {
  approvalId: string;
  runId: string;
  taskId: string;
  stepId: string | null;
  resolve: (verdict: ApprovalVerdict) => void;
}

/** RPC-facing error with a protocol-style code. */
export class ApprovalError extends Error {
  constructor(
    readonly code: "approval_not_found" | "approval_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

const MAX_ARGS_EVIDENCE_CHARS = 500;

function levelOf(capability: string): "L2" | "L3" {
  return capability.startsWith("l3:") ? "L3" : "L2";
}

function excerptArgs(args: Record<string, unknown>): string {
  try {
    const text = redactSensitiveText(JSON.stringify(args)).text;
    return text.length <= MAX_ARGS_EVIDENCE_CHARS
      ? text
      : `${text.slice(0, MAX_ARGS_EVIDENCE_CHARS - 1)}…`;
  } catch {
    return "(unserializable args)";
  }
}

export class ApprovalService {
  /** approvalId → in-memory gate (the kernel call waiting on it). */
  private readonly pending = new Map<string, PendingGate>();

  constructor(
    private readonly store: ProductStore,
    private readonly publish: (taskId: string, event: unknown) => void = () => {},
    private readonly log: (line: string) => void = () => {},
  ) {}

  /**
   * The kernel-gate entry: record the request, pause the run at
   * awaiting_approval, and hold until the owner decides (or the run is
   * aborted — cancelPendingForRun resolves the gate as denied).
   */
  async requestDecision(
    context: ApprovalGateContext,
    request: ApprovalGateRequest,
  ): Promise<ApprovalVerdict> {
    const payload = request.decision.approval;
    if (!payload) {
      // Programming error, not a policy outcome: refuse loudly.
      return { approved: false, note: "approval gate called without an approval payload" };
    }
    const level = levelOf(payload.capability);
    const row = this.store.requestApproval({
      taskId: context.task.id,
      runId: context.run.id,
      capability: payload.capability,
      action: payload.action,
      reason: request.decision.reason,
      requestedBy: `run:${context.run.id}`,
    });
    this.store.addEvidence({
      taskId: context.task.id,
      runId: context.run.id,
      stepId: context.stepId,
      kind: "log",
      title: `${level} 审批请求：${payload.action}`,
      summary: request.decision.reason,
      metadata: {
        approvalId: row.id,
        capability: payload.capability,
        toolName: request.toolName,
        args: excerptArgs(request.args),
      },
    });
    // Pause the run (idempotent across concurrent gates on the same run).
    const current = this.store.getRun(context.run.id);
    if (current?.status === "running") {
      this.store.transitionRun(context.run.id, "waiting_approval");
    }
    this.publish(context.task.id, {
      event: "task.run.waiting_approval",
      taskId: context.task.id,
      runId: context.run.id,
      approval: row,
    });
    return new Promise<ApprovalVerdict>((resolve) => {
      this.pending.set(row.id, {
        approvalId: row.id,
        runId: context.run.id,
        taskId: context.task.id,
        stepId: context.stepId,
        resolve,
      });
    });
  }

  /** approval.list: pending by default, enriched with task display data. */
  list(filter: { status?: "pending" | "all"; projectId?: string } = {}) {
    return this.store.listApprovals(filter);
  }

  /** approval.approve: decide approved; L2 may persist a 同类免问 grant. */
  approve(input: DecideInput): { approval: Approval; grant: PolicyGrant | null } {
    return this.decide(input, "approved");
  }

  /** approval.reject: decide denied; the model gets the note back. */
  reject(input: DecideInput): { approval: Approval; grant: PolicyGrant | null } {
    return this.decide(input, "denied");
  }

  private decide(
    input: DecideInput,
    status: "approved" | "denied",
  ): { approval: Approval; grant: PolicyGrant | null } {
    const existing = this.store.resolveApproval(input.approvalId);
    if (!existing) {
      throw new ApprovalError(
        "approval_not_found",
        `no approval matches '${input.approvalId}'`,
      );
    }
    let decided: Approval;
    try {
      decided = this.store.decideApproval(
        existing.id,
        status,
        input.decidedBy,
        input.note ?? null,
      );
    } catch (error) {
      throw new ApprovalError(
        "approval_conflict",
        error instanceof Error ? error.message : String(error),
      );
    }
    const level = levelOf(decided.capability);

    // L2 remember → durable per-project grant (同类免问). L3 is never
    // grantable: remember is silently meaningless there by design.
    let grant: PolicyGrant | null = null;
    if (status === "approved" && input.remember === true && level === "L2") {
      const task = this.store.getTask(decided.taskId);
      if (task) {
        grant = this.store.addPolicyGrant({
          projectId: task.projectId,
          grantKey: decided.capability,
          createdBy: input.decidedBy,
          note: `来自审批 ${decided.id}`,
        });
      }
    }

    // Decision provenance on the task evidence trail (可回放).
    const gate = this.pending.get(decided.id) ?? null;
    this.store.addEvidence({
      taskId: decided.taskId,
      runId: decided.runId,
      stepId: gate?.stepId ?? null,
      kind: "log",
      title: `${level} 审批${status === "approved" ? "通过" : "拒绝"}：${decided.action}`,
      summary: input.note ?? "",
      metadata: {
        approvalId: decided.id,
        capability: decided.capability,
        decidedBy: input.decidedBy,
        decidedAt: decided.decidedAt,
        note: input.note ?? null,
        grant: grant ? grant.grantKey : null,
        basedOn: { policyReason: decided.reason, action: decided.action },
      },
    });

    // Resume the run once no other gate still holds it.
    if (decided.runId) {
      const run = this.store.getRun(decided.runId);
      if (run?.status === "waiting_approval") {
        const othersHold = [...this.pending.values()].some(
          (g) => g.runId === run.id && g.approvalId !== decided.id,
        );
        if (!othersHold) {
          this.store.transitionRun(run.id, "running");
          this.publish(decided.taskId, {
            event: "task.run.resumed",
            taskId: decided.taskId,
            runId: run.id,
            approvalId: decided.id,
          });
        }
      }
    }
    this.publish(decided.taskId, {
      event: "task.run.approval_decided",
      taskId: decided.taskId,
      runId: decided.runId,
      approval: decided,
      grant,
    });

    if (gate) {
      this.pending.delete(decided.id);
      // Abort-vs-approve race (H3-adjacent): the owner approved, but the run
      // may have been aborted / budget-stopped while the decision was being
      // written. Never release the gate as "approved" into a terminal run —
      // the tool would execute after the abort landed. Resolve denied instead
      // so the kernel unblocks with a clear reason.
      const liveRun = decided.runId ? this.store.getRun(decided.runId) : null;
      const runStillLive =
        liveRun !== null &&
        !["completed", "failed", "cancelled"].includes(liveRun.status);
      if (status === "approved" && !runStillLive && liveRun) {
        gate.resolve({
          approved: false,
          note: `run ${decided.runId} already ended (${liveRun.status}); approval ${decided.id} recorded but not executed`,
        });
      } else {
        gate.resolve({
          approved: status === "approved",
          note:
            status === "approved"
              ? `审批通过（${input.decidedBy}）`
              : `审批拒绝（${input.decidedBy}）${input.note ? `：${input.note}` : ""}`,
        });
      }
    }
    return { approval: decided, grant };
  }

  /**
   * Abort/pause/budget-stop paths: settle every gate the run waits on as
   * denied so the kernel never hangs. The approval rows are decided by
   * "system" (留痕: the operation never ran); run-status transitions stay
   * with the caller.
   */
  cancelPendingForRun(runId: string, note: string): number {
    let cancelled = 0;
    for (const [approvalId, gate] of [...this.pending.entries()]) {
      if (gate.runId !== runId) continue;
      this.pending.delete(approvalId);
      try {
        this.store.decideApproval(approvalId, "denied", "system", note);
      } catch (error) {
        this.log(
          `approval ${approvalId}: cancel-decision failed: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      gate.resolve({ approved: false, note });
      cancelled += 1;
    }
    return cancelled;
  }

  /** Inspection seam (tests / status): live gates per run. */
  pendingCountForRun(runId: string): number {
    return [...this.pending.values()].filter((g) => g.runId === runId).length;
  }
}
