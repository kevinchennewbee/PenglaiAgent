import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";
import {
  setActiveGoal,
  loadGoal,
  updateGoalStatus,
  onEpisodeEnd,
  mirrorGoalText,
  clearGoal,
} from "../src/goal-service.js";

describe("goal-service", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-goal-"));
    _setPenglaiHomeForTest(home);
  });
  afterEach(() => {
    _setPenglaiHomeForTest(null);
    fs.rmSync(home, { recursive: true, force: true });
  });

  function expectPrivateMode(target: string, expected: number): void {
    if (process.platform === "win32") return;
    expect(fs.statSync(target).mode & 0o777).toBe(expected);
  }

  it("sets active goal and mirrors text", () => {
    const g = setActiveGoal({ conversationId: "conv_test", objective: "修绿构建" });
    expect(g.status).toBe("active");
    expect(mirrorGoalText(g)).toBe("修绿构建");
    expect(loadGoal("conv_test")?.objective).toBe("修绿构建");
    const conversationDir = path.join(home, "conversations", "conv_test");
    expectPrivateMode(conversationDir, 0o700);
    expectPrivateMode(path.join(conversationDir, "goal.json"), 0o600);
  });

  it("complete requires summary and episode settlement keeps it terminal", () => {
    setActiveGoal({ conversationId: "conv_test", objective: "X" });
    expect(() =>
      updateGoalStatus({ conversationId: "conv_test", status: "complete" }),
    ).toThrow(/summary/);
    const done = updateGoalStatus({
      conversationId: "conv_test",
      status: "complete",
      summary: "构建已绿，测试全过",
    });
    expect(done.status).toBe("completed");
    expect(mirrorGoalText(done)).toBeNull();
    expectPrivateMode(
      path.join(home, "conversations", "conv_test", "goal-history.jsonl"),
      0o600,
    );
    const decision = onEpisodeEnd({
      conversationId: "conv_test",
      stopReason: "completed",
      turns: 1,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(decision.action).toBe("none");
  });

  it("records settled active episodes without generating an automatic continue", () => {
    setActiveGoal({ conversationId: "conv_c", objective: "长任务" });
    for (let i = 0; i < 8; i += 1) {
      const d = onEpisodeEnd({
        conversationId: "conv_c",
        stopReason: "completed",
        turns: 2,
        inputTokens: 3,
        outputTokens: 1,
      });
      expect(d.action).toBe("none");
      expect(d).not.toHaveProperty("prompt");
      if (d.action === "none") expect(d.reason).toMatch(/owner action required/i);
    }
    const goal = loadGoal("conv_c");
    expect(goal?.status).toBe("active");
    expect(goal?.usage?.episodes).toBe(8);
    expect(goal?.usage?.autoContinues).toBe(0);
  });

  it("clear cancels active goal", () => {
    setActiveGoal({ conversationId: "conv_x", objective: "Y" });
    const c = clearGoal("conv_x");
    expect(c?.status).toBe("cancelled");
    expect(mirrorGoalText(c!)).toBeNull();
  });

  it("a blocked goal cannot be un-blocked by the model (owner-only)", () => {
    setActiveGoal({ conversationId: "conv_g", objective: "长任务" });
    const blocked = onEpisodeEnd({
      conversationId: "conv_g",
      stopReason: "budget",
      turns: 2,
      inputTokens: 3,
      outputTokens: 1,
    });
    expect(blocked.action).toBe("blocked");
    expect(loadGoal("conv_g")?.status).toBe("blocked");
    // Model calling update_goal(active) must be refused.
    expect(() =>
      updateGoalStatus({ conversationId: "conv_g", status: "active" }),
    ).toThrow(/owner/);
    // The owner channel (conversation.goal.continue) may un-block.
    const resumed = updateGoalStatus({
      conversationId: "conv_g",
      status: "active",
      ownerUnblock: true,
    });
    expect(resumed.status).toBe("active");
    expect(resumed.blockedReason).toBeNull();
  });

  it("a completed goal cannot be re-activated by the model (owner-only)", () => {
    setActiveGoal({ conversationId: "conv_h", objective: "X" });
    updateGoalStatus({
      conversationId: "conv_h",
      status: "complete",
      summary: "已完成",
    });
    expect(() =>
      updateGoalStatus({ conversationId: "conv_h", status: "active" }),
    ).toThrow(/owner/);
    expect(
      updateGoalStatus({
        conversationId: "conv_h",
        status: "active",
        ownerUnblock: true,
      }).status,
    ).toBe("active");
  });
});
