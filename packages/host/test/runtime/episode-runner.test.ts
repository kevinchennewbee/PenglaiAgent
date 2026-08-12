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

  it("C1: drains every queued follow-up in arrival order (A active + B/C/D)", async () => {
    const prompts: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const kernel: EpisodeKernel = {
      async run({ prompt, emit }) {
        prompts.push(prompt);
        if (prompts.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        emit({ type: "delta", textDelta: `${prompt} ` });
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
    const terminals: Array<{ runId: string; text: string }> = [];
    runner.on((e) => {
      if (e.event === "episode.completed") {
        terminals.push({ runId: e.runId, text: e.text });
      }
    });

    const a = runner.submit("c", { text: "A", delivery: "steer", runId: "ep_a" });
    await vi.waitFor(() => expect(prompts).toEqual(["A"]));
    const b = runner.submit("c", { text: "B", delivery: "followup", runId: "ep_b" });
    const c = runner.submit("c", { text: "C", delivery: "followup", runId: "ep_c" });
    const d = runner.submit("c", { text: "D", delivery: "followup", runId: "ep_d" });
    expect(a.runId).toBe("ep_a");
    expect(b.runId).toBe("ep_b");
    expect(c.runId).toBe("ep_c");
    expect(d.runId).toBe("ep_d");
    releaseFirst!();
    await vi.waitFor(() => expect(prompts).toEqual(["A", "B", "C", "D"]));
    await runner.join("c");
    // Extra settle window — no fifth run, no dropped tail.
    await new Promise((r) => setTimeout(r, 30));
    expect(prompts).toEqual(["A", "B", "C", "D"]);
    expect(terminals.map((t) => t.text)).toEqual(["A", "B", "C", "D"]);
  });

  it("C1: items queued during B also execute (A→B + E/F while B active)", async () => {
    const prompts: string[] = [];
    const gates = new Map<string, () => void>();
    const kernel: EpisodeKernel = {
      async run({ prompt, emit }) {
        prompts.push(prompt);
        if (prompt === "A" || prompt === "B") {
          await new Promise<void>((resolve) => {
            gates.set(prompt, resolve);
          });
        }
        emit({ type: "delta", textDelta: `${prompt} ` });
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
    runner.submit("c", { text: "A", delivery: "steer" });
    await vi.waitFor(() => expect(gates.has("A")).toBe(true));
    runner.submit("c", { text: "B", delivery: "followup" });
    gates.get("A")!();
    await vi.waitFor(() => expect(gates.has("B")).toBe(true));
    runner.submit("c", { text: "E", delivery: "followup" });
    runner.submit("c", { text: "F", delivery: "followup" });
    gates.get("B")!();
    await vi.waitFor(() => expect(prompts).toEqual(["A", "B", "E", "F"]));
    await runner.join("c");
  });

  it("C1: every prompt() Promise settles when B/C/D are queued during A", async () => {
    let releaseA: (() => void) | null = null;
    const kernel: EpisodeKernel = {
      async run({ prompt }) {
        if (prompt === "A") {
          await new Promise<void>((resolve) => {
            releaseA = resolve;
          });
        }
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
    const pA = runner.prompt("c", { text: "A", delivery: "steer", runId: "wa" });
    await vi.waitFor(() => expect(releaseA).toBeTruthy());
    const pB = runner.prompt("c", { text: "B", delivery: "followup", runId: "wb" });
    const pC = runner.prompt("c", { text: "C", delivery: "followup", runId: "wc" });
    const pD = runner.prompt("c", { text: "D", delivery: "followup", runId: "wd" });
    releaseA!();
    const results = await Promise.all([pA, pB, pC, pD]);
    expect(results.map((r) => r.text)).toEqual(["A", "B", "C", "D"]);
    expect(results.every((r) => r.stopReason === "completed")).toBe(true);
  });

  it("C2: Owner interrupt aborts active and every queued waiter; queue is empty", async () => {
    let releaseA: (() => void) | null = null;
    const executed: string[] = [];
    const kernel: EpisodeKernel = {
      async run({ prompt, signal }) {
        executed.push(prompt);
        if (prompt === "A") {
          await new Promise<void>((resolve, reject) => {
            releaseA = resolve;
            signal.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("aborted")),
              { once: true },
            );
          });
        }
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
    const pA = runner.prompt("c", { text: "A", delivery: "steer", runId: "a1" });
    await vi.waitFor(() => expect(releaseA).toBeTruthy());
    const pB = runner.prompt("c", { text: "B", delivery: "followup", runId: "b1" });
    const pC = runner.prompt("c", { text: "C", delivery: "followup", runId: "c1" });
    runner.interrupt("c");
    // Active A may surface as aborted completed or error; queued B/C must not hang.
    const settled = await Promise.allSettled([pA, pB, pC]);
    expect(settled.every((s) => s.status === "fulfilled" || s.status === "rejected")).toBe(true);
    for (const s of settled) {
      if (s.status === "fulfilled") {
        expect(s.value.stopReason).toBe("aborted");
      }
    }
    // No ghost execution of B/C after Owner abort.
    await new Promise((r) => setTimeout(r, 40));
    expect(executed.filter((p) => p === "B" || p === "C")).toEqual([]);
    // Queue drained — a new prompt after abort must still run once.
    const after = await runner.prompt("c", { text: "Z", delivery: "steer", runId: "z1" });
    expect(after.text).toBe("Z");
    expect(after.stopReason).toBe("completed");
  });

  it("C2: delivery interrupt replacement cancels old queue and runs X once", async () => {
    let releaseA: (() => void) | null = null;
    const executed: string[] = [];
    const kernel: EpisodeKernel = {
      async run({ prompt, signal }) {
        executed.push(prompt);
        if (prompt === "A") {
          await new Promise<void>((resolve, reject) => {
            releaseA = resolve;
            signal.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("aborted")),
              { once: true },
            );
          });
        }
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
    const pA = runner.prompt("c", { text: "A", delivery: "steer", runId: "ia" });
    await vi.waitFor(() => expect(releaseA).toBeTruthy());
    const pB = runner.prompt("c", { text: "B", delivery: "followup", runId: "ib" });
    const pC = runner.prompt("c", { text: "C", delivery: "followup", runId: "ic" });
    const pX = runner.prompt("c", {
      text: "X",
      delivery: "interrupt",
      runId: "ix",
    });
    const settledOld = await Promise.allSettled([pA, pB, pC]);
    for (const s of settledOld) {
      if (s.status === "fulfilled") {
        expect(s.value.stopReason).toBe("aborted");
      }
    }
    const x = await pX;
    expect(x.text).toBe("X");
    expect(x.stopReason).toBe("completed");
    expect(executed.filter((p) => p === "X")).toHaveLength(1);
    expect(executed.filter((p) => p === "B" || p === "C")).toEqual([]);
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
    const resolved = runner.resolveApproval(approvalId!, {
      approved: true,
      note: "yes",
      decidedBy: "test:owner",
    });
    expect(resolved.handled).toBe(true);
    expect(resolved.remembered).toBe(false);
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
    expect(result.runId).toMatch(/^(?:ep_|run_)/);
  });

  it("C7: L2 remember grants same capability for the session; L3 never", async () => {
    let l2Calls = 0;
    let l3Calls = 0;
    const kernel: EpisodeKernel = {
      async run({ requestApproval, prompt }) {
        if (prompt.startsWith("l2")) {
          l2Calls += 1;
          const v = await requestApproval({
            toolName: "write",
            action: "write file",
            capability: "l2:modify-existing",
            level: "L2",
            argsExcerpt: "{}",
          });
          return {
            stopReason: "completed",
            text: v.approved ? "l2-ok" : "l2-no",
            inputTokens: 1,
            outputTokens: 1,
            turns: 1,
          };
        }
        l3Calls += 1;
        const v = await requestApproval({
          toolName: "bash",
          action: "curl",
          capability: "l3:network",
          level: "L3",
          argsExcerpt: "{}",
        });
        return {
          stopReason: "completed",
          text: v.approved ? "l3-ok" : "l3-no",
          inputTokens: 1,
          outputTokens: 1,
          turns: 1,
        };
      },
    };
    const runner = new EpisodeRunner({ kernel });
    let l2ApprovalId: string | null = null;
    let l3ApprovalId: string | null = null;
    runner.on((e) => {
      if (e.event === "episode.approval.requested") {
        if (e.level === "L2") l2ApprovalId = e.approvalId;
        if (e.level === "L3") l3ApprovalId = e.approvalId;
      }
    });

    const p1 = runner.prompt("conv", { text: "l2-1", delivery: "steer" });
    await vi.waitFor(() => expect(l2ApprovalId).toBeTruthy());
    const l2Resolved = runner.resolveApproval(l2ApprovalId!, {
      approved: true,
      note: "yes",
      remember: true,
      decidedBy: "desktop:owner",
    });
    expect(l2Resolved.handled).toBe(true);
    expect(l2Resolved.remembered).toBe(true);
    expect(runner.getApprovalAudit(l2ApprovalId!)?.decidedBy).toBe("desktop:owner");
    await expect(p1).resolves.toMatchObject({ text: "l2-ok" });
    expect(runner.hasSessionGrant("conv", "l2:modify-existing")).toBe(true);

    // Second L2 same capability: no approval event, auto grant.
    l2ApprovalId = null;
    const p2 = await runner.prompt("conv", { text: "l2-2", delivery: "steer" });
    expect(p2.text).toBe("l2-ok");
    expect(l2ApprovalId).toBeNull();
    expect(l2Calls).toBe(2);

    // L3 with remember still asks every time.
    const p3 = runner.prompt("conv", { text: "l3-1", delivery: "steer" });
    await vi.waitFor(() => expect(l3ApprovalId).toBeTruthy());
    const l3Resolved = runner.resolveApproval(l3ApprovalId!, {
      approved: true,
      note: "yes",
      remember: true,
      decidedBy: "desktop:owner",
    });
    // R9: L3 remember request must not report remembered=true.
    expect(l3Resolved.handled).toBe(true);
    expect(l3Resolved.remembered).toBe(false);
    await expect(p3).resolves.toMatchObject({ text: "l3-ok" });
    expect(runner.hasSessionGrant("conv", "l3:network")).toBe(false);

    l3ApprovalId = null;
    const p4 = runner.prompt("conv", { text: "l3-2", delivery: "steer" });
    await vi.waitFor(() => expect(l3ApprovalId).toBeTruthy());
    runner.resolveApproval(l3ApprovalId!, {
      approved: false,
      note: "no",
      decidedBy: "desktop:owner",
    });
    await expect(p4).resolves.toMatchObject({ text: "l3-no" });
    expect(l3Calls).toBe(2);
  });

  it("R9: late approval after abort cannot revive the episode or grant", async () => {
    const executed: string[] = [];
    const kernel: EpisodeKernel = {
      async run({ prompt, requestApproval }) {
        executed.push(prompt);
        if (prompt === "A") {
          // Active episode requests an L2 approval and parks on it.
          await requestApproval({
            toolName: "write",
            action: "write",
            capability: "l2:modify-existing",
            level: "L2",
            argsExcerpt: "{}",
          });
          return {
            stopReason: "completed",
            text: "a-done",
            inputTokens: 1,
            outputTokens: 1,
            turns: 1,
          };
        }
        if (prompt === "L2") {
          return {
            stopReason: "completed",
            text: (await requestApproval({
              toolName: "write",
              action: "write",
              capability: "l2:modify-existing",
              level: "L2",
              argsExcerpt: "{}",
            })).approved
              ? "ok"
              : "no",
            inputTokens: 1,
            outputTokens: 1,
            turns: 1,
          };
        }
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
    let approvalId: string | null = null;
    runner.on((e) => {
      if (e.event === "episode.approval.requested") approvalId = e.approvalId;
    });
    // Active episode with a pending L2 approval, then Owner abort cancels it.
    const pA = runner.prompt("c", { text: "A", delivery: "steer", runId: "a" });
    await vi.waitFor(() => expect(approvalId).toBeTruthy());
    const heldApprovalId = approvalId;
    runner.interrupt("c");
    await Promise.allSettled([pA]);
    // Late decision arrives after abort: must not resolve (episode gone),
    // must not grant a session capability.
    const late = runner.resolveApproval(heldApprovalId!, {
      approved: true,
      note: "late",
      remember: true,
      decidedBy: "desktop:owner",
    });
    expect(late.handled).toBe(false);
    expect(late.remembered).toBe(false);
    expect(runner.hasSessionGrant("c", "l2:modify-existing")).toBe(false);
    // No ghost execution of the cancelled approval path after abort.
    await new Promise((r) => setTimeout(r, 40));
    expect(executed).toHaveLength(1);
  });
});

// Reference to avoid unused-import lint in some configs.
void events;
void EventEmitter;
