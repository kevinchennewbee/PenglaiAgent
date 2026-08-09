import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProductStore } from "../src/storage/product-store.js";

const cleanup: string[] = [];

function temporaryDatabase(): { directory: string; filename: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-store-"));
  cleanup.push(directory);
  return { directory, filename: path.join(directory, "product.db") };
}

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProductStore", () => {
  it("persists Project -> Task -> Run -> Step -> Evidence across restart", () => {
    const { filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    const project = store.createProject({
      name: "PenglaiAgent",
      rootPath: "/tmp/PenglaiAgent",
      repositoryUrl: "https://github.com/example/PenglaiAgent",
      repositoryBranch: "0.4.0",
      trusted: true,
    });
    const task = store.createTask({
      projectId: project.id,
      title: "Build the durable workbench",
      objective: "Persist product work independently from the agent engine.",
      acceptanceCriteria: ["survives restart", "preserves evidence"],
    });
    const run = store.createRun({
      taskId: task.id,
      modelProfileId: "openai-compatible",
      budget: { maxToolFailures: 2 },
    });
    const step = store.createStep({
      runId: run.id,
      title: "Create schema",
    });
    const runningRun = store.transitionRun(run.id, "running");
    const runningStep = store.transitionStep(step.id, "running");
    const completedStep = store.transitionStep(runningStep.id, "completed", "Schema verified");
    const completedRun = store.transitionRun(runningRun.id, "completed");
    const evidence = store.addEvidence({
      taskId: task.id,
      runId: run.id,
      stepId: step.id,
      kind: "test",
      title: "Storage test passed",
      metadata: { command: "npm test" },
    });
    const pending = store.requestApproval({
      taskId: task.id,
      runId: run.id,
      capability: "external_write",
      action: "push branch",
      reason: "Publish the verified work",
      requestedBy: "agent",
    });
    const approval = store.decideApproval(pending.id, "approved", "owner", "ship it");
    store.close();

    const reopened = new ProductStore(filename);
    expect(reopened.listProjects()).toEqual([project]);
    expect(reopened.listTasks(project.id)[0]).toMatchObject({
      id: task.id,
      status: "completed",
    });
    const bundle = reopened.getTaskBundle(task.id);
    expect(bundle?.task).toMatchObject({ id: task.id, status: "completed" });
    expect(bundle?.task.completedAt).not.toBeNull();
    expect(bundle?.runs).toEqual([completedRun]);
    expect(bundle?.steps).toEqual([completedStep]);
    expect(bundle?.evidence).toEqual([evidence]);
    expect(bundle?.approvals).toEqual([approval]);
    expect(reopened.listEvents("task", task.id).map((event) => event.type)).toEqual([
      "task.created",
      "task.status_changed",
      "task.status_changed",
    ]);
    reopened.close();
  });

  it("uses restrictive filesystem permissions for local product data", () => {
    const { directory, filename } = temporaryDatabase();
    fs.chmodSync(directory, 0o755);
    const store = new ProductStore(filename);
    store.close();
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  });

  it("keeps the first task completion timestamp across later runs", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({
      name: "completed-at",
      rootPath: "/tmp/completed-at",
      trusted: true,
    });
    const task = store.createTask({
      projectId: project.id,
      title: "finish once",
      objective: "complete a task",
    });
    const firstRun = store.createRun({ taskId: task.id, modelProfileId: "test" });
    store.transitionRun(firstRun.id, "running");
    store.transitionRun(firstRun.id, "completed");
    const firstCompletedAt = store.getTask(task.id)?.completedAt;
    expect(firstCompletedAt).not.toBeNull();

    // A second run on the same task must not clear the original completion
    // record (semantics parity with setTaskStatus, H3-adjacent fix).
    const secondRun = store.createRun({ taskId: task.id, modelProfileId: "test" });
    store.transitionRun(secondRun.id, "running");
    store.transitionRun(secondRun.id, "failed", "second run failed");
    expect(store.getTask(task.id)?.completedAt).toBe(firstCompletedAt);
    store.close();
  });

  it("turns interrupted runs into explicit failures on restart", () => {
    const { filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    const project = store.createProject({
      name: "recovery",
      rootPath: "/tmp/recovery",
      trusted: true,
    });
    const task = store.createTask({
      projectId: project.id,
      title: "survive a crash",
      objective: "never stay falsely active",
    });
    const run = store.createRun({ taskId: task.id, modelProfileId: "test" });
    const step = store.createStep({ runId: run.id, title: "in flight" });
    store.transitionRun(run.id, "running");
    store.transitionStep(step.id, "running");
    store.close();

    const reopened = new ProductStore(filename);
    const bundle = reopened.getTaskBundle(task.id);
    expect(bundle?.task.status).toBe("failed");
    expect(bundle?.runs[0]).toMatchObject({
      status: "failed",
      error: "Interrupted by previous Host shutdown",
    });
    expect(bundle?.steps[0]).toMatchObject({
      status: "failed",
      summary: "Interrupted by previous Host shutdown",
    });
    expect(reopened.listEvents("run", run.id).at(-1)?.type).toBe(
      "run.recovered_as_failed",
    );
    reopened.close();
  });

  it("rejects duplicate workspace bindings and stale approval decisions", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "one", rootPath: "/tmp/one" });
    expect(() =>
      store.createProject({ name: "duplicate", rootPath: "/tmp/one" }),
    ).toThrow();
    const task = store.createTask({
      projectId: project.id,
      title: "approval",
      objective: "test one-shot decisions",
    });
    const approval = store.requestApproval({
      taskId: task.id,
      capability: "network",
      action: "send",
      reason: "required",
      requestedBy: "agent",
    });
    store.decideApproval(approval.id, "denied", "owner");
    expect(() => store.decideApproval(approval.id, "approved", "owner")).toThrow(
      "already decided",
    );
    store.close();
  });

  it("enforces state machines, relational evidence, and append-only events", () => {
    const store = new ProductStore(":memory:");
    const firstProject = store.createProject({ name: "first", rootPath: "/tmp/first" });
    const secondProject = store.createProject({ name: "second", rootPath: "/tmp/second" });
    const firstTask = store.createTask({
      projectId: firstProject.id,
      title: "first task",
      objective: "own the run",
    });
    const secondTask = store.createTask({
      projectId: secondProject.id,
      title: "second task",
      objective: "must not borrow the run",
    });
    const run = store.createRun({ taskId: firstTask.id, modelProfileId: "test" });
    expect(() => store.transitionRun(run.id, "completed")).toThrow(
      "queued -> completed",
    );
    expect(() =>
      store.addEvidence({
        taskId: secondTask.id,
        runId: run.id,
        kind: "log",
        title: "invalid relationship",
      }),
    ).toThrow("relationship is invalid");
    expect(() =>
      store.database.prepare("DELETE FROM product_events").run(),
    ).toThrow("append-only");
    store.close();
  });

  it("round-trips the per-run turn budget", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "budget", rootPath: "/tmp/budget" });
    const task = store.createTask({
      projectId: project.id,
      title: "bounded episode",
      objective: "stop at the ceiling",
    });
    const run = store.createRun({
      taskId: task.id,
      modelProfileId: "test",
      budget: { maxTurns: 7, maxDurationMs: 60_000 },
    });
    expect(store.getRun(run.id)?.budget).toEqual({
      maxDurationMs: 60_000,
      maxTokens: null,
      maxToolFailures: 3,
      maxTurns: 7,
    });
    store.close();
  });

  it("transitions a task directly and stamps completion time once", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "mode", rootPath: "/tmp/mode" });
    const task = store.createTask({
      projectId: project.id,
      title: "anchored task",
      objective: "grow out of chat",
    });
    const completed = store.setTaskStatus(task.id, "completed");
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
    const paused = store.setTaskStatus(task.id, "blocked");
    expect(paused.status).toBe("blocked");
    // A later non-completed transition must not erase the completion stamp.
    expect(paused.completedAt).toBe(completed.completedAt);
    expect(
      store.listEvents("task", task.id).filter((e) => e.type === "task.status_changed"),
    ).toHaveLength(2);
    expect(() => store.setTaskStatus("missing", "completed")).toThrow("task not found");
    store.close();
  });
});

