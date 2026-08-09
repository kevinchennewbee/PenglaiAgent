import fs from "node:fs";
import path from "node:path";
import {
  AgentHarness,
  DEFAULT_COMPACTION_SETTINGS,
  JsonlSessionRepo,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  estimateContextTokens,
  shouldCompact,
  type AgentHarnessOptions,
  type AgentHarnessTool,
  type ExecutionToolContext,
  type Skill,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  createProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { Type } from "typebox";
import type { ModelProfile } from "@penglai/protocol";
import { POLICY_PROFILE, checkPolicy, type PolicyDecision } from "../policy.js";
import {
  HOST_TOOL_UPDATE_GOAL,
  buildActiveGoalPromptBlock,
  loadGoal,
} from "../goal-service.js";
import type { ApprovalGateRequest, ApprovalVerdict } from "../approvals.js";
import type { MemoryStore } from "../memory.js";
import { loadMessages } from "../conversation-store.js";
import type { HostToolHandlers, KernelThinkingLevel } from "./kernel.js";
import { createPiKernel } from "./pi-kernel.js";
import type { AgentKernel } from "./kernel.js";
import { resolveConversationDraftRoot } from "../conversation-draft.js";
import { prepareBashExecution } from "../sandbox/shell-env.js";
import { createCapabilityTools, HOST_TOOL_DOCUMENT_READ } from "./capability-tools.js";
import { UNTRUSTED_CONTENT_SYSTEM_RULE } from "../security/untrusted-content.js";
import { assertSafeProviderBaseUrl } from "../providers/url-safety.js";

export interface ProductionPiKernelOptions {
  runId: string;
  /** Durable task id (work episodes); null for chat episodes. */
  taskId?: string | null;
  workspaceRoot: string;
  dataDir: string;
  profile: ModelProfile;
  apiKey: string;
  /**
   * Whether this episode is anchored to a project jail. Selects memory
   * injection depth only; the tool surface and policy gate are identical
   * for floating and anchored sessions.
   */
  projectAnchored?: boolean;
  /** Two-layer memory, injected into the system prompt by anchor. */
  memory?: MemoryStore;
  /** Safe Host-side tool handlers (skills and goal status only in W1). */
  hostTools?: HostToolHandlers;
  /** Conversation this kernel is bound to (chat runner; null for bare tasks). */
  conversationId?: string | null;
  /**
   * Per-project L2 grant lookup (work kernels): a granted capability turns
   * that L2 kind into L1 for the project (同类免问).
   */
  hasPolicyGrant?: (grantKey: string) => boolean;
  /**
   * The L2/L3 human-in-the-loop gate (work kernels). When absent, L2/L3
   * decisions fail closed (the tool call is refused).
   */
  approvalGate?: (request: ApprovalGateRequest) => Promise<ApprovalVerdict>;
  /** L4 denial recorder (work kernels: evidence rows on the durable task). */
  onL4Denied?: (info: {
    toolName: string;
    args: Record<string, unknown>;
    decision: PolicyDecision;
  }) => void;
  /** ZCode-like dial: confirm | auto_edit | full | plan. */
  permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
  /**
   * Re-read Host-owned execution authority immediately before every Pi tool
   * call. A rejection blocks the call before policy/approval/tool execution.
   */
  revalidateAuthority?: () => void | Promise<void>;
  /** Pi thinking / reasoning level (default medium). */
  thinkingLevel?: KernelThinkingLevel;
  /**
   * Prior transcript to seed a NEW Pi session (first open of this conversation).
   * When reusing an existing session file, this is ignored.
   */
  seedTranscript?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Active conversation goal (ZCode session/goal). Injected every episode. */
  goal?: string | null;
  /** Owner-pinned extra context re-injected every episode. */
  contextPins?: Array<{
    kind: "file" | "skill" | "note" | "mcp" | "url" | "session";
    label: string;
    ref: string;
  }>;
  /** Optional owner TODO block. */
  workbenchInjection?: string | null;
}

function providerId(profileId: string): string {
  return `penglai-${profileId}`.replace(/[^a-zA-Z0-9._-]/g, "-");
}

// ── host-side tools (assembled per mode) ───────────────────────

type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
};

function textResult(text: string): TextToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

const skillListSchema = Type.Object({});
const skillShowSchema = Type.Object({
  name: Type.String({ description: "SOP / skill name (stem without .md)" }),
});

