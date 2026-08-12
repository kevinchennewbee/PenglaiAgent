/**
 * F1: Desktop RPC gets a non-terminal queued ack; executor waitForTerminal
 * waits for the real reply so IM channels never surface [episode queued:].
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONVERSATION_PROMPT_ACK } from "@penglai/protocol";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";

const TOKEN = "f1-ack-token";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-f1-ack-"));
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-f1-home-"));

class HoldKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "f1-hold";
  isRunning = false;
  private listeners = new Set<KernelEventListener>();
  private settle!: () => void;
  private promptPromise = new Promise<void>((resolve) => {
    this.settle = resolve;
  });
  reply = "第一轮回复";

  subscribe(listener: KernelEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Omit<KernelEvent, "occurredAt" | "sessionId" | "raw">): void {
    const full = {
      ...event,
      occurredAt: Date.now(),
      sessionId: this.sessionId,
      raw: event,
    } as KernelEvent;
    for (const listener of this.listeners) listener(full);
  }

  prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    // Emit reply text when completing, not immediately — tests control complete().
    return this.promptPromise.finally(() => {
      this.isRunning = false;
    });
  }

  complete(text?: string): void {
    if (text) this.reply = text;
    this.emit({ kind: "message.delta", textDelta: this.reply });
    this.emit({ kind: "turn.completed" });
    this.settle();
  }

  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {
    this.settle();
  }
  dispose(): void {}
}

const kernels: HoldKernel[] = [];

async function rpc(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const res = await fetch(`${baseUrl}/api`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-penglai-token": TOKEN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

describe("F1 conversation.prompt queued ack vs waitForTerminal", () => {
  let server: StartedServer;
  let baseUrl: string;
  let conversationId: string;

  beforeAll(async () => {
    _setPenglaiHomeForTest(homeDir);
    process.env.PENGLAI_F1_TEST_KEY = "test-key";
    server = await startServer({
      port: 0,
      token: TOKEN,
      dataDir,
      databasePath: path.join(dataDir, "product.db"),
      profiles: [
        {
          id: "f1",
          label: "F1",
          provider: "custom",
          baseUrl: "https://example.invalid/v1",
          apiKeyEnv: "PENGLAI_F1_TEST_KEY",
          model: "test",
          capabilities: { tools: true, streaming: true, vision: false },
        },
      ],
      chatKernelFactory: async () => {
        const kernel = new HoldKernel();
        kernels.push(kernel);
        return kernel;
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;

    const ws = await rpc(baseUrl, "workspace.open", {
      rootPath: dataDir,
      name: "f1-ws",
    });
    const created = await rpc(baseUrl, "conversation.create", {
      workspaceId: ws.result.id,
      modelProfileId: "f1",
      title: "f1 ack",
    });
    conversationId = created.result.id;
  });

  afterAll(async () => {
    await server.close();
    _setPenglaiHomeForTest(null);
    delete process.env.PENGLAI_F1_TEST_KEY;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("Desktop RPC (waitForTerminal=false) returns structured queued ack while busy", async () => {
    const first = rpc(baseUrl, "conversation.prompt", {
      conversationId,
      text: "第一轮",
      delivery: "queue",
    });
    // Wait until the kernel is active.
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (kernels[0]?.isRunning) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("kernel not running"));
        setTimeout(tick, 10);
      };
      tick();
    });

    const ack = await rpc(baseUrl, "conversation.prompt", {
      conversationId,
      text: "第二轮 follow-up",
      delivery: "queue",
    });
    expect(ack.error).toBeUndefined();
    expect(ack.result.stopReason).toBe("queued");
    expect(ack.result.stopDetail).toBe(CONVERSATION_PROMPT_ACK.FOLLOWUP_QUEUED);
    expect(ack.result.status).toBe("queued");

    const steerAck = await rpc(baseUrl, "conversation.prompt", {
      conversationId,
      text: "steer now",
      delivery: "now",
    });
    expect(steerAck.result.stopReason).toBe("queued");
    expect(steerAck.result.stopDetail).toBe(CONVERSATION_PROMPT_ACK.STEER_QUEUED);

    kernels[0]!.complete("第一轮回复");
    const firstResult = await first;
    expect(firstResult.result.stopReason).toBe("completed");
    expect(firstResult.result.text).toContain("第一轮回复");

    // Drain queued follow-ups so the next test starts idle.
    await server.handle.conversationExecutor.abortAndWait(conversationId);
  });

  it("conversationExecutor waitForTerminal waits for the real reply (IM path)", async () => {
    kernels.length = 0;
    const firstPromise = server.handle.conversationExecutor.prompt({
      conversationId,
      text: "IM 第一轮",
      waitForTerminal: true,
    });
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (kernels[0]?.isRunning) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("kernel not running"));
        setTimeout(tick, 10);
      };
      tick();
    });

    const secondPromise = server.handle.conversationExecutor.prompt({
      conversationId,
      text: "IM 第二轮",
      waitForTerminal: true,
    });

    // Must still be pending — not a queued ack.
    let secondSettled = false;
    void secondPromise.then(() => {
      secondSettled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(secondSettled).toBe(false);

    kernels[0]!.complete("IM 第一轮回复");
    const first = await firstPromise;
    expect(first.stopReason).toBe("completed");
    expect(first.text).toContain("IM 第一轮回复");

    // Second episode should start after first settles.
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (kernels[1]?.isRunning) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("second kernel not running"));
        setTimeout(tick, 10);
      };
      tick();
    });
    kernels[1]!.reply = "IM 第二轮回复";
    kernels[1]!.complete("IM 第二轮回复");
    const second = await secondPromise;
    expect(second.stopReason).toBe("completed");
    expect(second.text).toContain("IM 第二轮回复");
    expect(second.stopReason).not.toBe("queued");
  });
});
