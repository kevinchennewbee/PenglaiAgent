/**
 * R4/R5 end-to-end: Host restart durability.
 *
 * R4 — conversation message `contextReferences` survive close/restart:
 *   prompt with auto-retrieved context → assistant message persisted with refs
 *   → close server → reboot on same dataDir/home → conversation.get returns
 *   the same refs → context.read resolves them (current).
 *
 * R5 — Task source Evidence survives restart and resolves by opaque ref:
 *   Host-observed source evidence written to product.db → restart → evidence
 *   row intact with metadata.contextRef → context.read → current → modify +
 *   reindex → stale → remove source → revoked (tombstone, no body, row kept).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";

const TOKEN = "e2e-token-041";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-041-e2e-data-"));
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-041-e2e-home-"));
const docsDir = path.join(dataDir, "docs");
fs.mkdirSync(docsDir, { recursive: true });

class FakeChatKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "e2e-chat";
  isRunning = false;
  private readonly listeners = new Set<KernelEventListener>();
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
  async prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    try {
      this.emit({ kind: "message.delta", textDelta: "已核对资料。 " });
      this.emit({ kind: "turn.completed" });
    } finally {
      this.isRunning = false;
    }
  }
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

class FakeTaskKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "e2e-task";
  isRunning = false;
  subscribe(): () => void {
    return () => {};
  }
  async prompt(_input: KernelPrompt): Promise<void> {}
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

async function boot(): Promise<StartedServer> {
  const started = await startServer({
    port: 0,
    token: TOKEN,
    dataDir,
    databasePath: path.join(dataDir, "product.db"),
    chatKernelFactory: async () => new FakeChatKernel(),
    taskKernelFactory: async () => new FakeTaskKernel(),
  });
  return started;
}

let server: StartedServer;
let baseUrl: string;

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Penglai-Token": TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const DOC_TOKEN = "HT-E2E-9042";

beforeAll(async () => {
  _setPenglaiHomeForTest(homeDir);
  fs.writeFileSync(
    path.join(docsDir, "合同.md"),
    `# 合同\n\n合同编号 ${DOC_TOKEN}，付款 30 天，违约 10%。\n`,
    "utf8",
  );
  server = await boot();
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
  _setPenglaiHomeForTest(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe("R4 conversation contextReferences survive restart", () => {
  let chatId: string;
  let refId: string;

  it("prompts with auto-retrieved context and persists refs", async () => {
    const src = await rpc("context.source.add", {
      rootPath: docsDir,
      scope: "global",
      trustedChannel: "test",
    });
    expect(src.body.error).toBeUndefined();
    expect(src.body.result.source.successCount).toBeGreaterThanOrEqual(1);

    await rpc("config.createProfile", {
      id: "e2e-profile",
      baseUrl: "https://example.invalid/v1",
      model: "e2e-model",
      apiKey: "e2e-key",
    });
    const ws = await rpc("workspace.open", {
      rootPath: dataDir,
      name: "e2e-ws",
    });
    const created = await rpc("conversation.create", {
      workspaceId: ws.body.result.id,
      modelProfileId: "e2e-profile",
      title: "e2e refs",
    });
    chatId = created.body.result.id;

    // Query hits the doc → auto-retrieve injects refs → collector admits them.
    // Pure single token: trigram MATCH requires a contiguous substring.
    const prompted = await rpc("conversation.prompt", {
      conversationId: chatId,
      text: DOC_TOKEN,
    });
    expect(prompted.body.error).toBeUndefined();
    expect(prompted.body.result.stopReason).toBe("completed");

    const got = await rpc("conversation.get", { conversationId: chatId });
    const assistant = got.body.result.messages.find(
      (m: any) => m.role === "assistant",
    );
    expect(assistant).toBeTruthy();
    expect(assistant.contextReferences?.length).toBeGreaterThan(0);
    refId = assistant.contextReferences[0].ref;
    expect(refId).toMatch(/^ctxref_/);

    // Same-process resolve: current.
    const read = await rpc("context.read", { contextRef: refId });
    expect(read.body.error).toBeUndefined();
    expect(read.body.result.status).toBe("current");
    expect(read.body.result.text).toContain(DOC_TOKEN);
  });

  it("restores refs after close + reboot and still resolves them", async () => {
    await server.close();
    server = await boot();
    baseUrl = `http://127.0.0.1:${server.port}`;

    // conversation.get hydrates the durable transcript with contextReferences.
    const got = await rpc("conversation.get", { conversationId: chatId });
    expect(got.body.error).toBeUndefined();
    const assistant = got.body.result.messages.find(
      (m: any) => m.role === "assistant",
    );
    expect(assistant.contextReferences?.length).toBeGreaterThan(0);
    expect(assistant.contextReferences[0].ref).toBe(refId);
    expect(assistant.contextReferences[0].status).toBe("current");

    const read = await rpc("context.read", { contextRef: refId });
    expect(read.body.result.status).toBe("current");
  });

  it("F6: conversation.get refreshes frozen card status after reindex and revoke", async () => {
    // Persist wrote status=current; after content change + reindex, get must
    // return stale without requiring a separate context.read.
    fs.writeFileSync(
      path.join(docsDir, "合同.md"),
      `# 合同\n\n合同编号 ${DOC_TOKEN}，付款 90 天（F6 改动），违约 1%。\n`,
      "utf8",
    );
    const srcList = await rpc("context.source.list", {});
    const sourceId = srcList.body.result.sources[0].id;
    await rpc("context.source.reindex", { sourceId });

    const staleGet = await rpc("conversation.get", { conversationId: chatId });
    const staleAssistant = staleGet.body.result.messages.find(
      (m: any) => m.role === "assistant",
    );
    const staleRef = staleAssistant.contextReferences.find(
      (r: any) => r.ref === refId,
    );
    expect(staleRef).toBeTruthy();
    expect(staleRef.status).toBe("stale");
    // Other identity fields stay as written at mint time.
    expect(staleRef.ref).toBe(refId);
    expect(staleRef.relativePath).toBeTruthy();

    await rpc("context.source.remove", { sourceId });
    const revokedGet = await rpc("conversation.get", { conversationId: chatId });
    const revokedAssistant = revokedGet.body.result.messages.find(
      (m: any) => m.role === "assistant",
    );
    const revokedRef = revokedAssistant.contextReferences.find(
      (r: any) => r.ref === refId,
    );
    expect(revokedRef.status).toBe("revoked");

    // Re-add the same docs so R5 evidence cases below still have a source.
    await rpc("context.source.add", {
      rootPath: docsDir,
      scope: "global",
      trustedChannel: "test",
    });
  });
});

describe("R5 source Evidence survives restart and resolves by opaque ref", () => {
  let taskId: string;
  let refId: string;

  it("writes Host-observed source evidence; resolves after restart as current", async () => {
    // Fresh source (doc unchanged) to mint a stable ref.
    const hits = await rpc("context.search", {
      query: DOC_TOKEN,
      globalOnly: true,
      limit: 5,
    });
    expect(hits.body.result.hits.length).toBeGreaterThan(0);
    const hit = hits.body.result.hits[0];
    refId = hit.contextRef;
    const docSha = hit.documentSha256;

    const project = server.handle.productStore.createProject({
      name: "e2e-project",
      rootPath: docsDir,
      trusted: true,
    });
    const task = server.handle.productStore.createTask({
      projectId: project.id,
      title: "e2e evidence task",
      objective: "prove restart durability",
    });
    taskId = task.id;
    // Real durable run + step so evidence foreign-key checks pass (Host path).
    const run = server.handle.productStore.createRun({
      taskId,
      modelProfileId: "e2e-profile",
      budget: { maxTurns: 5 },
    });
    const step = server.handle.productStore.createStep({
      runId: run.id,
      title: "检索资料",
      status: "running",
      summary: "context_search",
    });
    // Host-observed evidence (same shape as server onContextUsed writes).
    server.handle.productStore.addEvidence({
      taskId,
      runId: run.id,
      stepId: step.id,
      kind: "source",
      title: "Context search: 合同",
      summary: "合同.md",
      uri: `penglai-context://${refId}`,
      sha256: docSha,
      metadata: {
        provenance: "tool-observed",
        tool: "context_search",
        query: DOC_TOKEN,
        contextRef: refId,
        relativePath: "合同.md",
        sourceId: hit.sourceId,
        runId: run.id,
      },
    });

    await server.close();
    server = await boot();
    baseUrl = `http://127.0.0.1:${server.port}`;

    const bundle = server.handle.productStore.getTaskBundle(taskId);
    const evidence = bundle?.evidence.find(
      (e) => e.kind === "source" && e.metadata?.contextRef === refId,
    );
    expect(evidence).toBeTruthy();
    expect(evidence!.uri).toBe(`penglai-context://${refId}`);
    expect(evidence!.metadata.relativePath).toBe("合同.md");

    // Ref persists in context.db and resolves current.
    const read = await rpc("context.read", { contextRef: refId });
    expect(read.body.result.status).toBe("current");
    expect(read.body.result.text).toContain(DOC_TOKEN);
  });

  it("evidence ref becomes stale after content change + reindex, revoked after remove", async () => {
    // Content change → reindex → same evidence ref resolves stale.
    fs.writeFileSync(
      path.join(docsDir, "合同.md"),
      `# 合同\n\n合同编号 ${DOC_TOKEN}，付款 60 天（已改），违约 5%。\n`,
      "utf8",
    );
    const srcList = await rpc("context.source.list", {});
    const sourceId = srcList.body.result.sources[0].id;
    await rpc("context.source.reindex", { sourceId });
    const stale = await rpc("context.read", { contextRef: refId });
    expect(stale.body.result.status).toBe("stale");

    // Evidence row survives and reflects stale lifecycle (no body on revoked).
    const bundle = server.handle.productStore.getTaskBundle(taskId);
    const evidence = bundle?.evidence.find(
      (e) => e.kind === "source" && e.metadata?.contextRef === refId,
    );
    expect(evidence).toBeTruthy();

    // Remove source → revoked tombstone: no body, minimal audit row kept.
    await rpc("context.source.remove", { sourceId });
    const revoked = await rpc("context.read", { contextRef: refId });
    expect(revoked.body.result.status).toBe("revoked");
    expect(revoked.body.result.text).toBe("");
    const after = server.handle.productStore.getTaskBundle(taskId);
    const kept = after?.evidence.find(
      (e) => e.kind === "source" && e.metadata?.contextRef === refId,
    );
    expect(kept).toBeTruthy();
  });
});
