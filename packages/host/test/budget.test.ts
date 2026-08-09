/**
 * Budget circuit-breaker tests (成本熔断, design §7 成本可见性).
 *
 * Covers the BudgetService on the durable ledger (config, 80% warnings,
 * 100% trips, gates, owner lift, day rollover), the TaskRunner pre-flight
 * L3 gate (approval-mode degradation). No real model anywhere: kernels are
 * in-memory fakes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { BudgetService, projectDimension } from "../src/budget.js";
import { ProductStore } from "../src/storage/product-store.js";
import { TaskRunner } from "../src/task-runner.js";
import type { AgentKernel, KernelEventListener, KernelPrompt } from "../src/kernel/kernel.js";

const DAY = "2026-07-28";

function setup(overrides: { now?: number } = {}) {
  const store = new ProductStore(":memory:");
  const published: Array<{ channelId: string; payload: any }> = [];
  const service = new BudgetService(store, {
    publish: (channelId, payload) => published.push({ channelId, payload }),
    day: () => DAY,
  });
  const recordWork = (projectId: string, tokens: number, requests = 1) => {
    store.recordUsage({
      day: DAY,
      mode: "work",
      projectId,
      inputTokens: tokens,
      outputTokens: 0,
      requests,
    });
    service.recordAndCheck({ mode: "work", projectId, channelId: `task-${projectId}` });
  };
  const recordChat = (tokens: number) => {
    store.recordUsage({
      day: DAY,
      mode: "chat",
      projectId: "",
      inputTokens: tokens,
      outputTokens: 0,
      requests: 1,
    });
    service.recordAndCheck({ mode: "chat", projectId: "", channelId: "conv-1" });
  };
  return { store, service, published, recordWork, recordChat };
}

describe("BudgetService（成本熔断）", () => {
  it("默认无上限：config 为空、记账不预警不撞线", () => {
    const { service, recordWork, published } = setup();
    expect(service.getConfig()).toMatchObject({
      dailyTokenLimit: null,
      projectDailyTokenLimit: null,
    });
    recordWork("p1", 999_999);
    expect(published).toEqual([]);
    expect(service.gateForChat().tripped).toBe(false);
    expect(service.gateForTaskStart("p1").tripped).toBe(false);
  });

  it("80% 预警一次（不重复播报），100% 撞线一次并降级", () => {
    const { service, recordChat, published } = setup();
    service.setConfig({
      dailyTokenLimit: 1000,
      projectDailyTokenLimit: null,
      updatedBy: "test",
    });

    recordChat(500); // 50% — 静默
    expect(published).toEqual([]);

    recordChat(350); // 85% — 预警
    const warnings = published.filter(
      (p) => p.payload.event === "budget.warning" && p.channelId === "budget",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].payload).toMatchObject({ dimension: "day", day: DAY });
    expect(warnings[0].payload.message).toContain("85%");
    // 同一条预警也播到了会话频道（owner 正在聊的面）。
    expect(
      published.some(
        (p) => p.payload.event === "budget.warning" && p.channelId === "conv-1",
      ),
    ).toBe(true);

    recordChat(50); // 90% — 不重复预警
    expect(
      published.filter(
        (p) => p.payload.event === "budget.warning" && p.channelId === "budget",
      ),
    ).toHaveLength(1);

    recordChat(120); // 102% — 撞线
    const trips = published.filter(
      (p) => p.payload.event === "budget.tripped" && p.channelId === "budget",
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].payload.message).toContain("降级为审批模式");
    expect(service.gateForChat().tripped).toBe(true);
    expect(service.gateForChat().message).toContain("budget_exceeded");
    expect(service.gateForTaskStart("any-project").tripped).toBe(true);

    recordChat(500); // 已撞线 — 不重复撞线播报
    expect(
      published.filter(
        (p) => p.payload.event === "budget.tripped" && p.channelId === "budget",
      ),
    ).toHaveLength(1);

    // breaker 行留痕：预警与撞线时间、撞线时用量。
    const breaker = service.status(DAY).dimensions.find((d) => d.dimension === "day")!;
    expect(breaker.warned).toBe(true);
    expect(breaker.tripped).toBe(true);
    expect(breaker.lifted).toBe(false);
  });

  it("项目日维度独立熔断：chat 门不受影响，同项目 task 门撞线", () => {
    const { service, recordWork } = setup();
    service.setConfig({
      dailyTokenLimit: null,
      projectDailyTokenLimit: 100,
      updatedBy: "test",
    });
    recordWork("proj-a", 120); // 120% — 项目维度撞线
    expect(service.gateForTaskStart("proj-a").tripped).toBe(true);
    expect(service.gateForTaskStart("proj-a").dimension).toBe(projectDimension("proj-a"));
    expect(service.gateForTaskStart("proj-b").tripped).toBe(false);
    expect(service.gateForChat().tripped).toBe(false);
  });

  it("lift 放行：撞线维度恢复，留痕 liftedBy/note；幂等", () => {
    const { service, recordChat, published, store } = setup();
    service.setConfig({ dailyTokenLimit: 100, projectDailyTokenLimit: null, updatedBy: "test" });
    recordChat(150);
    expect(service.gateForChat().tripped).toBe(true);

    const lifted = service.lift({ dimension: "all", liftedBy: "cli:owner", note: "今天特殊" });
    expect(lifted).toHaveLength(1);
    expect(lifted[0]).toMatchObject({ dimension: "day", liftedBy: "cli:owner", liftNote: "今天特殊" });
    expect(service.gateForChat().tripped).toBe(false);
    expect(published.some((p) => p.payload.event === "budget.lifted")).toBe(true);

    // 幂等：已放行的维度不再 lift。
    expect(service.lift({ dimension: "all", liftedBy: "cli:owner" })).toEqual([]);
    // 撞线后新增的用量不会重新触发「首次撞线」播报（同一天的熔断态保持）。
    recordChat(50);
    expect(service.gateForChat().tripped).toBe(false);
    // breaker 行仍在（当天 provenance 不丢）。
    expect(store.getBudgetBreaker("day", DAY)?.liftedBy).toBe("cli:owner");
  });

  it("新的一天重新计数：昨日撞线不影响今日", () => {
    const store = new ProductStore(":memory:");
    let day = "2026-07-28";
    const service = new BudgetService(store, { day: () => day });
    service.setConfig({ dailyTokenLimit: 100, projectDailyTokenLimit: null, updatedBy: "test" });
    store.recordUsage({ day, mode: "chat", projectId: "", inputTokens: 200, outputTokens: 0 });
    service.recordAndCheck({ mode: "chat", projectId: "" });
    expect(service.gateForChat().tripped).toBe(true);

    day = "2026-07-29";
    expect(service.gateForChat().tripped).toBe(false);
    const status = service.status();
    expect(status.day).toBe("2026-07-29");
    expect(status.dimensions.find((d) => d.dimension === "day")?.tripped).toBe(false);
  });

  it("breaker 行持久化：重开数据库后撞线状态仍在（同一本地日）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-budget-"));
    try {
      const dbPath = path.join(dir, "product.db");
      const store1 = new ProductStore(dbPath);
      const service1 = new BudgetService(store1, { day: () => DAY });
      service1.setConfig({ dailyTokenLimit: 100, projectDailyTokenLimit: null, updatedBy: "test" });
      store1.recordUsage({ day: DAY, mode: "chat", projectId: "", inputTokens: 150, outputTokens: 0 });
      service1.recordAndCheck({ mode: "chat", projectId: "" });
      store1.close();

      const store2 = new ProductStore(dbPath);
      const service2 = new BudgetService(store2, { day: () => DAY });
      expect(service2.getConfig().dailyTokenLimit).toBe(100);
      expect(service2.gateForChat().tripped).toBe(true);
      store2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── TaskRunner pre-flight（task.start 降级为 L3 审批） ──────────

class FakeKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "budget-preflight";
  isRunning = false;
  readonly abort = vi.fn(async () => undefined);
  readonly steer = vi.fn(async () => undefined);
  readonly followUp = vi.fn(async () => undefined);
  readonly dispose = vi.fn(() => undefined);
  subscribe(_listener: KernelEventListener): () => void {
    return () => undefined;
  }
  async prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    this.isRunning = false;
  }
}

class DeferredKernel extends FakeKernel {
  private finishPrompt!: () => void;
  private readonly promptSettlement = new Promise<void>((resolve) => {
    this.finishPrompt = resolve;
  });

  override async prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    await this.promptSettlement;
    this.isRunning = false;
  }

  complete(): void {
    this.finishPrompt();
  }
}

const workProfile: ModelProfile = {
  id: "test",
  label: "Test",
  provider: "custom",
  baseUrl: "https://example.invalid/v1",
  apiKeyEnv: "",
  model: "test-model",
  capabilities: { tools: true, streaming: true, vision: false },
};

describe("TaskRunner 预算前置门（approval-mode degradation）", () => {
  const taskDirectories: string[] = [];

  afterEach(() => {
    for (const directory of taskDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function taskSetup() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-budget-task-"));
    taskDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "p", rootPath: workspaceRoot, trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "do it" });
    return { store, project, task, dataDir: path.join(directory, "data") };
  }

  it("前置门批准 → 内核照常构建执行", async () => {
    const { store, project, task, dataDir } = taskSetup();
    const kernel = new FakeKernel();
    const preFlight = vi.fn(async () => ({ approved: true, note: "" }));
    const runner = new TaskRunner(store, dataDir, async () => kernel, () => {}, {
      preFlightApproval: preFlight,
    });
    const run = await runner.start({
      task, project, profile: workProfile, apiKey: "k", source: "cli", mode: "work",
    });
    await runner.wait(run.id);
    expect(preFlight).toHaveBeenCalledOnce();
    expect(store.getRun(run.id)?.status).toBe("completed");
  });

  it("wait 跨过前置门后继续等待真实 episode 收敛", async () => {
    const { store, project, task, dataDir } = taskSetup();
    const kernel = new DeferredKernel();
    const runner = new TaskRunner(store, dataDir, async () => kernel, () => {}, {
      preFlightApproval: async () => ({ approved: true, note: "" }),
    });
    const run = await runner.start({
      task, project, profile: workProfile, apiKey: "k", source: "cli", mode: "work",
    });
    let waitSettled = false;
    const waiting = runner.wait(run.id).then(() => {
      waitSettled = true;
    });
    for (let i = 0; i < 20 && !kernel.isRunning; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(kernel.isRunning).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(waitSettled).toBe(false);
    expect(store.getRun(run.id)?.status).toBe("running");
    kernel.complete();
    await waiting;
    expect(store.getRun(run.id)?.status).toBe("completed");
  });

  it("前置门拒绝 → 新 run 异步取消、内核从未构建、事件可观测", async () => {
    const { store, project, task, dataDir } = taskSetup();
    let kernelBuilt = false;
    const published: Array<any> = [];
    const runner = new TaskRunner(
      store,
      dataDir,
      async () => {
        kernelBuilt = true;
        return new FakeKernel();
      },
      (_taskId, event) => published.push(event),
      {
        preFlightApproval: async () => ({
          approved: false,
          note: "审批拒绝（cli:owner）：预算撞线，今天不再开工",
        }),
      },
    );
    // start 立即返回（不等裁决）；拒绝由异步延续落取消。
    const run = await runner.start({
      task, project, profile: workProfile, apiKey: "k", source: "cli", mode: "work",
    });
    await runner.wait(run.id);
    // 等待异步延续结算。
    for (let i = 0; i < 50 && store.getRun(run.id)?.status !== "cancelled"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(kernelBuilt).toBe(false);
    const bundle = store.getTaskBundle(task.id)!;
    expect(bundle.runs).toHaveLength(1);
    expect(bundle.runs[0].status).toBe("cancelled");
    expect(bundle.runs[0].error).toContain("预算撞线");
    expect(bundle.runs[0].finishedAt).not.toBeNull();
    expect(bundle.task.status).toBe("cancelled");
    expect(runner.pendingRunForTask(task.id)).toBeNull();
    await expect(runner.abort(run.id)).resolves.toBe(false);
    expect(
      published.some((e) => e.event === "task.run.cancelled"),
    ).toBe(true);
  });

  it("前置门自身报错 → run/task 失败收敛且不遗留 pending", async () => {
    const { store, project, task, dataDir } = taskSetup();
    const factory = vi.fn(async () => new FakeKernel());
    const published: Array<any> = [];
    const runner = new TaskRunner(
      store,
      dataDir,
      factory,
      (_taskId, event) => published.push(event),
      {
        preFlightApproval: async () => {
          throw new Error("budget approval service unavailable");
        },
      },
    );
    const run = await runner.start({
      task, project, profile: workProfile, apiKey: "k", source: "cli", mode: "work",
    });
    await runner.wait(run.id);
    const bundle = store.getTaskBundle(task.id)!;
    expect(factory).not.toHaveBeenCalled();
    expect(bundle.runs.at(-1)).toMatchObject({
      status: "failed",
      error: "budget approval service unavailable",
    });
    expect(bundle.runs.at(-1)?.finishedAt).not.toBeNull();
    expect(bundle.task.status).toBe("failed");
    expect(runner.pendingRunForTask(task.id)).toBeNull();
    await expect(runner.abort(run.id)).resolves.toBe(false);
    expect(published).toContainEqual(
      expect.objectContaining({ event: "task.run.failed", runId: run.id }),
    );
  });
});
