/**
 * 飞书渠道适配器全链路集成测试。
 *
 * 世界 = 真实 host（startServer，faux 内核缝）+ mock 飞书服务端（真实
 * loopback HTTP/WS，全协议链路）+ 真实 product-store。事件从 mock 注入，
 * 断言落在：mock 记录的出站消息/卡片、product-store 的产品记录、磁盘
 * transcript。绝不打真实飞书 API、绝不打真实模型。
 *
 * 覆盖：白名单拒绝/放行、聊天进 Conversation（含长输出截断纪律）、幂等
 * 去重、开工闭环（信任卡片 → 按钮开工）、进度节流播报、审批卡片全链路
 * （批准 → run 继续）、文本指令审批、任务控制（暂停/继续/取消）、重启
 * 路由水合。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { startServer, type StartedServer } from "../src/server.js";
import { saveChannelConfig } from "../src/feishu/config.js";
import type { PolicyDecision } from "../src/policy.js";
import type { ApprovalVerdict } from "../src/approvals.js";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";
import type { TaskKernelOptions } from "../src/task-runner.js";
import { loadMessages, _setPenglaiHomeForTest } from "../src/conversation-store.js";
import {
  MockFeishuServer,
  cardActionEnvelope,
  receiveMessageEnvelope,
  type RecordedApiCall,
} from "./feishu/mock-server.js";

const OWNER = "ou_owner";
const CHAT = "oc_chat1";
const TEST_KEY_ENV = "PENGLAI_FEISHU_CHANNEL_TEST_KEY";

const L3_DECISION: PolicyDecision = {
  allowed: false,
  code: "needs_approval",
  level: "L3",
  reason: "needs_approval: outbound or irreversible command requires L3 human approval",
  approval: { capability: "l3:outbound", action: "bash: git push origin main" },
};

// ── faux 内核 ────────────────────────────────────────────────────

class FakeKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = `fake_${Math.random().toString(36).slice(2, 8)}`;
  isRunning = false;
  private readonly listeners = new Set<KernelEventListener>();
  private settle!: () => void;
  private promptPromise = new Promise<void>((resolve) => {
    this.settle = resolve;
  });
  lastPrompt: KernelPrompt | null = null;

  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: Omit<KernelEvent, "occurredAt" | "sessionId" | "raw">): void {
    const full = { ...event, occurredAt: Date.now(), sessionId: this.sessionId, raw: event } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }

  prompt(input: KernelPrompt): Promise<void> {
    this.lastPrompt = input;
    this.isRunning = true;
    return this.promptPromise.finally(() => {
      this.isRunning = false;
    });
  }

  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {
    this.settle();
  }
  dispose(): void {}
  complete(): void {
    this.settle();
  }
}

interface World {
  mock: MockFeishuServer;
  server: StartedServer;
  dirs: { base: string; home: string; dataDir: string; project: string };
  chatKernels: FakeKernel[];
  taskKernels: FakeKernel[];
  /** 下一个 task 内核的脚本化行为。 */
  taskBehavior: {
    turns: number;
    holdApproval: boolean;
    reply: string;
    /** true = episode 不自动收尾（停着等 pause/cancel）。 */
    holdOpen?: boolean;
  };
  chatReply: string;
  /** F1: keep the chat episode open until FakeKernel.complete(). */
  chatHoldOpen: boolean;
  rpc<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  injectText(text: string, opts?: { openId?: string; eventId?: string }): void;
  injectCardAction(value: Record<string, unknown>, opts?: { openId?: string; eventId?: string }): void;
  waitForMessage(matcher: (call: RecordedApiCall) => boolean, timeoutMs?: number): Promise<RecordedApiCall>;
  waitForText(substring: string, timeoutMs?: number): Promise<RecordedApiCall>;
  waitForCard(substring: string, timeoutMs?: number): Promise<RecordedApiCall>;
  waitForWsConnected(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

function messageText(call: RecordedApiCall): string {
  try {
    const content = JSON.parse(String(call.body.content)) as { text?: string };
    return content.text ?? "";
  } catch {
    return "";
  }
}

function confirmationAction(call: RecordedApiCall): Record<string, unknown> {
  const card = JSON.parse(String(call.body.content)) as {
    elements: Array<{ actions?: Array<{ value?: Record<string, unknown> }> }>;
  };
  const value = card.elements.flatMap((element) => element.actions ?? [])[0]?.value;
  if (!value) throw new Error("confirmation card has no action value");
  return value;
}

async function confirmPendingWork(world: World): Promise<Record<string, unknown>> {
  const card = await world.waitForCard("确认工作区并开工");
  const value = confirmationAction(card);
  world.injectCardAction(value);
  await world.mock.waitForFrame((frame) => {
    try {
      const body = JSON.parse(frame.payload.toString("utf-8"));
      if (body.code !== 200 || typeof body.data !== "string") return false;
      const data = JSON.parse(Buffer.from(body.data, "base64").toString("utf-8"));
      return typeof data.toast?.content === "string" && data.toast.content.includes("确认");
    } catch {
      return false;
    }
  });
  return value;
}

async function startWorld(): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-feishu-"));
  const dirs = {
    base,
    home: path.join(base, "home"),
    dataDir: path.join(base, "data"),
    project: path.join(base, "project"),
  };
  fs.mkdirSync(dirs.home, { recursive: true });
  fs.mkdirSync(dirs.dataDir, { recursive: true });
  fs.mkdirSync(dirs.project, { recursive: true });
  _setPenglaiHomeForTest(dirs.home);
  process.env[TEST_KEY_ENV] = "test-key";

  const mock = new MockFeishuServer();
  await mock.start();
  saveChannelConfig(dirs.dataDir, {
    appId: "cli_mock",
    appSecret: "mock_secret",
    domain: mock.baseUrl,
    enabled: true,
  });

  const profile: ModelProfile = {
    id: "feishu-test",
    label: "Feishu Test",
    provider: "custom",
    baseUrl: "https://example.invalid/v1",
    apiKeyEnv: TEST_KEY_ENV,
    model: "test-model",
    capabilities: { tools: true, streaming: true, vision: false },
  };

  const chatKernels: FakeKernel[] = [];
  const taskKernels: FakeKernel[] = [];
  const world = {} as World;
  world.taskBehavior = { turns: 1, holdApproval: false, reply: "活干完了", holdOpen: false };
  world.chatReply = "蓬莱已收到";
  world.chatHoldOpen = false;

  const serverOptions = {
    port: 0,
    token: "feishu-test-token",
    dataDir: dirs.dataDir,
    databasePath: path.join(dirs.dataDir, "product.db"),
    profiles: [profile],
    log: () => undefined,
    chatKernelFactory: async () => {
      const kernel = new FakeKernel();
      chatKernels.push(kernel);
      const reply = world.chatReply;
      const holdOpen = world.chatHoldOpen;
      const originalPrompt = kernel.prompt.bind(kernel);
      kernel.prompt = (input: KernelPrompt) => {
        const promise = originalPrompt(input);
        if (holdOpen) {
          // F1: leave the episode open until the test calls complete().
          return promise;
        }
        kernel.emit({ kind: "message.delta", textDelta: reply });
        kernel.emit({ kind: "turn.completed" });
        kernel.complete();
        return promise;
      };
      return kernel;
    },
    taskKernelFactory: async (options: TaskKernelOptions) => {
      const kernel = new FakeKernel();
      taskKernels.push(kernel);
      const behavior = { ...world.taskBehavior };
      const originalPrompt = kernel.prompt.bind(kernel);
      kernel.prompt = (input: KernelPrompt) => {
        const promise = originalPrompt(input);
        void (async () => {
          if (behavior.holdApproval && options.approvalGate) {
            const verdict: ApprovalVerdict = await options.approvalGate({
              toolName: "bash",
              args: { command: "git push origin main" },
              decision: L3_DECISION,
            });
            if (!verdict.approved) {
              kernel.emit({ kind: "message.delta", textDelta: "审批被拒，已停止" });
              kernel.complete();
              return;
            }
          }
          for (let i = 0; i < behavior.turns; i += 1) {
            kernel.emit({ kind: "turn.completed" });
          }
          if (behavior.holdOpen) return; // 停着：等 pause/cancel 的 abort
          kernel.emit({ kind: "message.delta", textDelta: behavior.reply });
          kernel.complete();
        })();
        return promise;
      };
      return kernel;
    },
  };
  let server = await startServer(serverOptions);

  const rpc = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Penglai-Token": "feishu-test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };

  let eventSeq = 0;

  Object.assign(world, {
    mock,
    get server() {
      return server;
    },
    dirs,
    chatKernels,
    taskKernels,
    rpc,

    injectText(text: string, opts: { openId?: string; eventId?: string } = {}) {
      eventSeq += 1;
      mock.pushEvent(
        receiveMessageEnvelope({
          eventId: opts.eventId ?? `evt_${eventSeq}`,
          openId: opts.openId ?? OWNER,
          chatId: CHAT,
          text,
        }),
      );
    },

    injectCardAction(value: Record<string, unknown>, opts: { openId?: string; eventId?: string } = {}) {
      eventSeq += 1;
      mock.pushCard(
        cardActionEnvelope({
          eventId: opts.eventId ?? `evt_card_${eventSeq}`,
          openId: opts.openId ?? OWNER,
          chatId: CHAT,
          value,
        }),
      );
    },

    async waitForMessage(matcher: (call: RecordedApiCall) => boolean, timeoutMs = 5000) {
      return mock.waitForApiCall(
        (call) => call.path.startsWith("/open-apis/im/v1/messages") && matcher(call),
        timeoutMs,
      );
    },

    async waitForText(substring: string, timeoutMs = 5000) {
      return world.waitForMessage(
        (call) => call.body.msg_type === "text" && messageText(call).includes(substring),
        timeoutMs,
      );
    },

    async waitForCard(substring: string, timeoutMs = 5000) {
      return world.waitForMessage(
        (call) =>
          call.body.msg_type === "interactive" && String(call.body.content).includes(substring),
        timeoutMs,
      );
    },

    async waitForWsConnected() {
      const deadline = Date.now() + 5000;
      while (mock.connections < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (mock.connections < 1) throw new Error("feishu ws did not connect in time");
    },

    async restart() {
      const connectionsBefore = mock.connections;
      await server.close();
      server = await startServer(serverOptions);
      // 等「新的一条」WS 连接就位（connections 单调递增，不会因断开减少）。
      const deadline = Date.now() + 5000;
      while (mock.connections <= connectionsBefore && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (mock.connections <= connectionsBefore) {
        throw new Error("feishu ws did not reconnect after restart");
      }
    },

    async close() {
      await server.close();
      await mock.close();
      _setPenglaiHomeForTest(null);
      delete process.env[TEST_KEY_ENV];
      fs.rmSync(base, { recursive: true, force: true });
    },
  } satisfies Partial<World>);

  await world.waitForWsConnected();
  // owner 进白名单（与生产同路径：RPC）。
  await rpc("channel.allow", { channel: "feishu", channelUserId: OWNER, identity: "owner" });
  return world;
}

// ── 测试 ─────────────────────────────────────────────────────────

describe("feishu channel: whitelist (默认拒绝)", () => {
  let world: World;
  beforeEach(async () => {
    world = await startWorld();
  });
  afterEach(async () => {
    await world.close();
  });

  it("rejects non-whitelisted users with their open_id, serves after allow", async () => {
    world.injectText("你好", { openId: "ou_stranger" });
    const denial = await world.waitForText("未授权用户");
    expect(messageText(denial)).toContain("ou_stranger");
    expect(messageText(denial)).toContain("penglai channel allow feishu ou_stranger");
    // 拒绝后没有任何聊天/会话副作用。
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    expect(routes).toHaveLength(0);

    // owner 放行后即正常服务。
    await world.rpc("channel.allow", { channel: "feishu", channelUserId: "ou_stranger" });
    world.injectText("现在呢", { openId: "ou_stranger" });
    const reply = await world.waitForText("蓬莱已收到");
    expect(reply.body.receive_id).toBe(CHAT);
  });

  it("ignores bot-sent messages and non-text types politely", async () => {
    // 机器人自己发的消息（sender_type=app）：完全不理，零出站。
    world.mock.pushEvent(
      receiveMessageEnvelope({
        eventId: "evt_bot",
        openId: OWNER,
        chatId: CHAT,
        text: "回声",
        senderType: "app",
      }),
    );
    world.mock.pushEvent(
      receiveMessageEnvelope({
        eventId: "evt_img",
        openId: OWNER,
        chatId: CHAT,
        messageType: "image",
        content: '{"image_key":"k"}',
      }),
    );
    await world.waitForText("目前只支持文本消息");
    const outbound = world.mock.sentMessages();
    expect(outbound.filter((c) => messageText(c).includes("回声"))).toHaveLength(0);
  });
});

describe("feishu channel: chat → Conversation (同一产品记录)", () => {
  let world: World;
  beforeEach(async () => {
    world = await startWorld();
  });
  afterEach(async () => {
    await world.close();
  });

  it("routes a chat message into a durable conversation and replies", async () => {
    world.injectText("你好，蓬莱");
    await world.waitForText("蓬莱已收到");
    // 路由持久化：chat_id → conversation。
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    expect(routes).toHaveLength(1);
    expect(routes[0].chatId).toBe(CHAT);
    // 会话与 transcript 是同一份产品记录（CLI 可见）。
    const got = await world.rpc("conversation.get", { conversationId: routes[0].conversationId });
    expect(got.conversation.title).toContain("飞书会话");
    const messages = loadMessages(routes[0].conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(messages[0].content)).toContain("你好，蓬莱");
  });

  it("dedups redelivered events by event_id (幂等)", async () => {
    world.injectText("同一事件", { eventId: "evt_dup" });
    await world.waitForText("蓬莱已收到");
    world.injectText("同一事件", { eventId: "evt_dup" });
    // 重投被跳过：出站消息数不再增长。
    await new Promise((resolve) => setTimeout(resolve, 300));
    const replies = world.mock
      .sentMessages()
      .filter((c) => messageText(c).includes("蓬莱已收到"));
    expect(replies).toHaveLength(1);
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    const messages = loadMessages(routes[0].conversationId);
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("truncates long replies and keeps the full record in the transcript", async () => {
    world.chatReply = "很".repeat(5000);
    world.injectText("说点长的");
    const reply = await world.waitForText("已截断");
    const text = messageText(reply);
    expect(text.length).toBeLessThan(4300);
    expect(text).toContain("全文见");
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    const messages = loadMessages(routes[0].conversationId);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(JSON.stringify(assistant?.content)).toContain("很".repeat(100)); // 全文在 transcript
  });

  it("F1: busy session second message waits for real reply, never shows [episode queued]", async () => {
    world.chatHoldOpen = true;
    world.chatReply = "第一轮真实回复";
    world.injectText("第一轮");
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (world.chatKernels[0]?.isRunning) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("chat kernel not running"));
        setTimeout(tick, 10);
      };
      tick();
    });

    world.chatReply = "第二轮真实回复";
    world.injectText("第二轮");
    await new Promise((r) => setTimeout(r, 200));
    const early = world.mock
      .sentMessages()
      .map(messageText)
      .filter((t) => t.includes("episode queued") || t.includes("[episode "));
    expect(early).toEqual([]);

    // Finish first episode; second should then run and deliver its reply.
    world.chatKernels[0]!.emit({ kind: "message.delta", textDelta: "第一轮真实回复" });
    world.chatKernels[0]!.emit({ kind: "turn.completed" });
    world.chatKernels[0]!.complete();

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (world.chatKernels[1]?.isRunning) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("second chat kernel not running"));
        setTimeout(tick, 10);
      };
      tick();
    });
    world.chatKernels[1]!.emit({ kind: "message.delta", textDelta: "第二轮真实回复" });
    world.chatKernels[1]!.emit({ kind: "turn.completed" });
    world.chatKernels[1]!.complete();

    await world.waitForText("第二轮真实回复");
    const failureStyle = world.mock
      .sentMessages()
      .map(messageText)
      .filter((t) => t.includes("episode queued") || t.includes("[episode queued"));
    expect(failureStyle).toEqual([]);
  });
});

