import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import {
  WORK_MAX_DURATION_MS,
  WORK_MAX_TOKENS,
  WORK_MAX_TOOL_FAILURES,
  WORK_MAX_TURNS,
} from "../src/policy.js";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";
import { ProductStore } from "../src/storage/product-store.js";
import { TaskRunner, type TaskKernelOptions } from "../src/task-runner.js";

class FakeKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "fake";
  isRunning = false;
  private listeners = new Set<KernelEventListener>();
  private settle!: () => void;
  private promptPromise = new Promise<void>((resolve) => {
    this.settle = resolve;
  });
  readonly abort = vi.fn(async () => this.settle());
  readonly steer = vi.fn(async () => undefined);
  readonly followUp = vi.fn(async () => undefined);
  readonly dispose = vi.fn(() => undefined);

  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    return this.promptPromise.finally(() => {
      this.isRunning = false;
    });
  }

  emit(
    event: Omit<KernelEvent, "occurredAt" | "sessionId" | "raw"> & {
      raw?: unknown;
    },
  ): void {
    const { raw, ...rest } = event;
    const full = {
      ...rest,
      occurredAt: Date.now(),
      sessionId: this.sessionId,
      raw: raw ?? rest,
    } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }

  complete(): void {
    this.settle();
  }
}

const profile: ModelProfile = {
  id: "test",
  label: "Test",
  provider: "custom",
  baseUrl: "https://example.invalid/v1",
  apiKeyEnv: "",
  model: "test-model",
  capabilities: { tools: true, streaming: true, vision: false },
};

const taskWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-task-runner-root-"));
afterAll(() => fs.rmSync(taskWorkspace, { recursive: true, force: true }));

function setup() {
  const store = new ProductStore(":memory:");
  const project = store.createProject({
    name: "trusted",
    rootPath: taskWorkspace,
    trusted: true,
  });
  const task = store.createTask({
    projectId: project.id,
    title: "Run Pi",
    objective: "Complete a real task",
  });
  return { store, project, task };
}

