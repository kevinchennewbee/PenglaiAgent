import { describe, it, expect, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { EpisodeRunner } from "../../src/runtime/episode-runner.js";
import type { EpisodeKernel } from "../../src/runtime/episode-runner.js";
import { createTaskEpisodeKernel } from "../../src/runtime/task-episode-kernel.js";
import type { TaskKernelOptions } from "../../src/task-runner.js";

const profile: ModelProfile = {
  id: "test",
  label: "test",
  provider: "openai",
  baseUrl: "http://127.0.0.1:9/v1",
  model: "mock",
  apiKeyEnv: "",
  capabilities: { tools: true, streaming: true, vision: false },
  contextWindowTokens: 8_000,
  maxOutputTokens: 1_024,
};

function taskOptions(runId: string): TaskKernelOptions {
  return {
    runId,
    taskId: "task_1",
    workspaceRoot: "/tmp",
    dataDir: "/tmp",
    profile,
    apiKey: "test-key",
    mode: "work",
    permissionMode: "confirm",
  };
}

describe("createTaskEpisodeKernel", () => {
  it("C4: each prompt/steer uses a unique episodeRequestId, not durable runId", async () => {
    const seenRunIds: string[] = [];
    const kernel: EpisodeKernel = {
      async run({ runId, prompt }) {
        seenRunIds.push(runId);
        return {
          stopReason: "completed",
          text: prompt,
          inputTokens: 1,
          outputTokens: 1,
          turns: 1,
        };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    const taskKernel = createTaskEpisodeKernel(taskOptions("run_durable_1"), {
      runner,
      registerSession: () => () => {},
    });

    await taskKernel.prompt({ text: "first", source: "desktop" });
    await taskKernel.followUp("second");
    await taskKernel.steer("third");

    expect(seenRunIds).toHaveLength(3);
    expect(new Set(seenRunIds).size).toBe(3);
    expect(seenRunIds.every((id) => id !== "run_durable_1")).toBe(true);
    expect(seenRunIds.every((id) => id.startsWith("ep_"))).toBe(true);
    taskKernel.dispose();
  });

  it("C4: concurrent waiters settle only on their own episodeRequestId", async () => {
    let releaseFirst: (() => void) | null = null;
    const order: string[] = [];
    const kernel: EpisodeKernel = {
      async run({ runId, prompt }) {
        order.push(prompt);
        if (prompt === "A") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return {
          stopReason: "completed",
          text: `${prompt}:${runId}`,
          inputTokens: 1,
          outputTokens: 1,
          turns: 1,
        };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    const taskKernel = createTaskEpisodeKernel(taskOptions("run_shared"), {
      runner,
      registerSession: () => () => {},
    });

    const pA = taskKernel.prompt({ text: "A", source: "desktop" });
    await vi.waitFor(() => expect(releaseFirst).toBeTruthy());
    const pB = taskKernel.followUp("B");
    releaseFirst!();
    await Promise.all([pA, pB]);
    expect(order).toEqual(["A", "B"]);
    taskKernel.dispose();
  });

  it("C5: budget stopReason rejects so TaskRunner does not mark completed", async () => {
    const kernel: EpisodeKernel = {
      async run() {
        return {
          stopReason: "budget",
          stopDetail: "turn budget exhausted",
          text: "",
          inputTokens: 1,
          outputTokens: 0,
          turns: 3,
        };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    const taskKernel = createTaskEpisodeKernel(taskOptions("run_budget"), {
      runner,
      registerSession: () => () => {},
    });
    await expect(
      taskKernel.prompt({ text: "go", source: "desktop" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("turn budget exhausted"),
      stopReason: "budget",
    });
    taskKernel.dispose();
  });

  it("C5: aborted stopReason rejects; failed rejects; completed resolves", async () => {
    const reasons: Array<"completed" | "aborted" | "failed"> = [];
    const kernel: EpisodeKernel = {
      async run({ prompt }) {
        const stopReason = prompt as "completed" | "aborted" | "failed";
        reasons.push(stopReason);
        return {
          stopReason,
          stopDetail: stopReason === "completed" ? null : stopReason,
          text: prompt,
          inputTokens: 1,
          outputTokens: 1,
          turns: 1,
        };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    const taskKernel = createTaskEpisodeKernel(taskOptions("run_stop"), {
      runner,
      registerSession: () => () => {},
    });
    await expect(
      taskKernel.prompt({ text: "completed", source: "desktop" }),
    ).resolves.toBeUndefined();
    await expect(
      taskKernel.prompt({ text: "aborted", source: "desktop" }),
    ).rejects.toMatchObject({ stopReason: "aborted" });
    await expect(
      taskKernel.prompt({ text: "failed", source: "desktop" }),
    ).rejects.toMatchObject({ stopReason: "failed" });
    expect(reasons).toEqual(["completed", "aborted", "failed"]);
    taskKernel.dispose();
  });
});