describe("feishu channel: 开工闭环 + 进度播报", () => {
  let world: World;
  beforeEach(async () => {
    world = await startWorld();
  });
  afterEach(async () => {
    await world.close();
  });

  it("keeps a proposal inert and starts only after the explicit confirm_work action", async () => {
    const project = await world.rpc("project.create", { rootPath: world.dirs.project, name: "demo" });
    world.injectText("开工 demo 把构建修绿");
    const card = await world.waitForCard("确认工作区并开工");
    await world.waitForText("等待 Owner 确认工作区");
    const action = confirmationAction(card);
    expect(action.a).toBe("confirm_work");
    expect(action.path).toBe(fs.realpathSync(world.dirs.project));
    // 提案阶段：仅默认项目路由；未信任、无 Task、Conversation 仍 floating。
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    expect(routes[0].defaultProjectId).toBe(project.id);
    const conversation = (await world.rpc("conversation.get", {
      conversationId: routes[0].conversationId,
    })).conversation;
    expect(conversation.mode).toBe("chat");
    expect(conversation.activeTaskId).toBeNull();
    expect(await world.rpc("task.list", { projectId: project.id })).toEqual([]);
    expect((await world.rpc("project.get", { projectId: project.id })).project.trusted).toBe(false);
    expect(world.taskKernels).toHaveLength(0);

    // Owner 点精确 proposal/path 确认：此时才创建 Task、trust、anchor、run。
    world.injectCardAction(action);
    const ack = await world.mock.waitForFrame((frame) => {
      if (!frame.payload.toString("utf-8").includes('"data"')) return false;
      const body = JSON.parse(frame.payload.toString("utf-8"));
      return body.code === 200 && typeof body.data === "string";
    });
    const ackData = JSON.parse(
      Buffer.from(JSON.parse(ack.payload.toString("utf-8")).data, "base64").toString("utf-8"),
    );
    expect(ackData.toast.content).toContain("已确认");
    await world.waitForText("▶️ 已开始");
    await world.waitForText("✅ 完成");
    const anchored = (await world.rpc("conversation.get", {
      conversationId: routes[0].conversationId,
    })).conversation;
    expect(anchored.mode).toBe("work");
    const bundle = await world.rpc("task.get", { taskId: anchored.activeTaskId });
    expect(bundle.task.sourceChannel).toBe("feishu");
    expect(bundle.task.title).toContain("把构建修绿");
    const settled = await world.rpc("task.get", { taskId: bundle.task.id });
    expect(settled.runs.at(-1).status).toBe("completed");
    expect((await world.rpc("project.get", { projectId: project.id })).project.trusted).toBe(true);
  });

  it("still requires per-work confirmation on a trusted project and throttles progress", async () => {
    const project = await world.rpc("project.create", { rootPath: world.dirs.project, name: "demo" });
    await world.rpc("project.trust", { projectId: project.id, confirmedRootPath: world.dirs.project });
    world.taskBehavior = { turns: 4, holdApproval: false, reply: "构建修好了" };
    world.injectText("开工 demo 修构建");
    await confirmPendingWork(world);
    await world.waitForText("▶️ 已开始");
    await world.waitForText("✅ 完成");
    // 4 个 turn.completed 只播报一次（节流窗口内）。
    const progress = world.mock
      .sentMessages()
      .filter((c) => messageText(c).includes("⏳ 进行中"));
    expect(progress).toHaveLength(1);
    // 完成摘要带回合数与证据指针。
    const done = world.mock.sentMessages().find((c) => messageText(c).includes("✅ 完成"))!;
    expect(messageText(done)).toContain("回合 4");
    expect(messageText(done)).toContain("penglai task show");
  });
});

