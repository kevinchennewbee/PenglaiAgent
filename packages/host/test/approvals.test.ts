/**
 * Approval service (审批四级制 L2/L3) — unit tests over a real ProductStore
 * (in-memory). The run pause/resume state machine, the decision provenance
 * (approvals row + evidence trail + product events), the 同类免问 grant,
 * and the abort-path gate settlement are all asserted on durable state.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ApprovalService, ApprovalError } from "../src/approvals.js";
import { checkPolicy } from "../src/policy.js";
import { ProductStore } from "../src/storage/product-store.js";
import type { ApprovalGateRequest } from "../src/approvals.js";
import type { PolicyDecision } from "../src/policy.js";

interface Fixture {
  store: ProductStore;
  service: ApprovalService;
  events: Array<{ taskId: string; event: string }>;
  project: ReturnType<ProductStore["createProject"]>;
  task: ReturnType<ProductStore["createTask"]>;
  run: ReturnType<ProductStore["createRun"]>;
  stepId: string;
  /** Real on-disk jail (policy containment realpaths through it). */
  workspace: string;
}

const cleanup: string[] = [];

function fixture(): Fixture {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-appr-ws-"));
  cleanup.push(workspace);
  fs.writeFileSync(path.join(workspace, "file.txt"), "hello\n");
  const store = new ProductStore(":memory:");
  const events: Array<{ taskId: string; event: string }> = [];
  const service = new ApprovalService(store, (taskId, event) => {
    events.push({ taskId, event: String((event as { event?: unknown }).event) });
  });
  const project = store.createProject({ name: "p", rootPath: workspace, trusted: true });
  const task = store.createTask({ projectId: project.id, title: "t", objective: "do things" });
  const run = store.createRun({ taskId: task.id, modelProfileId: "m" });
  store.transitionRun(run.id, "running");
  const step = store.createStep({ runId: run.id, title: "episode" });
  store.transitionStep(step.id, "running");
  return { store, service, events, project, task, run, stepId: step.id, workspace };
}

function l3Request(f: Fixture, command: string): ApprovalGateRequest {
  const decision = checkPolicy("bash", { command }, f.workspace) as PolicyDecision;
  if (!decision.approval) throw new Error(`expected an approval payload for: ${command}`);
  return { toolName: "bash", args: { command }, decision };
}

function l2EditRequest(f: Fixture, name = "file.txt"): ApprovalGateRequest {
  const decision = checkPolicy(
    "edit",
    { path: path.join(f.workspace, name), old_text: "a", new_text: "b" },
    f.workspace,
  );
  if (!decision.approval) throw new Error(`expected an approval payload for edit ${name}`);
  return { toolName: "edit", args: { path: path.join(f.workspace, name) }, decision };
}

