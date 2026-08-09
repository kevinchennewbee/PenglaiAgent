/**
 * Mode-switch loop + memory RPC tests (0.4.0 design §5/§6).
 *
 * Exercises the deterministic state machine over the real JSON-RPC surface:
 *   chat → mode.proposeWork (pending only) → Owner confirm → work
 *   work → mode.exitWork → chat (task completed or paused)
 * plus the two-layer memory RPCs and their anti-pollution refusals.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { startServer, type StartedServer } from "../src/server.js";
import type {
  AgentKernel,
  KernelEventListener,
  KernelPrompt,
} from "../src/kernel/kernel.js";

const TEST_TOKEN = "mode-switch-test-token";

let started: StartedServer;
let baseUrl: string;
let dataDir: string;
let projectDir: string;
let conversationId: string;

class IdleKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = "0.83.0";
  readonly sessionId = "mode-switch-test";
  isRunning = false;
  subscribe(_listener: KernelEventListener): () => void {
    return () => {};
  }
  async prompt(_input: KernelPrompt): Promise<void> {}
  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async abort(): Promise<void> {}
  dispose(): void {}
}

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Penglai-Token": TEST_TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Unwrap a successful RPC result or throw the server's error message. */
function result<T = any>(body: any): T {
  if (body.error) {
    throw new Error(`RPC failed: ${body.error.message}`);
  }
  return body.result as T;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-mode-home-"));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-mode-proj-"));
  started = await startServer({
    port: 0,
    token: TEST_TOKEN,
    dataDir,
    taskKernelFactory: async () => new IdleKernel(),
  });
  baseUrl = `http://127.0.0.1:${started.port}`;

  const ws = result(
    (await rpc("workspace.open", { rootPath: projectDir, name: "proj" })).body,
  );
  const conversation = result(
    (
      await rpc("conversation.create", {
        workspaceId: ws.id,
        modelProfileId: "grok",
        title: "daily",
      })
    ).body,
  );
  conversationId = conversation.id;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("mode switch: the deterministic chat ⇄ work loop", () => {
  let projectId = "";
  let proposalId = "";
  let activeTaskId = "";

  it("starts in chat mode with no anchored task", async () => {
    const { body } = await rpc("mode.get", { conversationId });
    const mode = result(body);
    expect(mode.mode).toBe("chat");
    expect(mode.activeTaskId).toBeNull();
    expect(mode.projectId).toBeNull();
  });

  it("proposal for filesystem root stays untrusted, taskless, and unanchored", async () => {
    const proposed = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          rootPath: path.parse(process.cwd()).root,
          objective: "root must remain inert",
        })
      ).body,
    );
    expect(proposed.project).toBeNull();
    expect(proposed.projectName).toBe("Project");
    expect(proposed.proposal.canonicalRootPath).toBe(fs.realpathSync(path.parse(process.cwd()).root));
    expect(proposed.proposal.status).toBe("pending");
    expect(proposed.task).toBeNull();
    expect(proposed.conversation.mode).toBe("chat");
    expect(proposed.conversation.activeTaskId).toBeNull();
    expect(result((await rpc("project.list", {})).body)).toEqual([]);

    const refused = await rpc("mode.confirmWork", {
      proposalId: proposed.proposal.id,
      conversationId,
      confirmedRootPath: path.parse(process.cwd()).root,
    });
    expect(refused.body.error.data?.code).toBe("proposal_blocked");
    expect(result((await rpc("project.list", {})).body)).toEqual([]);
    expect(result((await rpc("mode.get", { conversationId })).body).activeTaskId).toBeNull();
  });

  it("proposal for Host dataDir is recorded but confirmation has no product side effects", async () => {
    const proposed = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          rootPath: dataDir,
          objective: "host data must remain protected",
        })
      ).body,
    );
    expect(proposed.project).toBeNull();
    expect(proposed.proposal.status).toBe("pending");
    const refused = await rpc("mode.confirmWork", {
      proposalId: proposed.proposal.id,
      conversationId,
      confirmedRootPath: dataDir,
    });
    expect(refused.body.error.data?.code).toBe("proposal_blocked");
    expect(result((await rpc("project.list", {})).body)).toEqual([]);
    expect(result((await rpc("mode.get", { conversationId })).body).activeTaskId).toBeNull();
  });

  it("proposeWork persists a canonical pending proposal without trust, Task, or anchor", async () => {
    const { body } = await rpc("mode.proposeWork", {
      conversationId,
      rootPath: projectDir,
      objective: "把构建修绿并补回归测试",
    });
    const proposed = result(body);
    expect(proposed.reusedProject).toBe(false);
    expect(proposed.project).toBeNull();
    expect(proposed.projectName).toBe(path.basename(projectDir));
    expect(proposed.proposal.canonicalRootPath).toBe(fs.realpathSync(projectDir));
    expect(proposed.proposal.objective).toBe("把构建修绿并补回归测试");
    expect(proposed.proposal.status).toBe("pending");
    expect(proposed.task).toBeNull();
    expect(proposed.requiresConfirmation).toBe(true);
    expect(proposed.conversation.mode).toBe("chat");
    expect(proposed.conversation.activeTaskId).toBeNull();
    proposalId = proposed.proposal.id;

    expect(result((await rpc("project.list", {})).body)).toEqual([]);
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "work-proposals.json"), "utf8"));
    expect(persisted.proposals.find((row: any) => row.id === proposalId).canonicalRootPath)
      .toBe(fs.realpathSync(projectDir));

    const mode = result((await rpc("mode.get", { conversationId })).body);
    expect(mode.mode).toBe("chat");
    expect(mode.activeTaskId).toBeNull();
    expect(mode.projectId).toBeNull();
    expect(mode.task).toBeNull();
    expect(mode.pendingProposal.id).toBe(proposalId);
  });

  it("rejects an unknown proposal id and a path mismatch without side effects", async () => {
    const unknown = await rpc("mode.confirmWork", {
      proposalId: "proposal_missing",
      conversationId,
      confirmedRootPath: projectDir,
    });
    expect(unknown.body.error.data?.code).toBe("proposal_not_found");

    const mismatch = await rpc("mode.confirmWork", {
      proposalId,
      conversationId,
      confirmedRootPath: dataDir,
    });
    expect(mismatch.body.error.data?.code).toBe("proposal_mismatch");
    expect(result((await rpc("project.list", {})).body)).toEqual([]);
    expect(result((await rpc("mode.get", { conversationId })).body).activeTaskId).toBeNull();
  });

  it("project.trust alone never creates or activates work", async () => {
    const project = result(
      (
        await rpc("project.create", {
          rootPath: projectDir,
          name: "proj",
        })
      ).body,
    );
    projectId = project.id;
    expect(project.trusted).toBe(false);
    const trusted = result(
      (
        await rpc("project.trust", {
          projectId,
          confirmedRootPath: projectDir,
        })
      ).body,
    );
    expect(trusted.trusted).toBe(true);
    expect(result((await rpc("task.list", { projectId })).body)).toEqual([]);
    expect(result((await rpc("mode.get", { conversationId })).body).activeTaskId).toBeNull();
  });

  it("exact Owner confirmation trusts, creates one task, and activates the conversation", async () => {
    const confirmed = result(
      (
        await rpc("mode.confirmWork", {
          proposalId,
          conversationId,
          confirmedRootPath: projectDir,
          confirmedBy: "test:owner",
        })
      ).body,
    );
    expect(confirmed.changed).toBe(true);
    expect(confirmed.idempotent).toBe(false);
    expect(confirmed.project.trusted).toBe(true);
    expect(confirmed.proposal.status).toBe("confirmed");
    expect(confirmed.proposal.confirmedBy).toBe("test:owner");
    expect(confirmed.task.objective).toBe("把构建修绿并补回归测试");
    expect(confirmed.task.acceptanceCriteria).toContain(`owner-proposal:${proposalId}`);
    expect(confirmed.conversation.mode).toBe("work");
    expect(confirmed.conversation.activeTaskId).toBe(confirmed.task.id);
    activeTaskId = confirmed.task.id;
    expect(result((await rpc("task.list", { projectId })).body)).toHaveLength(1);
  });

  it("repeated exact confirmation is idempotent and creates no duplicate task", async () => {
    const repeated = result(
      (
        await rpc("mode.confirmWork", {
          proposalId,
          conversationId,
          confirmedRootPath: projectDir,
          confirmedBy: "test:owner",
        })
      ).body,
    );
    expect(repeated.changed).toBe(false);
    expect(repeated.idempotent).toBe(true);
    expect(repeated.task.id).toBe(activeTaskId);
    expect(result((await rpc("task.list", { projectId })).body)).toHaveLength(1);
  });

  it("refuses a second proposeWork while already in work mode", async () => {
    const { body } = await rpc("mode.proposeWork", {
      conversationId,
      rootPath: projectDir,
      objective: "another task",
    });
    expect(body.error).toBeDefined();
    expect(body.error.data?.code ?? body.error.message).toMatch(/mode_conflict|already in work mode/);
  });

  it("exitWork(paused) flips back to chat and leaves the task open", async () => {
    const before = result((await rpc("mode.get", { conversationId })).body);
    const { body } = await rpc("mode.exitWork", {
      conversationId,
      outcome: "paused",
    });
    const exited = result(body);
    expect(exited.changed).toBe(true);
    expect(exited.conversation.mode).toBe("chat");
    expect(exited.conversation.activeTaskId).toBeNull();
    expect(exited.task.id).toBe(before.activeTaskId);
    expect(exited.task.status).not.toBe("completed");

    const replay = await rpc("mode.confirmWork", {
      proposalId,
      conversationId,
      confirmedRootPath: projectDir,
    });
    expect(replay.body.error.data?.code).toBe("proposal_replayed");
    expect(result((await rpc("task.list", { projectId })).body)).toHaveLength(1);
  });

  it("exitWork is an idempotent no-op in chat mode", async () => {
    const { body } = await rpc("mode.exitWork", { conversationId });
    const exited = result(body);
    expect(exited.changed).toBe(false);
    expect(exited.message).toContain("already floating");
  });

  it("rejects a forged recovery marker but adopts an exact crash-recovery task", async () => {
    const forgedProposal = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          projectId,
          objective: "recover exact task",
        })
      ).body,
    );
    await rpc("task.create", {
      projectId,
      title: "forged title",
      objective: forgedProposal.proposal.objective,
      acceptanceCriteria: [`owner-proposal:${forgedProposal.proposal.id}`],
      sourceChannel: "api",
    });
    const forged = await rpc("mode.confirmWork", {
      proposalId: forgedProposal.proposal.id,
      conversationId,
      confirmedRootPath: projectDir,
    });
    expect(forged.body.error.data?.code).toBe("proposal_blocked");
    expect(result((await rpc("mode.get", { conversationId })).body).activeTaskId).toBeNull();

    const recoveryProposal = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          projectId,
          objective: "resume interrupted confirmation",
          title: "recovery task",
        })
      ).body,
    );
    const recoveryTask = result(
      (
        await rpc("task.create", {
          projectId,
          title: recoveryProposal.proposal.title,
          objective: recoveryProposal.proposal.objective,
          acceptanceCriteria: [`owner-proposal:${recoveryProposal.proposal.id}`],
          sourceChannel: recoveryProposal.proposal.sourceChannel,
        })
      ).body,
    );
    const recovered = result(
      (
        await rpc("mode.confirmWork", {
          proposalId: recoveryProposal.proposal.id,
          conversationId,
          confirmedRootPath: projectDir,
        })
      ).body,
    );
    expect(recovered.task.id).toBe(recoveryTask.id);
    expect(
      result((await rpc("task.list", { projectId })).body)
        .filter((task: any) => task.acceptanceCriteria.includes(`owner-proposal:${recoveryProposal.proposal.id}`)),
    ).toHaveLength(1);
    await rpc("mode.exitWork", { conversationId, outcome: "paused" });
  });

  it("proposeWork by rootPath REUSES an existing project, and exitWork(completed) closes the task", async () => {
    const first = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          rootPath: projectDir,
          objective: "第二轮：补文档",
        })
      ).body,
    );
    expect(first.reusedProject).toBe(true);
    const confirmed = result(
      (
        await rpc("mode.confirmWork", {
          proposalId: first.proposal.id,
          conversationId,
          confirmedRootPath: projectDir,
        })
      ).body,
    );

    const { body } = await rpc("mode.exitWork", {
      conversationId,
      outcome: "completed",
    });
    const exited = result(body);
    expect(exited.task.status).toBe("completed");
    expect(exited.task.completedAt).not.toBeNull();
    expect(exited.conversation.mode).toBe("chat");

    // The durable task bundle agrees with the loop's outcome.
    const bundle = result(
      (await rpc("task.get", { taskId: confirmed.task.id })).body,
    );
    expect(bundle.task.status).toBe("completed");
  });

  it("proposeWork by projectId anchors an existing project", async () => {
    const projects = result((await rpc("project.list", {})).body);
    const project = projects.find((p: any) => p.rootPath === fs.realpathSync(projectDir));
    const proposed = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          projectId: project.id,
          objective: "by id",
          title: "by-id task",
        })
      ).body,
    );
    expect(proposed.project.id).toBe(project.id);
    expect(proposed.task).toBeNull();
    const confirmed = result(
      (
        await rpc("mode.confirmWork", {
          proposalId: proposed.proposal.id,
          conversationId,
          confirmedRootPath: projectDir,
        })
      ).body,
    );
    expect(confirmed.task.title).toBe("by-id task");
    await rpc("mode.exitWork", { conversationId, outcome: "paused" });
  });

  it("empty objective is allowed and gets a light-anchor default", async () => {
    const projects = result((await rpc("project.list", {})).body);
    const project = projects.find((p: any) => p.rootPath === fs.realpathSync(projectDir));
    const proposed = result(
      (
        await rpc("mode.proposeWork", {
          conversationId,
          projectId: project.id,
          objective: "",
        })
      ).body,
    );
    expect(proposed.conversation.mode).toBe("chat");
    expect(proposed.task).toBeNull();
    expect(proposed.proposal.objective).toContain(project.name);
    const confirmed = result(
      (
        await rpc("mode.confirmWork", {
          proposalId: proposed.proposal.id,
          conversationId,
          confirmedRootPath: projectDir,
        })
      ).body,
    );
    expect(confirmed.task.objective).toContain(project.name);
    await rpc("mode.exitWork", { conversationId, outcome: "paused" });
  });

  it("rejects unknown conversations and missing anchors", async () => {
    const noConv = await rpc("mode.proposeWork", {
      conversationId: "conv_missing",
      rootPath: projectDir,
      objective: "x",
    });
    expect(noConv.body.error).toBeDefined();

    const noAnchor = await rpc("mode.proposeWork", {
      conversationId,
      objective: "x",
    });
    expect(noAnchor.body.error).toBeDefined();
    expect(noAnchor.body.error.message).toContain("anchor");

    const noDir = await rpc("mode.proposeWork", {
      conversationId,
      rootPath: path.join(projectDir, "does-not-exist"),
      objective: "x",
    });
    expect(noDir.body.error).toBeDefined();

    const badGet = await rpc("mode.get", { conversationId: "conv_missing" });
    expect(badGet.body.error).toBeDefined();
  });
});

