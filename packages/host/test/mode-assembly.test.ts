/**
 * Mode-aware AgentKernel assembly tests (0.4.0 design §5/§6).
 *
 * The policy profile must take effect at the assembly layer: plan is a strict
 * read-only allowlist, and W1 quarantines unbrokered external tools and
 * model-driven project activation under every permission dial.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import {
  buildSystemPrompt,
  buildToolSurface,
  buildToolSurfaceAsync,
  createProductionPiKernel,
  hostToolNames,
  HOST_TOOL_SKILL_LIST,
  HOST_TOOL_SKILL_SHOW,
  permissionModeAutoApprovesPolicyDecision,
  toolSurfaceForPermissionMode,
} from "../src/kernel/create-production-pi-kernel.js";
import { HOST_TOOL_UPDATE_GOAL } from "../src/goal-service.js";
import {
  HOST_TOOL_DOCUMENT_CREATE_PDF,
  HOST_TOOL_DOCUMENT_CREATE,
  HOST_TOOL_DOCUMENT_READ,
  HOST_TOOL_WEB_FETCH,
  HOST_TOOL_WEB_SEARCH,
} from "../src/kernel/capability-tools.js";
import { checkPolicy } from "../src/policy.js";
import { MemoryStore } from "../src/memory.js";

let root: string;
let workspaceRoot: string;
let dataDir: string;
let memory: MemoryStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-assembly-"));
  workspaceRoot = path.join(root, "workspace");
  dataDir = path.join(root, "home");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  memory = new MemoryStore(path.join(dataDir, "memory", "global"));
  memory.ensureGlobalLayout();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const profile: ModelProfile = {
  id: "test-openai-compatible",
  label: "Test compatible provider",
  provider: "custom",
  baseUrl: "https://example.invalid/v1",
  apiKeyEnv: "",
  model: "test-model",
  capabilities: { tools: true, streaming: true, vision: false },
};

function seedProjectNote(): void {
  memory.writeProjectNote(workspaceRoot, "deploy", "# 部署笔记\n全文：先灰度再全量\n", {
    anchored: true,
  });
}

describe("tool surface per mode", () => {
  it("fails closed when broker roots are unavailable", () => {
    const tools = buildToolSurface({
      hostTools: {
        listSkills: () => [{ name: "deploy", title: "部署" }],
        showSkill: () => "body",
        updateGoal: () => ({ ok: true }),
      },
    });
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      HOST_TOOL_SKILL_LIST,
      HOST_TOOL_SKILL_SHOW,
      HOST_TOOL_UPDATE_GOAL,
    ]);
    expect(hostToolNames(tools)).toEqual([
      HOST_TOOL_SKILL_LIST,
      HOST_TOOL_SKILL_SHOW,
      HOST_TOOL_UPDATE_GOAL,
    ]);
    for (const forbidden of [
      "web_fetch",
      "web_search",
      "web_scan",
      "web_execute_js",
      "mcp_demo_ping",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("mounts documents, brokered Web, skills and goal in production", () => {
    const tools = buildToolSurface({
      workspaceRoot,
      dataDir,
      hostTools: {
        listSkills: () => [{ name: "deploy", title: "部署" }],
        showSkill: () => "body",
        updateGoal: () => ({ ok: true }),
      },
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      HOST_TOOL_DOCUMENT_READ,
      HOST_TOOL_DOCUMENT_CREATE_PDF,
      HOST_TOOL_DOCUMENT_CREATE,
      HOST_TOOL_WEB_SEARCH,
      HOST_TOOL_WEB_FETCH,
      HOST_TOOL_SKILL_LIST,
      HOST_TOOL_SKILL_SHOW,
      HOST_TOOL_UPDATE_GOAL,
    ]);
    expect(hostToolNames(tools)).toEqual([
      HOST_TOOL_DOCUMENT_READ,
      HOST_TOOL_DOCUMENT_CREATE_PDF,
      HOST_TOOL_DOCUMENT_CREATE,
      HOST_TOOL_WEB_SEARCH,
      HOST_TOOL_WEB_FETCH,
      HOST_TOOL_SKILL_LIST,
      HOST_TOOL_SKILL_SHOW,
      HOST_TOOL_UPDATE_GOAL,
    ]);
  });

  it("mounts manually connected MCP only outside plan mode", async () => {
    const resolveExtras = vi.fn(async () => [
      {
        name: "mcp_demo_ping",
        description: "demo",
        inputSchema: { type: "object", properties: {} },
        call: async () => "pong",
      },
    ]);
    const hostTools = {
      listSkills: () => [{ name: "deploy", title: "部署" }],
      showSkill: () => "body",
      updateGoal: () => ({ ok: true }),
      externalTools: resolveExtras,
    };
    const planTools = await buildToolSurfaceAsync({ hostTools, workspaceRoot, dataDir }, "plan");
    const fullTools = await buildToolSurfaceAsync({ hostTools, workspaceRoot, dataDir }, "full");
    expect(resolveExtras).toHaveBeenCalledTimes(1);
    expect(fullTools.map((tool) => tool.name)).toContain("mcp_demo_ping");
    expect(planTools.map((tool) => tool.name)).toEqual([
      "read",
      HOST_TOOL_DOCUMENT_READ,
      HOST_TOOL_SKILL_LIST,
      HOST_TOOL_SKILL_SHOW,
    ]);

    const fakeUnknown = {
      name: "future_side_effect",
    } as (typeof fullTools)[number];
    const filtered = toolSurfaceForPermissionMode(
      [...fullTools, fakeUnknown],
      "plan",
    ).map((tool) => tool.name);
    for (const forbidden of [
      "write",
      "edit",
      "bash",
      HOST_TOOL_UPDATE_GOAL,
      "mcp_demo_ping",
      "future_side_effect",
      "web_fetch",
      "web_search",
      HOST_TOOL_DOCUMENT_CREATE_PDF,
      HOST_TOOL_DOCUMENT_CREATE,
      "web_scan",
      "web_execute_js",
    ]) {
      expect(filtered, `plan must exclude ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("system prompt per mode", () => {
  it("unified prompt states the Owner boundaries", () => {
    seedProjectNote();
    const prompt = buildSystemPrompt({ projectAnchored: false, workspaceRoot, memory });
    expect(prompt).toContain("ONE conversation surface");
    expect(prompt).toContain("bash");
    expect(prompt).toContain("document_read");
    expect(prompt).toContain("document_create_pdf");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("web_fetch");
    expect(prompt).toContain("Only the Owner may select or trust another project folder");
    expect(prompt).not.toContain("mode_propose_work");
    expect(prompt).not.toMatch(/web_scan|web_execute_js|mcp_/i);
    expect(prompt).toContain("L1");
    expect(prompt).toContain("部署笔记"); // index title
    expect(prompt).not.toContain("先灰度再全量"); // body stays out of floating index
  });

  it("work memory injection includes full project note bodies", () => {
    seedProjectNote();
    const prompt = buildSystemPrompt({ projectAnchored: true, workspaceRoot, memory });
    expect(prompt).toContain("ONE conversation surface");
    expect(prompt).toContain("先灰度再全量");
  });

  it("injects goal + context pins into the system prompt", () => {
    const prompt = buildSystemPrompt({
      workspaceRoot,
      memory,
      permissionMode: "plan",
      goal: "Ship goal mode without a second chat surface",
      contextPins: [
        { kind: "file", label: "server.ts", ref: "packages/host/src/server.ts" },
        { kind: "skill", label: "deploy", ref: "deploy" },
      ],
    });
    expect(prompt).toContain("ACTIVE GOAL");
    expect(prompt).toContain("Ship goal mode without a second chat surface");
    expect(prompt).toContain("OWNER-PINNED CONTEXT");
    expect(prompt).toContain("server.ts");
    expect(prompt).toContain("[skill] deploy");
    expect(prompt).toContain("PLAN MODE");
    expect(prompt).not.toContain(HOST_TOOL_UPDATE_GOAL);
    expect(prompt).not.toContain("mode_propose_work");
    expect(prompt).not.toMatch(/subagents|background shell jobs/i);
  });
});

describe("permission dial owner boundary", () => {
  it("never auto-approves an L3 command under any dial", () => {
    // git push is L3 (outbound); it must never be auto-approved by a dial.
    const decision = checkPolicy("bash", { command: "git push origin main" }, workspaceRoot);
    expect(decision).toMatchObject({
      allowed: false,
      code: "needs_approval",
      level: "L3",
    });
    for (const mode of ["confirm", "auto_edit", "full", "plan"] as const) {
      expect(
        permissionModeAutoApprovesPolicyDecision(mode, decision),
        `${mode} must not auto-approve L3 outbound`,
      ).toBe(false);
    }
  });

  it("auto-approves L1 read-only bash under auto_edit/full but not plan/confirm", () => {
    const decision = checkPolicy("bash", { command: "git status" }, workspaceRoot);
    expect(decision).toMatchObject({ allowed: true, level: "L1" });
  });
});

describe("production kernel construction per mode", () => {
  it("constructs a conversation kernel (full surface) without a network call", async () => {
    const kernel = await createProductionPiKernel({
      runId: "run-chat-assembly",
      taskId: "conv-1",
      workspaceRoot,
      dataDir,
      profile,
      apiKey: "not-sent",
      memory,
      conversationId: "conv-1",
    });
    expect(kernel.engine).toBe("pi");
    expect(fs.existsSync(path.join(dataDir, "pi-sessions"))).toBe(true);
    kernel.dispose();
  });
});