describe("approval service: request → pause → decide → resume", () => {
  it("an L3 request pauses the run, records provenance, and approve resumes it", async () => {
    const f = fixture();
    const gate = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l3Request(f, "git push origin main"),
    );

    // The run paused and the request is fully recorded.
    expect(f.store.getRun(f.run.id)?.status).toBe("waiting_approval");
    const taskStatus = f.store.getTask(f.task.id);
    expect(taskStatus?.status).toBe("waiting_approval");
    const listed = f.service.list({ status: "pending" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      capability: "l3:outbound",
      requestedBy: `run:${f.run.id}`,
    });
    expect(listed[0].action).toContain("git push");
    const requestEvidence = f.store
      .getTaskBundle(f.task.id)!
      .evidence.find((e) => e.title.includes("审批请求"));
    expect(requestEvidence).toBeDefined();
    expect(f.events.map((e) => e.event)).toContain("task.run.waiting_approval");

    // Approve: the SAME run resumes and the gate resolves approved.
    const { approval, grant } = f.service.approve({
      approvalId: listed[0].id.slice(0, 8), // prefix resolution
      decidedBy: "cli:owner",
      note: "这个仓库是我的",
    });
    expect(approval.status).toBe("approved");
    expect(approval.decidedBy).toBe("cli:owner");
    expect(approval.decidedAt).not.toBeNull();
    expect(grant).toBeNull(); // L3 is never grantable
    await expect(gate).resolves.toMatchObject({ approved: true });
    expect(f.store.getRun(f.run.id)?.status).toBe("running");

    // Decision provenance: evidence trail + product events are replayable.
    const decisionEvidence = f.store
      .getTaskBundle(f.task.id)!
      .evidence.find((e) => e.title.includes("审批通过"));
    expect(decisionEvidence?.metadata).toMatchObject({
      approvalId: approval.id,
      decidedBy: "cli:owner",
    });
    const types = f.store.listEvents("approval", approval.id).map((e) => e.type);
    expect(types).toEqual(["approval.requested", "approval.approved"]);
    expect(f.events.map((e) => e.event)).toContain("task.run.resumed");
    expect(f.events.map((e) => e.event)).toContain("task.run.approval_decided");
    f.store.close();
  });

  it("reject resumes the run and hands the model a human-readable refusal", async () => {
    const f = fixture();
    const gate = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l3Request(f, "git push origin main"),
    );
    expect(f.store.getRun(f.run.id)?.status).toBe("waiting_approval");
    const [pending] = f.service.list();
    f.service.reject({ approvalId: pending.id, decidedBy: "cli:owner", note: "不准外发" });
    await expect(gate).resolves.toEqual({
      approved: false,
      note: "审批拒绝（cli:owner）：不准外发",
    });
    expect(f.store.getRun(f.run.id)?.status).toBe("running");
    const types = f.store.listEvents("approval", pending.id).map((e) => e.type);
    expect(types).toEqual(["approval.requested", "approval.denied"]);
    f.store.close();
  });

  it("L2 approve with remember persists the 同类免问 grant and policy honors it", async () => {
    const f = fixture();
    const gate = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l2EditRequest(f),
    );
    expect(f.store.getRun(f.run.id)?.status).toBe("waiting_approval");
    const [pending] = f.service.list();
    const { approval, grant } = f.service.approve({
      approvalId: pending.id,
      decidedBy: "cli:owner",
      remember: true,
    });
    expect(approval.capability).toBe("l2:modify-existing");
    expect(grant?.grantKey).toBe("l2:modify-existing");
    await expect(gate).resolves.toMatchObject({ approved: true });
    expect(f.store.hasPolicyGrant(f.project.id, "l2:modify-existing")).toBe(true);

    // The grant turns the same kind into L1 through the real policy gate.
    const again = checkPolicy(
      "edit",
      { path: path.join(f.workspace, "file.txt"), old_text: "a", new_text: "c" },
      f.workspace,
      { hasGrant: (key: string) => f.store.hasPolicyGrant(f.project.id, key) },
    );
    expect(again.allowed).toBe(true);
    f.store.close();
  });

  it("concurrent gates: the run resumes only after the last decision", async () => {
    const f = fixture();
    const gateA = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l3Request(f, "git push"),
    );
    const gateB = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l3Request(f, "ssh deploy@host uptime"),
    );
    expect(f.service.list()).toHaveLength(2);
    expect(f.store.getRun(f.run.id)?.status).toBe("waiting_approval");

    const pending = f.service.list();
    const a = pending.find((row) => row.action.includes("git push"))!;
    const b = pending.find((row) => row.action.includes("ssh"))!;
    f.service.approve({ approvalId: a.id, decidedBy: "cli:owner" });
    // One gate still holds the run.
    expect(f.store.getRun(f.run.id)?.status).toBe("waiting_approval");
    f.service.reject({ approvalId: b.id, decidedBy: "cli:owner" });
    expect(f.store.getRun(f.run.id)?.status).toBe("running");
    await expect(gateA).resolves.toMatchObject({ approved: true });
    await expect(gateB).resolves.toMatchObject({ approved: false });
    f.store.close();
  });

  it("abort settles waiting gates as denied (kernel never hangs)", async () => {
    const f = fixture();
    const gate = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l3Request(f, "git push"),
    );
    expect(f.service.list()).toHaveLength(1);
    const cancelled = f.service.cancelPendingForRun(f.run.id, "run aborted by owner");
    expect(cancelled).toBe(1);
    await expect(gate).resolves.toEqual({ approved: false, note: "run aborted by owner" });
    const row = f.store.listApprovals({ status: "all" })[0];
    expect(row.status).toBe("denied");
    expect(row.decidedBy).toBe("system");
    f.store.close();
  });

  it("deciding an unknown or already-decided approval raises coded errors", async () => {
    const f = fixture();
    expect(() => f.service.approve({ approvalId: "nope", decidedBy: "x" })).toThrow(ApprovalError);
    try {
      f.service.approve({ approvalId: "nope", decidedBy: "x" });
    } catch (error) {
      expect((error as ApprovalError).code).toBe("approval_not_found");
    }
    const gate = f.service.requestDecision(
      { task: f.task, run: f.run, project: f.project, stepId: f.stepId },
      l3Request(f, "git push"),
    );
    expect(f.service.list()).toHaveLength(1);
    const [pending] = f.service.list();
    f.service.approve({ approvalId: pending.id, decidedBy: "x" });
    try {
      f.service.reject({ approvalId: pending.id, decidedBy: "x" });
      expect.unreachable("second decide must throw");
    } catch (error) {
      expect((error as ApprovalError).code).toBe("approval_conflict");
    }
    await gate;
    f.store.close();
  });
});
