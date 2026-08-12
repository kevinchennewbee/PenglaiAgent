/**
 * Desktop pure-logic suites: formatters, the conversation stream reducer,
 * and the workbench view-model derivations. No DOM anywhere — components
 * render exactly what these functions return.
 */

import { describe, expect, it } from "vitest";
import type {
  Conversation,
  Evidence,
  Message,
  Project,
  Run,
  RuntimeHandshake,
  Task,
  UsageReport,
} from "@penglai/protocol";
import {
  clockLabel,
  compareVersions,
  firstLine,
  formatRatio,
  formatTokens,
  oneLine,
  shortId,
  timeAgo,
} from "../src/state/format.js";
import {
  initialStreamState,
  loadTranscript,
  messageText,
  noticeForPromptAck,
  reduceConversationEvent,
  streamItems,
  toolSummary,
} from "../src/state/conversation.js";
import { CONVERSATION_PROMPT_ACK } from "@penglai/protocol";
import {
  buildProjectTree,
  checkHandshake,
  collectActiveTasks,
  deriveProgress,
  dimensionLabel,
  dimensionSeverity,
  groupEvidence,
  taskStateClass,
  taskStatusLabel,
  usageForProject,
  usageTotalForProject,
} from "../src/state/workbench.js";

// ── fixtures ───────────────────────────────────────────────────

const NOW = 1_800_000_000_000;

function makeProject(id: string, name: string, trusted = true): Project {
  return {
    schemaVersion: 1,
    id,
    name,
    rootPath: `/tmp/${name}`,
    repositoryUrl: null,
    repositoryBranch: null,
    status: "active",
    trusted,
    defaultModelProfileId: null,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 5_000,
  };
}

function makeTask(id: string, projectId: string, status: Task["status"], updatedAt = NOW): Task {
  return {
    schemaVersion: 1,
    id,
    projectId,
    title: `task-${id}`,
    objective: "do the thing",
    acceptanceCriteria: [],
    status,
    sourceChannel: "desktop",
    createdAt: NOW - 20_000,
    updatedAt,
    completedAt: null,
  };
}

function makeMessage(id: string, role: Message["role"], text: string, at: number): Message {
  return {
    id,
    conversationId: "conv_1",
    role,
    createdAt: at,
    content: [{ type: "text", text }],
  };
}

function makeRun(id: string, status: Run["status"], sequence = 1): Run {
  return {
    schemaVersion: 1,
    id,
    taskId: "t1",
    sequence,
    status,
    kernel: "pi",
    modelProfileId: "test",
    budget: { maxDurationMs: null, maxTokens: null, maxToolFailures: 5 },
    startedAt: NOW - 1000,
    finishedAt: null,
    createdAt: NOW - 2000,
    updatedAt: NOW,
    error: null,
  };
}

function makeEvidence(id: string, kind: Evidence["kind"], at = NOW): Evidence {
  return {
    schemaVersion: 1,
    id,
    taskId: "t1",
    runId: "r1",
    stepId: null,
    kind,
    title: id,
    summary: "observed",
    uri: null,
    sha256: null,
    metadata: {},
    createdAt: at,
  };
}

function makeConversation(mode: "chat" | "work"): Conversation {
  return {
    schemaVersion: 1,
    id: "conv_1",
    workspaceId: "ws_1",
    title: "hello",
    status: "idle",
    modelProfileId: "test",
    mode,
    activeTaskId: mode === "work" ? "t1" : null,
    createdAt: NOW - 1000,
    updatedAt: NOW,
    endedAt: null,
  };
}

const HANDSHAKE: RuntimeHandshake = {
  ok: true,
  product: "Penglai",
  productVersion: "0.4.0",
  runtime: "host",
  runtimeVersion: "0.4.0",
  protocolSchemaVersion: 1,
  databaseSchemaVersion: 7,
  minimumDesktopVersion: "0.4.0",
  instanceId: "inst",
};

// ── format ─────────────────────────────────────────────────────