describe("TaskRunner", () => {
  it("maps one Pi episode into durable run, step, and evidence", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const publish = vi.fn();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel, publish);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    kernel.emit({
      kind: "message.delta",
      textDelta: "Verified response",
    });
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "call-1",
      toolName: "bash",
      isError: false,
    });
    kernel.complete();
    await runner.wait(run.id);

    const bundle = store.getTaskBundle(task.id);
    expect(bundle?.task.status).toBe("completed");
    expect(bundle?.runs[0].status).toBe("completed");
    expect(bundle?.steps[0]).toMatchObject({
      status: "completed",
      summary: "Pi episode settled",
    });
    expect(bundle?.evidence.map((item) => item.kind)).toEqual(["command", "log"]);
    expect(kernel.dispose).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ event: "task.run.completed" }),
    );
    expect(
      publish.mock.calls.some(([, event]) =>
        Object.prototype.hasOwnProperty.call(event, "raw"),
      ),
    ).toBe(false);
    store.close();
  });

  it("cancels the Pi kernel and records a terminal cancelled run", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    expect(await runner.abort(run.id)).toBe(true);
    await runner.wait(run.id);
    expect(store.getRun(run.id)?.status).toBe("cancelled");
    expect(kernel.abort).toHaveBeenCalledOnce();
    store.close();
  });

  it("refuses execution before an explicit project trust decision", async () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "untrusted", rootPath: "/tmp/untrusted" });
    const task = store.createTask({
      projectId: project.id,
      title: "No implicit trust",
      objective: "Must not run",
    });
    const factory = vi.fn(async () => new FakeKernel());
    const runner = new TaskRunner(store, "/tmp/data", factory);
    await expect(
      runner.start({
        task,
        project,
        profile,
        apiKey: "secret",
        source: "desktop",
        mode: "work",
      }),
    ).rejects.toThrow("not trusted");
    expect(factory).not.toHaveBeenCalled();
    expect(store.getTaskBundle(task.id)?.runs).toEqual([]);
    store.close();
  });

  it("fails a missing workspace without leaving a durable run active", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-task-missing-start-"));
    const missingRoot = path.join(parent, "not-created");
    const store = new ProductStore(":memory:");
    const project = store.createProject({
      name: "missing-at-start",
      rootPath: missingRoot,
      trusted: true,
    });
    const task = store.createTask({
      projectId: project.id,
      title: "Missing workspace",
      objective: "Fail closed before kernel assembly",
    });
    const factory = vi.fn(async () => new FakeKernel());
    const runner = new TaskRunner(store, "/tmp/data", factory);
    try {
      await expect(
        runner.start({
          task,
          project,
          profile,
          apiKey: "secret",
          source: "desktop",
          mode: "work",
        }),
      ).rejects.toMatchObject({ code: "authority_changed" });
      expect(factory).not.toHaveBeenCalled();
      const runs = store.getTaskBundle(task.id)?.runs ?? [];
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: "failed",
      });
      expect(runs[0]?.error).toContain("workspace authority is unavailable");
      expect(runs[0]?.finishedAt).not.toBeNull();
      expect(store.getTaskBundle(task.id)?.task.status).toBe("failed");
      expect(store.getTaskBundle(task.id)?.steps).toEqual([]);
      await expect(runner.wait(runs[0]!.id)).resolves.toBeUndefined();
      await expect(runner.abort(runs[0]!.id)).resolves.toBe(false);
      await runner.shutdown();
    } finally {
      store.close();
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("allows only one active run per task", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const first = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    await expect(
      runner.start({
        task,
        project,
        profile,
        apiKey: "secret",
        source: "desktop",
        mode: "work",
      }),
    ).rejects.toThrow("already has an active run");
    expect(store.getTaskBundle(task.id)?.runs).toHaveLength(1);
    kernel.complete();
    await runner.wait(first.id);
    store.close();
  });

  it("revalidates live project trust before TaskRunner followUp", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    store.setProjectTrusted(project.id, false);

    await expect(runner.followUp(run.id, "must fail closed")).rejects.toMatchObject({
      code: "authority_changed",
    });
    expect(kernel.followUp).not.toHaveBeenCalled();
    expect(kernel.abort).toHaveBeenCalledOnce();
    expect(store.getRun(run.id)?.status).toBe("cancelled");
    store.close();
  });

  it("wires TaskRunner authority revalidation into every Pi tool call", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    let kernelOptions: TaskKernelOptions | null = null;
    const runner = new TaskRunner(store, "/tmp/data", async (options) => {
      kernelOptions = options;
      return kernel;
    });
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    store.setProjectTrusted(project.id, false);

    await expect(
      Promise.resolve().then(() => kernelOptions?.revalidateAuthority?.()),
    ).rejects.toMatchObject({ code: "authority_changed" });
    await runner.wait(run.id);
    expect(kernel.abort).toHaveBeenCalledOnce();
    expect(store.getRun(run.id)?.status).toBe("cancelled");
    store.close();
  });

  it.skipIf(process.platform === "win32")(
    "revokes a task when its trusted root is replaced by a same-name symlink",
    async () => {
      const declaredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-task-declared-"));
      const replacementRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "penglai-task-replacement-"),
      );
      const movedRoot = `${declaredRoot}-moved`;
      fs.writeFileSync(path.join(replacementRoot, "sentinel.txt"), "REPLACEMENT_ROOT_SENTINEL");
      const store = new ProductStore(":memory:");
      const project = store.createProject({
        name: "replaceable",
        rootPath: declaredRoot,
        trusted: true,
      });
      const task = store.createTask({
        projectId: project.id,
        title: "Root substitution",
        objective: "Never follow a replacement root",
      });
      const kernel = new FakeKernel();
      const capture: { options?: TaskKernelOptions } = {};
      const runner = new TaskRunner(store, "/tmp/data", async (options) => {
        capture.options = options;
        return kernel;
      });
      try {
        const run = await runner.start({
          task,
          project,
          profile,
          apiKey: "secret",
          source: "desktop",
          mode: "work",
        });
        expect(capture.options?.workspaceRoot).toBe(fs.realpathSync(declaredRoot));

        fs.renameSync(declaredRoot, movedRoot);
        fs.symlinkSync(replacementRoot, declaredRoot, "dir");

        await expect(
          Promise.resolve().then(() => capture.options?.revalidateAuthority?.()),
        ).rejects.toMatchObject({ code: "authority_changed" });
        await runner.wait(run.id);
        expect(kernel.abort).toHaveBeenCalledOnce();
        expect(store.getRun(run.id)?.status).toBe("cancelled");
        expect(capture.options?.workspaceRoot).not.toBe(fs.realpathSync(replacementRoot));
      } finally {
        try {
          if (fs.lstatSync(declaredRoot).isSymbolicLink()) fs.unlinkSync(declaredRoot);
        } catch {
          /* already absent */
        }
        if (fs.existsSync(movedRoot)) fs.renameSync(movedRoot, declaredRoot);
        fs.rmSync(declaredRoot, { recursive: true, force: true });
        fs.rmSync(replacementRoot, { recursive: true, force: true });
        store.close();
      }
    },
  );

  it("revokes a task when the trusted root disappears", async () => {
    const declaredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-task-missing-"));
    const store = new ProductStore(":memory:");
    const project = store.createProject({
      name: "missing",
      rootPath: declaredRoot,
      trusted: true,
    });
    const task = store.createTask({
      projectId: project.id,
      title: "Missing root",
      objective: "Fail closed",
    });
    const kernel = new FakeKernel();
    let kernelOptions: TaskKernelOptions | null = null;
    const runner = new TaskRunner(store, "/tmp/data", async (options) => {
      kernelOptions = options;
      return kernel;
    });
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    fs.rmSync(declaredRoot, { recursive: true, force: true });
    await expect(
      Promise.resolve().then(() => kernelOptions?.revalidateAuthority?.()),
    ).rejects.toMatchObject({ code: "authority_changed" });
    await runner.wait(run.id);
    expect(kernel.abort).toHaveBeenCalledOnce();
    expect(store.getRun(run.id)?.status).toBe("cancelled");
    store.close();
  });
});

