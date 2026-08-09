import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { EpisodeRunner } from "../../src/runtime/episode-runner.js";
import type { EpisodeKernel, EpisodeKernelEvent } from "../../src/runtime/episode-runner.js";

/** A scripted fake kernel for testing the runner without Pi/LLM. */
function fakeKernel(script: {
  text?: string;
  toolCalls?: Array<{ name: string; args?: unknown; approved?: boolean; isError?: boolean }>;
  stopReason?: "completed" | "aborted" | "budget" | "failed";
}): EpisodeKernel {
  return {
    async run({ prompt, permissionMode, signal, requestApproval, emit }) {
      let text = script.text ?? "";
      let inputTokens = 5;
      let outputTokens = 0;
      let turns = 0;
      for (const call of script.toolCalls ?? []) {
        turns += 1;
        emit({ type: "tool.started", toolName: call.name, args: call.args });
        if (call.approved !== undefined) {
          // The tool needs approval (in the real kernel L2/L3 tools do).
          const verdict = await requestApproval({
            toolName: call.name,
            action: `run ${call.name}`,
            capability: "l2:test",
            level: "L2",
            argsExcerpt: JSON.stringify(call.args ?? {}),
          });
          if (!verdict.approved) {
            emit({ type: "tool.completed", toolName: call.name, isError: true });
            text += ` [${call.name} denied]`;
            outputTokens += 2;
            return { stopReason: "completed", text, inputTokens, outputTokens, turns };
          }
        }
        await new Promise((r) => setTimeout(r, 2));
        if (signal.aborted) {
          return { stopReason: "aborted", text, inputTokens, outputTokens, turns };
        }
        emit({ type: "tool.completed", toolName: call.name, isError: call.isError ?? false });
        outputTokens += 3;
      }
      if (text) {
        for (const chunk of text.split(" ")) {
          emit({ type: "delta", textDelta: chunk + " " });
        }
      }
      outputTokens += 4;
      turns += 1;
      return { stopReason: script.stopReason ?? "completed", text, inputTokens, outputTokens, turns };
    },
  };
}

function events(runner: EpisodeRunner): EpisodeKernelEvent[] {
  // Helper to collect events isn't needed; tests subscribe directly.
  return [];
}

describe("EpisodeRunner", () => {
  it("runs a prompt through the kernel and emits lifecycle events", async () => {
    const kernel = fakeKernel({ text: "hello world" });
    const runner = new EpisodeRunner({ kernel, defaultPermissionMode: "auto_edit" });
    const received: string[] = [];
    runner.on((e) => received.push(e.event));

    const { runId } = runner.submit("conv-1", { text: "hi", delivery: "steer" });
    await runner.join("conv-1");

    expect(received).toContain("episode.started");
    expect(received).toContain("episode.completed");
    expect(received.filter((e) => e === "episode.delta").length).toBeGreaterThan(0);
  });

  it("coalesces multiple inputs into one active run plus a successor", async () => {
    let kernelRuns = 0;
    let releaseFirst: (() => void) | null = null;
    const kernel: EpisodeKernel = {
      async run({ emit }) {
        kernelRuns += 1;
        if (kernelRuns === 1) {
          // Block until the test releases, so wake coalescing is observable.
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        emit({ type: "delta", textDelta: "ok " });
        return { stopReason: "completed", text: "ok", inputTokens: 1, outputTokens: 1, turns: 1 };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    runner.submit("c", { text: "one", delivery: "steer" });
    await vi.waitFor(() => expect(kernelRuns).toBe(1));
    // Three wakes while active → exactly one successor.
    runner.submit("c", { text: "two", delivery: "followup" });
    runner.submit("c", { text: "three", delivery: "followup" });
    runner.submit("c", { text: "four", delivery: "followup" });
    releaseFirst!();
    await vi.waitFor(() => expect(kernelRuns).toBe(2));
    // Give a tick for any third run to start erroneously.
    await new Promise((r) => setTimeout(r, 30));
    expect(kernelRuns).toBe(2);
  });

  it("routes an L2 approval request and resolves it via resolveApproval", async () => {
    const kernel = fakeKernel({
      toolCalls: [{ name: "bash", args: { command: "npm install" }, approved: true }],
    });
    const runner = new EpisodeRunner({ kernel });
    let approvalId: string | null = null;
    runner.on((e) => {
      if (e.event === "episode.approval.requested") approvalId = e.approvalId;
    });

    runner.submit("conv", { text: "install", delivery: "steer" });
    await vi.waitFor(() => expect(approvalId).toBeTruthy());
    const resolved = runner.resolveApproval(approvalId!, { approved: true, note: "yes" });
    expect(resolved).toBe(true);
    await runner.join("conv");
  });

  it("interrupt aborts the active run", async () => {
    let observedSignal = false;
    const kernel: EpisodeKernel = {
      async run({ signal, emit }) {
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            observedSignal = true;
            reject(signal.reason);
          });
        });
        return { stopReason: "completed", text: "", inputTokens: 0, outputTokens: 0, turns: 0 };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    runner.submit("c", { text: "go", delivery: "steer" });
    await new Promise((r) => setTimeout(r, 10));
    runner.interrupt("c");
    await runner.join("c");
    expect(observedSignal).toBe(true);
  });

  it("scheduled deliveries auto-approve L2 (headless policy)", async () => {
    let gotApproved = false;
    const kernel: EpisodeKernel = {
      async run({ requestApproval }) {
        const v = await requestApproval({
          toolName: "write",
          action: "write file",
          capability: "l2:modify-existing",
          level: "L2",
          argsExcerpt: "{}",
        });
        gotApproved = v.approved;
        return { stopReason: "completed", text: "", inputTokens: 1, outputTokens: 1, turns: 1 };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    runner.submit("c", { text: "cron", delivery: "scheduled" });
    await runner.join("c");
    expect(gotApproved).toBe(true);
  });

  it("tracks and updates the permission dial per session", () => {
    const runner = new EpisodeRunner({ kernel: fakeKernel({}), defaultPermissionMode: "auto_edit" });
    expect(runner.getDial("c")).toBe("auto_edit");
    runner.setDial("c", "plan");
    expect(runner.getDial("c")).toBe("plan");
  });

  it("prompt() submits and resolves with the completed result", async () => {
    const kernel = fakeKernel({ text: "done" });
    const runner = new EpisodeRunner({ kernel });
    const result = await runner.prompt("c", { text: "go", delivery: "steer" });
    expect(result.text).toBe("done");
    expect(result.stopReason).toBe("completed");
    expect(result.runId).toMatch(/^ep_|run_/);
  });
});

// Reference to avoid unused-import lint in some configs.
void events;
void EventEmitter;