describe("ProductStore: policy grants + approval queries (schema v4)", () => {
  it("persists per-project L2 grants with an append-only project event", () => {
    const { filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    const project = store.createProject({ name: "g", rootPath: "/tmp/grants" });
    const grant = store.addPolicyGrant({
      projectId: project.id,
      grantKey: "l2:modify-existing",
      createdBy: "cli:owner",
      note: "来自审批 abc",
    });
    expect(grant.grantKey).toBe("l2:modify-existing");
    expect(store.hasPolicyGrant(project.id, "l2:modify-existing")).toBe(true);
    expect(store.hasPolicyGrant(project.id, "l2:install-deps")).toBe(false);
    expect(() =>
      store.addPolicyGrant({
        projectId: project.id,
        grantKey: "l3:outbound",
        createdBy: "malformed-caller",
      }),
    ).toThrow("only l2 policy grants");
    expect(store.hasPolicyGrant(project.id, "l3:outbound")).toBe(false);
    // Upsert: same (project, key) refreshes instead of duplicating.
    store.addPolicyGrant({
      projectId: project.id,
      grantKey: "l2:modify-existing",
      createdBy: "cli:owner",
    });
    expect(store.listPolicyGrants(project.id)).toHaveLength(1);
    // Survives reopen.
    store.close();
    const reopened = new ProductStore(filename);
    expect(reopened.hasPolicyGrant(project.id, "l2:modify-existing")).toBe(true);
    const events = reopened
      .listEvents("project", project.id)
      .filter((e) => e.type === "project.policy_grant.added");
    expect(events).toHaveLength(2);
    reopened.close();
  });

  it("lists approvals enriched with task data and resolves id prefixes", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "a", rootPath: "/tmp/appr" });
    const taskA = store.createTask({ projectId: project.id, title: "task A", objective: "o" });
    const taskB = store.createTask({ projectId: project.id, title: "task B", objective: "o" });
    const first = store.requestApproval({
      taskId: taskA.id, capability: "l3:outbound", action: "bash: git push",
      reason: "r", requestedBy: "run:x",
    });
    const second = store.requestApproval({
      taskId: taskB.id, capability: "l2:install-deps", action: "bash: npm install",
      reason: "r", requestedBy: "run:y",
    });
    const pending = store.listApprovals({ status: "pending" });
    expect(pending).toHaveLength(2);
    expect(pending.map((a) => a.taskTitle).sort()).toEqual(["task A", "task B"]);
    expect(pending[0].projectId).toBe(project.id);
    store.decideApproval(first.id, "approved", "cli:owner");
    expect(store.listApprovals({ status: "pending" })).toHaveLength(1);
    expect(store.listApprovals({ status: "all" })).toHaveLength(2);
    // Prefix resolution: unique prefix resolves, ambiguous throws.
    expect(store.resolveApproval(second.id.slice(0, 8))?.id).toBe(second.id);
    expect(store.resolveApproval("nonexistent")).toBeNull();
    store.close();
  });

  it("expires orphaned pending approvals at boot (host restarted mid-gate)", () => {
    const { filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    const project = store.createProject({ name: "e", rootPath: "/tmp/expire" });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    const approval = store.requestApproval({
      taskId: task.id, capability: "l3:outbound", action: "bash: curl x",
      reason: "r", requestedBy: "run:z",
    });
    store.close();
    // Simulated crash/restart: the pending gate's waiter is gone.
    const reopened = new ProductStore(filename);
    const expired = reopened.getApproval(approval.id);
    expect(expired?.status).toBe("expired");
    expect(expired?.decisionNote).toMatch(/expired/i);
    expect(
      reopened.listEvents("approval", approval.id).map((e) => e.type),
    ).toContain("approval.expired");
    // Already-decided rows are untouched.
    expect(reopened.listApprovals({ status: "pending" })).toHaveLength(0);
    reopened.close();
  });
});
