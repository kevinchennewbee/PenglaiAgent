/**
 * penglai CLI tests.
 *
 *   1. argv / slash-command parsing (pure, no host);
 *   2. end-to-end over a real in-process Host with injected fake kernels —
 *      the CLI is exercised exactly as the owner runs it (runCli + captured
 *      IO), never touching a real model or the real ~/.penglai.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "@penglai/protocol";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";
import { runCli } from "../src/cli/main.js";
import { cmdChatRepl, parseSlashCommand, permissionModeFromFlags, nextPermissionMode, type CliPermissionMode } from "../src/cli/chat.js";
import { HostClient } from "../src/cli/client.js";
import { parseArgs, timeAgo, oneLine, shortId } from "../src/cli/format.js";
import type { CliIO } from "../src/cli/format.js";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";

// ── parsing (pure) ─────────────────────────────────────────────

describe("cli: argv parsing", () => {
  it("parses positionals, valued flags, boolean flags, and the -- separator", () => {
    expect(parseArgs(["task", "show", "abc", "--project", "p1", "--all"])).toEqual({
      positionals: ["task", "show", "abc"],
      flags: { project: "p1", all: true },
    });
    expect(parseArgs(["work", "/tmp/x", "fix it", "--conversation=c1"])).toEqual({
      positionals: ["work", "/tmp/x", "fix it"],
      flags: { conversation: "c1" },
    });
    expect(parseArgs(["chat", "--", "--not-a-flag"])).toEqual({
      positionals: ["chat", "--not-a-flag"],
      flags: {},
    });
  });
});

describe("cli: permission dial", () => {
  it("defaults to auto_edit, and resolves --plan/--confirm/--full flags", () => {
    expect(permissionModeFromFlags({})).toBe("auto_edit");
    expect(permissionModeFromFlags({ plan: true })).toBe("plan");
    expect(permissionModeFromFlags({ confirm: true })).toBe("confirm");
    expect(permissionModeFromFlags({ full: true })).toBe("full");
    // --plan wins over the others if multiple are set (it's most restrictive).
    expect(permissionModeFromFlags({ plan: true, full: true })).toBe("plan");
  });

  it("cycles plan → confirm → auto_edit → full → plan", () => {
    const order: CliPermissionMode[] = ["plan", "confirm", "auto_edit", "full"];
    let mode: CliPermissionMode = "plan";
    for (let i = 0; i < 4; i += 1) {
      mode = nextPermissionMode(mode);
      expect(mode).toBe(order[(i + 1) % 4]!);
    }
  });
});

describe("cli: slash commands", () => {
  it("classifies /exit /mode /new /help, unknown slashes, and plain prompts", () => {
    expect(parseSlashCommand("/exit")).toEqual({ kind: "exit" });
    expect(parseSlashCommand("/quit")).toEqual({ kind: "exit" });
    expect(parseSlashCommand("/mode")).toEqual({ kind: "mode" });
    expect(parseSlashCommand("/new")).toEqual({ kind: "new" });
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
    expect(parseSlashCommand("/bogus")).toEqual({ kind: "unknown", raw: "/bogus" });
    expect(parseSlashCommand("给我讲个笑话")).toEqual({ kind: "prompt", text: "给我讲个笑话" });
  });

  it("classifies /goal /compact /pin /unpin /pins", () => {
    expect(parseSlashCommand("/goal")).toEqual({ kind: "goal", text: null });
    expect(parseSlashCommand("/goal ship 0.4")).toEqual({ kind: "goal", text: "ship 0.4" });
    expect(parseSlashCommand("/goal clear")).toEqual({ kind: "goal_clear" });
    expect(parseSlashCommand("/compact keep TODOs")).toEqual({
      kind: "compact",
      instructions: "keep TODOs",
    });
    expect(parseSlashCommand("/pin file src/a.ts")).toEqual({
      kind: "pin",
      kindPin: "file",
      ref: "src/a.ts",
      label: null,
    });
    expect(parseSlashCommand("/pin skill deploy as 部署")).toEqual({
      kind: "pin",
      kindPin: "skill",
      ref: "deploy",
      label: "部署",
    });
    expect(parseSlashCommand("/unpin src/a.ts")).toEqual({ kind: "unpin", ref: "src/a.ts" });
    expect(parseSlashCommand("/pins")).toEqual({ kind: "pins" });
    expect(parseSlashCommand("/image ./a.png 看看")).toEqual({
      kind: "image",
      path: "./a.png",
      caption: "看看",
    });
    expect(parseSlashCommand("/img /tmp/x.jpg")).toEqual({
      kind: "image",
      path: "/tmp/x.jpg",
      caption: null,
    });
  });
});

describe("cli: floating root authority", () => {
  it("does not send the CLI cwd as conversation.prompt workspace authority", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const conversation = {
      schemaVersion: SCHEMA_VERSION,
      id: "conv_cli_floating",
      workspaceId: "ws_legacy_cli",
      title: "New conversation",
      status: "idle",
      modelProfileId: "profile_cli",
      mode: "chat",
      activeTaskId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      endedAt: null,
    };
    const client = {
      rpc: vi.fn(
        async (method: string, params: Record<string, unknown> = {}) => {
          calls.push({ method, params });
          switch (method) {
            case "config.resolveProfile":
              return {
                profile: { id: "profile_cli", apiKeyEnv: "CLI_TEST_KEY" },
                hasKey: true,
              };
            case "workspace.open":
              return { id: "ws_legacy_cli" };
            case "conversation.create":
              return conversation;
            case "conversation.prompt":
              return { text: "ok", stopReason: "completed", stopDetail: null };
            case "mode.get":
              return { mode: "chat", activeTaskId: null, task: null };
            default:
              throw new Error(`unexpected RPC: ${method}`);
          }
        },
      ),
      subscribe: vi.fn(async () => () => undefined),
    } as unknown as HostClient;
    const cap = capture();

    const code = await cmdChatRepl(
      client,
      { positionals: [], flags: { new: true } },
      cap.io,
      Readable.from(["hello\n", "/exit\n"]),
    );

    expect(code).toBe(0);
    // conversation.create still needs workspaceId for legacy UI/history, but
    // The unified runner no longer treats that registration as a filesystem grant.
    expect(calls.find((call) => call.method === "workspace.open")?.params).toMatchObject({
      rootPath: process.cwd(),
    });
    const prompt = calls.find((call) => call.method === "conversation.prompt");
    expect(prompt?.params).toMatchObject({
      conversationId: conversation.id,
      text: "hello",
    });
    expect(prompt?.params).not.toHaveProperty("workspaceRoot");
  });
});

describe("cli: formatting", () => {
  it("timeAgo / oneLine / shortId stay compact", () => {
    const now = Date.now();
    expect(timeAgo(now - 5_000, now)).toBe("5s ago");
    expect(timeAgo(now - 300_000, now)).toBe("5m ago");
    expect(timeAgo(now - 7_200_000, now)).toBe("2h ago");
    expect(oneLine("a b  c", 10)).toBe("a b c");
    expect(oneLine("x".repeat(100), 10)).toHaveLength(10);
    expect(shortId("conv_1234567890abcd")).toBe("conv_12345…");
  });
});

// ── end-to-end over a real host ────────────────────────────────

const TEST_TOKEN = "cli-e2e-token";

let home: string;
let dataDir: string;
let projectDir: string;
let started: StartedServer;
let baseArgv: string[];

class ControllableKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "cli-e2e-task";
  isRunning = false;
  autoSettle = true;
  private readonly listeners = new Set<KernelEventListener>();
  private settle!: () => void;
  private promptPromise = new Promise<void>((resolve) => {
    this.settle = resolve;
  });

  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: Partial<KernelEvent>): void {
    const full = {
      occurredAt: Date.now(),
      sessionId: this.sessionId,
      raw: event.raw ?? {},
      ...event,
    } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }

  async prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    // One settle channel per episode (the kernel instance is shared across
    // this file's runs).
    this.promptPromise = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
    try {
      this.emit({ kind: "message.delta", textDelta: "干活中…" });
      this.emit({ kind: "turn.completed" });
      this.emit({
        kind: "message.completed",
        raw: {
          type: "message_end",
          message: { role: "assistant", usage: { input: 21, output: 13 } },
        },
      });
      if (this.autoSettle) this.settle();
      await this.promptPromise;
    } finally {
      this.isRunning = false;
    }
  }

  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async abort(): Promise<void> {
    this.settle();
  }
  dispose(): void {}
  complete(): void {
    this.settle();
  }
}

class EchoChatKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "cli-e2e-chat";
  isRunning = false;
  private readonly listeners = new Set<KernelEventListener>();
  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: Partial<KernelEvent>): void {
    const full = {
      occurredAt: Date.now(),
      sessionId: this.sessionId,
      raw: event.raw ?? {},
      ...event,
    } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }
  async prompt(input: KernelPrompt): Promise<void> {
    this.emit({ kind: "message.delta", textDelta: `echo:${input.text}` });
    this.emit({ kind: "turn.completed" });
    this.emit({
      kind: "message.completed",
      raw: {
        type: "message_end",
        message: { role: "assistant", usage: { input: 5, output: 3 } },
      },
    });
  }
  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

const taskKernel = new ControllableKernel();

function capture(): { io: CliIO; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: (t) => {
        out += t;
      },
      line: (t) => {
        out += `${t}\n`;
      },
      err: (t) => {
        err += `${t}\n`;
      },
      tty: false,
    },
    out: () => out,
    err: () => err,
  };
}

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const cap = capture();
  const code = await runCli([...argv, ...baseArgv], { io: cap.io });
  return { code, out: cap.out(), err: cap.err() };
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${started.port}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Penglai-Token": TEST_TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-cli-home-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-cli-data-"));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-cli-proj-"));
  _setPenglaiHomeForTest(home);
  started = await startServer({
    port: 0,
    token: TEST_TOKEN,
    dataDir,
    taskKernelFactory: async () => taskKernel,
    chatKernelFactory: async () => new EchoChatKernel(),
    // 蒸馏复盘走注入缝（NO_SOP），不碰真实端点。
    distillReviewModel: async () => "NO_SOP",
  });
  baseArgv = ["--port", String(started.port), "--token", TEST_TOKEN];
  // A keyed custom profile + a conversation to anchor the flow.
  await rpc("config.createProfile", {
    id: "e2e",
    baseUrl: "https://example.invalid/v1",
    model: "e2e-model",
    apiKey: "e2e-key",
  });
  const workspace = await rpc("workspace.open", { rootPath: projectDir, name: "e2e" });
  await rpc("conversation.create", {
    workspaceId: workspace.id,
    modelProfileId: "e2e",
    title: "cli e2e",
  });
});

afterAll(async () => {
  await started.close();
  _setPenglaiHomeForTest(null);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("cli e2e: basics", () => {
  it("help prints the command surface; unknown commands exit 2", async () => {
    const help = await cli(["help"]);
    expect(help.code).toBe(0);
    for (const word of ["chat", "task", "work", "mode", "memory", "status", "doctor", "serve"]) {
      expect(help.out).toContain(word);
    }
    expect(help.out).toContain("doctor [--export]");
    expect(help.out).not.toMatch(/^\s*demo\b/m);
    const bogus = await cli(["bogus"]);
    expect(bogus.code).toBe(2);
    expect(bogus.err).toContain("unknown command");

    const removedDemo = await cli(["demo"]);
    expect(removedDemo.code).toBe(2);
    expect(removedDemo.err).toContain("unknown command: demo");
  });

  it("status reports host, conversation, tasks, and usage", async () => {
    const result = await cli(["status"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("host     ok");
    expect(result.out).toContain("cli e2e");
    expect(result.out).toContain("usage");
  });

  it("memory list shows the seeded L1; memory read returns it", async () => {
    const list = await cli(["memory", "list"]);
    expect(list.code).toBe(0);
    expect(list.out).toContain("L1");
    const read = await cli(["memory", "read", "L1"]);
    expect(read.code).toBe(0);
    expect(read.out).toContain("蓬莱");
    // The anti-pollution iron rule: the CLI has no write backdoor.
    const write = await cli(["memory", "write", "x"]);
    expect(write.code).not.toBe(0);
  });

  it("config list marks the keyed profile", async () => {
    const result = await cli(["config", "list"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("e2e");
    expect(result.out).toContain("key ✓");
  });

  it("chat --list shows the conversation", async () => {
    const result = await cli(["chat", "--list"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("cli e2e");
  });
});

describe("cli e2e: the chat → work → task loop", () => {
  let taskId: string;
  let projectId: string;

  it("work proposes inertly, then Owner confirm anchors one task", async () => {
    const result = await cli(["work", projectDir, "把构建修绿"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("pending Owner confirmation");
    const mode = await cli(["mode"]);
    expect(mode.out).toContain("floating");
    expect(await rpc("project.list", {})).toEqual([]);
    const conversations = await rpc("conversation.list", {});
    const pending = await rpc("mode.get", { conversationId: conversations[0].id });
    const confirmed = await cli(["work", "confirm", pending.pendingProposal.id, projectDir]);
    expect(confirmed.code).toBe(0);
    expect(confirmed.out).toContain("confirmed");
    expect((await cli(["mode"])).out).toContain("把构建修绿");
    projectId = (await rpc("project.list", {}))[0].id;
    const tasks = await rpc("task.list", { projectId });
    expect(tasks.length).toBeGreaterThan(0);
    taskId = tasks[0].id;
    expect(taskId.length).toBeGreaterThan(8);
  });

  it("task start runs to completion after project is trusted", async () => {
    // mode.confirmWork already recorded the explicit Owner trust decision.
    const run = await cli(["task", "start", taskId]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("干活中");
    expect(run.out).toContain("run completed");

    const show = await cli(["task", "show", taskId]);
    expect(show.out).toContain("completed");
    expect(show.out).toContain("checkpoint turns=1 tokens=34");

    // The usage row: project-anchored.
    const status = await cli(["status"]);
    expect(status.out).toContain("work 34");

    // A finished task has nothing to pause/cancel.
    const paused = await cli(["task", "pause", taskId]);
    expect(paused.out).toContain("no active run");
    const cancelled = await cli(["task", "cancel", taskId]);
    expect(cancelled.out).toContain("no cancellable run");
  });

  it("resume starts a fresh run from the checkpoint", async () => {
    const resumed = await cli(["task", "resume", taskId]);
    expect(resumed.code).toBe(0);
    const bundle = await rpc("task.get", { taskId });
    expect(bundle.runs).toHaveLength(2);
    expect(bundle.checkpoints).toHaveLength(2);
  });
});

describe("cli e2e: pause mid-run", () => {
  it("task pause settles the run as paused and records the checkpoint", async () => {
    const task = await rpc("task.create", {
      projectId: (await rpc("project.list", {}))[0].id,
      title: "长跑任务",
      objective: "跑一个会被暂停的长任务",
    });
    taskKernel.autoSettle = false;
    try {
      const run = await rpc("task.start", { taskId: task.id, modelProfileId: "e2e", source: "cli" });
      expect(run.status).toBe("running");

      const paused = await cli(["task", "pause", task.id]);
      expect(paused.code).toBe(0);
      expect(paused.out).toContain("paused run");

      // The run row is paused immediately; the checkpoint lands right after.
      let bundle = await rpc("task.get", { taskId: task.id });
      expect(bundle.runs.at(-1).status).toBe("paused");
      for (let i = 0; i < 20 && bundle.checkpoints.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        bundle = await rpc("task.get", { taskId: task.id });
      }
      expect(bundle.checkpoints.at(-1).status).toBe("paused");

      // Cancel from paused works without a live episode.
      const cancelled = await cli(["task", "cancel", task.id]);
      expect(cancelled.out).toContain("cancelled run");
      bundle = await rpc("task.get", { taskId: task.id });
      expect(bundle.runs.at(-1).status).toBe("cancelled");
    } finally {
      taskKernel.autoSettle = true;
      taskKernel.complete();
    }
  });
});

describe("cli e2e: the interactive chat REPL", () => {
  it("streams a prompt, answers /mode, and exits on /exit", async () => {
    // The anchored conversation is still in work mode from the task loop;
    // leave work first (the chat executor refuses work-mode prompts).
    const conversations = await rpc("conversation.list", {});
    await rpc("mode.exitWork", { conversationId: conversations[0].id, outcome: "paused" });

    const client = await HostClient.connect({ port: started.port, token: TEST_TOKEN });
    const cap = capture();
    const input = Readable.from(["你好蓬莱\n", "/mode\n", "/exit\n"]);
    const code = await cmdChatRepl(client, { positionals: [], flags: {} }, cap.io, input);
    expect(code).toBe(0);
    expect(cap.out()).toContain("echo:你好蓬莱");
    expect(cap.out()).toContain("mode");
    // The chat beat is durable in the transcript.
    const after = await rpc("conversation.list", {});
    const got = await rpc("conversation.get", { conversationId: after[0].id });
    expect(got.messages.at(-1).role).toBe("assistant");
  });
});

describe("cli e2e: approvals (审批四级制)", () => {
  it("lists pending rows with levels, then approve --remember / approve / reject", async () => {
    const project = (await rpc("project.list", {}))[0];
    const task = await rpc("task.create", {
      projectId: project.id,
      title: "审批任务",
      objective: "触发 L2/L3 审批",
    });
    const l2 = await rpc("approval.request", {
      taskId: task.id,
      capability: "l2:modify-existing",
      action: "edit: file.txt",
      reason: "needs_confirm: 'edit' overwrites an existing file",
      requestedBy: "run:cli-test",
    });
    const l3 = await rpc("approval.request", {
      taskId: task.id,
      capability: "l3:outbound",
      action: "bash: git push origin main",
      reason: "needs_approval: outbound command",
      requestedBy: "run:cli-test",
    });

    const list = await cli(["approval", "list"]);
    expect(list.code).toBe(0);
    expect(list.out).toContain("pending");
    expect(list.out).toContain("L2 l2:modify-existing");
    expect(list.out).toContain("L3 l3:outbound");
    expect(list.out).toContain("git push");
    expect(list.out).toContain("--remember");

    // L2 approve with --remember: the grant lands in the store.
    const granted = await cli(["approval", "approve", l2.id.slice(0, 8), "--remember"]);
    expect(granted.code).toBe(0);
    expect(granted.out).toContain("approved");
    expect(granted.out).toContain("同类免问");
    expect(
      started.handle.productStore.hasPolicyGrant(project.id, "l2:modify-existing"),
    ).toBe(true);

    // L3 approve: decided, never a grant.
    const pushed = await cli(["approval", "approve", l3.id, "--note", "这是我的仓库"]);
    expect(pushed.code).toBe(0);
    expect(pushed.out).toContain("approved");
    expect(started.handle.productStore.listPolicyGrants(project.id)).toHaveLength(1);

    // Reject with a reason on a fresh request.
    const l3b = await rpc("approval.request", {
      taskId: task.id,
      capability: "l3:delete",
      action: "bash: rm -rf build/",
      reason: "needs_approval: destructive command",
      requestedBy: "run:cli-test",
    });
    const rejected = await cli(["approval", "reject", l3b.id, "--note", "不许删"]);
    expect(rejected.code).toBe(0);
    expect(rejected.out).toContain("denied");
    expect(rejected.out).toContain("留痕");

    // Pending is empty now; --all shows the decided provenance.
    const empty = await cli(["approval", "list"]);
    expect(empty.out).toContain("没有待审批项");
    const all = await cli(["approval", "list", "--all"]);
    expect(all.out).toContain("approved");
    expect(all.out).toContain("denied");
    expect(all.out).toMatch(/cli:/); // decidedBy identity
    expect(all.out).toContain("不许删");

    // Unknown id is a coded error, not a crash.
    const missing = await cli(["approval", "approve", "deadbeef"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no approval matches");
  });
});

describe("cli e2e: channel (IM 渠道面板)", () => {
  it("list → allow/deny 白名单 → setup feishu (mock) → list 状态 → disable", async () => {
    // 未配置时：一行引导，exit 0。
    const empty = await cli(["channel", "list"]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("没有已配置的渠道");

    // 白名单管理不需要渠道在线（product-store 持久记录）。
    const allowed = await cli(["channel", "allow", "feishu", "ou_owner", "--name", "owner"]);
    expect(allowed.code).toBe(0);
    expect(allowed.out).toContain("ou_owner → owner");
    const identities = await rpc("channel.identities", { channel: "feishu" });
    expect(identities).toHaveLength(1);
    expect(identities[0].identity).toBe("owner");

    // setup 缺参数：用法错误（与 CLI 其余 missing-arg 一致 exit 1），不打网络。
    const badSetup = await cli(["channel", "setup", "feishu", "--app-id", "only-id"]);
    expect(badSetup.code).toBe(1);
    expect(badSetup.err).toContain("--app-secret");

    // 真 setup：指向 mock 飞书服务端（不打真实飞书 API）。
    const { MockFeishuServer } = await import("./feishu/mock-server.js");
    const mock = new MockFeishuServer();
    await mock.start();
    try {
      const setup = await cli([
        "channel",
        "setup",
        "feishu",
        "--app-id",
        "cli_mock",
        "--app-secret",
        "mock_secret",
        "--domain",
        mock.baseUrl,
      ]);
      expect(setup.code).toBe(0);
      expect(setup.out).toContain("configured");
      expect(setup.out).toContain("connected");
      // 长连接真的建立起来了。
      const deadline = Date.now() + 5000;
      while (mock.connections < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(mock.connections).toBe(1);

      // list：状态 + 白名单计数。
      const listed = await cli(["channel", "list"]);
      expect(listed.out).toContain("feishu");
      expect(listed.out).toContain("connected");
      expect(listed.out).toContain("cli_mock");
      expect(listed.out).toContain("白名单 1");

      // deny：从白名单移除。
      const denied = await cli(["channel", "deny", "feishu", "ou_owner"]);
      expect(denied.code).toBe(0);
      expect(denied.out).toContain("已从白名单移除");
      expect(await rpc("channel.identities", { channel: "feishu" })).toHaveLength(0);

      // disable：停连 + enabled=false（channels.json 保留）。
      const disabled = await cli(["channel", "disable", "feishu"]);
      expect(disabled.code).toBe(0);
      expect(disabled.out).toContain("disabled");
      const rows = await rpc("channel.list", {});
      expect(rows[0].enabled).toBe(false);
      expect(rows[0].state).toBe("stopped");
    } finally {
      // 即使断言失败也要停掉渠道，别让它留在共享 host 里连 mock。
      await rpc("channel.disable", { channel: "feishu" }).catch(() => undefined);
      await mock.close();
    }
  });
});

describe("cli e2e: budget / memory sop / distill", () => {
  it("budget set → status → lift 全链路（RPC 落库 + CLI 面板）", async () => {
    const set = await cli(["budget", "set", "--daily-tokens", "1000", "--project-daily-tokens", "500"]);
    expect(set.code).toBe(0);
    expect(set.out).toContain("saved");
    expect(set.out).toContain("1,000");

    const status = await cli(["budget"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("全局日 1,000");
    expect(status.out).toContain("项目日 500");

    // 无撞线时 lift 是明确空操作。
    const none = await cli(["budget", "lift"]);
    expect(none.code).toBe(0);
    expect(none.out).toContain("没有处于撞线状态");

    // 清理：恢复不限（别影响共享 host 上的其他用例）。
    const cleared = await cli(["budget", "set", "--daily-tokens", "off", "--project-daily-tokens", "off"]);
    expect(cleared.code).toBe(0);
    expect(cleared.out).toContain("不限");
  });

  it("status 面板含 budget 行（配置了上限时常显）", async () => {
    await cli(["budget", "set", "--daily-tokens", "2000"]);
    const status = await cli(["status"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("budget");
    expect(status.out).toContain("2,000");
    await cli(["budget", "set", "--daily-tokens", "off"]);
  });

  it("memory sop list/show/remove 管理技能树（写入仍无后门）", async () => {
    // 技能树只由蒸馏环写入：测试经同进程 handle 直接落一条（生产等价物
    // 是 DistillService 的 writeGlobalSop 专属通道）。
    started.handle.memory.writeGlobalSop("sop-cli-e2e-abc123", "# CLI 演示 SOP\n\n1. 看日志。\n", {
      sourceKind: "migrate",
      sourceTaskId: null,
      sourceRunId: null,
      sourceRef: "migration:test-cli-e2e",
      evidenceId: null,
      auditedBy: "rules+migrate-03",
    });

    const list = await cli(["memory", "sop", "list"]);
    expect(list.code).toBe(0);
    expect(list.out).toContain("sop-cli-e2e-abc123");
    expect(list.out).toContain("CLI 演示 SOP");

    const show = await cli(["memory", "sop", "show", "sop-cli-e2e-abc123"]);
    expect(show.code).toBe(0);
    expect(show.out).toContain("看日志");

    const removed = await cli(["memory", "sop", "remove", "sop-cli-e2e-abc123"]);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("removed");
    const again = await cli(["memory", "sop", "list"]);
    expect(again.out).not.toContain("sop-cli-e2e-abc123");

    // 写入后门依旧不存在。
    const write = await cli(["memory", "write", "x"]);
    expect(write.code).toBe(1);
    expect(write.err).toContain("unknown memory subcommand");
  });

  it("distill status/set 配置复盘与审计档位", async () => {
    const status = await cli(["distill"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("enabled");

    const set = await cli(["distill", "set", "--review-profile", "e2e"]);
    expect(set.code).toBe(0);
    expect(set.out).toContain("复盘 e2e");

    const off = await cli(["distill", "set", "--review-profile", "off", "--disable"]);
    expect(off.code).toBe(0);
    expect(off.out).toContain("disabled");
    // 还原（共享 host）。
    await cli(["distill", "set", "--enable"]);

    // 未知档案确定性报错。
    const bad = await cli(["distill", "set", "--audit-profile", "nope"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("unknown modelProfileId");
  });
});
