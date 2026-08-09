import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import type {
  AgentHarnessEvent,
  AgentHarnessOptions,
} from "@earendil-works/pi-agent-core";
import {
  createPiKernel,
  PI_ENGINE_VERSION,
} from "../src/kernel/pi-kernel.js";
import {
  createProductionPiKernel,
  loadSopSkills,
} from "../src/kernel/create-production-pi-kernel.js";
import { MemoryStore } from "../src/memory.js";
import {
  MockModelServer,
  toolResultsTextOf,
} from "./fixtures/mock-model-server.js";

class FakePiHarness {
  private listener?: (event: AgentHarnessEvent) => Promise<void> | void;

  readonly prompt = vi.fn(async () => undefined);
  readonly steer = vi.fn(async () => undefined);
  readonly followUp = vi.fn(async () => undefined);
  readonly abort = vi.fn(async () => undefined);
  readonly dispose = vi.fn(() => undefined);

  subscribe(
    listener: (event: AgentHarnessEvent) => Promise<void> | void,
  ): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(event: AgentHarnessEvent): void {
    this.listener?.(event);
  }
}

const harnessOptions = {} as AgentHarnessOptions;

describe("Pi kernel adapter", () => {
  it("loads Pi skill resources only from receipt-verified SOP buffers", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-pi-sop-"));
    const memory = new MemoryStore(path.join(directory, "memory", "global"));
    memory.ensureGlobalLayout();
    fs.mkdirSync(memory.sopRoot, { recursive: true });
    fs.writeFileSync(
      path.join(memory.sopRoot, "manual-poison.md"),
      "# PI_RESOURCE_SENTINEL\n",
      "utf-8",
    );
    memory.writeGlobalSop("trusted-skill", "# Trusted skill\nverified body\n", {
      sourceKind: "migrate",
      sourceTaskId: null,
      sourceRunId: null,
      sourceRef: "migration:test-trusted-skill",
      evidenceId: null,
      auditedBy: "rules+migrate-03",
    });
    try {
      const skills = loadSopSkills(memory);
      expect(skills.map((skill) => skill.name)).toEqual(["trusted-skill"]);
      expect(skills[0]?.content).toContain("verified body");
      expect(skills[0]?.content).not.toContain("penglai-sop:v2");

      fs.appendFileSync(path.join(memory.sopRoot, "trusted-skill.md"), "tampered\n");
      expect(loadSopSkills(memory)).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("constructs the real pinned Pi provider, tools, and per-Run session without a network call", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-pi-production-"));
    const workspaceRoot = path.join(directory, "workspace");
    const dataDir = path.join(directory, "data");
    fs.mkdirSync(workspaceRoot);
    const profile: ModelProfile = {
      id: "test-openai-compatible",
      label: "Test compatible provider",
      provider: "custom",
      baseUrl: "https://example.invalid/v1",
      apiKeyEnv: "",
      model: "test-model",
      capabilities: { tools: true, streaming: true, vision: false },
    };

    try {
      const kernel = await createProductionPiKernel({
        runId: "run-production-construction",
        taskId: "task-1",
        workspaceRoot,
        dataDir,
        profile,
        apiKey: "not-sent",
        projectAnchored: true,
      });
      expect(kernel.engine).toBe("pi");
      expect(kernel.engineVersion).toBe(PI_ENGINE_VERSION);
      expect(kernel.sessionId).toBe("run-production-construction");
      expect(fs.existsSync(path.join(dataDir, "pi-sessions"))).toBe(true);
      kernel.dispose();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks a Pi tool call before execution when live authority revalidation fails", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-pi-authority-"));
    const workspaceRoot = path.join(directory, "workspace");
    const dataDir = path.join(directory, "data");
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "secret.txt"), "must-not-be-read\n");
    const mock = new MockModelServer();
    await mock.start();
    const prompt = "attempt a tool after revocation";
    mock.register(prompt, [
      { toolCalls: [{ name: "read", arguments: { path: "secret.txt" } }] },
      { text: "authority was revoked" },
    ]);
    const revalidateAuthority = vi.fn(() => {
      const error = new Error("project trust changed");
      Object.assign(error, { code: "authority_changed" });
      throw error;
    });

    try {
      const kernel = await createProductionPiKernel({
        runId: "run-authority-race",
        taskId: "task-authority-race",
        workspaceRoot,
        dataDir,
        profile: {
          id: "authority-mock",
          label: "Authority mock",
          provider: "custom",
          baseUrl: mock.baseUrl,
          apiKeyEnv: "",
          model: "mock-model",
          capabilities: { tools: true, streaming: true, vision: false },
        },
        apiKey: "test-key",
        projectAnchored: true,
        revalidateAuthority,
      });
      await kernel.prompt({ text: prompt, source: "desktop" });
      kernel.dispose();

      expect(revalidateAuthority).toHaveBeenCalledOnce();
      const requests = mock.requestsFor(prompt);
      expect(requests).toHaveLength(2);
      const toolResult = toolResultsTextOf(requests[1]!.body);
      expect(toolResult).toContain("authority_changed");
      expect(toolResult).not.toContain("must-not-be-read");
    } finally {
      await mock.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("constructs the pinned Pi harness with Penglai-owned options", async () => {
    const fake = new FakePiHarness();
    let received: AgentHarnessOptions | undefined;

    const kernel = await createPiKernel({
      sessionId: "run-1",
      harnessOptions,
      harnessFactory: (options) => {
        received = options;
        return fake;
      },
    });

    expect(received).toBe(harnessOptions);
    expect(kernel.engine).toBe("pi");
    expect(kernel.engineVersion).toBe(PI_ENGINE_VERSION);
    expect(kernel.sessionId).toBe("run-1");
    kernel.dispose();
  });

  it("keeps channel semantics in Penglai and sends only prompt text to Pi", async () => {
    const fake = new FakePiHarness();
    const kernel = await createPiKernel({
      sessionId: "run-1",
      harnessOptions,
      harnessFactory: () => fake,
    });

    await kernel.prompt({ text: "desktop task", source: "desktop" });
    await kernel.prompt({ text: "remote task", source: "feishu" });

    expect(fake.prompt).toHaveBeenNthCalledWith(1, "desktop task");
    expect(fake.prompt).toHaveBeenNthCalledWith(2, "remote task");
    kernel.dispose();
  });

  it("normalizes useful fields while retaining the exact Pi event", async () => {
    const fake = new FakePiHarness();
    const kernel = await createPiKernel({
      sessionId: "run-1",
      harnessOptions,
      harnessFactory: () => fake,
      now: () => 1234,
    });
    const events: unknown[] = [];
    kernel.subscribe((event) => events.push(event));

    const raw = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: { content: "ok" },
      isError: false,
    } as AgentHarnessEvent;
    fake.emit(raw);

    expect(events).toEqual([
      {
        kind: "tool.completed",
        occurredAt: 1234,
        sessionId: "run-1",
        toolCallId: "call-1",
        toolName: "read",
        isError: false,
        data: { content: "ok" },
        raw,
      },
    ]);
    kernel.dispose();
  });

  it("propagates steer, follow-up, abort and idempotent disposal", async () => {
    const fake = new FakePiHarness();
    const kernel = await createPiKernel({
      sessionId: "run-1",
      harnessOptions,
      harnessFactory: () => fake,
    });

    await kernel.steer("change direction");
    await kernel.followUp("verify afterwards");
    await kernel.abort();
    kernel.dispose();
    kernel.dispose();

    expect(fake.steer).toHaveBeenCalledWith("change direction");
    expect(fake.followUp).toHaveBeenCalledWith("verify afterwards");
    expect(fake.abort).toHaveBeenCalledOnce();
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(() => kernel.subscribe(() => undefined)).toThrow(
      "Pi kernel has been disposed",
    );
  });
});