describe("memory RPCs under the anti-pollution iron rules", () => {
  it("memory.readGlobal returns the seeded L1 and the note index", async () => {
    const { body } = await rpc("memory.readGlobal", {});
    const memory = result(body);
    expect(memory.layer).toBe("global");
    expect(memory.l1.truncated).toBe(false);
    expect(memory.l1.content).toContain("L1");
    expect(Array.isArray(memory.notes)).toBe(true);
    // The store lives under the host data dir.
    expect(
      fs.existsSync(path.join(dataDir, "memory", "global", "L1.md")),
    ).toBe(true);
  });

  it("memory.writeGlobal stays a closed channel under BOTH modes (SOP 只走蒸馏环)", async () => {
    for (const mode of ["chat", "work"]) {
      const { body } = await rpc("memory.writeGlobal", {
        name: "preferences",
        content: "# 偏好\n",
        mode,
      });
      expect(body.error).toBeDefined();
      expect(body.error.data?.code).toBe("memory_denied");
      expect(body.error.message).toContain("distillation loop");
    }
    expect(
      fs.existsSync(path.join(dataDir, "memory", "global", "preferences.md")),
    ).toBe(false);
  });

  it("memory.writeProject is anchored-only; memory.readProject round-trips", async () => {
    const projects = result((await rpc("project.list", {})).body);
    const project = projects.find((row: any) => row.rootPath === fs.realpathSync(projectDir));

    // The fresh conversation (created in setup) is not anchored to this project,
    // so writing project memory through it is refused.
    const denied = await rpc("memory.writeProject", {
      conversationId,
      projectId: project.id,
      name: "findings",
      content: "# 发现\n",
    });
    expect(denied.body.error).toBeDefined();
    expect(denied.body.error.data?.code).toBe("needs_work_mode");

    // Owner direct write (no conversationId) is allowed - registered project
    // is considered anchored by definition.
    const written = result(
      (
        await rpc("memory.writeProject", {
          projectId: project.id,
          name: "findings",
          content: "# 发现\n缓存键格式 v2\n",
        })
      ).body,
    );
    expect(written.name).toBe("findings");
    expect(written.title).toBe("发现");

    const index = result(
      (await rpc("memory.readProject", { projectId: project.id })).body,
    );
    expect(index.notes.map((n: any) => n.name)).toEqual(["findings"]);

    const note = result(
      (
        await rpc("memory.readProject", {
          projectId: project.id,
          name: "findings",
        })
      ).body,
    );
    expect(note.content).toContain("缓存键格式 v2");
  });

  it("memory RPCs reject unknown projects", async () => {
    const { body } = await rpc("memory.readProject", { projectId: "missing" });
    expect(body.error).toBeDefined();
    expect(body.error.data?.code).toBe("project_not_found");
  });
});
