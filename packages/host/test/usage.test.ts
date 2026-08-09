/**
 * Usage ledger tests (0.4.0 design §7 成本可见性).
 *
 * Covers the durable (day, mode, project) aggregation in the product store,
 * the local-day helper, the TaskRunner's zero-usage logging when a provider
 * stays silent, and the `usage.get` RPC shape end to end.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { ProductStore } from "../src/storage/product-store.js";
import { TaskRunner } from "../src/task-runner.js";
import { localDay } from "../src/usage.js";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";

const cleanup: string[] = [];

function temporaryDatabase(): { directory: string; filename: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-usage-"));
  cleanup.push(directory);
  return { directory, filename: path.join(directory, "product.db") };
}

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("localDay", () => {
  it("formats the local calendar day as YYYY-MM-DD", () => {
    // Noon local time is safely inside one calendar day in every timezone.
    const day = localDay(new Date(2026, 6, 28, 12, 0, 0));
    expect(day).toBe("2026-07-28");
  });
});

describe("ProductStore usage ledger", () => {
  it("aggregates additively by (day, mode, project) and survives restart", () => {
    const { filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    store.recordUsage({
      day: "2026-07-28",
      mode: "chat",
      projectId: "",
      inputTokens: 100,
      outputTokens: 50,
    });
    store.recordUsage({
      day: "2026-07-28",
      mode: "chat",
      projectId: "",
      inputTokens: 10,
      outputTokens: 5,
    });
    store.recordUsage({
      day: "2026-07-28",
      mode: "work",
      projectId: "proj_1",
      inputTokens: 1000,
      outputTokens: 500,
      requests: 2,
    });
    store.recordUsage({
      day: "2026-07-27",
      mode: "work",
      projectId: "proj_1",
      inputTokens: 7,
      outputTokens: 3,
    });
    store.close();

    const reopened = new ProductStore(filename);
    const report = reopened.getUsageReport();
    expect(report.totalTokens).toBe(1675);
    expect(report.totalRequests).toBe(5);
    expect(report.inputTokens).toBe(1117);
    expect(report.outputTokens).toBe(558);
    expect(report.rows).toHaveLength(3);
    const chatRow = report.rows.find((r) => r.mode === "chat");
    expect(chatRow).toMatchObject({
      day: "2026-07-28",
      projectId: "",
      inputTokens: 110,
      outputTokens: 55,
      requests: 2,
    });
    const workRows = report.rows.filter((r) => r.mode === "work");
    expect(workRows.map((r) => r.day).sort()).toEqual(["2026-07-27", "2026-07-28"]);
    reopened.close();
  });

  it("records a zero-token row when the provider reported nothing", () => {
    const { filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    store.recordUsage({
      day: "2026-07-28",
      mode: "work",
      projectId: "proj_1",
      inputTokens: 0,
      outputTokens: 0,
      requests: 1,
    });
    const report = store.getUsageReport();
    expect(report.totalTokens).toBe(0);
    expect(report.totalRequests).toBe(1);
    expect(report.rows[0]).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    store.close();
  });
});

// ── TaskRunner → ledger wiring ─────────────────────────────────

class SilentKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "usage-test";
  isRunning = false;
  private readonly listeners = new Set<KernelEventListener>();

  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: Omit<KernelEvent, "occurredAt" | "sessionId" | "raw"> & { raw?: unknown }): void {
    const { raw, ...rest } = event;
    const full = { ...rest, occurredAt: Date.now(), sessionId: this.sessionId, raw: raw ?? rest } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }

  async prompt(_input: KernelPrompt): Promise<void> {}
  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

const profile: ModelProfile = {
  id: "usage-profile",
  label: "Usage",
  provider: "custom",
  baseUrl: "https://example.invalid/v1",
  apiKeyEnv: "",
  model: "usage-model",
  capabilities: { tools: true, streaming: true, vision: false },
};

describe("TaskRunner usage accounting", () => {
  it("logs a note and reports zeros when the provider never reports usage", async () => {
    const { directory, filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const project = store.createProject({ name: "p", rootPath: workspaceRoot, trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    const kernel = new SilentKernel();
    const onUsage = vi.fn();
    const log = vi.fn();
    const runner = new TaskRunner(store, path.join(directory, "data"), async () => kernel, () => {}, {
      onUsage,
      log,
    });
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    await runner.wait(run.id);

    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        taskId: task.id,
        mode: "work",
        projectId: project.id,
        totalTokens: 0,
      }),
    );
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes("provider reported no token usage"),
      ),
    ).toBe(true);
    store.close();
  });

  it("does not log the zero-usage note when the provider reports tokens", async () => {
    const { directory, filename } = temporaryDatabase();
    const store = new ProductStore(filename);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const project = store.createProject({ name: "p", rootPath: workspaceRoot, trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    const kernel = new SilentKernel();
    const log = vi.fn();
    const runner = new TaskRunner(store, path.join(directory, "data"), async () => kernel, () => {}, { log });
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    kernel.emit({
      kind: "message.completed",
      raw: {
        type: "message_end",
        message: { role: "assistant", usage: { input: 3, output: 4 } },
      },
    });
    await runner.wait(run.id);
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes("provider reported no token usage"),
      ),
    ).toBe(false);
    store.close();
  });
});

// ── RPC surface ────────────────────────────────────────────────

describe("usage.get RPC", () => {
  it("returns the durable report (totals + per-dimension rows)", async () => {
    const { startServer } = await import("../src/server.js");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-usage-rpc-"));
    cleanup.push(directory);
    const started = await startServer({
      port: 0,
      token: "usage-test-token",
      dataDir: directory,
      databasePath: path.join(directory, "product.db"),
      taskKernelFactory: async () => new SilentKernel(),
    });
    try {
      started.handle.productStore.recordUsage({
        day: localDay(),
        mode: "chat",
        projectId: "",
        inputTokens: 42,
        outputTokens: 8,
        requests: 1,
      });
      const res = await fetch(`http://127.0.0.1:${started.port}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Penglai-Token": "usage-test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "usage.get", params: {} }),
      });
      const body = await res.json();
      expect(body.result.totalTokens).toBe(50);
      expect(body.result.totalRequests).toBe(1);
      expect(Array.isArray(body.result.rows)).toBe(true);
      expect(body.result.rows[0]).toMatchObject({
        day: localDay(),
        mode: "chat",
        projectId: "",
        inputTokens: 42,
      });
    } finally {
      await started.close();
    }
  });
});
