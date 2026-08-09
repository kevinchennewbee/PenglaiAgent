/**
 * Server integration: the new agent.submit RPC drives EpisodeRunner
 * through a real (mock-model) server, proving the unified runner is
 * wired into the production host.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer, type StartedServer } from "../src/server.js";
import { MockModelServer } from "./fixtures/mock-model-server.js";
import { savePersistedProfile } from "../src/profiles-store.js";

const TOKEN = "agent-rpc-test";

async function rpc(port: number, method: string, params: unknown = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}/api`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const envelope = await res.json();
  if (envelope.error) throw new Error(`${method}: ${envelope.error.message}`);
  return envelope.result;
}

describe("agent.submit (EpisodeRunner via server)", () => {
  let base: string;
  let dataDir: string;
  let mock: MockModelServer;
  let server: StartedServer;

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-agent-rpc-"));
    dataDir = path.join(base, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    mock = new MockModelServer();
    await mock.start();
    process.env.AGENT_RPC_TEST_KEY = "secret";
    savePersistedProfile(dataDir, {
      id: "eval",
      label: "Eval",
      provider: "custom",
      baseUrl: mock.baseUrl,
      model: "eval-model",
      apiKeyEnv: "AGENT_RPC_TEST_KEY",
      capabilities: { vision: false },
    });
    server = await startServer({
      port: 0,
      token: TOKEN,
      dataDir,
      databasePath: path.join(dataDir, "product.db"),
      log: () => {},
    });
  });

  afterEach(async () => {
    await server.close();
    await mock.close();
    fs.rmSync(base, { recursive: true, force: true });
    delete process.env.AGENT_RPC_TEST_KEY;
  });

  it("submits a prompt, runs through EpisodeRunner, and completes", async () => {
    const ws = await rpc(server.port, "workspace.open", {
      rootPath: dataDir,
      name: "rpc-test",
    });
    const conversation = await rpc(server.port, "conversation.create", {
      workspaceId: ws.id,
      modelProfileId: "eval",
      title: "agent rpc test",
    });
    const conversationId = conversation.id;

    const prompt = "用新 runner 打个招呼";
    mock.register(prompt, [
      { text: "新 runner 就绪。", usage: { input: 8, output: 5 } },
    ]);

    const submitted = await rpc(server.port, "agent.submit", {
      conversationId,
      text: prompt,
      delivery: "steer",
    });
    expect(submitted.runId).toBeTruthy();

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const status = await rpc(server.port, "agent.active", { conversationId });
      if (!status.active) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const final = await rpc(server.port, "agent.active", { conversationId });
    expect(final.active).toBe(false);

    // The run persisted both the user beat and the assistant reply.
    const got = await rpc(server.port, "conversation.get", { conversationId });
    const text = JSON.stringify(got.messages ?? []);
    expect(text).toContain("用新 runner 打个招呼");
    expect(text).toContain("新 runner 就绪");

    // Usage is recorded in the durable ledger (server bridge, not the runner).
    // The mock harness may not surface token usage, but a completed episode
    // always writes one request row — proving the bridge calls recordUsage.
    const report = await rpc(server.port, "usage.get", {});
    const rows = Array.isArray(report?.rows) ? report.rows : [];
    const requests = rows.reduce(
      (sum: number, row: { requests?: number }) => sum + (row.requests ?? 0),
      0,
    );
    expect(requests).toBeGreaterThanOrEqual(1);
  });

  it("accepts thinkingLevel without error and completes the episode", async () => {
    const ws = await rpc(server.port, "workspace.open", {
      rootPath: dataDir,
      name: "rpc-thinking",
    });
    const conversation = await rpc(server.port, "conversation.create", {
      workspaceId: ws.id,
      modelProfileId: "eval",
      title: "thinking level test",
    });
    const prompt = "think hard then answer";
    mock.register(prompt, [
      { text: "thought deeply", usage: { input: 4, output: 3 } },
    ]);

    const submitted = await rpc(server.port, "agent.submit", {
      conversationId: conversation.id,
      text: prompt,
      delivery: "steer",
      thinkingLevel: "high",
    });
    expect(submitted.runId).toBeTruthy();

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const status = await rpc(server.port, "agent.active", {
        conversationId: conversation.id,
      });
      if (!status.active) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const final = await rpc(server.port, "agent.active", {
      conversationId: conversation.id,
    });
    expect(final.active).toBe(false);
  });

  it("translates episode.* into legacy conversation.* events", async () => {
    const workspace = await rpc(server.port, "workspace.open", {
      rootPath: dataDir,
      name: "rpc-legacy-events",
    });
    const conversation = await rpc(server.port, "conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "eval",
      title: "legacy event test",
    });
    const conversationId = conversation.id;

    // Subscribe over WebSocket and collect every conversation.* event.
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { "X-Penglai-Token": TOKEN },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const events: string[] = [];
    const deltaChunks: string[] = [];
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { event?: string; textDelta?: string };
      if (typeof msg.event === "string" && msg.event.startsWith("conversation.")) {
        events.push(msg.event);
        if (msg.event === "conversation.delta" && typeof msg.textDelta === "string") {
          deltaChunks.push(msg.textDelta);
        }
      }
    });
    socket.send(JSON.stringify({ type: "subscribe", channelId: conversationId }));
    // Give the subscribe ack time to land before submitting.
    await new Promise((r) => setTimeout(r, 50));

    const prompt = "say legacy hello";
    mock.register(prompt, [
      { text: "legacy reply", usage: { input: 6, output: 4 } },
    ]);
    await rpc(server.port, "agent.submit", {
      conversationId,
      text: prompt,
      delivery: "steer",
    });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (events.includes("conversation.prompt.completed")) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    socket.close();

    expect(events).toContain("conversation.prompt.started");
    expect(events).toContain("conversation.delta");
    expect(events).toContain("conversation.message.assistant");
    expect(events).toContain("conversation.prompt.completed");
    expect(deltaChunks.join("")).toContain("legacy reply");
  });

  it("titles an untitled conversation and settles status to idle", async () => {
    const workspace = await rpc(server.port, "workspace.open", {
      rootPath: dataDir,
      name: "rpc-lifecycle",
    });
    const conversation = await rpc(server.port, "conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "eval",
      title: "新对话",
    });
    const conversationId = conversation.id;

    const prompt = "帮我起个响亮的标题";
    mock.register(prompt, [
      { text: "好的", usage: { input: 3, output: 2 } },
    ]);
    await rpc(server.port, "agent.submit", {
      conversationId,
      text: prompt,
      delivery: "steer",
    });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const got = await rpc(server.port, "conversation.get", { conversationId });
      if (got.conversation.status === "idle") break;
      await new Promise((r) => setTimeout(r, 30));
    }

    const got = await rpc(server.port, "conversation.get", { conversationId });
    expect(got.conversation.status).toBe("idle");
    expect(got.conversation.title).toBe("帮我起个响亮的标题");
  });

  it("injects the active goal and context pins into the kernel prompt", async () => {
    const workspace = await rpc(server.port, "workspace.open", {
      rootPath: dataDir,
      name: "rpc-goal",
    });
    const conversation = await rpc(server.port, "conversation.create", {
      workspaceId: workspace.id,
      modelProfileId: "eval",
      title: "goal injection test",
    });
    const conversationId = conversation.id;

    // Set a goal via the production RPC (populates conversation.goal).
    await rpc(server.port, "conversation.goal.set", {
      conversationId,
      goal: "完成重构并提交所有测试",
    });

    const prompt = "检查当前状态";
    mock.register(prompt, [
      { text: "已检查", usage: { input: 5, output: 3 } },
    ]);
    await rpc(server.port, "agent.submit", {
      conversationId,
      text: prompt,
      delivery: "steer",
    });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const got = await rpc(server.port, "conversation.get", { conversationId });
      if (got.conversation.status === "idle") break;
      await new Promise((r) => setTimeout(r, 30));
    }

    // The goal text should have reached the model (system prompt block).
    const requests = mock.requestsFor(prompt);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(requests[0]?.body?.messages ?? []);
    expect(serialized).toContain("完成重构并提交所有测试");
  });
});
