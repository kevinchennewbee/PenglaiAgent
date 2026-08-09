/**
 * Observational tool evidence tests (M3′ desktop evidence rail foundation).
 *
 * The durable Evidence rows for a run must derive from the tool layer and
 * the filesystem — the applied diff, the re-read written file, the captured
 * command output — never from model narration. These tests pin that the
 * runner records real diffs, observed write facts, and classified checks.
 */

import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ModelProfile } from "@penglai/protocol";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";
import { ProductStore } from "../src/storage/product-store.js";
import { TaskRunner } from "../src/task-runner.js";
import {
  MAX_TOOL_EVIDENCE_CHARS,
  recordToolEvidence,
} from "../src/tool-evidence.js";

class FakeKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "tool-evidence-fake";
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

function setupProject(): { store: ProductStore; rootDir: string; projectId: string; taskId: string } {
  const store = new ProductStore(":memory:");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-toolev-"));
  const project = store.createProject({
    name: "trusted",
    rootPath: rootDir,
    trusted: true,
  });
  const task = store.createTask({
    projectId: project.id,
    title: "Observe tools",
    objective: "Exercise the tool surface",
  });
  return { store, rootDir, projectId: project.id, taskId: task.id };
}

describe("TaskRunner tool evidence (observational)", () => {
  it("records the edit tool's own applied diff as kind diff", async () => {
    const { store, rootDir } = setupProject();
    const project = store.listProjects()[0];
    const task = store.listTasks(project.id)[0];
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
    kernel.emit({
      kind: "tool.started",
      toolCallId: "c-edit",
      toolName: "edit",
      data: { path: "src/a.ts", edits: [] },
    });
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "c-edit",
      toolName: "edit",
      isError: false,
      data: {
        content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/a.ts." }],
        details: { diff: "@@ -1,1 +1,1 @@\n- old\n+ new", firstChangedLine: 1 },
      },
    });
    kernel.complete();
    await runner.wait(run.id);

    const bundle = store.getTaskBundle(task.id);
    expect(bundle?.evidence).toHaveLength(1);
    const row = bundle!.evidence[0];
    expect(row.kind).toBe("diff");
    expect(row.title).toBe("edit src/a.ts");
    expect(row.summary).toContain("- old");
    expect(row.summary).toContain("+ new");
    expect(row.metadata).toMatchObject({
      path: "src/a.ts",
      firstChangedLine: 1,
      provenance: "tool-observed",
      isError: false,
    });
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("re-reads a written file from disk and records observed facts", async () => {
    const { store, rootDir } = setupProject();
    const project = store.listProjects()[0];
    const task = store.listTasks(project.id)[0];
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
    const written = path.join(rootDir, "notes.md");
    const content = "# 观察到的写入\n真实内容，不是模型自述。\n";
    kernel.emit({
      kind: "tool.started",
      toolCallId: "c-write",
      toolName: "write",
      data: { path: "notes.md", content },
    });
    fs.writeFileSync(written, content, "utf-8"); // the tool's real effect
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "c-write",
      toolName: "write",
      isError: false,
      data: { content: [{ type: "text", text: "wrote notes.md" }], details: undefined },
    });
    kernel.complete();
    await runner.wait(run.id);

    const bundle = store.getTaskBundle(task.id);
    const row = bundle!.evidence[0];
    const sha = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    expect(row.kind).toBe("diff");
    expect(row.title).toBe("write notes.md");
    expect(row.summary).toContain("写入 notes.md");
    expect(row.summary).toContain("真实内容，不是模型自述");
    expect(row.metadata).toMatchObject({
      path: "notes.md",
      bytes: Buffer.byteLength(content),
      sha256: sha,
      provenance: "disk-observed",
    });
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("classifies test-looking bash commands as kind test with observed output", async () => {
    const { store, rootDir } = setupProject();
    const project = store.listProjects()[0];
    const task = store.listTasks(project.id)[0];
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
    kernel.emit({
      kind: "tool.started",
      toolCallId: "c-test",
      toolName: "bash",
      data: { command: "npx vitest run" },
    });
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "c-test",
      toolName: "bash",
      isError: false,
      data: {
        content: [{ type: "text", text: "Test Files  3 passed (3)\n Tests  42 passed (42)" }],
        details: { truncation: null, fullOutputPath: null },
      },
    });
    kernel.emit({
      kind: "tool.started",
      toolCallId: "c-ls",
      toolName: "bash",
      data: { command: "ls missing-dir" },
    });
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "c-ls",
      toolName: "bash",
      isError: true,
      data: {
        content: [{ type: "text", text: "Command exited with code 1\nls: missing-dir: No such file or directory" }],
        details: undefined,
      },
    });
    kernel.emit({
      kind: "tool.started",
      toolCallId: "c-read",
      toolName: "read",
      data: { path: "notes.md" },
    });
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "c-read",
      toolName: "read",
      isError: false,
      data: { content: [{ type: "text", text: "file body" }], details: undefined },
    });
    kernel.complete();
    await runner.wait(run.id);

    const bundle = store.getTaskBundle(task.id);
    expect(bundle!.evidence.map((row) => row.kind)).toEqual(["test", "command", "log"]);
    const testRow = bundle!.evidence[0];
    expect(testRow.title).toBe("npx vitest run");
    expect(testRow.summary).toContain("42 passed");
    expect(testRow.metadata).toMatchObject({ exitOk: true, provenance: "tool-observed" });
    const failRow = bundle!.evidence[1];
    expect(failRow.summary).toContain("No such file or directory");
    expect(failRow.metadata).toMatchObject({ exitOk: false, command: "ls missing-dir" });
    const readRow = bundle!.evidence[2];
    expect(readRow.title).toBe("read completed");
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("falls back to the tool-reported row when the written file is outside the jail", async () => {
    const { store, rootDir } = setupProject();
    const project = store.listProjects()[0];
    const task = store.listTasks(project.id)[0];
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
    kernel.emit({
      kind: "tool.started",
      toolCallId: "c-escape",
      toolName: "write",
      data: { path: "/etc/passwd", content: "x" },
    });
    kernel.emit({
      kind: "tool.completed",
      toolCallId: "c-escape",
      toolName: "write",
      isError: false,
      data: { content: [{ type: "text", text: "wrote /etc/passwd" }], details: undefined },
    });
    kernel.complete();
    await runner.wait(run.id);

    const row = store.getTaskBundle(task.id)!.evidence[0];
    expect(row.kind).toBe("diff");
    expect(row.metadata).toMatchObject({ provenance: "tool-reported", sha256: null });
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

describe("recordToolEvidence (unit edges)", () => {
  it("redacts credentials from command, output, diff, and structured metadata", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "p", rootPath: "/tmp/p", trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    const secret = "sk-" + "abcdefghijklmnopqrstuvwxyz123456";
    const row = recordToolEvidence({
      store,
      taskId: task.id,
      runId: null,
      stepId: null,
      workspaceRoot: "/tmp/p",
      toolCallId: "secret-call",
      toolName: "bash",
      args: { command: `curl -H 'Authorization: Bearer ${secret}' https://example.com?token=${secret}` },
      result: {
        content: [{ type: "text", text: `OPENAI_API_KEY=${secret}` }],
        details: { diagnostic: { apiKey: secret } },
      },
      isError: false,
    });
    const persisted = JSON.stringify(row);
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain("REDACTED");
  });

  it("bounds oversized diffs to the evidence text budget", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "p", rootPath: "/tmp/p", trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    const huge = `+ ${"x".repeat(MAX_TOOL_EVIDENCE_CHARS * 2)}`;
    const row = recordToolEvidence({
      store,
      taskId: task.id,
      runId: null,
      stepId: null,
      workspaceRoot: "/tmp/p",
      toolCallId: "c",
      toolName: "edit",
      args: { path: "big.txt" },
      result: { content: [], details: { diff: huge, firstChangedLine: 1 } },
      isError: false,
    });
    expect(row).not.toBeNull();
    expect(row!.summary.length).toBeLessThanOrEqual(MAX_TOOL_EVIDENCE_CHARS);
    expect(row!.summary.endsWith("…")).toBe(true);
  });

  it("never throws when the result payload is malformed", () => {
    const store = new ProductStore(":memory:");
    const project = store.createProject({ name: "p", rootPath: "/tmp/p", trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    const row = recordToolEvidence({
      store,
      taskId: task.id,
      runId: null,
      stepId: null,
      workspaceRoot: "/tmp/p",
      toolCallId: null,
      toolName: "bash",
      args: {},
      result: 42,
      isError: true,
    });
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("command");
    expect(row!.metadata).toMatchObject({ exitOk: false });
  });
});