describe("feishu channel: 审批全链路", () => {
  let world: World;
  beforeEach(async () => {
    world = await startWorld();
    const project = await world.rpc("project.create", { rootPath: world.dirs.project, name: "demo" });
    await world.rpc("project.trust", { projectId: project.id, confirmedRootPath: world.dirs.project });
  });
  afterEach(async () => {
    await world.close();
  });

  async function startGatedRun(): Promise<{ taskId: string; approvalId: string }> {
    world.taskBehavior = { turns: 1, holdApproval: true, reply: "已推送" };
    world.injectText("开工 demo 发版");
    await confirmPendingWork(world);
    await world.waitForText("▶️ 已开始");
    const card = await world.waitForCard("审批请求");
    const content = JSON.parse(String(card.body.content)) as {
      elements: Array<{ actions?: Array<{ value: { id: string } }> }>;
    };
    const approvalId = content.elements.flatMap((e) => e.actions ?? [])[0].value.id;
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    const conversation = (await world.rpc("conversation.get", {
      conversationId: routes[0].conversationId,
    })).conversation;
    return { taskId: conversation.activeTaskId, approvalId };
  }

  it("pushes the approval card and approves via the card button (run resumes)", async () => {
    const { taskId, approvalId } = await startGatedRun();
    // run 停在 waiting_approval。
    const waiting = await world.rpc("task.get", { taskId });
    expect(waiting.runs.at(-1).status).toBe("waiting_approval");
    // 卡片内容：操作 + 理由 + 两个按钮。
    const card = world.mock.sentMessages().find((c) => String(c.body.content).includes("审批请求"))!;
    expect(String(card.body.content)).toContain("git push");
    expect(String(card.body.content)).toContain("l3:outbound");

    // 点「批准」：ack 带 toast + 更新卡片（移除按钮、留决定溯源）。
    world.injectCardAction({ a: "approve", id: approvalId });
    const ack = await world.mock.waitForFrame((frame) => {
      try {
        const body = JSON.parse(frame.payload.toString("utf-8"));
        if (typeof body.data !== "string") return false;
        const data = JSON.parse(Buffer.from(body.data, "base64").toString("utf-8"));
        return data.toast?.content === "已批准";
      } catch {
        return false;
      }
    });
    const ackData = JSON.parse(
      Buffer.from(JSON.parse(ack.payload.toString("utf-8")).data, "base64").toString("utf-8"),
    );
    expect(ackData.toast.content).toBe("已批准");
    expect(JSON.stringify(ackData.card)).toContain("✅ 已批准");
    expect(JSON.stringify(ackData.card)).toContain("feishu:owner");
    // 门解开，run 完成；审批行 decidedBy = 飞书身份。
    await world.waitForText("审批已决定，run 继续执行");
    await world.waitForText("✅ 完成");
    const settled = await world.rpc("task.get", { taskId });
    expect(settled.runs.at(-1).status).toBe("completed");
    expect(settled.approvals[0].status).toBe("approved");
    expect(settled.approvals[0].decidedBy).toBe("feishu:owner");
  });

  it("decides via the text command with an id prefix (拒绝)", async () => {
    const { taskId, approvalId } = await startGatedRun();
    world.injectText(`拒绝 ${approvalId.slice(0, 8)} 不准外发`);
    await world.waitForText("已拒绝 ⛔");
    await world.waitForText("✅ 完成"); // 内核收到拒绝 verdict 后体面收尾
    const settled = await world.rpc("task.get", { taskId });
    expect(settled.approvals[0].status).toBe("denied");
    expect(settled.approvals[0].decidedBy).toBe("feishu:owner");
    expect(settled.approvals[0].decisionNote).toBe("不准外发");
  });

  it("a redelivered card action is idempotent", async () => {
    const { approvalId } = await startGatedRun();
    world.injectCardAction({ a: "approve", id: approvalId }, { eventId: "evt_card_dup" });
    await world.mock.waitForFrame((frame) => frame.payload.toString("utf-8").includes('"data"'));
    world.injectCardAction({ a: "approve", id: approvalId }, { eventId: "evt_card_dup" });
    const dupAck = await world.mock.waitForFrame((frame) => {
      if (!frame.payload.toString("utf-8").includes('"data"')) return false;
      const body = JSON.parse(frame.payload.toString("utf-8"));
      const data = JSON.parse(Buffer.from(body.data, "base64").toString("utf-8"));
      return data.toast?.content === "该操作已处理过";
    });
    expect(dupAck).toBeDefined();
  });
});