describe("TaskRunner bounded episodes (design §5)", () => {
  function assistantUsage(input: number, output: number): unknown {
    return {
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input, output, cacheRead: 0, cacheWrite: 0 },
      },
    };
  }

  it("records the policy-profile budget ceiling on the run for audit", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    expect(run.budget.maxTurns).toBe(WORK_MAX_TURNS);
    expect(run.budget.maxDurationMs).toBe(WORK_MAX_DURATION_MS);
    expect(run.budget.maxTokens).toBe(WORK_MAX_TOKENS);
    expect(run.budget.maxToolFailures).toBe(WORK_MAX_TOOL_FAILURES);
    kernel.complete();
    await runner.wait(run.id);
    store.close();
  });

  it("stops at the turn ceiling, writes a checkpoint, and blocks the run", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const publish = vi.fn();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel, publish);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
      budget: { maxTurns: 2 },
    });
    kernel.emit({ kind: "turn.completed" });
    kernel.emit({ kind: "turn.completed" });
    await runner.wait(run.id);

    const blocked = store.getRun(run.id);
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.error).toContain("turn budget exhausted (2/2)");
    const bundle = store.getTaskBundle(task.id);
    expect(bundle?.task.status).toBe("blocked");
    expect(bundle?.steps[0].status).toBe("blocked");
    const checkpoint = bundle?.evidence.find((e) =>
      e.title.includes("Checkpoint"),
    );
    expect(checkpoint?.summary).toContain("turns=2/2");
    expect(kernel.abort).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ event: "task.run.blocked" }),
    );
    store.close();
  });

  it("stops at the tool-failure ceiling", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
      budget: { maxToolFailures: 2 },
    });
    kernel.emit({ kind: "tool.completed", toolCallId: "1", toolName: "read", isError: true });
    kernel.emit({ kind: "tool.completed", toolCallId: "2", toolName: "bash", isError: true });
    await runner.wait(run.id);
    expect(store.getRun(run.id)?.error).toContain("tool-failure budget exhausted (2/2)");
    store.close();
  });

  it("stops at the token ceiling when the provider reports usage", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
      budget: { maxTokens: 100 },
    });
    kernel.emit({ kind: "message.completed", raw: assistantUsage(60, 50) });
    kernel.emit({ kind: "message.completed", raw: assistantUsage(60, 50) });
    await runner.wait(run.id);
    expect(store.getRun(run.id)?.error).toContain("token budget exhausted (110/100)");
    store.close();
  });

  it("stops at the duration ceiling", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
      budget: { maxDurationMs: 25 },
    });
    await runner.wait(run.id);
    expect(store.getRun(run.id)?.error).toContain("duration budget exhausted (25ms)");
    store.close();
  });

  it("reports per-episode token usage to the host sink", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const onUsage = vi.fn();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel, () => {}, {
      onUsage,
    });
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    kernel.emit({ kind: "message.completed", raw: assistantUsage(120, 80) });
    kernel.complete();
    await runner.wait(run.id);
    expect(store.getRun(run.id)?.status).toBe("completed");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      runId: run.id,
      taskId: task.id,
      mode: "work",
      projectId: project.id,
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
    }));
    store.close();
  });

  it("H3: settling an externally-cancelled run does not crash and keeps terminal state", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel, () => {});
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    // External run.transition moves the run to a terminal state while the
    // episode is still finishing. The settle path must not throw (which would
    // be an unhandled rejection / process crash); the terminal state stays.
    store.transitionRun(run.id, "cancelled", "cancelled externally");
    kernel.complete();
    await runner.wait(run.id);
    expect(store.getRun(run.id)?.status).toBe("cancelled");
    expect(store.getRun(run.id)?.error).toContain("cancelled externally");
    store.close();
  });

  it("H3: settling a run whose step already failed keeps both terminal states", async () => {
    const { store, project, task } = setup();
    const kernel = new FakeKernel();
    const runner = new TaskRunner(store, "/tmp/data", async () => kernel, () => {});
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    const step = store.getTaskBundle(task.id)?.steps[0];
    if (!step) throw new Error("expected a step");
    store.transitionStep(step.id, "failed", "step failed externally");
    // Episode still finishes: the run may settle to completed while the step
    // keeps its earlier terminal state - no crash, no state-machine violation.
    kernel.complete();
    await runner.wait(run.id);
    expect(store.getStep(step.id)?.status).toBe("failed");
    store.close();
  });

  it("rejects a same-tick concurrent second start for the same task", async () => {
    const { store, project, task } = setup();
    let gates = 0;
    const runner = new TaskRunner(
      store,
      "/tmp/data",
      async () => new FakeKernel(),
      () => {},
      {
        // Hold the pre-flight gate open so both starts overlap in the same
        // tick before either marks the task active.
        preFlightApproval: async () => {
          gates += 1;
          await new Promise((r) => setTimeout(r, 10));
          return { approved: true, note: "ok" };
        },
      },
    );
    const [a, b] = await Promise.allSettled([
      runner.start({ task, project, profile, apiKey: "secret", source: "desktop", mode: "work" }),
      runner.start({ task, project, profile, apiKey: "secret", source: "desktop", mode: "work" }),
    ]);
    // Exactly one start proceeds; the second is rejected by the starting guard.
    expect(gates).toBe(1);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
    if (b.status === "rejected") {
      expect(String(b.reason)).toContain("already starting");
    }
    store.close();
  });
});