describe("format", () => {
  it("timeAgo buckets", () => {
    expect(timeAgo(NOW - 30_000, NOW)).toBe("刚刚");
    expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(timeAgo(NOW - 3 * 60 * 60_000, NOW)).toBe("3 小时前");
    expect(timeAgo(NOW - 2 * 24 * 60 * 60_000, NOW)).toMatch(/月/);
  });
  it("formatTokens compacts", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(3200)).toBe("3.2k");
    expect(formatTokens(14000)).toBe("1.4 万");
  });
  it("compareVersions orders semver-ish strings", () => {
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
    expect(compareVersions("0.3.9", "0.4.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.4.9")).toBe(1);
  });
  it("small formatters", () => {
    expect(formatRatio(null)).toBe("无上限");
    expect(formatRatio(0.83)).toBe("83%");
    expect(shortId("abcdefghijklmnop")).toBe("abcdefgh");
    expect(oneLine("a  b\n c", 10)).toBe("a b c");
    expect(firstLine("第一行\n第二行", 10)).toBe("第一行");
    expect(clockLabel(NOW)).toMatch(/\d{2}:\d{2}/);
  });
});

// ── conversation stream reducer ────────────────────────────────

describe("conversation stream reducer", () => {
  it("accumulates deltas, tracks tools, clears on prompt completion", () => {
    let state = initialStreamState(makeConversation("chat"));
    state = reduceConversationEvent(state, { event: "conversation.prompt.started", episodeId: "e1" });
    expect(state.streaming).toBe(true);
    state = reduceConversationEvent(state, { event: "conversation.delta", textDelta: "你好" });
    state = reduceConversationEvent(state, { event: "conversation.delta", textDelta: "，世界" });
    expect(state.streamingText).toBe("你好，世界");
    state = reduceConversationEvent(state, {
      event: "conversation.tool.started",
      toolCallId: "c1",
      toolName: "read",
    });
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0].ok).toBeNull();
    state = reduceConversationEvent(state, {
      event: "conversation.tool.completed",
      toolCallId: "c1",
      toolName: "read",
      isError: false,
    });
    expect(state.tools[0].ok).toBe(true);
    expect(toolSummary(state.tools)).toEqual({ total: 1, failed: 0, running: 0 });
    state = reduceConversationEvent(state, { event: "conversation.prompt.completed", stopReason: "completed" });
    expect(state.streaming).toBe(false);
    // Episode end replaces the live bubble and clears in-flight tool chips.
    expect(state.streamingText).toBe("");
    expect(toolSummary(state.tools)).toEqual({ total: 0, failed: 0, running: 0 });
  });

  it("dedupes durable messages and merges transcript by timestamp", () => {
    let state = initialStreamState(makeConversation("chat"));
    const user = makeMessage("m1", "user", "hi", NOW - 100);
    state = reduceConversationEvent(state, { event: "conversation.message.user", message: user });
    state = reduceConversationEvent(state, { event: "conversation.message.user", message: user });
    expect(state.messages).toHaveLength(1);
    state = loadTranscript(state, makeConversation("chat"), [
      user,
      makeMessage("m2", "assistant", "hello back", NOW - 50),
    ]);
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(messageText(state.messages[1])).toBe("hello back");
  });

  it("renders the mode proposal card and budget/stop notices in the stream", () => {
    let state = initialStreamState(makeConversation("chat"));
    const task = makeTask("t1", "p1", "ready");
    const project = makeProject("p1", "demo");
    state = reduceConversationEvent(state, {
      event: "conversation.mode.changed",
      mode: "work",
      activeTaskId: "t1",
      task,
      project,
    });
    expect(state.mode).toBe("work");
    expect(state.activeTaskId).toBe("t1");
    state = reduceConversationEvent(state, {
      event: "budget.tripped",
      message: "全局日预算已熔断",
    });
    state = reduceConversationEvent(state, {
      event: "conversation.prompt.blocked",
      reason: "turn budget exhausted (6/6)",
    });
    const items = streamItems(state);
    expect(items.some((item) => item.kind === "mode")).toBe(true);
    const notices = items.filter((item) => item.kind === "notice");
    expect(notices.map((n) => (n.kind === "notice" ? n.tone : ""))).toEqual(["alert", "warn"]);
  });

  it("orders stream items by timestamp with the live bubble last", () => {
    let state = initialStreamState(makeConversation("chat"));
    state = reduceConversationEvent(state, {
      event: "conversation.message.user",
      message: makeMessage("m1", "user", "first", NOW - 100),
    });
    state = reduceConversationEvent(state, {
      event: "conversation.message.assistant",
      message: makeMessage("m2", "assistant", "second", NOW - 50),
    });
    state = reduceConversationEvent(state, { event: "conversation.prompt.started" });
    state = reduceConversationEvent(state, { event: "conversation.delta", textDelta: "live" });
    const items = streamItems(state);
    expect(items.map((item) => item.kind)).toEqual(["message", "message", "streaming"]);
  });

  it("clears the live bubble after completion so finals are not doubled", () => {
    let state = initialStreamState(makeConversation("chat"));
    state = reduceConversationEvent(state, { event: "conversation.prompt.started" });
    state = reduceConversationEvent(state, { event: "conversation.delta", textDelta: "hello" });
    state = reduceConversationEvent(state, {
      event: "conversation.message.assistant",
      message: makeMessage("m1", "assistant", "hello", NOW),
    });
    state = reduceConversationEvent(state, { event: "conversation.prompt.completed" });
    expect(state.streaming).toBe(false);
    expect(state.streamingText).toBe("");
    const items = streamItems(state);
    expect(items.map((item) => item.kind)).toEqual(["message"]);
    expect(items[0]).toMatchObject({ kind: "message", text: "hello" });
  });

  it("strips think tags from display text and keeps thinking collapsible", () => {
    let state = initialStreamState(makeConversation("chat"));
    state = reduceConversationEvent(state, {
      event: "conversation.message.assistant",
      message: makeMessage(
        "m1",
        "assistant",
        "<think>secret plan</think>\n\n我是来来",
        NOW,
      ),
    });
    state = reduceConversationEvent(state, {
      event: "conversation.thinking",
      text: "secret plan",
    });
    const items = streamItems(state);
    const message = items.find((item) => item.kind === "message");
    const thinking = items.find((item) => item.kind === "thinking");
    expect(message).toMatchObject({ kind: "message", text: "我是来来" });
    expect(thinking).toMatchObject({ kind: "thinking", text: "secret plan" });
  });
});

