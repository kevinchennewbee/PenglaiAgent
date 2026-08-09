/**
 * Desktop ↔ Host integration suites (server-test style): a real loopback
 * Host on an ephemeral port, the desktop's HttpBridge as the client. Pins
 * the handshake/续约, the JSON-RPC sequences the workbench drives
 * (conversation prompt, approvals, budget, mode switch), WS event
 * subscription, and 断线重连.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startServer, type StartedServer } from "../../host/src/server.js";
import { _setPenglaiHomeForTest } from "../../host/src/conversation-store.js";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../../host/src/kernel/kernel.js";
import type { Approval, Conversation, Task, WorkProposal } from "@penglai/protocol";
import { BridgeError, HttpBridge } from "../src/bridge/index.js";
import { ResilientSubscription } from "../src/bridge/resilient.js";
import {
  initialStreamState,
  reduceConversationEvent,
  type StreamState,
} from "../src/state/conversation.js";
import { checkHandshake } from "../src/state/workbench.js";

const TEST_TOKEN = "desktop-it-token-456";

let started: StartedServer;
let bridge: HttpBridge;
let workDir: string;
let homeDir: string;
let dataDir: string;

/** Chat kernel: streams two deltas, reports usage, settles. */
class EchoChatKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "desktop-it-chat";
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
    this.isRunning = true;
    try {
      this.emit({ kind: "message.delta", textDelta: `echo: ${input.text} ` });
      this.emit({ kind: "message.delta", textDelta: "(desktop)" });
      this.emit({ kind: "turn.completed" });
      this.emit({
        kind: "message.completed",
        raw: {
          type: "message_end",
          message: { role: "assistant", usage: { input: 5, output: 3 } },
        },
      });
    } finally {
      this.isRunning = false;
    }
  }
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

class InertTaskKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "desktop-it-task";
  isRunning = false;
  subscribe(): () => void {
    return () => {};
  }
  async prompt(): Promise<void> {}
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-desktop-it-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-desktop-it-home-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-desktop-it-data-"));
  _setPenglaiHomeForTest(homeDir);
  started = await startServer({
    port: 0,
    token: TEST_TOKEN,
    dataDir,
    taskKernelFactory: async () => new InertTaskKernel(),
    chatKernelFactory: async () => new EchoChatKernel(),
  });
  bridge = new HttpBridge({
    healthUrl: `http://127.0.0.1:${started.port}/health`,
    rpcUrl: `http://127.0.0.1:${started.port}/api`,
    wsUrl: `ws://127.0.0.1:${started.port}/ws`,
    token: TEST_TOKEN,
  });
});

