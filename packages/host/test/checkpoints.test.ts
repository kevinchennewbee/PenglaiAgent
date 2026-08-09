/**
 * Lightweight checkpoint tests (the worldline replacement).
 *
 * Covers: Pi session discovery by run-id suffix, checkpoint indexing at run
 * settle (session path + task summary + budget usage), bundle visibility,
 * the crash-recovery sweep rebuilding the task view from a session file a
 * dead process left behind, and idempotency between the two paths.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { ProductStore } from "../src/storage/product-store.js";
import { TaskRunner } from "../src/task-runner.js";
import {
  findPiSessionFile,
  indexRunCheckpoint,
  piSessionsRoot,
  sweepMissingCheckpoints,
} from "../src/checkpoints.js";
import type {
  AgentKernel,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";

const cleanup: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

class IdleKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "checkpoint-test";
  isRunning = false;
  subscribe(_listener: KernelEventListener): () => void {
    return () => {};
  }
  async prompt(_input: KernelPrompt): Promise<void> {}
  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

const profile: ModelProfile = {
  id: "checkpoint-profile",
  label: "Checkpoint",
  provider: "custom",
  baseUrl: "https://example.invalid/v1",
  apiKeyEnv: "",
  model: "checkpoint-model",
  capabilities: { tools: true, streaming: true, vision: false },
};

/** Plant a fake Pi session JSONL in the engine's own directory layout. */
function plantSessionFile(dataDir: string, runId: string, cwdName = "some-workspace"): string {
  const dir = path.join(piSessionsRoot(dataDir), cwdName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `2026-07-28T03-00-00-000Z_${runId}.jsonl`);
  fs.writeFileSync(file, `{"type":"session","id":"${runId}"}\n`, "utf-8");
  return file;
}

function trustedTask(store: ProductStore, rootPath: string) {
  const project = store.createProject({ name: "p", rootPath, trusted: true });
  const task = store.createTask({
    projectId: project.id,
    title: "修复构建",
    objective: "把测试修绿并补回归",
  });
  return { project, task };
}

describe("findPiSessionFile", () => {
  it("discovers a session file by run-id suffix regardless of the workspace encoding", () => {
    const dataDir = tempDir("penglai-ckpt-data-");
    const planted = plantSessionFile(dataDir, "run_abc123", "weird-encoded-cwd");
    expect(findPiSessionFile(dataDir, "run_abc123")).toBe(planted);
  });

  it("returns null when no sessions root or no matching file exists", () => {
    const dataDir = tempDir("penglai-ckpt-empty-");
    expect(findPiSessionFile(dataDir, "run_missing")).toBeNull();
    plantSessionFile(dataDir, "run_other");
    expect(findPiSessionFile(dataDir, "run_missing")).toBeNull();
  });
});

describe("checkpoint indexing at run settle", () => {
  it("records the session path, task summary, and budget usage for a finished run", async () => {
    const dataDir = tempDir("penglai-ckpt-run-");
    const store = new ProductStore(":memory:");
    const projectRoot = tempDir("penglai-ckpt-proj-");
    const { project, task } = trustedTask(store, projectRoot);
    const kernel = new IdleKernel();
    const runner = new TaskRunner(store, dataDir, async () => kernel);
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    // The engine writes its session during the episode; the settle path
    // indexes it afterwards.
    const planted = plantSessionFile(dataDir, run.id);
    await runner.wait(run.id);

    const checkpoint = store.getRunCheckpoint(run.id);
    expect(checkpoint).toMatchObject({
      runId: run.id,
      taskId: task.id,
      sessionPath: planted,
      taskTitle: "修复构建",
      taskObjective: "把测试修绿并补回归",
      status: "completed",
      turns: 0,
      toolFailures: 0,
    });
    expect(checkpoint?.budget.maxTurns).toBeGreaterThan(0);

    // The task bundle carries the checkpoint, and the session file appears
    // on the evidence trail as an engine attachment.
    const bundle = store.getTaskBundle(task.id);
    expect(bundle?.checkpoints.map((c) => c.runId)).toEqual([run.id]);
    const attachment = bundle?.evidence.find(
      (e) => e.metadata?.checkpointRunId === run.id,
    );
    expect(attachment?.kind).toBe("artifact");
    expect(attachment?.uri).toBe(planted);
    store.close();
  });

  it("still records a checkpoint (null session) when the engine left no file", async () => {
    const dataDir = tempDir("penglai-ckpt-nofile-");
    const store = new ProductStore(":memory:");
    const projectRoot = tempDir("penglai-ckpt-proj-");
    const { project, task } = trustedTask(store, projectRoot);
    const runner = new TaskRunner(store, dataDir, async () => new IdleKernel());
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    await runner.wait(run.id);
    const checkpoint = store.getRunCheckpoint(run.id);
    expect(checkpoint?.status).toBe("completed");
    expect(checkpoint?.sessionPath).toBeNull();
    store.close();
  });
});