// ── workbench view models ──────────────────────────────────────

describe("checkHandshake", () => {
  it("accepts a compatible host", () => {
    expect(checkHandshake(HANDSHAKE).compatible).toBe(true);
  });
  it("rejects protocol / database / version mismatches and impostors", () => {
    expect(
      checkHandshake({ ...HANDSHAKE, protocolSchemaVersion: 2 }).reason,
    ).toContain("协议版本不兼容");
    expect(
      checkHandshake({ ...HANDSHAKE, databaseSchemaVersion: 5 }).reason,
    ).toContain("数据库版本不兼容");
    expect(
      checkHandshake({ ...HANDSHAKE, minimumDesktopVersion: "9.9.9" }).reason,
    ).toContain("低于 Host 要求");
    expect(checkHandshake({ ...HANDSHAKE, product: "Other" }).reason).toContain("不是蓬莱 Host");
  });
});

describe("project tree + active collection", () => {
  it("builds sorted task trees and collects live tasks", () => {
    const p1 = makeProject("p1", "alpha");
    const p2 = makeProject("p2", "beta", false);
    const tasks = new Map<string, Task[]>([
      ["p1", [makeTask("t1", "p1", "ready", NOW - 5000), makeTask("t2", "p1", "running", NOW)]],
      ["p2", [makeTask("t3", "p2", "completed", NOW - 100)]],
    ]);
    const nodes = buildProjectTree([p1, p2], tasks);
    expect(nodes[0].tasks.map((task) => task.id)).toEqual(["t2", "t1"]);
    const active = collectActiveTasks(nodes);
    expect(active.map((entry) => entry.task.id)).toEqual(["t2"]);
  });
});

