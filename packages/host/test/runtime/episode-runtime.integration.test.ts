/**
 * Integration test: EpisodeRunner + production Pi kernel end-to-end.
 *
 * Uses a scripted mock model server (no real LLM) but exercises the REAL
 * createProductionPiKernel (policy, jail, bash, memory, session) through
 * the new EpisodeRunner. This proves the unified architecture can drive
 * the one production agent loop.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EpisodeRunner } from "../../src/runtime/episode-runner.js";
import { createProductionEpisodeKernel } from "../../src/kernel/episode-kernel.js";
import { MemoryStore } from "../../src/memory.js";
import { MockModelServer } from "../fixtures/mock-model-server.js";
import { savePersistedProfile } from "../../src/profiles-store.js";

const EVAL_TOKEN = "eval-token";
const EVAL_PROFILE = "eval";

describe("EpisodeRunner + production kernel (integration)", () => {
  let base: string;
  let dataDir: string;
  let workspace: string;
  let mock: MockModelServer;
  let runner: EpisodeRunner;
  let memory: MemoryStore;

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-episode-"));
    dataDir = path.join(base, "data");
    workspace = path.join(base, "workspace");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });

    mock = new MockModelServer();
    await mock.start();

    // An eval profile pointing at the mock model server.
    savePersistedProfile(dataDir, {
      id: EVAL_PROFILE,
      label: "Eval",
      provider: "custom",
      baseUrl: mock.baseUrl,
      model: "eval-model",
      apiKeyEnv: "EVAL_KEY",
      capabilities: { vision: false },
    });
    process.env.EVAL_KEY = "eval-secret";

    memory = new MemoryStore(path.join(dataDir, "memory"));

    const kernel = createProductionEpisodeKernel({
      dataDir,
      resolveSession: async (sessionKey) => {
        // In this test, sessionKey is the conversation id; the workspace
        // is our temp dir and the model profile is the eval one.
        const profile = {
          id: EVAL_PROFILE,
          label: "Eval",
          baseUrl: mock.baseUrl,
          model: "eval-model",
          apiKeyEnv: "EVAL_KEY",
          capabilities: { vision: false },
        } as never;
        return {
          profile,
          apiKey: "eval-secret",
          workspaceRoot: workspace,
          projectAnchored: false,
          conversationId: sessionKey,
          memory,
          hostTools: undefined,
        };
      },
    });

    runner = new EpisodeRunner({ kernel, defaultPermissionMode: "auto_edit" });
  });

  afterEach(async () => {
    await runner.join("conv-test");
    await mock.close();
    fs.rmSync(base, { recursive: true, force: true });
    delete process.env.EVAL_KEY;
  });

  it("streams a plain-text turn through the real Pi kernel", async () => {
    const prompt = "你好";
    mock.register(prompt, [{ text: "你好，我是蓬莱。", usage: { input: 10, output: 6 } }]);

    const events: string[] = [];
    runner.on((e) => events.push(e.event));

    runner.submit("conv-test", { text: prompt, delivery: "steer" });
    await runner.join("conv-test");

    expect(events).toContain("episode.started");
    expect(events).toContain("episode.delta");
    expect(events).toContain("episode.completed");
  });

  it("executes a read-only bash command (L1) without approval", async () => {
    const prompt = "跑个 echo";
    mock.register(prompt, [
      {
        toolCalls: [{ name: "bash", arguments: { command: "echo episode-runtime-ok" } }],
      },
      { text: "done", usage: { input: 20, output: 5 } },
    ]);

    let sawApprovalRequest = false;
    runner.on((e) => {
      if (e.event === "episode.approval.requested") sawApprovalRequest = true;
      if (e.event === "episode.tool.completed" && e.toolName === "bash") {
        // Tool completed without an approval event = L1 auto-run.
      }
    });

    runner.submit("conv-test", { text: prompt, delivery: "steer" });
    await runner.join("conv-test");

    // echo is L1 (read-only), so no approval event should fire.
    expect(sawApprovalRequest).toBe(false);
  });

  it("stops an episode when the tool-failure safety ceiling trips", async () => {
    // Re-wire a kernel with a very low tool-failure ceiling (2) so a
    // failing tool loop trips the budget stop quickly.
    const tightKernel = createProductionEpisodeKernel({
      dataDir,
      policyProfile: {
        fileTools: [],
        hostTools: [],
        allowsBash: true,
        maxTurns: 200,
        budget: {
          maxDurationMs: null,
          maxTokens: null,
          maxToolFailures: 2,
        },
      },
      resolveSession: async (sessionKey) => ({
        profile: {
          id: EVAL_PROFILE,
          label: "Eval",
          baseUrl: mock.baseUrl,
          model: "eval-model",
          apiKeyEnv: "EVAL_KEY",
          capabilities: { vision: false },
        } as never,
        apiKey: "eval-secret",
        workspaceRoot: workspace,
        projectAnchored: false,
        conversationId: sessionKey,
        memory,
        hostTools: undefined,
      }),
    });
    const tightRunner = new EpisodeRunner({
      kernel: tightKernel,
      defaultPermissionMode: "auto_edit",
    });

    // Script several turns, each invoking a command that exits non-zero.
    const prompt = "一直跑失败的命令";
    const failingTurn = {
      toolCalls: [{ name: "bash", arguments: { command: "false" } }],
      usage: { input: 5, output: 2 },
    };
    mock.register(prompt, Array(8).fill(failingTurn));

    const result = await tightRunner.prompt("conv-budget", {
      text: prompt,
      delivery: "steer",
    });

    expect(result.stopReason).toBe("budget");
    expect(result.stopDetail ?? "").toContain("tool failure");
    await tightRunner.join("conv-budget");
  });
});