export const HOST_TOOL_SKILL_LIST = "skill_list";
export const HOST_TOOL_SKILL_SHOW = "skill_show";

function createSkillListTool(
  handlers: HostToolHandlers,
): AgentHarnessTool<ExecutionToolContext, typeof skillListSchema> {
  return {
    name: HOST_TOOL_SKILL_LIST,
    label: "List skills",
    description:
      "List owner-approved SOP skills in the global skill tree (distilled). " +
      "Use skill_show to read full content before following a procedure.",
    parameters: skillListSchema,
    async execute() {
      if (!handlers.listSkills) {
        return textResult("skill_list unavailable: host did not wire listSkills");
      }
      try {
        const rows = await handlers.listSkills();
        if (!rows.length) return textResult("(skill tree empty)");
        return textResult(
          rows
            .map((row) => `- ${row.name}${row.title ? ` — ${row.title}` : ""}`)
            .join("\n"),
        );
      } catch (error) {
        return textResult(
          `skill_list failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

function createSkillShowTool(
  handlers: HostToolHandlers,
): AgentHarnessTool<ExecutionToolContext, typeof skillShowSchema> {
  return {
    name: HOST_TOOL_SKILL_SHOW,
    label: "Show skill",
    description:
      "Read the full body of one distilled SOP skill by name. Prefer this over inventing procedures when a matching skill exists.",
    parameters: skillShowSchema,
    async execute(_toolCallId, params) {
      if (!handlers.showSkill) {
        return textResult("skill_show unavailable: host did not wire showSkill");
      }
      const name = typeof params.name === "string" ? params.name.trim() : "";
      if (!name) return textResult("skill_show: missing name");
      try {
        const body = await handlers.showSkill(name);
        if (body == null || body === "") {
          return textResult(`skill_show: no SOP named '${name}'`);
        }
        return textResult(body);
      } catch (error) {
        return textResult(
          `skill_show failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

const updateGoalSchema = Type.Object({
  status: Type.Union(
    [
      Type.Literal("complete"),
      Type.Literal("blocked"),
      Type.Literal("active"),
    ],
    {
      description: "complete when objective truly achieved; blocked when owner/external input is required; active to resume (owner-only for blocked goals)",
    },
  ),
  summary: Type.Optional(
    Type.String({ description: "Required for complete: factual evidence-based completion summary" }),
  ),
  reason: Type.Optional(
    Type.String({ description: "Required for blocked: why work cannot continue" }),
  ),
});

function createUpdateGoalTool(
  handlers: HostToolHandlers,
  conversationId: string | null,
): AgentHarnessTool<ExecutionToolContext, typeof updateGoalSchema> {
  return {
    name: HOST_TOOL_UPDATE_GOAL,
    label: HOST_TOOL_UPDATE_GOAL,
    description:
      "Update the ACTIVE GOAL status. Call complete only when the objective is actually achieved with evidence. Call blocked when you cannot proceed without owner input.",
    parameters: updateGoalSchema,
    async execute(_toolCallId, params) {
      if (!handlers.updateGoal) {
        return textResult(`${HOST_TOOL_UPDATE_GOAL} is unavailable`);
      }
      try {
        const result = await handlers.updateGoal({
          status: params.status as "complete" | "blocked" | "active",
          summary: typeof params.summary === "string" ? params.summary : undefined,
          reason: typeof params.reason === "string" ? params.reason : undefined,
          conversationId: conversationId ?? undefined,
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return textResult(
          `${HOST_TOOL_UPDATE_GOAL} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

// ── mode-aware assembly (exported for tests) ───────────────────

export interface ToolSurfaceOptions {
  hostTools?: HostToolHandlers;
  conversationId?: string | null;
  workspaceRoot?: string;
  dataDir?: string;
}

const FILE_TOOL_NAMES = new Set(["read", "write", "edit", "bash"]);
const PLAN_TOOL_NAMES = new Set([
  "read",
  HOST_TOOL_DOCUMENT_READ,
  HOST_TOOL_SKILL_LIST,
  HOST_TOOL_SKILL_SHOW,
]);
/**
 * Assemble the production kernel tool surface: Pi-native read/write/edit/bash,
 * brokered document/Web capabilities, and host skills/goal tools. Bash
 * runs with inheritEnv forced off; external tools have their own bounded Host
 * brokers and still pass through the beforeToolCall approval policy.
 */
export function buildToolSurface(
  options: ToolSurfaceOptions,
): AgentHarnessTool<ExecutionToolContext>[] {
  const spec = POLICY_PROFILE;
  const tools: AgentHarnessTool<ExecutionToolContext>[] = [];
  for (const name of spec.fileTools) {
    switch (name) {
      case "read":
        tools.push(createReadTool<ExecutionToolContext>());
        break;
      case "write":
        tools.push(createWriteTool<ExecutionToolContext>());
        break;
      case "edit":
        tools.push(createEditTool<ExecutionToolContext>());
        break;
      case "bash":
        tools.push(
          createBashTool<ExecutionToolContext>({
            prepare: (execution) => prepareBashExecution(execution),
          }),
        );
        break;
    }
  }
  if (options.workspaceRoot) {
    tools.push(...createCapabilityTools({ workspaceRoot: options.workspaceRoot }));
  }
  if (options.hostTools?.listSkills) {
    tools.push(createSkillListTool(options.hostTools));
  }
  if (options.hostTools?.showSkill) {
    tools.push(createSkillShowTool(options.hostTools));
  }
  if (options.hostTools?.updateGoal) {
    tools.push(createUpdateGoalTool(options.hostTools, options.conversationId ?? null));
  }
  return tools;
}

/**
 * Apply the permission dial to the actual registered tool surface. Plan mode
 * is a fail-closed allowlist: future/unknown tools do not become available
 * merely because they were added to the full surface.
 */
export function toolSurfaceForPermissionMode<
  T extends AgentHarnessTool<ExecutionToolContext>,
>(
  tools: ReadonlyArray<T>,
  permissionMode: "confirm" | "auto_edit" | "full" | "plan",
): T[] {
  if (permissionMode !== "plan") return [...tools];
  return tools.filter((tool) => PLAN_TOOL_NAMES.has(tool.name));
}

/**
 * Async-shaped variant retained for the production factory.
 */
export async function buildToolSurfaceAsync(
  options: ToolSurfaceOptions,
  permissionMode: "confirm" | "auto_edit" | "full" | "plan" = "auto_edit",
): Promise<AgentHarnessTool<ExecutionToolContext>[]> {
  const tools = buildToolSurface(options);
  if (permissionMode !== "plan" && options.hostTools?.externalTools) {
    const external = await options.hostTools.externalTools();
    for (const descriptor of external) {
      tools.push({
        name: descriptor.name,
        label: descriptor.name,
        description: descriptor.description,
        parameters: Type.Unsafe(descriptor.inputSchema),
        async execute(_toolCallId, params) {
          try {
            return textResult(await descriptor.call(params as Record<string, unknown>));
          } catch (error) {
            return textResult(`${descriptor.name} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      });
    }
  }
  return toolSurfaceForPermissionMode(tools, permissionMode);
}

/** Host-side tool names present on a tool surface (for the policy gate). */
export function hostToolNames(
  tools: ReadonlyArray<{ name: string }>,
): string[] {
  return tools.map((tool) => tool.name).filter((n) => !FILE_TOOL_NAMES.has(n));
}

export interface SystemPromptOptions {
  /**
   * Whether the conversation is anchored to a project jail (vs floating).
   * Selects memory injection depth only: floating -> L1 + project index;
   * anchored -> L1 + full project memory. NOT a capability switch.
   */
  projectAnchored?: boolean;
  workspaceRoot: string;
  memory?: MemoryStore;
  permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
  /** Active goal text for this conversation (orientation, not a separate hive). */
  goal?: string | null;
  /** Owner-pinned context always re-injected. */
  contextPins?: Array<{
    kind: "file" | "skill" | "note" | "mcp" | "url" | "session";
    label: string;
    ref: string;
  }>;
  /** Optional owner TODO injection. */
  workbenchInjection?: string | null;
  conversationId?: string | null;
}

function formatContextPins(
  pins: SystemPromptOptions["contextPins"] | undefined,
): string {
  if (!pins || pins.length === 0) return "";
  const lines: string[] = [];
  for (const pin of pins) {
    const head = `- [${pin.kind}] ${pin.label || pin.ref}`;
    if (pin.kind === "session" && pin.ref) {
      // Expand linked conversation transcript (bounded) — ZCode #session analogue.
      try {
        const msgs = loadMessages(pin.ref)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-12);
        const body = msgs
          .map((m) => {
            const text = m.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n")
              .trim();
            if (!text) return "";
            return `${m.role}: ${text.slice(0, 800)}`;
          })
          .filter(Boolean)
          .join("\n");
        lines.push(
          `${head}${pin.ref !== pin.label ? ` (${pin.ref})` : ""}`,
          body
            ? `  <linked_session id="${pin.ref}">\n${body}\n  </linked_session>`
            : `  (session ${pin.ref} empty or unavailable)`,
        );
      } catch {
        lines.push(`${head}: ${pin.ref} (failed to load)`);
      }
      continue;
    }
    lines.push(pin.ref && pin.ref !== pin.label ? `${head}: ${pin.ref}` : head);
  }
  return ["OWNER-PINNED CONTEXT (always honour these):", ...lines].join("\n");
}

/**
 * Assemble the system prompt. Both floating and project-anchored sessions share
 * identity, the global L1 memory, and the full tool surface; the only
 * difference is memory depth: floating gets the project index (titles),
 * anchored gets the full project memory.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const memory = options.memory;
  // 身份（M3′ 诞生仪式落 L1）：有身份则报姓名与诞生日，否则保持种子默认。
  const identity = memory?.readIdentity() ?? null;
  const identityLine = identity
    ? `You are ${identity.name} (born ${identity.bornAt}), the owner's personal assistant - one identity, one memory.`
    : "You are Penglai, the owner's personal assistant - one identity, one memory.";
  // Anchoring only selects the jail root + memory depth. The permission dial
  // may further subtract tools (plan is an explicit read-only allowlist).
  const jailLine = `Current workspace jail: ${options.workspaceRoot}`;
  const structured = options.conversationId ? loadGoal(options.conversationId) : null;
  const goalBlockFromService = buildActiveGoalPromptBlock(structured, {
    allowModelStatusUpdate: options.permissionMode !== "plan",
  });
  const goalText = options.goal?.trim() || structured?.objective || "";
  const goalBlock =
    goalBlockFromService ||
    (goalText
      ? [
          "ACTIVE GOAL (orientation for this whole conversation — keep working toward it until cleared or completed):",
          goalText,
          options.permissionMode === "plan"
            ? "The owner has the permission dial on plan: research and outline how to reach the goal; do not execute mutating steps until they switch the dial."
            : "When ready to execute, use tools. Report progress against the goal; call update_goal(complete) when truly done.",
        ]
          .filter(Boolean)
          .join("\n")
      : "");

  const pinsBlock = formatContextPins(options.contextPins);
  const workbenchBlock = options.workbenchInjection?.trim() || "";
  const toolSurfaceLine =
    options.permissionMode === "plan"
      ? "PLAN MODE tool surface is read-only: read, document_read, and owner-approved skill lookup only. Mutating and outbound tools are unavailable."
      : "There is only ONE conversation surface. Available tools: read, write, edit, bash, document_read, document_create/document_create_pdf, web_search, web_fetch, owner-approved skill lookup, goal status, and any Owner-manually-connected MCP tools. Document tools create real PDF/DOCX/XLSX/PPTX files inside the workspace. Web and every MCP call require Owner L3 approval. Browser automation is not built in.";
  const networkingLine =
    options.permissionMode === "plan"
      ? "Network tools are unavailable in plan mode. Base the plan on owner-provided context and local read-only evidence."
      : "Use web_search/web_fetch for public research. Never invent URLs, citations, or network success.";
  const common = [
    identityLine,
    toolSurfaceLine,
    jailLine,
    "Stay inside the jail path above for file tools; escaping the jail is refused.",
    networkingLine,
    UNTRUSTED_CONTENT_SYSTEM_RULE,
    "Skills: verified Owner-installed Agent Skills and Pi-native distilled SOPs may appear in the system skill list; inspect them with skill_list / skill_show. Prefer a matching skill before inventing multi-step rituals.",
    "Only the Owner may select or trust another project folder; do not claim or attempt to change the workspace yourself.",
    "Never invent a chat-vs-work capability split, and never tell the owner to open a task panel or click 'start run'.",
    "Be practical: run tools yourself instead of dumping command lists for the owner to paste.",
    options.permissionMode === "plan"
      ? "PLAN MODE: research and outline only. Do not write/edit/run shell that changes the workspace. Produce a clear plan with steps and risks; wait for the owner to switch the dial before executing."
      : "",
    goalBlock,
    pinsBlock,
    workbenchBlock,
    "",
  ].filter((line) => line !== undefined && line !== "");
  const mem =
    options.projectAnchored
      ? memory
        ? memory.buildWorkInjection(options.workspaceRoot)
        : "(memory unavailable)"
      : memory
        ? memory.buildChatInjection(options.workspaceRoot)
        : "(memory unavailable)";
  return [...common, mem].join("\n");
}

function thinkingLevelOf(raw: string | undefined): ThinkingLevel {
  const allowed: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as ThinkingLevel;
  return "medium";
}

/**
 * Only L2 workspace confirmations may be auto-approved by an execution dial.
 * L3 always remains an explicit Owner decision. Bash is mounted, but every
 * call still passes through the deterministic policy ladder before execution.
 */
export function permissionModeAutoApprovesPolicyDecision(
  permissionMode: "confirm" | "auto_edit" | "full" | "plan",
  decision: PolicyDecision,
): boolean {
  return (
    (permissionMode === "auto_edit" || permissionMode === "full") &&
    (decision.level === "L2" || decision.code === "needs_confirm")
  );
}

/**
 * Load Penglai distilled SOP tree as Pi-native Skill resources (agentskills-shaped).
 * Keeps Penglai's audit-only write path; only READ is exposed to the model via Pi.
 */
export function loadSopSkills(
  memory: MemoryStore | undefined,
  hostTools?: HostToolHandlers,
): Skill[] {
  const resources = new Map<string, Skill>();
  if (memory) {
    try {
      for (const { meta: sop, content, filePath } of memory.loadTrustedSops()) {
        resources.set(sop.name, {
          name: sop.name,
          description: sop.title || sop.name,
          content,
          filePath,
        });
      }
    } catch {
      /* fail closed: unverified SOPs are absent */
    }
  }
  try {
    for (const skill of hostTools?.loadSkills?.() ?? []) {
      if (resources.has(skill.name)) continue;
      resources.set(skill.name, {
        name: skill.name,
        description: skill.title || skill.name,
        content: skill.content,
        filePath: skill.filePath,
      });
    }
  } catch {
    /* fail closed: one integrity failure suppresses installed skills */
  }
  return [...resources.values()];
}

/**
 * Reuse one Pi JSONL session per conversation so multi-turn history +
 * compaction are Pi-native. Falls back to a new session id when none exists.
 */
async function openOrCreateConversationSession(
  sessions: JsonlSessionRepo,
  options: {
    conversationId?: string | null;
    runId: string;
    workspaceRoot: string;
    taskId?: string | null;
  },
) {
  const conversationId = options.conversationId?.trim() || "";
  if (conversationId) {
    try {
      // Look across ALL workspace dirs, not just the current cwd: a
      // conversation re-anchored to a different project root via
      // mode.proposeWork keeps the same conversationId but moves to a new
      // cwd. Matching by cwd alone would miss the old session and rebuild the
      // Pi history from scratch.
      const listed = await sessions.list({});
      const hit = listed
        .filter((meta) => {
          const m = meta.metadata as Record<string, unknown> | undefined;
          return m && m.conversationId === conversationId && m.engine === "pi";
        })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (hit) {
        return { session: await sessions.open(hit), sessionId: hit.id, reused: true as const };
      }
    } catch {
      /* fall through to create */
    }
  }
  const sessionId = conversationId
    ? `conv_${conversationId}`
    : options.runId;
  const session = await sessions.create({
    id: sessionId,
    cwd: options.workspaceRoot,
    metadata: {
      taskId: options.taskId ?? null,
      conversationId: conversationId || null,
      engine: "pi",
      engineVersion: "0.83.0",
    },
  });
  return { session, sessionId, reused: false as const };
}

/**
 * Construct the only production agent engine for 0.4.
 *
 * Provider, jail, policy, memory, and approval are Penglai-owned.
 * Turn lifecycle, streaming, tool parallel, queues, skills resources,
 * thinking level, session history, and compaction are Pi-owned.
 */
export async function createProductionPiKernel(
  options: ProductionPiKernelOptions,
): Promise<AgentKernel> {
  if (!options.apiKey.trim()) throw new Error("model profile has no API key");

  const env = new NodeExecutionEnv({ cwd: options.workspaceRoot });
  const canonicalDataDir = (() => {
    fs.mkdirSync(options.dataDir, { recursive: true });
    return fs.realpathSync(options.dataDir);
  })();
  const conversationDraftRoot = resolveConversationDraftRoot(
    canonicalDataDir,
    options.conversationId,
  );
  const assistantMemoryReadRoots = options.memory
    ? [
        path.join(options.memory.globalRoot, "L1.md"),
        ...options.memory
          .listGlobal()
          .map((note) => path.join(options.memory!.globalRoot, `${note.name}.md`)),
      ]
    : [];
  const sessionsRoot = path.join(canonicalDataDir, "pi-sessions");
  const sessions = new JsonlSessionRepo({ fs: env, sessionsRoot });
  const { session, sessionId, reused } = await openOrCreateConversationSession(
    sessions,
    {
      conversationId: options.conversationId,
      runId: options.runId,
      workspaceRoot: options.workspaceRoot,
      taskId: options.taskId,
    },
  );

  // Seed brand-new sessions with durable conversation transcript so multi-turn
  // history is not lost just because each desktop prompt used to create a fresh kernel.
  if (!reused) {
    const seed =
      options.seedTranscript ??
      (options.conversationId
        ? loadMessages(options.conversationId)
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              text: m.content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("\n"),
            }))
            .filter((m) => m.text.trim())
        : []);
    // Drop the trailing user message — the Host already saved it and the
    // EpisodeRunner will prompt it into this session.
    const prior =
      seed.length > 0 && seed[seed.length - 1]?.role === "user"
        ? seed.slice(0, -1)
        : seed;
    for (const msg of prior.slice(-40)) {
      try {
        await session.appendMessage({
          role: msg.role,
          content: msg.text,
          timestamp: Date.now(),
        } as never);
      } catch {
        /* best-effort seed */
      }
    }
  }

  const id = providerId(options.profile.id);
  // Prefer profile-declared window (catalog context_k or owner override).
  const contextWindow =
    typeof options.profile.contextWindowTokens === "number" &&
    options.profile.contextWindowTokens > 0
      ? Math.floor(options.profile.contextWindowTokens)
      : 128_000;
  const maxTokens =
    typeof options.profile.maxOutputTokens === "number" &&
    options.profile.maxOutputTokens > 0
      ? Math.floor(options.profile.maxOutputTokens)
      : Math.min(32_000, Math.floor(contextWindow / 4) || 8_000);
  const safeBaseUrl = assertSafeProviderBaseUrl(options.profile.baseUrl);
  const modelDefinition: Model<"openai-completions"> = {
    id: options.profile.model,
    name: options.profile.label,
    api: "openai-completions",
    provider: id,
    baseUrl: safeBaseUrl,
    reasoning: false,
    input: options.profile.capabilities.vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
  const provider = createProvider({
    id,
    name: options.profile.label,
    baseUrl: safeBaseUrl,
    auth: {
      apiKey: {
        name: `${options.profile.label} API key`,
        resolve: async () => ({
          auth: { apiKey: options.apiKey },
          source: "Penglai secure profile",
        }),
      },
    },
    models: [modelDefinition],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  const model = models.getModel(id, modelDefinition.id);
  if (!model) throw new Error(`Pi model registration failed: ${id}/${modelDefinition.id}`);

  const dial = options.permissionMode ?? "auto_edit";
  const tools = await buildToolSurfaceAsync(options, dial);
  const activeToolNames = tools.map((tool) => tool.name);
  const hostTools = hostToolNames(tools);
  const skills = loadSopSkills(options.memory, options.hostTools);
  const thinkingLevel = thinkingLevelOf(options.thinkingLevel);

  const harnessOptions: AgentHarnessOptions<ExecutionToolContext> = {
    session,
    models,
    model,
    thinkingLevel,
    tools,
    activeToolNames,
    toolContext: { env },
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    systemPrompt: buildSystemPrompt(options),
    resources: skills.length > 0 ? { skills } : undefined,
    streamOptions: {
      timeoutMs: 120_000,
      maxRetries: 2,
      maxRetryDelayMs: 10_000,
    },
  };

  const harness = new AgentHarness(harnessOptions);
  // The per-call policy gate (four-level adjudication). L2/L3 decisions are
  // routed through the approval service: the run pauses at
  // awaiting_approval and the kernel holds the tool call until the owner
  // decides — Pi awaits this hook before executing (beforeToolCall).
  harness.on("tool_call", async (event) => {
    if (options.revalidateAuthority) {
      try {
        await options.revalidateAuthority();
      } catch (error) {
        return {
          block: true,
          reason:
            `authority_changed: ${
              error instanceof Error ? error.message : String(error)
            }`,
        };
      }
    }
    if (dial === "plan") {
      const allowedInPlan = new Set(activeToolNames);
      if (!allowedInPlan.has(event.toolName)) {
        return {
          block: true,
          reason:
            "plan mode is read-only: use read/skill_list/skill_show; switch dial only through an explicit Owner action",
        };
      }
    }
    const decision = checkPolicy(
      event.toolName,
      event.input as Record<string, unknown>,
      options.workspaceRoot,
      {
        // Runtime-owned data fails closed. Memory is readable, while generic
        // mutation is restricted to this exact conversation's draft root.
        // Raw SOP Markdown is intentionally excluded: only receipt-verified
        // skill_list/skill_show and Pi resources may expose SOP bodies.
        assistantReadRoots: [
          ...assistantMemoryReadRoots,
          ...(conversationDraftRoot ? [conversationDraftRoot] : []),
        ],
        assistantWriteRoots: conversationDraftRoot
          ? [conversationDraftRoot]
          : [],
        protectedRoots: [canonicalDataDir],
        hostTools,
        hasGrant: options.hasPolicyGrant,
      },
    );
    if (decision.allowed) return undefined;
    if (decision.approval) {
      // Permission dial:
      // - full auto-approves L2 only; L3 (outbound/delete) still requires a human
      // - auto_edit auto L2 only
      // - plan/confirm always ask (or fail closed)
      if (permissionModeAutoApprovesPolicyDecision(dial, decision)) {
        return undefined;
      }
      if (!options.approvalGate) {
        if (dial === "auto_edit" && decision.level === "L3") {
          return {
            block: true,
            reason: `${decision.reason} (permissionMode=auto_edit blocks L3 without approval UI)`,
          };
        }
        return {
          block: true,
          reason: `${decision.reason} (no approval gate on this kernel — fail closed)`,
        };
      }
      const verdict = await options.approvalGate({
        toolName: event.toolName,
        args: event.input as Record<string, unknown>,
        decision,
      });
      if (verdict.approved) return undefined;
      return { block: true, reason: verdict.note };
    }
    // Hard boundary (L4): refuse and record when a durable task exists.
    if (decision.level === "L4") {
      options.onL4Denied?.({
        toolName: event.toolName,
        args: event.input as Record<string, unknown>,
        decision,
      });
    }
    return { block: true, reason: decision.reason };
  });

  const prepareForPrompt = async () => {
    try {
      const ctx = await session.buildContext();
      const estimate = estimateContextTokens(ctx.messages as never);
      if (
        shouldCompact(
          estimate.tokens,
          contextWindow,
          DEFAULT_COMPACTION_SETTINGS,
        )
      ) {
        // Auto-compact before the user's prompt. Pi emits a `session_compact`
        // event (mapped to compaction.completed) carrying the CompactResult
        // (incl. usage); the episode bridge attributes that usage to the run
        // so the compaction's LLM cost is not silently lost.
        await harness.compact(
          "Compress older turns; keep decisions, file paths, tool outcomes, goals, and open TODOs.",
        );
      }
    } catch {
      /* auto-compact is best-effort; never block the user prompt */
    }
  };

  return createPiKernel({
    sessionId,
    harnessOptions,
    harnessFactory: () => ({
      subscribe: harness.subscribe.bind(harness),
      prompt: harness.prompt.bind(harness),
      steer: harness.steer.bind(harness),
      followUp: harness.followUp.bind(harness),
      abort: harness.abort.bind(harness),
      compact: harness.compact.bind(harness),
      setThinkingLevel: harness.setThinkingLevel.bind(harness),
      getThinkingLevel: harness.getThinkingLevel.bind(harness),
      prepareForPrompt,
      dispose: () => {
        try {
          void harness.abort?.();
        } catch {
          /* best-effort */
        }
        try {
          const anyHarness = harness as { dispose?: () => void };
          anyHarness.dispose?.();
        } catch {
          /* best-effort */
        }
        void env.cleanup();
      },
    }),
  });
}