describe("crash-recovery sweep", () => {
  it("indexes the session file a dead process left behind", () => {
    const dataDir = tempDir("penglai-ckpt-crash-");
    const dbFile = path.join(tempDir("penglai-ckpt-db-"), "product.db");
    const store = new ProductStore(dbFile);
    const projectRoot = tempDir("penglai-ckpt-proj-");
    const { task } = trustedTask(store, projectRoot);
    const run = store.createRun({ taskId: task.id, modelProfileId: profile.id });
    store.transitionRun(run.id, "running");
    const planted = plantSessionFile(dataDir, run.id);
    // Simulate the crash: the process dies with the run still "running".
    store.close();

    // Reopening closes the interrupted run (recoverInterruptedRuns)…
    const reopened = new ProductStore(dbFile);
    expect(reopened.getRun(run.id)?.status).toBe("failed");
    expect(reopened.getRunCheckpoint(run.id)).toBeNull();

    // …and the sweep indexes the engine session the dead process left.
    const swept = sweepMissingCheckpoints(reopened, dataDir);
    expect(swept.indexed).toEqual([run.id]);
    const checkpoint = reopened.getRunCheckpoint(run.id);
    expect(checkpoint).toMatchObject({
      runId: run.id,
      sessionPath: planted,
      status: "failed",
      turns: 0, // counters unknowable post-crash
    });
    // The task view is rebuilt from observation: bundle shows the attachment.
    const bundle = reopened.getTaskBundle(task.id);
    expect(bundle?.checkpoints).toHaveLength(1);
    expect(
      bundle?.evidence.some((e) => e.metadata?.checkpointRunId === run.id),
    ).toBe(true);
    reopened.close();
  });

  it("is idempotent with the settle path and reports runs without session files", async () => {
    const dataDir = tempDir("penglai-ckpt-idem-");
    const store = new ProductStore(":memory:");
    const projectRoot = tempDir("penglai-ckpt-proj-");
    const { project, task } = trustedTask(store, projectRoot);
    const runner = new TaskRunner(store, dataDir, async () => new IdleKernel());
    const run = await runner.start({
      task,
      project,
      profile,
      apiKey: "secret",
      source: "desktop",
      mode: "work",
    });
    await runner.wait(run.id);

    // Settle path already recorded a (null-session) checkpoint; the sweep
    // must not touch it, and must report the run as not missing anything.
    const swept = sweepMissingCheckpoints(store, dataDir);
    expect(swept.indexed).toEqual([]);
    expect(swept.missing).toEqual([]);

    // A second index call replaces the row instead of duplicating evidence.
    const planted = plantSessionFile(dataDir, run.id);
    indexRunCheckpoint(store, dataDir, {
      run: store.getRun(run.id)!,
      task,
      turns: 1,
      toolFailures: 0,
      inputTokens: 5,
      outputTokens: 6,
    });
    indexRunCheckpoint(store, dataDir, {
      run: store.getRun(run.id)!,
      task,
      turns: 1,
      toolFailures: 0,
      inputTokens: 5,
      outputTokens: 6,
    });
    expect(store.getRunCheckpoint(run.id)?.sessionPath).toBe(planted);
    const bundle = store.getTaskBundle(task.id);
    expect(
      bundle?.evidence.filter((e) => e.metadata?.checkpointRunId === run.id),
    ).toHaveLength(1);
    store.close();
  });
});