describe("deriveProgress", () => {
  const bundleBase = {
    task: makeTask("t1", "p1", "ready"),
    runs: [] as Run[],
    steps: [],
    evidence: [],
    approvals: [],
    checkpoints: [],
  };
  it("no run yet → start", () => {
    const progress = deriveProgress(bundleBase);
    expect(progress.canStart).toBe(true);
    expect(progress.live).toBe(false);
    expect(progress.nextAction).toContain("尚未运行");
  });
  it("running → live, pause/cancel", () => {
    const progress = deriveProgress({ ...bundleBase, runs: [makeRun("r1", "running")] });
    expect(progress.live).toBe(true);
    expect(progress.canStart).toBe(false);
    expect(progress.nextAction).toContain("可暂停或取消");
  });
  it("pending approval overrides the next action", () => {
    const approval = {
      schemaVersion: 1,
      id: "a1",
      taskId: "t1",
      runId: "r1",
      capability: "l3:irreversible",
      action: "删除文件",
      reason: "irreversible",
      status: "pending",
      requestedBy: "kernel",
      decidedBy: null,
      decisionNote: null,
      createdAt: NOW,
      decidedAt: null,
    } as const;
    const progress = deriveProgress({
      ...bundleBase,
      runs: [makeRun("r1", "waiting_approval")],
      approvals: [approval],
    });
    expect(progress.pendingApprovals).toHaveLength(1);
    expect(progress.nextAction).toContain("等待审批");
  });
  it("paused → resume from checkpoint", () => {
    const progress = deriveProgress({ ...bundleBase, runs: [makeRun("r1", "paused")] });
    expect(progress.canStart).toBe(true);
    expect(progress.nextAction).toContain("checkpoint 续接");
  });
});

describe("groupEvidence + usage + budget dimensions", () => {
  it("groups evidence into rail sections, newest first", () => {
    const groups = groupEvidence([
      makeEvidence("e1", "log", NOW - 300),
      makeEvidence("e2", "diff", NOW - 100),
      makeEvidence("e3", "test", NOW - 200),
      makeEvidence("e4", "command", NOW - 50),
      makeEvidence("e5", "artifact", NOW),
    ]);
    expect(groups.outputs.map((e) => e.id)).toEqual(["e1"]);
    expect(groups.diffs.map((e) => e.id)).toEqual(["e2"]);
    expect(groups.tests.map((e) => e.id)).toEqual(["e3"]);
    expect(groups.commands.map((e) => e.id)).toEqual(["e4"]);
    expect(groups.artifacts.map((e) => e.id)).toEqual(["e5"]);
  });
  it("filters usage rows by project", () => {
    const report: UsageReport = {
      totalTokens: 100,
      totalRequests: 3,
      inputTokens: 60,
      outputTokens: 40,
      rows: [
        { day: "2027-01-01", mode: "work", projectId: "p1", inputTokens: 10, outputTokens: 5, requests: 1, updatedAt: NOW },
        { day: "2027-01-01", mode: "chat", projectId: "", inputTokens: 50, outputTokens: 35, requests: 2, updatedAt: NOW },
      ],
    };
    expect(usageForProject(report, "p1")).toHaveLength(1);
    expect(usageTotalForProject(report, "p1")).toBe(15);
  });
  it("labels budget dimensions and severities", () => {
    const projects = [makeProject("p1", "alpha")];
    expect(dimensionLabel("day", projects)).toBe("全局日预算");
    expect(dimensionLabel("project:p1", projects)).toBe("项目「alpha」日预算");
    expect(
      dimensionSeverity({
        dimension: "day",
        day: "2027-01-01",
        limitTokens: 1000,
        usedTokens: 900,
        ratio: 0.9,
        warned: true,
        tripped: false,
        lifted: false,
      }),
    ).toBe("warn");
    expect(
      dimensionSeverity({
        dimension: "day",
        day: "2027-01-01",
        limitTokens: 1000,
        usedTokens: 1100,
        ratio: 1.1,
        warned: true,
        tripped: true,
        lifted: false,
      }),
    ).toBe("alert");
  });
  it("maps task statuses to classes and labels", () => {
    expect(taskStateClass("running")).toBe("working");
    expect(taskStateClass("waiting_approval")).toBe("waiting");
    expect(taskStateClass("archived")).toBe("paused");
    expect(taskStatusLabel("waiting_approval")).toBe("待审批");
    expect(taskStatusLabel("blocked")).toBe("已熔断");
  });
});

describe("F1 noticeForPromptAck", () => {
  it("maps structured stopDetail enums and ignores text substrings", () => {
    expect(noticeForPromptAck(CONVERSATION_PROMPT_ACK.FOLLOWUP_QUEUED)).toContain("已排队");
    expect(noticeForPromptAck(CONVERSATION_PROMPT_ACK.STEER_QUEUED)).toContain("插入");
    expect(noticeForPromptAck("steered")).toBeNull();
    expect(noticeForPromptAck("queued")).toBeNull();
    expect(noticeForPromptAck("(queued as follow-up)")).toBeNull();
    expect(noticeForPromptAck(null)).toBeNull();
  });
});