describe("feishu channel: 任务控制 + 重启水合", () => {
  let world: World;
  beforeEach(async () => {
    world = await startWorld();
  });
  afterEach(async () => {
    await world.close();
  });

  it("lists tasks and status for an anchored work conversation", { timeout: 15000 }, async () => {
    const project = await world.rpc("project.create", { rootPath: world.dirs.project, name: "demo" });
    await world.rpc("project.trust", { projectId: project.id, confirmedRootPath: world.dirs.project });
    world.injectText("开工 demo 长活");
    await confirmPendingWork(world);
    await world.waitForText("▶️ 已开始");
    // 任务列表与状态（单对话面下 work 锚定的会话仍可列任务）。
    world.injectText("任务");
    const list = await world.waitForText("📋 任务");
    expect(messageText(list)).toContain("长活");
    world.injectText("状态");
    const status = await world.waitForText("📊 蓬莱状态");
    expect(messageText(status)).toContain("用量");
  });

  it("pauses, resumes and cancels via text commands", async () => {
    const project = await world.rpc("project.create", { rootPath: world.dirs.project, name: "demo" });
    await world.rpc("project.trust", { projectId: project.id, confirmedRootPath: world.dirs.project });
    // 挂起型内核：episode 不自动收尾，等 pause/cancel 的 abort。
    world.taskBehavior = { turns: 0, holdApproval: false, reply: "", holdOpen: true };
    world.injectText("开工 demo 长活");
    await confirmPendingWork(world);
    await world.waitForText("▶️ 已开始");
    // 暂停。
    world.injectText("暂停");
    await world.waitForText("已暂停");
    let routes = await world.rpc("channel.routes", { channel: "feishu" });
    let conversation = (await world.rpc("conversation.get", {
      conversationId: routes[0].conversationId,
    })).conversation;
    let bundle = await world.rpc("task.get", { taskId: conversation.activeTaskId });
    expect(bundle.runs.at(-1).status).toBe("paused");
    // 继续（新 run）。
    world.injectText("继续");
    await world.waitForText("已续跑");
    bundle = await world.rpc("task.get", { taskId: conversation.activeTaskId });
    expect(bundle.runs).toHaveLength(2);
    // 取消。
    world.injectText("取消");
    await world.waitForText("已取消");
    bundle = await world.rpc("task.get", { taskId: conversation.activeTaskId });
    expect(bundle.runs.at(-1).status).toBe("cancelled");
    routes = await world.rpc("channel.routes", { channel: "feishu" });
    conversation = (await world.rpc("conversation.get", {
      conversationId: routes[0].conversationId,
    })).conversation;
    expect(conversation.activeTaskId).toBe(bundle.task.id);
  });

  it("cancels a run parked at the budget pre-flight gate without leaving approval/pending state", { timeout: 15000 }, async () => {
    const project = await world.rpc("project.create", {
      rootPath: world.dirs.project,
      name: "demo",
    });
    await world.rpc("project.trust", {
      projectId: project.id,
      confirmedRootPath: world.dirs.project,
    });
    const handle = world.server.handle;
    handle.budget.setConfig({
      dailyTokenLimit: null,
      projectDailyTokenLimit: 1,
      updatedBy: "feishu-test",
    });
    const day = handle.budget.status().day;
    handle.productStore.recordUsage({
      day,
      mode: "work",
      projectId: project.id,
      inputTokens: 2,
      outputTokens: 0,
      requests: 1,
    });
    handle.budget.recordAndCheck({ mode: "work", projectId: project.id });

    world.injectText("开工 demo 预算门取消回归");
    await confirmPendingWork(world);
    // The episode has not started yet: the pre-flight budget gate publishes
    // its approval card first and only emits task.run.started after approval.
    await world.waitForCard("审批请求");
    const routes = await world.rpc("channel.routes", { channel: "feishu" });
    const conversation = (await world.rpc("conversation.get", {
      conversationId: routes[0].conversationId,
    })).conversation;
    const taskId = conversation.activeTaskId as string;
    const pendingRunId = handle.taskRunner.pendingRunForTask(taskId);
    expect(pendingRunId).not.toBeNull();
    expect(handle.approvals.pendingCountForRun(pendingRunId!)).toBe(1);

    world.injectText("取消");
    await world.waitForText("已取消");
    await handle.taskRunner.wait(pendingRunId!);
    const cancelled = await world.rpc("task.get", { taskId });
    expect(cancelled.runs.at(-1).status).toBe("cancelled");
    expect(cancelled.approvals.at(-1).status).toBe("denied");
    expect(handle.taskRunner.pendingRunForTask(taskId)).toBeNull();
    expect(handle.approvals.pendingCountForRun(pendingRunId!)).toBe(0);

    handle.budget.lift({ dimension: "all", liftedBy: "feishu-test", note: "resume regression" });
    world.injectText("继续");
    await world.waitForText("已续跑");
    await world.waitForText("✅ 完成");
    const resumed = await world.rpc("task.get", { taskId });
    expect(resumed.runs).toHaveLength(2);
    expect(resumed.runs.at(-1).status).toBe("completed");
  });

  it("hydrates routes across a host restart (same conversation, transcript intact)", async () => {
    world.injectText("重启前的对话");
    await world.waitForText("蓬莱已收到");
    const before = await world.rpc("channel.routes", { channel: "feishu" });
    const sentBefore = world.mock.sentMessages().length;
    await world.restart();
    // 重启后白名单仍在（product-store 持久化）。
    const identities = await world.rpc("channel.identities", { channel: "feishu" });
    expect(identities).toHaveLength(1);
    // 再发消息：同一条会话被水合复用，transcript 接上。
    world.injectText("重启后的对话");
    // 等一条「重启之后才发出」的新回复（mock 记录跨重启累积）。
    await world.waitForMessage(
      () => world.mock.sentMessages().length > sentBefore,
    );
    const after = await world.rpc("channel.routes", { channel: "feishu" });
    expect(after[0].conversationId).toBe(before[0].conversationId);
    const messages = loadMessages(before[0].conversationId);
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(JSON.stringify(messages.map((m) => m.content))).toContain("重启后的对话");
  });
});
