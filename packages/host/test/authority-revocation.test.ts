import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { startServer, type StartedServer } from "../src/server.js";
import type {
  AgentKernel,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";

const TOKEN = "authority-revocation-test-token";
const profile: ModelProfile = {
  id: "authority-test",
  label: "Authority test",
  provider: "custom",
  baseUrl: "https://example.invalid/v1",
  apiKeyEnv: "AUTHORITY_TEST_KEY",
  model: "authority-test-model",
  capabilities: { tools: true, streaming: true, vision: false },
};

class BlockingKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = `authority-${Math.random().toString(36).slice(2)}`;
  isRunning = false;
  private settle!: () => void;
  private startedResolve!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });
  private readonly completion = new Promise<void>((resolve) => {
    this.settle = resolve;
  });
  onAbort: (() => void) | null = null;
  readonly abort = vi.fn(async () => {
    this.onAbort?.();
    this.settle();
  });

  subscribe(_listener: KernelEventListener): () => void {
    return () => {};
  }

  async prompt(_input: KernelPrompt): Promise<void> {
    this.isRunning = true;
    this.startedResolve();
    try {
      await this.completion;
    } finally {
      this.isRunning = false;
    }
  }

  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  dispose(): void {}
}

const servers: StartedServer[] = [];
const directories: string[] = [];

async function rpc(
  server: StartedServer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${server.port}/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Penglai-Token": TOKEN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
}

function unwrap(body: any): any {
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function createTestServer(options: {
  chatKernel?: BlockingKernel;
  taskKernel?: BlockingKernel;
}): Promise<{ server: StartedServer; dataDir: string; projectDir: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-authority-data-"));
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "penglai-authority-project-"),
  );
  directories.push(dataDir, projectDir);
  const server = await startServer({
    port: 0,
    token: TOKEN,
    dataDir,
    profiles: [profile],
    chatKernelFactory: options.chatKernel
      ? async () => options.chatKernel!
      : undefined,
    taskKernelFactory: options.taskKernel
      ? async () => options.taskKernel!
      : undefined,
    log: () => {},
  });
  servers.push(server);
  return { server, dataDir, projectDir };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
  while (directories.length > 0) {
    fs.rmSync(directories.pop()!, { recursive: true, force: true });
  }
  delete process.env.AUTHORITY_TEST_KEY;
});

describe("Host authority revocation order", () => {
  it("mode.confirmWork drains the floating episode before changing activeTask/root", async () => {
    process.env.AUTHORITY_TEST_KEY = "test-key";
    const kernel = new BlockingKernel();
    const { server, projectDir } = await createTestServer({ chatKernel: kernel });
    const workspace = unwrap(
      await rpc(server, "workspace.open", { rootPath: projectDir }),
    );
    const conversation = unwrap(
      await rpc(server, "conversation.create", {
        workspaceId: workspace.id,
        modelProfileId: profile.id,
      }),
    );
    const prompting = rpc(server, "conversation.prompt", {
      conversationId: conversation.id,
      text: "floating episode",
      permissionMode: "auto_edit",
    });
    await kernel.started;
    const proposal = unwrap(
      await rpc(server, "mode.proposeWork", {
        conversationId: conversation.id,
        rootPath: projectDir,
        objective: "switch roots safely",
      }),
    );
    let taskAtAbort: string | null | undefined = undefined;
    kernel.onAbort = () => {
      taskAtAbort = server.handle.conversations.get(conversation.id)?.activeTaskId;
    };

    const confirmed = unwrap(
      await rpc(server, "mode.confirmWork", {
        proposalId: proposal.proposal.id,
        conversationId: conversation.id,
        confirmedRootPath: projectDir,
      }),
    );
    const promptResult = unwrap(await prompting);

    expect(kernel.abort).toHaveBeenCalledOnce();
    expect(taskAtAbort).toBeNull();
    expect(promptResult.stopReason).toBe("aborted");
    expect(confirmed.conversation.activeTaskId).toBe(confirmed.task.id);
    expect(confirmed.conversation.mode).toBe("work");
  });

  it("mode.exitWork aborts and settles the anchored chat episode before clearing its task", async () => {
    process.env.AUTHORITY_TEST_KEY = "test-key";
    const kernel = new BlockingKernel();
    const { server, projectDir } = await createTestServer({ chatKernel: kernel });
    const workspace = unwrap(
      await rpc(server, "workspace.open", { rootPath: projectDir }),
    );
    const conversation = unwrap(
      await rpc(server, "conversation.create", {
        workspaceId: workspace.id,
        modelProfileId: profile.id,
      }),
    );
    const proposal = unwrap(
      await rpc(server, "mode.proposeWork", {
        conversationId: conversation.id,
        rootPath: projectDir,
        objective: "authority ordering",
      }),
    );
    const confirmed = unwrap(
      await rpc(server, "mode.confirmWork", {
        proposalId: proposal.proposal.id,
        conversationId: conversation.id,
        confirmedRootPath: projectDir,
      }),
    );
    let taskAtAbort: string | null = null;
    kernel.onAbort = () => {
      taskAtAbort = server.handle.conversations.get(conversation.id)?.activeTaskId ?? null;
    };

    const prompting = rpc(server, "conversation.prompt", {
      conversationId: conversation.id,
      text: "keep working",
      permissionMode: "auto_edit",
    });
    await kernel.started;
    const exited = unwrap(
      await rpc(server, "mode.exitWork", {
        conversationId: conversation.id,
        outcome: "paused",
      }),
    );
    const promptResult = unwrap(await prompting);

    expect(kernel.abort).toHaveBeenCalledOnce();
    expect(taskAtAbort).toBe(confirmed.task.id);
    expect(promptResult.stopReason).toBe("aborted");
    expect(exited.conversation.activeTaskId).toBeNull();
    expect(exited.conversation.mode).toBe("chat");
  });

  it("project.untrust drains a live TaskRunner episode before persisting trust=false", async () => {
    process.env.AUTHORITY_TEST_KEY = "test-key";
    const kernel = new BlockingKernel();
    const { server, projectDir } = await createTestServer({ taskKernel: kernel });
    const project = unwrap(
      await rpc(server, "project.create", {
        rootPath: projectDir,
        name: "authority project",
      }),
    );
    unwrap(
      await rpc(server, "project.trust", {
        projectId: project.id,
        confirmedRootPath: projectDir,
      }),
    );
    const task = unwrap(
      await rpc(server, "task.create", {
        projectId: project.id,
        title: "live task",
        objective: "stay inside trusted root",
      }),
    );
    let trustAtAbort: boolean | null = null;
    kernel.onAbort = () => {
      trustAtAbort = server.handle.productStore.getProject(project.id)?.trusted ?? null;
    };

    const run = unwrap(
      await rpc(server, "task.start", {
        taskId: task.id,
        modelProfileId: profile.id,
        source: "desktop",
      }),
    );
    await kernel.started;
    const untrusted = unwrap(
      await rpc(server, "project.untrust", { projectId: project.id }),
    );

    expect(kernel.abort).toHaveBeenCalledOnce();
    expect(trustAtAbort).toBe(true);
    expect(untrusted.trusted).toBe(false);
    expect(server.handle.productStore.getRun(run.id)?.status).toBe("cancelled");
  });
});