afterAll(async () => {
  await started.close();
  _setPenglaiHomeForTest(null);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("bridge: handshake + auth", () => {
  it("probes the runtime handshake and passes the desktop compat check", async () => {
    const status = await bridge.status();
    expect(status.ok).toBe(true);
    expect(status.handshake?.protocolSchemaVersion).toBe(1);
    expect(checkHandshake(status.handshake!).compatible).toBe(true);
  });

  it("rejects a wrong token with the unauthorized code", async () => {
    const bad = new HttpBridge({
      healthUrl: `http://127.0.0.1:${started.port}/health`,
      rpcUrl: `http://127.0.0.1:${started.port}/api`,
      wsUrl: `ws://127.0.0.1:${started.port}/ws`,
      token: "wrong-token",
    });
    const failure = await bad.rpc("config.listProfiles").catch((error) => error);
    expect(failure).toBeInstanceOf(BridgeError);
    expect((failure as BridgeError).code).toBe("unauthorized");
  });
});

describe("bridge: desktop support surfaces", () => {
  it("previews a jailed artifact and exports a redacted diagnostic bundle", async () => {
    const artifactPath = path.join(workDir, "desktop-preview.md");
    fs.writeFileSync(artifactPath, "# 桌面预览\n来自真实文件。\n", "utf-8");
    const project = started.handle.productStore.createProject({
      name: "preview-project",
      rootPath: workDir,
      trusted: true,
    });
    const task = started.handle.productStore.createTask({
      projectId: project.id,
      title: "preview",
      objective: "preview an observed artifact",
    });
    const run = started.handle.productStore.createRun({
      taskId: task.id,
      modelProfileId: "desktop-it-chat",
    });
    const evidence = started.handle.productStore.addEvidence({
      taskId: task.id,
      runId: run.id,
      kind: "artifact",
      title: "desktop-preview.md",
      uri: "desktop-preview.md",
    });

    const preview = await bridge.rpc<{ name: string; format: string; text: string }>(
      "artifact.preview",
      { taskId: task.id, evidenceId: evidence.id },
    );
    expect(preview).toMatchObject({ name: "desktop-preview.md", format: "md" });
    expect(preview.text).toContain("来自真实文件");

    fs.mkdirSync(path.join(dataDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "logs", "host.log"), "Bearer bridge-secret\nok\n");
    const diagnostic = await bridge.rpc<{ path: string; redactions: number }>("doctor.export", {});
    expect(fs.existsSync(diagnostic.path)).toBe(true);
    expect(diagnostic.path.startsWith(path.join(dataDir, "diagnostics"))).toBe(true);
    expect(diagnostic.redactions).toBeGreaterThanOrEqual(1);
  });
});

describe("bridge: conversation prompt over RPC + WS", () => {
  it("streams the episode on the conversation channel in order", async () => {
    // A profile with a literal key (server-test style): the chat runner
    // resolves the key host-side before assembling the kernel.
    await bridge.rpc("config.createProfile", {
      id: "desktop-it-chat",
      baseUrl: "https://example.invalid/v1",
      model: "chat-model",
      apiKey: "desktop-it-key",
    });
    const workspace = await bridge.rpc<{ id: string }>("workspace.open", {
      rootPath: workDir,
      name: "desktop-it",
    });
    const conversation = await bridge.rpc<Conversation>("conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "desktop-it-chat",
      title: "integration chat",
    });

    const events: Record<string, unknown>[] = [];
    let streamState: StreamState = initialStreamState(conversation);
    const unsubscribe = await bridge.subscribe(conversation.id, (event) => {
      events.push(event);
      streamState = reduceConversationEvent(streamState, event);
    });

    const result = await bridge.rpc<{ text: string; stopReason: string }>(
      "conversation.prompt",
      { conversationId: conversation.id, text: "ping" },
    );
    await sleep(150); // let trailing frames land
    unsubscribe();

    expect(result.text).toBe("echo: ping (desktop)");
    const names = events.map((event) => String(event.event));
    const order = [
      names.indexOf("conversation.message.user"),
      names.indexOf("conversation.prompt.started"),
      names.indexOf("conversation.delta"),
      names.indexOf("conversation.message.assistant"),
      names.indexOf("conversation.prompt.completed"),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The pure reducer reconstructs the same stream the UI renders.
    expect(streamState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(streamState.streaming).toBe(false);
  });
});

describe("bridge: approvals / budget / mode RPC sequences", () => {
  it("drives the desktop approval sequence: request → list → approve (remember) → reject", async () => {
    const project = await bridge.rpc<{ id: string }>("project.create", { rootPath: workDir });
    const task = await bridge.rpc<Task>("task.create", {
      projectId: project.id,
      title: "approval surface",
      objective: "exercise approvals",
      acceptanceCriteria: [],
      sourceChannel: "desktop",
    });
    const requested = await bridge.rpc<Approval>("approval.request", {
      taskId: task.id,
      capability: "l2:modify-existing",
      action: "修改既有文件",
      reason: "L2 one-click confirm",
      requestedBy: "desktop-it",
    });
    const pending = await bridge.rpc<Approval[]>("approval.list", { status: "pending" });
    expect(pending.map((row) => row.id)).toContain(requested.id);

    const approved = await bridge.rpc<{ approval: Approval; grant: unknown }>(
      "approval.approve",
      {
        approvalId: requested.id,
        decidedBy: "desktop:owner",
        remember: true,
      },
    );
    expect(approved.approval.status).toBe("approved");
    const afterApprove = await bridge.rpc<Approval[]>("approval.list", { status: "pending" });
    expect(afterApprove.map((row) => row.id)).not.toContain(requested.id);

    const second = await bridge.rpc<Approval>("approval.request", {
      taskId: task.id,
      capability: "l3:outbound-send",
      action: "外发内容",
      reason: "L3 mandatory",
      requestedBy: "desktop-it",
    });
    const rejected = await bridge.rpc<{ approval: Approval }>("approval.reject", {
      approvalId: second.id,
      decidedBy: "desktop:owner",
      note: "不允许外发",
    });
    expect(rejected.approval.status).toBe("denied");
    const all = await bridge.rpc<Approval[]>("approval.list", { status: "all" });
    expect(all.find((row) => row.id === second.id)?.decisionNote).toBe("不允许外发");
  });

  it("drives the budget sequence: set → status → lift", async () => {
    await bridge.rpc("budget.set", {
      dailyTokenLimit: 12345,
      projectDailyTokenLimit: null,
      updatedBy: "desktop:owner",
    });
    const status = await bridge.rpc<{
      config: { dailyTokenLimit: number | null };
      dimensions: { dimension: string; tripped: boolean }[];
    }>("budget.status");
    expect(status.config.dailyTokenLimit).toBe(12345);
    const lift = await bridge.rpc<{ lifted: string[] }>("budget.lift", {
      dimension: "all",
      liftedBy: "desktop:owner",
    });
    expect(Array.isArray(lift.lifted)).toBe(true);
  });

  it("drives proposal → Owner confirm → mode.get(work) → exitWork(chat)", async () => {
    const workspace = await bridge.rpc<{ id: string }>("workspace.open", {
      rootPath: workDir,
      name: "desktop-it-mode",
    });
    const conversation = await bridge.rpc<Conversation>("conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "grok",
      title: "mode chat",
    });
    const proposed = await bridge.rpc<{ task: null; proposal: WorkProposal }>(
      "mode.proposeWork",
      {
        conversationId: conversation.id,
        rootPath: workDir,
        objective: "anchor work from the desktop",
        title: "desktop anchored task",
        sourceChannel: "desktop",
      },
    );
    expect(proposed.task).toBeNull();
    const confirmed = await bridge.rpc<{ task: Task }>("mode.confirmWork", {
      proposalId: proposed.proposal.id,
      conversationId: conversation.id,
      confirmedRootPath: proposed.proposal.canonicalRootPath,
      confirmedBy: "desktop:test-owner",
    });
    expect(confirmed.task.objective).toContain("anchor work");
    const mode = await bridge.rpc<{ mode: string; activeTaskId: string | null }>("mode.get", {
      conversationId: conversation.id,
    });
    expect(mode.mode).toBe("work");
    expect(mode.activeTaskId).toBe(confirmed.task.id);
    const exited = await bridge.rpc<{ changed: boolean }>("mode.exitWork", {
      conversationId: conversation.id,
      outcome: "paused",
    });
    expect(exited.changed).toBe(true);
    const back = await bridge.rpc<{ mode: string }>("mode.get", {
      conversationId: conversation.id,
    });
    expect(back.mode).toBe("chat");
  });
});

describe("bridge: 断线重连", () => {
  it("re-subscribes after the server drops the socket and keeps receiving events", async () => {
    await bridge.rpc("config.createProfile", {
      id: "desktop-it-chat",
      baseUrl: "https://example.invalid/v1",
      model: "chat-model",
      apiKey: "desktop-it-key",
    });
    const workspace = await bridge.rpc<{ id: string }>("workspace.open", {
      rootPath: workDir,
      name: "desktop-it-reconnect",
    });
    const conversation = await bridge.rpc<Conversation>("conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "desktop-it-chat",
      title: "reconnect chat",
    });
    const events: Record<string, unknown>[] = [];
    const states: string[] = [];
    const unsubscribe = await bridge.subscribe(
      conversation.id,
      (event) => events.push(event),
      (state) => states.push(state),
    );
    // Drop every server-side socket; the client observes close → reconnecting → open.
    for (const client of started.wss.clients) client.terminate();
    await sleep(1600); // default backoff: 400ms first retry
    expect(states).toContain("reconnecting");
    await bridge.rpc("conversation.prompt", {
      conversationId: conversation.id,
      text: "after reconnect",
    });
    await sleep(150);
    unsubscribe();
    const deltas = events.filter((event) => event.event === "conversation.delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((event) => String(event.textDelta)).join("")).toContain("after reconnect");
  }, 15_000);

  it("ResilientSubscription retries failed connects and redelivers after close", async () => {
    const log: string[] = [];
    let attempt = 0;
    const subscription = new ResilientSubscription(
      (dispatch, onClosed) => {
        attempt += 1;
        log.push(`factory#${attempt}`);
        if (attempt === 1) {
          return {
            connect: () => Promise.reject(new Error("boom")),
            close: () => undefined,
          };
        }
        return {
          connect: () => {
            if (attempt === 2) {
              setTimeout(() => {
                dispatch({ event: "first" });
                onClosed(null); // simulate a transport drop
              }, 5);
            } else {
              setTimeout(() => dispatch({ event: "second" }), 5);
            }
            return Promise.resolve();
          },
          close: () => undefined,
        };
      },
      (event) => log.push(`event:${String(event.event)}`),
      (state) => log.push(`state:${state}`),
      () => 1, // deterministic 1ms backoff for the test
    );
    await subscription.start();
    await sleep(80);
    subscription.close();
    expect(log).toContain("factory#3");
    expect(log).toContain("event:first");
    expect(log).toContain("event:second");
    expect(log).toContain("state:reconnecting");
    expect(subscription.reconnects).toBeGreaterThan(0);
  });
});
