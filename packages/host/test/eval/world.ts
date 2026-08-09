/**
 * Eval world — the shared harness for the M1′ replay suite.
 *
 * One world = one isolated Penglai: temp home (transcripts), temp data dir
 * (product.db, memory, pi-sessions), temp workspace + project dirs, the
 * scripted mock model endpoint, and the REAL production host — no kernel
 * factory overrides anywhere. The only mock in the building is the model
 * API boundary; every assertion lands on observable production state (RPC
 * results, the durable store, files on disk, the provider wire log).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, type StartedServer } from "../../src/server.js";
import { _setPenglaiHomeForTest } from "../../src/conversation-store.js";
import { MockModelServer, type RecordedRequest } from "../fixtures/mock-model-server.js";
import { saveChannelConfig } from "../../src/feishu/config.js";
import { MockFeishuServer } from "../feishu/mock-server.js";

export const EVAL_TOKEN = "eval-token";
export const EVAL_PROFILE = "eval";

export interface EvalWorldDirs {
  /** Base temp dir holding everything. */
  base: string;
  /** Penglai home override (conversation transcripts). */
  home: string;
  /** Product data dir (product.db, memory/global, pi-sessions). */
  dataDir: string;
  /** Conversation workspace root (chat-mode read scope). */
  workspace: string;
  /** The project a work episode anchors to. */
  project: string;
}

export interface EvalWorld {
  mock: MockModelServer;
  server: StartedServer;
  dirs: EvalWorldDirs;
  /** Mock 飞书服务端（仅 options.feishu 时存在；渠道回放用）。 */
  feishu: MockFeishuServer | null;
  /** JSON-RPC against the live host; throws on error envelopes. */
  rpc<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** JSON-RPC returning the raw envelope (for error-code assertions). */
  rpcRaw(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }>;
  /** Set up a conversation bound to the workspace (chat mode). */
  createConversation(title?: string): Promise<any>;
  /** Anchor + trust + open a task; returns { project, task }. */
  createTrustedTask(objective: string, title?: string): Promise<{ project: any; task: any }>;
  /** Poll task.get until the latest run leaves `running`. */
  waitForRunSettle(taskId: string): Promise<any>;
  /** Poll task.get until the latest run reaches one of `statuses`. */
  waitForRunStatus(taskId: string, statuses: string[]): Promise<any>;
  /**
   * Restart the host over the same data dir (crash-recovery replays): close
   * the live server, boot a fresh one against the same product.db, and
   * retarget `rpc`. The conversation-home override is process-wide and
   * stays in place across the restart.
   */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function startEvalWorld(options: { feishu?: boolean } = {}): Promise<EvalWorld> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-eval-"));
  const dirs: EvalWorldDirs = {
    base,
    home: path.join(base, "home"),
    dataDir: path.join(base, "data"),
    workspace: path.join(base, "workspace"),
    project: path.join(base, "project"),
  };
  fs.mkdirSync(dirs.home, { recursive: true });
  fs.mkdirSync(dirs.dataDir, { recursive: true });
  fs.mkdirSync(dirs.workspace, { recursive: true });
  fs.mkdirSync(dirs.project, { recursive: true });
  _setPenglaiHomeForTest(dirs.home);

  const mock = new MockModelServer();
  await mock.start();

  // 渠道回放：先起 mock 飞书服务端并落 channels.json（0600），host 启动即
  // 自启飞书渠道（生产同路径：开机自启）。
  let feishu: MockFeishuServer | null = null;
  if (options.feishu) {
    feishu = new MockFeishuServer();
    await feishu.start();
    saveChannelConfig(dirs.dataDir, {
      appId: "cli_eval",
      appSecret: "eval_secret",
      domain: feishu.baseUrl,
      enabled: true,
    });
  }

  const serverOptions = {
    port: 0,
    token: EVAL_TOKEN,
    dataDir: dirs.dataDir,
    databasePath: path.join(dirs.dataDir, "product.db"),
    log: () => undefined,
  };
  let server = await startServer(serverOptions);
  // 渠道回放：等飞书长连接就位（事件早到会被丢弃）。
  if (feishu) {
    const deadline = Date.now() + 5000;
    while (feishu.connections < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (feishu.connections < 1) throw new Error("feishu channel did not connect in time");
  }
  /** Drop idle keep-alive sockets so close() does not wait out the timeout. */
  const closeServer = async (s: StartedServer): Promise<void> => {
    s.server.closeIdleConnections();
    await s.close();
  };

  const rpcRaw = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<{ status: number; body: any }> => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Penglai-Token": EVAL_TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  const rpc = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const { body } = await rpcRaw(method, params);
    if (body.error) {
      throw new Error(`${method} failed: ${body.error.message}`);
    }
    return body.result as T;
  };

  await rpc("config.createProfile", {
    id: EVAL_PROFILE,
    baseUrl: mock.baseUrl,
    model: "mock-model",
    apiKey: "eval-key",
  });

  const world: EvalWorld = {
    mock,
    feishu,
    get server() {
      return server;
    },
    dirs,
    rpc,
    rpcRaw,

    async createConversation(title = "eval conversation") {
      const ws = await rpc("workspace.open", { rootPath: dirs.workspace, name: "eval-ws" });
      return rpc("conversation.create", {
        workspaceId: ws.id,
        modelProfileId: EVAL_PROFILE,
        title,
      });
    },

    async createTrustedTask(objective: string, title = "eval task") {
      const project = await rpc("project.create", { rootPath: dirs.project, name: "eval-project" });
      await rpc("project.trust", { projectId: project.id, confirmedRootPath: dirs.project });
      const task = await rpc("task.create", {
        projectId: project.id,
        title,
        objective,
      });
      return { project, task };
    },

    async waitForRunSettle(taskId: string) {
      // A waiting_approval run is NOT settled — it is parked for a human
      // decision; replays decide through the approval RPCs, then wait again.
      return world.waitForRunStatus(taskId, [
        "blocked",
        "paused",
        "completed",
        "failed",
        "cancelled",
      ]);
    },

    async waitForRunStatus(taskId: string, statuses: string[]) {
      for (let i = 0; i < 200; i += 1) {
        const bundle = await rpc("task.get", { taskId });
        const latest = bundle.runs.at(-1);
        if (latest && statuses.includes(latest.status)) return bundle;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`run for task ${taskId} did not reach ${statuses.join("/")} in time`);
    },

    async restart() {
      await closeServer(server);
      server = await startServer(serverOptions);
    },

    async close() {
      await closeServer(server);
      await mock.close();
      await feishu?.close();
      _setPenglaiHomeForTest(null);
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
  return world;
}

/** Extract the tool names the kernel advertised on one provider request. */
export function advertisedTools(request: RecordedRequest): string[] {
  const tools = Array.isArray(request.body.tools)
    ? (request.body.tools as Array<{ function?: { name?: string } }>)
    : [];
  return tools
    .map((t) => t?.function?.name)
    .filter((n): n is string => typeof n === "string")
    .sort();
}

/** Concatenate the text content of every tool-result message in a request. */
export function toolResultsText(request: RecordedRequest): string {
  const messages = Array.isArray(request.body.messages) ? request.body.messages : [];
  return messages
    .filter((m) => m?.role === "tool")
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((part) =>
            part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
              ? (part as { text: string }).text
              : "",
          )
          .join("");
      }
      return "";
    })
    .join("\n");
}
