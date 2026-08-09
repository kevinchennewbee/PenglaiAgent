/**
 * Penglai 0.4 loopback Host.
 *
 * JSON-RPC owns Project/Task/Run/Step/Evidence and starts execution only
 * through TaskRunner -> Pi AgentKernel. The Host is headless: the Tauri
 * desktop is the sole product UI owner. The legacy static workbench files
 * (packages/host/static) are retained on disk for reference but are NOT
 * mounted on any request path.
 *
 * Surface:
 *   POST /api            JSON-RPC 2.0 (token-gated)
 *   GET  /health         unauthenticated liveness probe
 *   WS   /ws             streaming events (token via header/subprotocol)
 *
 * Security:
 *   - Binds to 127.0.0.1 only (loopback); non-loopback hosts cannot connect.
 *   - Host header validated against loopback hostnames to block DNS rebinding.
 *   - A random bearer token is generated on first start and persisted to
 *     ~/.penglai/host.token; every /api and /ws call must present it via the
 *     `Authorization: Bearer <token>` or `X-Penglai-Token` header. Browser
 *     test clients may use the `penglai.auth.<base64url>` WS subprotocol.
 *   - Token comparison is constant-time; Tauri keeps it out of the renderer.
 *
 * No external HTTP framework: uses node:http + ws only.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  loadMessages,
  listConversations,
  listConversationIndex,
  loadConversationMeta,
  saveConversationMeta as persistConversationMeta,
  saveMessage,
} from "./conversation-store.js"
import {
  clearGoal,
  hydrateGoal,
  loadGoal,
  mirrorGoalText,
  setActiveGoal,
  updateGoalStatus,
} from "./goal-service.js";
import {
  buildWorkbenchInjection,
  loadWorkbench,
  removeTodo,
  setTodos,
  upsertTodo,
} from "./conversation-workbench.js";
import { ConversationApprovalService } from "./conversation-approvals.js";
import { sanitizeImages, imageOnlyPrompt } from "./image-sanitize.js";
import { resumeConversation } from "./resume.js";
import {
  SchedulerService,
  AutonomousService,
  CompanionService,
  type CompanionMode,
  type CompanionSource,
} from "./services.js";
import {
  DATABASE_SCHEMA_VERSION,
  MIN_DESKTOP_VERSION,
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  type RuntimeHandshake,
  type Workspace,
  type Conversation,
  type ModelProfile,
  type Message,
  type MessageContent,
  type TextContent,
} from "@penglai/protocol";
import { ProductStore } from "./storage/product-store.js";
import {
  describeBuiltinToolSurface,
  listMcpServers,
  removeMcpServer,
  upsertMcpServer,
} from "./mcp/config.js";
import { McpSessionManager } from "./mcp/client.js";
import { penglaiDataDir } from "./data-dir.js";
import { loadOrCreateHostToken } from "./token-file.js";
import { assertSafeProviderBaseUrl } from "./providers/url-safety.js";
import {
  TaskRunner,
  type TaskKernelFactory,
  type TaskKernelOptions,
} from "./task-runner.js";
import type {
  ConversationExecutor,
  ConversationPromptInput,
  ConversationPromptResult,
} from "./conversation-executor.js";
import { EpisodeRunner } from "./runtime/episode-runner.js";
import {
  createProductionEpisodeKernel,
  type ResolvedSession,
} from "./kernel/episode-kernel.js";
import { createTaskEpisodeKernel } from "./runtime/task-episode-kernel.js";
import { ApprovalService } from "./approvals.js";
import type { AgentKernel, HostToolHandlers } from "./kernel/kernel.js";
import {
  createProductionPiKernel,
  type ProductionPiKernelOptions,
} from "./kernel/create-production-pi-kernel.js";
import { MemoryStore } from "./memory.js";
import { SkillStore } from "./skills/store.js";
import { localDay } from "./usage.js";
import { sweepMissingCheckpoints } from "./checkpoints.js";
import { BudgetService } from "./budget.js";
import { CAPABILITY_L3_BUDGET_OVERRIDE } from "./policy.js";
import { DistillService } from "./distill/distill.js";
import { runDoctor } from "./doctor.js";
import { exportDiagnostics } from "./diagnostics.js";
import { previewArtifactFile } from "./artifact-preview.js";
import type { ReviewModelRequest } from "./distill/review.js";
import {
  loadPersistedProfiles,
  savePersistedProfile,
} from "./profiles-store.js";
import { smokeTestModel } from "./model-smoke.js";
import { listRemoteModels } from "./providers/models.js";
import {
  catalogContextTokens,
  catalogMaxOutputTokens,
  catalogUpdated,
  findCatalogModel,
} from "./providers/catalog.js";
import {
  loadCatalogOverlay,
  saveCatalogOverlayEntry,
} from "./providers/overlay.js";
import { refreshCatalog } from "./providers/refresh.js";
import { runBirth } from "./onboarding/birth.js";
import { VoiceService, type VoiceServiceDeps } from "./voice/service.js";
import {
  confirmWork,
  exitWork,
  getMode,
  proposeWork,
  WorkProposalStore,
  type ConfirmWorkInput,
  type ConfirmWorkResult,
  type ExitWorkInput,
  type ExitWorkResult,
  type ModeSwitchContext,
} from "./mode-switch.js";
import { EpisodeAuthorityError } from "./episode-authority.js";
import { FeishuApiClient } from "./feishu/api-client.js";
import { FeishuChannel } from "./feishu/channel.js";
import { FeishuWsClient } from "./feishu/ws-client.js";
import {
  loadChannelConfig,
  resolveChannelConfig,
  saveChannelConfig,
  type FeishuChannelConfig,
} from "./feishu/config.js";
import {
  pollFeishuQrCreate,
  startFeishuQrCreate,
  takeFeishuQrCredentials,
} from "./feishu/qr-create.js";
import {
  clearWechatToken,
  loadWechatToken,
  pollWechatQrBind,
  probeWechatToken,
  saveWechatToken,
  startWechatQrBind,
} from "./wechat/ilink.js";
import { WechatRuntime } from "./wechat/runtime.js";
import { WechatBridge } from "./wechat/bridge.js";
import { buildUsageStats, recordModelUsage, type UsageRange } from "./usage-stats.js";
import { completeFiles } from "./files-complete.js";
import {
  acquireDataDirOperationLock,
  type DataDirOperationLock,
} from "./migrate/operation-lock.js";

// ── paths & constants ──────────────────────────────────────────

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 14169; // matches 0.3 desktop_bridge port
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Per-client WS buffer ceiling: a slow consumer is dropped, never buffered. */
const WS_MAX_BUFFERED = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const RUNTIME_INSTANCE_ID = crypto.randomUUID();

/** SOP the Autonomous service submits as a prompt when the user is idle. */
const AUTONOMOUS_SOP_PATH = path.join(process.cwd(), "memory", "autonomous_operation_sop.md");

// ── public types ───────────────────────────────────────────────

export interface ServerOptions {
  /** Bind port; default 14169. Pass 0 to pick a free port (useful in tests). */
  port?: number;
  /** Bind host; default 127.0.0.1. */
  host?: string;
  /** Override the auth token (testing). If omitted, loaded/created from disk. */
  token?: string;
  /** Override the model profile list (testing). */
  profiles?: ModelProfile[];
  /** Logger; defaults to console.error. Receives redacted one-liners. */
  log?: (line: string) => void;
  /** Product database path. Defaults to ~/.penglai/product.db outside tests. */
  databasePath?: string;
  /** Inject an already-open product store (tests/embedding). Caller retains ownership. */
  productStore?: ProductStore;
  /** Override the root used for Pi session attachments. */
  dataDir?: string;
  /** Test/embedding seam; production always uses the pinned Pi factory. */
  taskKernelFactory?: TaskKernelFactory;
  /** Test/embedding seam for the unified conversation EpisodeRunner. */
  chatKernelFactory?: (
    options: ProductionPiKernelOptions,
  ) => Promise<AgentKernel> | AgentKernel;
  /** Test/embedding seam for the distillation review model (蒸馏环复盘). */
  distillReviewModel?: (request: ReviewModelRequest) => Promise<string>;
  /**
   * 语音服务依赖缝（测试注入假引擎/假下载；生产全缺省 = 懒加载原生探测）。
   * 语音是统一会话的本地 I/O 层，绝不成 host 启动硬依赖。
   */
  voice?: Partial<VoiceServiceDeps>;
}

export interface StartedServer {
  server: http.Server;
  wss: WebSocketServer;
  token: string;
  port: number;
  host: string;
  /** Close the HTTP server and all WebSocket connections. */
  close(): Promise<void>;
  /** Test/inspection handle into the in-memory registries. */
  handle: HostHandle;
}

export interface HostHandle {
  workspaces: Map<string, Workspace>;
  conversations: Map<string, Conversation>;
  profiles: Map<string, ModelProfile>;
  usage: { totalTokens: number; totalRequests: number };
  productStore: ProductStore;
  taskRunner: TaskRunner;
  episodeRunner: EpisodeRunner;
  conversationExecutor: ConversationExecutor;
  memory: MemoryStore;
  approvals: ApprovalService;
  /** 成本熔断服务（预算配置 / 预警 / 撞线降级 / owner 放行）。 */
  budget: BudgetService;
  /** 语音服务（统一会话的本地 ASR+TTS；懒加载 + 能力探测）。 */
  voice: VoiceService;
  /** 进程内事件总线（广播 = WS 扇出 + 本地订阅者，IM 渠道用它做进度播报）。 */
  subscribeEvents: (listener: (channelId: string, payload: unknown) => void) => () => void;
}

// ── RPC error ──────────────────────────────────────────────────

/** JSON-RPC application error. `data.code` carries protocol error codes. */
class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

// ── host factory (per-instance state) ──────────────────────────

interface WsClient {
  ws: WebSocket;
  /** Subscription channel: a conversation id or a task id, depending on the
   *  stream the client follows. */
  channelId: string | null;
}

/**
 * Build a fresh set of in-memory registries + JSON-RPC method handlers.
 * Workspaces/conversations/profiles/running-agents/usage are isolated per
 * server instance. Conversation transcripts (conversation-store.ts) remain
 * process-wide by design.
 */
function createHost(options: ServerOptions): {
  methods: Record<string, RpcHandler>;
  broadcast: (channelId: string, payload: unknown) => void;
  handle: HostHandle;
  wsClients: Set<WsClient>;
  services: {
    scheduler: SchedulerService;
    autonomous: AutonomousService;
    companion: CompanionService;
    mcpSessions: McpSessionManager;
  };
  productStore: ProductStore;
  ownsProductStore: boolean;
  /** Stop every IM channel runtime (ws clients, event subscriptions). */
  stopChannels: () => Promise<void>;
  /** Finish post-run jobs before their ProductStore dependency is closed. */
  drainBackground: () => Promise<void>;
} {
  const ownsProductStore = options.productStore === undefined;
  const productStore =
    options.productStore ??
    new ProductStore(
      options.databasePath ??
        (process.env.VITEST
          ? ":memory:"
          : path.join(penglaiDataDir(), "product.db")),
    );
  const productDataDir =
    options.dataDir ??
    (options.databasePath && options.databasePath !== ":memory:"
      ? path.dirname(path.resolve(options.databasePath))
      : penglaiDataDir());
  const workspaces = new Map<string, Workspace>();
  const conversations = new Map<string, Conversation>();
  const profiles = new Map<string, ModelProfile>();
  const customApiKeys = new Map<string, string>();
  const wsClients = new Set<WsClient>();
  const usage = { totalTokens: 0, totalRequests: 0 };
  const hostLog = options.log ?? ((line: string) => console.error(`[host] ${line}`));
  /** 进程内事件订阅者（IM 渠道等）；broadcast 除 WS 扇出外也喂给它们。 */
  const eventListeners = new Set<(channelId: string, payload: unknown) => void>();

  // Legacy background records remain available for migration, but their
  // execution tickers stay disabled until they route through TaskRunner.
  const scheduler = new SchedulerService({ persist: true });
  const autonomous = new AutonomousService({ persist: true, sopPath: AUTONOMOUS_SOP_PATH });
  const companion = new CompanionService({
    persist: true,
    statePath: path.join(productDataDir, "companion.json"),
  });

  for (const p of options.profiles ?? defaultProfiles()) {
    profiles.set(p.id, p);
  }
  // Durable BYOK profiles (<data-dir>/profiles.json, 0600): created by the
  // first-run setup wizard or `penglai config add`. They merge over the
  // built-in catalog (same id wins), and literal keys seed the in-memory
  // key map so a configured profile survives host restarts.
  for (const entry of loadPersistedProfiles(productDataDir)) {
    const catalogModel = findCatalogModel(entry.model);
    const vision =
      entry.capabilities?.vision ??
      (catalogModel?.features?.includes("vision") ?? false);
    profiles.set(entry.id, {
      id: entry.id,
      label: entry.label,
      provider: entry.provider,
      baseUrl: entry.baseUrl,
      apiKeyEnv: entry.apiKeyEnv,
      model: entry.model,
      capabilities: {
        tools: entry.capabilities?.tools ?? true,
        streaming: entry.capabilities?.streaming ?? true,
        vision,
      },
      contextWindowTokens:
        entry.contextWindowTokens ?? catalogContextTokens(catalogModel),
      maxOutputTokens: entry.maxOutputTokens ?? catalogMaxOutputTokens(catalogModel),
    });
    if (entry.apiKey) customApiKeys.set(entry.id, entry.apiKey);
  }

  /** Forward an event to every WS client subscribed to `channelId`, and to
   *  every in-process listener (IM channels consume task progress here). */
  function broadcast(channelId: string, payload: unknown): void {
    const msg = JSON.stringify(payload);
    for (const c of wsClients) {
      if (c.channelId === channelId && c.ws.readyState === c.ws.OPEN) {
        // Slow-consumer backpressure: never buffer unboundedly for a client
        // that is not draining (a stuck renderer would otherwise grow memory
        // with every event). Dropping an event is safe — the WS protocol is
        // subscribe/unsubscribe state sync, and clients re-pull via RPC.
        if (c.ws.bufferedAmount > WS_MAX_BUFFERED) continue;
        c.ws.send(msg);
      }
    }
    for (const listener of eventListeners) {
      try {
        listener(channelId, payload);
      } catch (error) {
        hostLog(
          `event listener failed on ${channelId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  /** Subscribe an in-process listener; returns the unsubscribe function. */
  function subscribeEvents(
    listener: (channelId: string, payload: unknown) => void,
  ): () => void {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  }
  // Two-layer memory (design §6): global layer under the product data dir
  // (<data-dir>/memory/global), project layer inside each project workspace.
  const memoryStore = new MemoryStore(
    path.join(productDataDir, "memory", "global"),
    {
      resolveEvidence: ({ evidenceId, taskId, runId }) =>
        productStore
          .getTaskBundle(taskId)
          ?.evidence.find(
            (evidence) => evidence.id === evidenceId && evidence.runId === runId,
          ) ?? null,
      onSopIndexError: (error) =>
        hostLog(`SOP L1 index refresh failed: ${error.message}`),
    },
  );
  memoryStore.ensureGlobalLayout();
  const skillStore = new SkillStore(productDataDir);
  // Manual-connect only: configuration survives restarts, but Host startup
  // never spawns or contacts a third-party MCP server.
  const mcpSessions = new McpSessionManager(productDataDir);

  // Deterministic mode-switch loop (design §5). Only explicit Owner-facing
  // mode.* RPCs use this path during W1 hardening; it is not a model tool.
  const modeSwitchCtx: ModeSwitchContext = {
    store: productStore,
    proposalStore: new WorkProposalStore(path.join(productDataDir, "work-proposals.json")),
    dataDir: productDataDir,
    getConversation: (conversationId) => getOrHydrateConversation(conversationId),
    saveConversation: (conversation) => {
      conversations.set(conversation.id, conversation);
      saveConversationMeta(productDataDir, conversation);
    },
  };

  // MCP configuration is read-only and inert during W1. No process is
  // spawned and no network endpoint is contacted before an Owner-authorized
  // execution broker exists.
  // Safe Host-side tools shared by every kernel assembly. MCP descriptors and
  // model-driven project activation are deliberately not mounted in W1.
  const hostTools: HostToolHandlers = {
    listSkills: () => [
      ...memoryStore.listSops().map((sop) => ({
        name: sop.name,
        title: sop.title || sop.name,
        updatedAt: sop.updatedAt,
      })),
      ...skillStore.list().filter((skill) => skill.enabled).map((skill) => ({
        name: skill.name,
        title: skill.description,
        updatedAt: skill.updatedAt,
      })),
    ],
    showSkill: (name) => {
      const installed = skillStore.inspect(name);
      if (installed) return installed.content;
      try {
        return memoryStore.readSop(name);
      } catch {
        return null;
      }
    },
    loadSkills: () => skillStore.loadEnabled().map((skill) => ({
      name: skill.name,
      title: skill.description,
      content: skill.content,
      filePath: skill.filePath,
      updatedAt: skill.updatedAt,
    })),
    externalTools: () => mcpSessions.listToolDescriptors().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      call: (args: Record<string, unknown>) => mcpSessions.callTool(tool.name, args),
    })),
    updateGoal: (input) => {
      const conversationId = input.conversationId;
      if (!conversationId) {
        throw new Error("update_goal requires a bound conversationId");
      }
      const goal = updateGoalStatus({
        conversationId,
        status: input.status,
        summary: input.summary,
        reason: input.reason,
      });
      const conv = getOrHydrateConversation(conversationId);
      if (conv) {
        const next = {
          ...conv,
          goal: mirrorGoalText(goal),
          activeGoal: goal.status === "active" || goal.status === "blocked" ? goal : null,
          updatedAt: Date.now(),
        };
        conversations.set(next.id, next);
        saveConversationMeta(productDataDir, next);
        broadcast(conversationId, {
          event: "conversation.goal.updated",
          conversationId,
          goal: next.goal,
          activeGoal: next.activeGoal ?? goal,
        });
      }
      return { ok: true, goal };
    },
  };

  // 审批四级制 (design §5/§9): L2 one-click confirms + L3 mandatory human
  // decisions, all durable (approvals rows + evidence trail + product
  // events) and replayable.
  const approvalService = new ApprovalService(productStore, broadcast, hostLog);
  // Conversation-surface L2/L3 holds (no task/run row required).
  const conversationApprovals = new ConversationApprovalService(broadcast);

  // 成本熔断 (design §7 成本可见性): the usage ledger is the source of
  // truth; ≥80% warns once per dimension per day, ≥100% trips the breaker
  // and degrades the dimension into approval mode (L3 pre-flight for
  // task.start; budget_exceeded + owner lift for chat).
  const budgetService = new BudgetService(productStore, {
    publish: broadcast,
    log: hostLog,
  });

  // 蒸馏环 v1 (design §6/§9): work → 全局记忆的唯一合法通道。run 完工 →
  // 复盘（review 模型，可配轻量档位）→ 候选 SOP → 注入/安全审计闸（规则
  // 表 + 预留的不同 provider 审计位）→ 入树（writeGlobalSop 专属通道 +
  // L1 索引刷新）。不过审只留 Evidence，绝不入树。
  const distillService = new DistillService({
    store: productStore,
    memory: memoryStore,
    dataDir: productDataDir,
    resolveProfile: (profileId) => {
      const profile = profiles.get(profileId);
      if (!profile) return null;
      return {
        profile,
        apiKey:
          customApiKeys.get(profile.id) ??
          (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : ""),
      };
    },
    reviewModel: options.distillReviewModel,
    publish: broadcast,
    log: hostLog,
  });
  const distillJobs = new Set<Promise<unknown>>();

  // 语音服务（design §7：统一会话的本地 ASR+TTS，数据不出机）。语音是 I/O
  // 层——蒸馏/审批/预算机制与其天然兼容（语音进出的都是 conversation.prompt
  // 的文本）。原生引擎懒加载 + 能力探测，绝不成 host 启动硬依赖；下载进度
  // 经 voice 频道广播（CLI 订阅渲染进度行）。
  const voiceService = new VoiceService({
    ...(options.voice ?? {}),
    dataDir: productDataDir,
    onProgress: (event) =>
      broadcast("voice", { event: "voice.download.progress", ...event }),
    log: hostLog,
  });

  // In-memory mutation barriers close new execution entrances while the Host
  // drains old kernels. Persistent trust/anchor state is changed only after
  // every relevant episode has aborted and settled.
  const revokingProjects = new Set<string>();
  const revokingTasks = new Set<string>();
  const revokingConversations = new Set<string>();

  // Durable task runs register their authority/model assembly here while
  // TaskRunner tracks Run/Step/Evidence. EpisodeRunner remains the only owner
  // of an actual Pi agent loop.
  const taskEpisodeSessions = new Map<string, ResolvedSession>();
  let episodeRunner!: EpisodeRunner;

  const registerTaskEpisodeSession = (
    sessionKey: string,
    taskOptions: TaskKernelOptions,
  ): (() => void) => {
    const conversation = taskOptions.conversationId
      ? getOrHydrateConversation(taskOptions.conversationId)
      : null;
    taskEpisodeSessions.set(sessionKey, {
      profile: taskOptions.profile,
      apiKey: taskOptions.apiKey,
      workspaceRoot: taskOptions.workspaceRoot,
      projectAnchored: true,
      taskId: taskOptions.taskId,
      conversationId: taskOptions.conversationId ?? null,
      memory: taskOptions.memory,
      hostTools: taskOptions.hostTools,
      hasPolicyGrant: taskOptions.hasPolicyGrant,
      revalidateAuthority: taskOptions.revalidateAuthority,
      goal: conversation?.goal ?? null,
      contextPins: conversation?.contextPins ?? [],
      workbenchInjection: taskOptions.conversationId
        ? buildWorkbenchInjection(taskOptions.conversationId)
        : null,
      onL4Denied: (info) =>
        taskOptions.onL4Denied?.({
          toolName: info.toolName,
          args: info.args,
          decision: {
            allowed: false,
            code: "l4_denied",
            level: "L4",
            reason: info.reason,
          },
        }),
      kernelFactory: options.taskKernelFactory
        ? async () => options.taskKernelFactory!(taskOptions)
        : undefined,
    });
    return () => taskEpisodeSessions.delete(sessionKey);
  };

  const taskRunner = new TaskRunner(
    productStore,
    productDataDir,
    async (taskOptions) =>
      createTaskEpisodeKernel(taskOptions, {
        runner: episodeRunner,
        registerSession: (sessionKey) =>
          registerTaskEpisodeSession(sessionKey, taskOptions),
        log: hostLog,
      }),
    broadcast,
    {
      memory: memoryStore,
      hostTools,
      // 审批四级制: the L2/L3 human-in-the-loop service backing the kernel
      // gate and the approval.* RPC surface.
      approvals: approvalService,
      // 成本熔断前置门: a tripped, unlifted breaker forces an L3
      // budget-override approval BEFORE the kernel is constructed (the run
      // pauses at awaiting_approval; a denial cancels the fresh run).
      preFlightApproval: ({ task, run, project }) => {
        const gate = budgetService.gateForTaskStart(project.id);
        if (!gate.tripped) return Promise.resolve({ approved: true, note: "" });
        return approvalService.requestDecision(
          { task, run, project, stepId: null },
          {
            toolName: "task.start",
            args: { objective: task.objective },
            decision: {
              allowed: false,
              code: "needs_approval",
              level: "L3",
              reason: gate.message,
              approval: {
                capability: CAPABILITY_L3_BUDGET_OVERRIDE,
                action: `task.start「${task.title}」（预算熔断降级）`,
              },
            },
          },
        );
      },
      // 蒸馏环入口：干净完工的 run → 复盘→候选 SOP→审计→入树（异步，
      // 绝不阻塞 settle 尾段；失败只留 host 日志与 Evidence）。
      onRunCompleted: (info) => {
        const job = distillService.distillRun(info).catch((error) => {
          hostLog(
            `distillation failed for run ${info.run.id}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        });
        distillJobs.add(job);
        void job.finally(() => distillJobs.delete(job));
      },
      onUsage: (episode) => {
        // Durable cost ledger (design §7): one row per (day, mode, project).
        usage.totalTokens += episode.totalTokens;
        usage.totalRequests += 1;
        try {
          productStore.recordUsage({
            day: localDay(),
            mode: episode.mode,
            projectId: episode.projectId,
            inputTokens: episode.inputTokens,
            outputTokens: episode.outputTokens,
            requests: 1,
          });
          recordModelUsage(productDataDir, {
            model: episode.model,
            modelProfileId: episode.modelProfileId,
            tokens: episode.totalTokens,
            requests: 1,
          });
          // 实时核对预算：80% 预警 / 撞线降级（事件播报到任务频道 + budget 频道）。
          budgetService.recordAndCheck({
            mode: episode.mode,
            projectId: episode.projectId,
            channelId: episode.taskId,
          });
        } catch (error) {
          hostLog(
            `usage ledger write failed for run ${episode.runId}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      log: hostLog,
      isProjectAuthorityAvailable: (projectId) =>
        !revokingProjects.has(projectId),
      isTaskAuthorityAvailable: (taskId) => !revokingTasks.has(taskId),
    },
  );

  // Crash recovery (lightweight checkpoint): the store already closed
  // interrupted runs at open; index any engine session files the previous
  // process left behind so the task view rebuilds from observation.
  try {
    const swept = sweepMissingCheckpoints(productStore, productDataDir);
    if (swept.indexed.length > 0) {
      hostLog(
        `checkpoint sweep: indexed ${swept.indexed.length} recovered run(s)` +
          (swept.missing.length > 0
            ? `, ${swept.missing.length} stopped run(s) left no session file`
            : ""),
      );
    }
  } catch (error) {
    hostLog(
      `checkpoint sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // ── Unified EpisodeRunner (0.4 execution core) ────────────────
  // Desktop, CLI, Goal and IM transports all enter this coordinator. There is
  // no transport-owned chat loop and no capability split by conversation mode.
  episodeRunner = new EpisodeRunner({
    kernel: createProductionEpisodeKernel({
      dataDir: productDataDir,
      // Allow tests to inject a scripted kernel (echo, failure, budget trip).
      kernelFactory: options.chatKernelFactory,
      resolveSession: async (sessionKey) => {
        const taskSession = taskEpisodeSessions.get(sessionKey);
        if (taskSession) return taskSession;
        // sessionKey is a conversation id; resolve its anchor + profile.
        const conversation = getOrHydrateConversation(sessionKey);
        if (!conversation) {
          throw new Error(`unknown conversation: ${sessionKey}`);
        }
        const profileId = conversation.modelProfileId ?? "default";
        const profile = profiles.get(profileId) ?? profiles.get("default");
        if (!profile) throw new Error("no model profile");
        const apiKey =
          customApiKeys.get(profile.id) ??
          (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : "");
        let workspaceRoot = productDataDir;
        let projectAnchored = false;
        let taskId: string | null = null;
        let projectId = "";
        const ws = workspaces.get(conversation.workspaceId);
        if (ws) workspaceRoot = ws.rootPath;
        if (conversation.activeTaskId) {
          const task = productStore.getTask(conversation.activeTaskId);
          if (task) {
            const project = productStore.getProject(task.projectId);
            if (project && project.trusted === true && project.status !== "archived") {
              workspaceRoot = project.rootPath;
              projectAnchored = true;
              taskId = task.id;
              projectId = project.id;
            }
          }
        }
        return {
          profile,
          apiKey,
          workspaceRoot,
          projectAnchored,
          taskId,
          conversationId: conversation.id,
          memory: memoryStore,
          hostTools,
          goal: conversation.goal ?? null,
          contextPins: (conversation.contextPins ?? []).map((pin) => ({
            kind: pin.kind,
            label: pin.label,
            ref: pin.ref,
          })),
          workbenchInjection: buildWorkbenchInjection(conversation.id),
          // Project-scoped L2 grants ("remember for this project") are
          // strictly scoped to the anchored project — never scan across
          // jails (the old 同类免问 leak).
          hasPolicyGrant: (grantKey) =>
            projectId ? productStore.hasPolicyGrant(projectId, grantKey) : false,
          // L4 denials are hard policy blocks; record them as evidence on
          // the anchored task so the run has an auditable trail.
          onL4Denied: (info) => {
            if (!taskId) return;
            try {
              productStore.addEvidence({
                taskId,
                kind: "log",
                title: `L4 拒绝：${info.toolName}`,
                summary: info.reason,
                metadata: {
                  code: info.code,
                  toolName: info.toolName,
                  args: JSON.stringify(info.args).slice(0, 500),
                },
              });
            } catch (error) {
              hostLog(
                `agent L4 denial evidence failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          },
        };
      },
      log: hostLog,
    }),
    defaultPermissionMode: "auto_edit",
    log: hostLog,
  });
  // Bridge EpisodeRunner events into the existing broadcast bus so CLI/
  // desktop/Feishu subscribers see them during the transition. Also
  // persist assistant messages to the conversation transcript.
  //
  // Resolve the project anchor (if any) for a chat episode so usage is
  // billed to the right mode/project.
  const resolveEpisodeAnchor = (
    conversationId: string,
  ): { projectId: string; projectAnchored: boolean } => {
    const conversation = getOrHydrateConversation(conversationId);
    if (conversation?.activeTaskId) {
      const task = productStore.getTask(conversation.activeTaskId);
      if (task) {
        const project = productStore.getProject(task.projectId);
        if (project && project.trusted === true && project.status !== "archived") {
          return { projectId: project.id, projectAnchored: true };
        }
      }
    }
    return { projectId: "", projectAnchored: false };
  };

  // The agent.* path is two-phase (submit returns a runId; completion
  // arrives as an event). The bridge needs the originating user text to
  // auto-title an untitled conversation on completion, so remember it by
  // runId until the terminal event lands.
  const runPrompts = new Map<string, string>();

  const touchConversation = (
    conversationId: string,
    patch: Partial<Pick<Conversation, "status" | "title" | "updatedAt">>,
  ): void => {
    const current = getOrHydrateConversation(conversationId);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    conversations.set(conversationId, next);
    saveConversationMeta(productDataDir, next);
  };

  // Title an untitled conversation from the owner's first prompt, mirroring
  // Host title derivation. Only applies to the default placeholder titles.
  const derivedTitle = (conversationId: string, userText: string): string | null => {
    const current = getOrHydrateConversation(conversationId);
    if (!current) return null;
    const isUntitled =
      !current.title ||
      current.title === "New conversation" ||
      current.title === "新对话";
    if (!isUntitled) return null;
    const trimmed = userText.trim().slice(0, 60);
    return trimmed.length > 0 ? trimmed : null;
  };

  // Human-readable detail for a non-clean stop, used both in the legacy
  // conversation.prompt.* event and the transcript marker.
  const stopDetailFor = (
    stopReason: "completed" | "aborted" | "budget" | "failed",
  ): string | null => {
    switch (stopReason) {
      case "completed":
        return null;
      case "aborted":
        return "episode aborted";
      case "budget":
        return "episode budget exceeded";
      case "failed":
        return "episode failed";
    }
  };

  episodeRunner.on((event) => {
    if (!event.event.startsWith("episode.")) return;
    const channelId =
      "sessionKey" in event ? String((event as { sessionKey: string }).sessionKey) : "";
    // Durable task sessions are translated back into KernelEvents by the task
    // adapter; TaskRunner publishes task.* lifecycle/evidence on task channels.
    if (channelId.startsWith("task:")) return;

    // Translate episode.* → conversation.* events so every client renders the
    // unified EpisodeRunner path through the stable public event vocabulary.
    // Terminal prompt events are emitted only after the assistant transcript
    // beat has been persisted and broadcast below.
    switch (event.event) {
      case "episode.started":
        touchConversation(channelId, { status: "running" });
        broadcast(channelId, {
          event: "conversation.prompt.started",
          conversationId: channelId,
          runId: event.runId,
        });
        break;
      case "episode.delta":
        broadcast(channelId, {
          event: "conversation.delta",
          conversationId: channelId,
          textDelta: event.textDelta,
        });
        break;
      case "episode.tool.started":
        broadcast(channelId, {
          event: "conversation.tool.started",
          conversationId: channelId,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
        });
        break;
      case "episode.tool.completed":
        broadcast(channelId, {
          event: "conversation.tool.completed",
          conversationId: channelId,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          data: event.data,
          isError: event.isError,
        });
        break;
      case "episode.approval.requested":
        broadcast(channelId, {
          event: "conversation.approval.requested",
          conversationId: channelId,
          approval: {
            id: event.approvalId,
            conversationId: channelId,
            episodeId: event.runId,
            toolName: event.toolName,
            capability: event.capability,
            action: event.action,
            reason: event.argsExcerpt,
            level: event.level,
            argsExcerpt: event.argsExcerpt,
            status: "pending",
          },
        });
        break;
      case "episode.mode.changed":
        // Already in the legacy namespace; forward as-is.
        broadcast(channelId, { ...event, conversationId: channelId });
        break;
      case "episode.completed": {
        // Deferred until after conversation.message.assistant below.
        break;
      }
      case "episode.error":
        // Deferred until after the failure transcript marker below.
        break;
      default:
        break;
    }

    if (event.event === "episode.completed") {
      // Persist the assistant beat. On a clean stop the text is the model
      // reply; on a non-clean stop with no text, or alongside the text, we
      // leave a [episode <reason>: <detail>] marker so the transcript is
      // never silently missing a beat.
      const stopDetail = event.stopDetail ?? stopDetailFor(event.stopReason);
      const marker =
        event.stopReason === "completed"
          ? ""
          : `[episode ${event.stopReason}: ${stopDetail ?? ""}]`;
      const transcriptText =
        event.text || event.stopReason !== "completed"
          ? `${event.text}${event.text && marker ? "\n\n" : ""}${marker}`
          : "";
      if (transcriptText) {
        try {
          const assistantMessage = {
            id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            conversationId: channelId,
            role: "assistant" as const,
            createdAt: Date.now(),
            content: [{ type: "text" as const, text: transcriptText }],
          };
          saveMessage(channelId, assistantMessage);
          broadcast(channelId, {
            event: "conversation.message.assistant",
            conversationId: channelId,
            message: assistantMessage,
          });
        } catch (error) {
          hostLog(
            `episode transcript write failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Cost visibility: conversation rows are
      // unanchored (projectId ""); project-anchored episodes bill "work".
      const totalTokens = event.inputTokens + event.outputTokens;
      if (totalTokens > 0) {
        usage.totalTokens += totalTokens;
        usage.totalRequests += 1;
      }
      try {
        const conversation = getOrHydrateConversation(channelId);
        const { projectId, projectAnchored } = resolveEpisodeAnchor(channelId);
        const profileId = conversation?.modelProfileId ?? "default";
        const profile = profiles.get(profileId) ?? profiles.get("default");
        productStore.recordUsage({
          day: localDay(),
          mode: projectAnchored ? "work" : "chat",
          projectId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          requests: 1,
        });
        if (profile) {
          recordModelUsage(productDataDir, {
            model: profile.model,
            modelProfileId: profileId,
            tokens: totalTokens,
            requests: 1,
          });
        }
        budgetService.recordAndCheck({
          mode: projectAnchored ? "work" : "chat",
          projectId,
          channelId,
        });
      } catch (error) {
        hostLog(
          `episode usage ledger write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Settle conversation lifecycle: back to idle (error on a failed run)
      // and auto-title an untitled conversation from the owner's prompt.
      const userText = runPrompts.get(event.runId) ?? "";
      runPrompts.delete(event.runId);
      const title = derivedTitle(channelId, userText);
      touchConversation(channelId, {
        status: event.stopReason === "failed" ? "error" : "idle",
        ...(title ? { title } : {}),
      });

      broadcast(channelId, {
        event: `conversation.prompt.${event.stopReason === "completed" ? "completed" : event.stopReason}`,
        conversationId: channelId,
        runId: event.runId,
        stopReason: event.stopReason,
        stopDetail,
      });
      // Budget stops also surface as conversation.prompt.blocked (CLI renders
      // the reason inline after the terminal prompt event).
      if (event.stopReason === "budget") {
        broadcast(channelId, {
          event: "conversation.prompt.blocked",
          conversationId: channelId,
          runId: event.runId,
          reason: stopDetail ?? "episode budget exceeded",
        });
      }
    }
    if (event.event === "episode.error") {
      runPrompts.delete(event.runId);
      touchConversation(channelId, { status: "error" });
      // Leave a failure marker in the transcript so the beat is not silent.
      try {
        const assistantMessage = {
          id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          conversationId: channelId,
          role: "assistant" as const,
          createdAt: Date.now(),
          content: [
            { type: "text" as const, text: `[episode failed: ${event.error}]` },
          ],
        };
        saveMessage(channelId, assistantMessage);
        broadcast(channelId, {
          event: "conversation.message.assistant",
          conversationId: channelId,
          message: assistantMessage,
        });
      } catch (error) {
        hostLog(
          `episode error transcript write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      broadcast(channelId, {
        event: "conversation.prompt.failed",
        conversationId: channelId,
        runId: event.runId,
        stopReason: "failed",
        stopDetail: event.error,
      });
    }
    broadcast(channelId, event);
  });

  const persistConversationUserBeat = (
    conversationId: string,
    promptText: string,
    images: ReturnType<typeof sanitizeImages>,
  ): void => {
    const userMessage = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      role: "user" as const,
      createdAt: Date.now(),
      content: [
        { type: "text" as const, text: promptText },
        ...images.map((image) => ({
          type: "image" as const,
          data: image.data,
          mimeType: image.mimeType,
          name: image.name,
        })),
      ],
    };
    saveMessage(conversationId, userMessage);
    broadcast(conversationId, {
      event: "conversation.message.user",
      conversationId,
      message: userMessage,
    });
  };

  /** Single prompt entry used by every transport in 0.4. */
  const promptConversation = async (
    input: ConversationPromptInput,
  ): Promise<ConversationPromptResult> => {
    const { conversationId } = input;
    const conversation = getOrHydrateConversation(conversationId);
    if (!conversation) {
      throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
        code: "conversation_not_found",
      });
    }
    if (revokingConversations.has(conversationId)) {
      throw new RpcError(-32000, "conversation authority is changing", {
        code: "authority_changed",
      });
    }

    const images = sanitizeImages(input.images);
    const promptText = input.text.trim()
      ? input.text.trim()
      : images.length > 0
        ? imageOnlyPrompt(images.length)
        : "";
    if (!promptText) {
      throw new RpcError(-32602, "invalid params: 'text' or 'images' required");
    }
    const permissionMode = input.permissionMode ?? "auto_edit";
    const thinkingLevel = input.thinkingLevel ?? "medium";
    const delivery = input.delivery === "now" ? "steer" : "followup";

    if (episodeRunner.active(conversationId)) {
      if (input.requireNewEpisode) {
        throw new RpcError(
          -32000,
          "conversation has an active episode; wait before starting a permission-isolated episode",
          { code: "conversation_busy" },
        );
      }
      if (input.recordUserMessage !== false) {
        persistConversationUserBeat(conversationId, promptText, images);
      }
      const runId =
        `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      runPrompts.set(runId, promptText);
      episodeRunner.submit(conversationId, {
        text: promptText,
        delivery,
        permissionMode,
        thinkingLevel,
        images: images.length > 0 ? images : undefined,
        runId,
      });
      return {
        conversationId,
        episodeId: runId,
        text: delivery === "steer" ? "(steered into active episode)" : "(queued as follow-up)",
        stopReason: "completed",
        stopDetail: delivery === "steer" ? "steered" : "queued",
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const profileId = conversation.modelProfileId ?? "default";
    const profile = profiles.get(profileId) ?? profiles.get("default");
    if (!profile) {
      throw new RpcError(
        -32000,
        `unknown model profile: ${conversation.modelProfileId ?? "(none)"}`,
        { code: "model_error" },
      );
    }
    const apiKey =
      customApiKeys.get(profile.id) ??
      (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : "");
    if (!apiKey.trim()) {
      throw new RpcError(
        -32000,
        `no API key for model profile '${profile.id}'` +
          (profile.apiKeyEnv
            ? `; set the ${profile.apiKeyEnv} environment variable or create a profile with a key`
            : ""),
        { code: "model_error" },
      );
    }
    const { projectId } = resolveEpisodeAnchor(conversationId);
    const gate = budgetService.gateForChat(projectId || null);
    if (gate.tripped) {
      throw new RpcError(-32000, gate.message, { code: "budget_exceeded" });
    }

    if (input.recordUserMessage !== false) {
      persistConversationUserBeat(conversationId, promptText, images);
    }
    const runId =
      `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    runPrompts.set(runId, promptText);
    let result;
    try {
      result = await episodeRunner.prompt(conversationId, {
        text: promptText,
        delivery,
        permissionMode,
        thinkingLevel,
        images: images.length > 0 ? images : undefined,
        runId,
      });
    } catch (error) {
      throw new RpcError(
        -32000,
        error instanceof Error ? error.message : String(error),
        { code: "model_error" },
      );
    }
    if (result.stopReason === "failed") {
      throw new RpcError(-32000, result.stopDetail ?? "episode failed", {
        code: "model_error",
      });
    }
    return {
      conversationId,
      episodeId: result.runId,
      text: result.text,
      stopReason: result.stopReason,
      stopDetail: result.stopDetail,
      turns: result.turns,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  };

  const compactConversation = async (
    conversationId: string,
    instructions?: string,
  ): Promise<{ ok: boolean; deferred: boolean; detail?: string }> => {
    const conversation = getOrHydrateConversation(conversationId);
    if (!conversation) {
      return { ok: false, deferred: false, detail: "conversation not found" };
    }
    if (episodeRunner.active(conversationId)) {
      return {
        ok: true,
        deferred: true,
        detail: "episode is active; compact after it settles",
      };
    }
    const profile =
      profiles.get(conversation.modelProfileId) ?? profiles.get("default");
    if (!profile) {
      return { ok: false, deferred: false, detail: "unknown model profile" };
    }
    const apiKey =
      customApiKeys.get(profile.id) ??
      (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : "");
    if (!apiKey.trim()) {
      return { ok: false, deferred: false, detail: "no API key for profile" };
    }
    let kernel: AgentKernel | null = null;
    try {
      let workspaceRoot =
        workspaces.get(conversation.workspaceId)?.rootPath ?? productDataDir;
      let projectAnchored = false;
      let taskId: string | null = null;
      if (conversation.activeTaskId) {
        const task = productStore.getTask(conversation.activeTaskId);
        const project = task ? productStore.getProject(task.projectId) : null;
        if (task && project?.trusted && project.status !== "archived") {
          workspaceRoot = project.rootPath;
          projectAnchored = true;
          taskId = task.id;
        }
      }
      const shared = {
        taskId,
        workspaceRoot,
        dataDir: productDataDir,
        profile,
        apiKey,
        projectAnchored,
        conversationId,
        memory: memoryStore,
        hostTools,
        permissionMode: "plan" as const,
        thinkingLevel: "off" as const,
        goal: conversation.goal ?? null,
        contextPins: conversation.contextPins ?? [],
        workbenchInjection: buildWorkbenchInjection(conversationId),
      };
      kernel = options.chatKernelFactory
        ? await options.chatKernelFactory({
            ...shared,
            runId: `compact_${Date.now().toString(36)}`,
          })
        : await createProductionPiKernel({
            ...shared,
            runId: `compact_${Date.now().toString(36)}`,
          });
      if (!kernel.compact) {
        return { ok: false, deferred: false, detail: "compact not available on this kernel" };
      }
      const result = await kernel.compact(
        instructions ??
          "Compress older turns; keep decisions, file paths, tool outcomes, goals, and open TODOs.",
      );
      const detail =
        result.ok && typeof result.tokensBefore === "number"
          ? `session compacted (about ${result.tokensBefore} tokens before)`
          : result.detail ?? (result.ok ? "session compacted" : "compact failed");
      return { ok: result.ok, deferred: false, detail };
    } catch (error) {
      return {
        ok: false,
        deferred: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      kernel?.dispose();
    }
  };

  const conversationExecutor: ConversationExecutor = {
    prompt: promptConversation,
    isBusy: (conversationId) => episodeRunner.active(conversationId),
    abort: async (conversationId) => episodeRunner.interrupt(conversationId),
    abortAndWait: async (conversationId) => {
      const aborted = episodeRunner.interrupt(conversationId);
      if (aborted) await episodeRunner.join(conversationId);
      return aborted;
    },
    compact: compactConversation,
  };

  const abortProjectConversationEpisodes = async (
    projectId: string,
  ): Promise<number> => {
    const ids: string[] = [];
    for (const conversation of conversations.values()) {
      if (!conversation.activeTaskId) continue;
      const task = productStore.getTask(conversation.activeTaskId);
      if (task?.projectId === projectId && episodeRunner.active(conversation.id)) {
        ids.push(conversation.id);
      }
    }
    await Promise.all(ids.map((id) => conversationExecutor.abortAndWait(id)));
    return ids.length;
  };

  function saveConversationMeta(dataDir: string, conversation: Conversation): void {
    // dataDir unused — meta lives next to the transcript under product home.
    void dataDir;
    try {
      persistConversationMeta({
        id: conversation.id,
        workspaceId: conversation.workspaceId,
        title: conversation.title,
        status: conversation.status,
        modelProfileId: conversation.modelProfileId,
        mode: conversation.mode,
        activeTaskId: conversation.activeTaskId ?? null,
        goal: conversation.goal ?? null,
        contextPins: conversation.contextPins ?? [],
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      });
    } catch (error) {
      hostLog(
        `conversation meta write failed for ${conversation.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Build a lightweight Conversation row for a disk-only conversation (no
   *  in-memory row). Prefers meta.json; falls back to transcript first line. */
  function conversationFromDisk(cid: string): Conversation | null {
    const meta = loadConversationMeta(cid);
    const msgs = meta ? null : loadMessages(cid);
    if (!meta && (!msgs || msgs.length === 0)) return null;
    const firstUser = msgs?.find((m) => m.role === "user");
    const titleFromMsg = firstUser
      ? joinText(firstUser.content).slice(0, 60)
      : "(empty conversation)";
    return {
      schemaVersion: SCHEMA_VERSION,
      id: cid,
      workspaceId: meta?.workspaceId ?? "",
      title: meta?.title || titleFromMsg,
      status: (meta?.status as Conversation["status"]) || "idle",
      modelProfileId: meta?.modelProfileId ?? "",
      activeTaskId: meta?.activeTaskId ?? null,
      // mode is a derived mirror of activeTaskId (legacy field).
      mode: meta?.activeTaskId ? "work" : "chat",
      goal: meta?.goal ?? null,
      activeGoal: hydrateGoal(cid, meta?.goal ?? null),
      contextPins: meta?.contextPins ?? [],
      createdAt: meta?.createdAt ?? msgs?.[0]?.createdAt ?? 0,
      updatedAt: meta?.updatedAt ?? msgs?.[msgs.length - 1]?.createdAt ?? 0,
      endedAt: null,
    };
  }

  /** Return the in-memory conversation, or hydrate one from disk if it
   *  exists. */
  function getOrHydrateConversation(conversationId: string): Conversation | null {
    const mem = conversations.get(conversationId);
    if (mem) return mem;
    const meta = loadConversationMeta(conversationId);
    if (meta || loadMessages(conversationId).length > 0) {
      const hydrated = conversationFromDisk(conversationId);
      if (hydrated) conversations.set(conversationId, hydrated);
      return hydrated;
    }
    return null;
  }

  /** Abort and settle the one conversation episode before authority changes. */
  async function drainEpisodeRunner(conversationId: string): Promise<void> {
    await conversationExecutor.abortAndWait(conversationId);
  }

  async function confirmWorkWithAuthorityDrain(
    input: ConfirmWorkInput,
  ): Promise<ConfirmWorkResult> {
    const conversation = getOrHydrateConversation(input.conversationId);
    // Unknown/idempotently anchored cases do not introduce a new authority;
    // let the deterministic mode switch return its exact protocol result.
    if (!conversation || conversation.activeTaskId) {
      return confirmWork(modeSwitchCtx, input);
    }
    if (revokingConversations.has(conversation.id)) {
      throw new EpisodeAuthorityError(
        `conversation ${conversation.id} authority mutation already in progress`,
      );
    }
    revokingConversations.add(conversation.id);
    try {
      await drainEpisodeRunner(conversation.id);
      return confirmWork(modeSwitchCtx, input);
    } finally {
      revokingConversations.delete(conversation.id);
    }
  }

  async function exitWorkWithAuthorityDrain(
    input: ExitWorkInput,
  ): Promise<ExitWorkResult> {
    const conversation = getOrHydrateConversation(input.conversationId);
    if (!conversation) return exitWork(modeSwitchCtx, input);
    const taskId = conversation.activeTaskId;
    if (!taskId) return exitWork(modeSwitchCtx, input);
    if (revokingConversations.has(conversation.id)) {
      throw new EpisodeAuthorityError(
        `conversation ${conversation.id} authority mutation already in progress`,
      );
    }
    revokingConversations.add(conversation.id);
    revokingTasks.add(taskId);
    try {
      await Promise.all([
        drainEpisodeRunner(conversation.id),
        taskRunner.abortTaskEpisodes(
          taskId,
          "work-mode authority was exited by the owner",
        ),
      ]);
      return exitWork(modeSwitchCtx, input);
    } finally {
      revokingTasks.delete(taskId);
      revokingConversations.delete(conversation.id);
    }
  }

  // ── IM 渠道（飞书先行；M2′ 渠道项） ──────────────────────────
  // 渠道适配器住在 host 进程内：与 CLI 同一套产品记录（Conversation/Task/
  // Run/Approval），白名单/路由/幂等全部落 product-store（重启水合）。

  interface FeishuRuntime {
    config: FeishuChannelConfig;
    api: FeishuApiClient;
    channel: FeishuChannel;
    ws: FeishuWsClient;
  }

  const channelController: {
    feishu: FeishuRuntime | null;
    wechat: WechatRuntime | null;
    wechatBridge: WechatBridge | null;
  } = {
    feishu: null,
    wechat: null,
    wechatBridge: null,
  };
  // Legacy liveness probe kept for status fallback; product path uses WechatBridge.
  channelController.wechat = new WechatRuntime(productDataDir, hostLog);

  function ensureChannelWorkspace(id: string, name: string): string {
    const existing = workspaces.get(id);
    if (existing) return existing.id;
    // Never jail IM sessions on productDataDir (that would expose product.db /
    // profiles / tokens). Use an isolated drafts root under the data dir.
    const imRoot = path.join(productDataDir, "drafts", "im", name);
    try {
      fs.mkdirSync(imRoot, { recursive: true });
    } catch {
      /* best-effort */
    }
    const timestamp = Date.now();
    const workspace: Workspace = {
      schemaVersion: SCHEMA_VERSION,
      id,
      rootPath: imRoot,
      name,
      trust: { mode: "project", extraReadRoots: [], extraWriteRoots: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    workspaces.set(id, workspace);
    return id;
  }

  function ensureWechatConversation(input: {
    channel: "wechat";
    chatId: string;
    channelUserId: string;
    title: string;
  }): Conversation {
    const route = productStore.getChannelRoute("wechat", input.chatId);
    if (route) {
      const existing = getOrHydrateConversation(route.conversationId);
      if (existing) return existing;
    }
    const workspaceId = ensureChannelWorkspace("ws_wechat", "wechat");
    let profileId: string | null = null;
    for (const profile of profiles.values()) {
      const key =
        customApiKeys.get(profile.id) ??
        (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : "");
      if (key.trim()) {
        profileId = profile.id;
        break;
      }
    }
    if (!profileId) {
      profileId = profiles.values().next().value?.id ?? "default";
    }
    const conversation: Conversation = {
      schemaVersion: SCHEMA_VERSION,
      id: `conv_wx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      workspaceId,
      title: input.title,
      status: "idle",
      modelProfileId: profileId,
      mode: "chat",
      activeTaskId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      endedAt: null,
    };
    conversations.set(conversation.id, conversation);
    saveConversationMeta(productDataDir, conversation);
    productStore.upsertChannelRoute("wechat", input.chatId, {
      conversationId: conversation.id,
      defaultProjectId: null,
    });
    return conversation;
  }

  channelController.wechatBridge = new WechatBridge({
    dataDir: productDataDir,
    store: productStore,
    conversationExecutor,
    ensureConversation: ensureWechatConversation,
    resolveDefaultProfileId: () => {
      for (const profile of profiles.values()) {
        const key =
          customApiKeys.get(profile.id) ??
          (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : "");
        if (key.trim()) return profile.id;
      }
      return profiles.values().next().value?.id ?? null;
    },
    log: hostLog,
    publish: broadcast,
  });

  /** 渠道会话的锚定工作区（内存态；rootPath = 数据目录 = 助理自身地盘）。 */
  function ensureFeishuWorkspace(): string {
    const existing = workspaces.get("ws_feishu");
    if (existing) return existing.id;
    const imRoot = path.join(productDataDir, "drafts", "im", "feishu");
    try {
      fs.mkdirSync(imRoot, { recursive: true });
    } catch {
      /* best-effort */
    }
    const timestamp = Date.now();
    const workspace: Workspace = {
      schemaVersion: SCHEMA_VERSION,
      id: "ws_feishu",
      rootPath: imRoot,
      name: "feishu",
      trust: { mode: "project", extraReadRoots: [], extraWriteRoots: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    workspaces.set(workspace.id, workspace);
    return workspace.id;
  }

  async function startFeishuChannel(config: FeishuChannelConfig): Promise<string> {
    await stopFeishuChannel();
    const api = new FeishuApiClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain,
    });
    const channel = new FeishuChannel({
      api,
      host: {
        store: productStore,
        conversationExecutor,
        taskRunner,
        approvals: approvalService,
        modeSwitch: modeSwitchCtx,
        confirmWorkWithAuthorityDrain,
        exitWorkWithAuthorityDrain,
        conversations,
        workspaces,
        profiles,
        resolveApiKey: (profile) =>
          customApiKeys.get(profile.id) ??
          (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : ""),
        subscribe: subscribeEvents,
        getOrHydrateConversation,
        workspaceId: ensureFeishuWorkspace(),
        log: hostLog,
      },
    });
    channel.attach();
    const ws = new FeishuWsClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain,
      onEvent: (envelope) => channel.handleEvent(envelope),
      onCardAction: (envelope) => channel.handleCardAction(envelope),
      onStateChange: (state) => hostLog(`feishu ws state -> ${state}`),
      log: (line) => hostLog(`[feishu-ws] ${line}`),
    });
    channelController.feishu = { config, api, channel, ws };
    await ws.start();
    return ws.getState();
  }

  async function stopFeishuChannel(): Promise<void> {
    const runtime = channelController.feishu;
    if (!runtime) return;
    channelController.feishu = null;
    runtime.channel.detach();
    await runtime.ws.stop();
  }

  // 开机自启：channels.json（0600）配好且 enabled 即起连（env 可覆盖密钥）。
  const bootChannelConfig = resolveChannelConfig(productDataDir);
  if (bootChannelConfig?.enabled) {
    void startFeishuChannel(bootChannelConfig)
      .then((state) => hostLog(`feishu channel started (ws ${state})`))
      .catch((error) =>
        hostLog(
          `feishu channel start failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }
  // WeChat: auto-start message bridge when a token is already on disk.
  if (loadWechatToken(productDataDir)) {
    try {
      channelController.wechatBridge?.start();
    } catch (error) {
      hostLog(
        `wechat bridge start failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const companionPrompt = (source: CompanionSource): string => {
    const opportunity: Record<CompanionSource, string> = {
      morning: "现在是晨间陪伴机会：结合最近对话，只在确有帮助时给一个轻量开场或今天第一步。",
      evening: "现在是晚间陪伴机会：结合最近对话，只在确有未闭环事项或情绪承接时轻声询问。",
      emotion: "本地 SenseVoice 刚观察到负面情绪信号。不要诊断，不要说教；用一两句温和承接，并给用户选择是否继续。",
      free: "这是一次空闲陪伴机会。先判断最近上下文中是否真的有值得主动提起的事情。",
      weather: "这是用户明确触发的天气关怀机会。没有实时天气证据时不得编造天气，只能询问是否需要查询或提醒。",
    };
    return [
      "[Penglai 主动陪伴内部事件；不是用户发言]",
      opportunity[source],
      "严格护栏：不调用工具、不改文件、不替用户做决定、不制造紧迫感；回复不超过 100 个中文字符。",
      "如果没有足够上下文或此刻不值得打扰，只输出 [SILENT]。",
    ].join("\n");
  };

  const resolveCompanionConversation = (): Conversation | null => {
    const configured = companion.status().conversationId;
    if (configured) {
      const conversation = getOrHydrateConversation(configured);
      if (conversation) return conversation;
    }
    const routed = [
      ...productStore.listChannelRoutes("feishu"),
      ...productStore.listChannelRoutes("wechat"),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const route of routed) {
      const conversation = getOrHydrateConversation(route.conversationId);
      if (conversation) return conversation;
    }
    const available = [
      ...conversations.values(),
      ...listConversationIndex()
        .map((entry) => getOrHydrateConversation(entry.id))
        .filter((entry): entry is Conversation => entry !== null),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
    return available[0] ?? null;
  };

  const deliverCompanionText = async (
    conversationId: string,
    text: string,
  ): Promise<{ channel: string | null; chatId: string | null }> => {
    const routes = [
      ...productStore.listChannelRoutes("feishu"),
      ...productStore.listChannelRoutes("wechat"),
    ]
      .filter((route) => route.conversationId === conversationId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const route = routes[0];
    if (!route) return { channel: null, chatId: null };
    if (route.channel === "feishu" && channelController.feishu) {
      await channelController.feishu.channel.sendProactiveText(route.chatId, text);
      return { channel: "feishu", chatId: route.chatId };
    }
    if (route.channel === "wechat" && channelController.wechatBridge) {
      await channelController.wechatBridge.sendProactiveText(route.chatId, text);
      return { channel: "wechat", chatId: route.chatId };
    }
    return { channel: null, chatId: null };
  };

  const resolveArtifactFile = (params: Record<string, unknown>) => {
    const taskId = reqStr(params, "taskId");
    const evidenceId = reqStr(params, "evidenceId");
    const bundle = productStore.getTaskBundle(taskId);
    if (!bundle) throw new RpcError(-32000, `unknown taskId: ${taskId}`, { code: "task_not_found" });
    const evidence = bundle.evidence.find((row) => row.id === evidenceId && row.kind === "artifact");
    if (!evidence?.uri) throw new RpcError(-32000, "artifact evidence has no file URI", { code: "invalid_params" });
    const project = productStore.getProject(bundle.task.projectId);
    if (!project) throw new RpcError(-32000, "artifact project is unavailable", { code: "project_not_found" });
    const root = fs.realpathSync(project.rootPath);
    const candidate = path.isAbsolute(evidence.uri) ? evidence.uri : path.resolve(root, evidence.uri);
    const target = fs.realpathSync(candidate);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new RpcError(-32000, "artifact is outside its project workspace", { code: "l4_denied" });
    }
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) {
      throw new RpcError(-32000, "artifact is not a regular file or exceeds 100 MB", { code: "invalid_params" });
    }
    return { evidence, project, root, target, stat };
  };

  const runCompanionOpportunity = async (source: CompanionSource): Promise<void> => {
    const conversation = resolveCompanionConversation();
    if (!conversation) {
      hostLog(`companion ${source}: no conversation target`);
      return;
    }
    if (conversationExecutor.isBusy(conversation.id)) {
      hostLog(`companion ${source}: conversation busy; deferred without interruption`);
      return;
    }
    const result = await conversationExecutor.prompt({
      conversationId: conversation.id,
      text: companionPrompt(source),
      permissionMode: "plan",
      thinkingLevel: "low",
      requireNewEpisode: true,
      recordUserMessage: false,
      delivery: "queue",
    });
    const text = result.text.trim();
    if (!text || /^\[SILENT\][.!。！]?$/i.test(text)) {
      broadcast("companion", {
        event: "companion.silent",
        source,
        conversationId: conversation.id,
      });
      return;
    }
    const delivery = await deliverCompanionText(conversation.id, text);
    broadcast("companion", {
      event: "companion.message",
      source,
      conversationId: conversation.id,
      text,
      ...delivery,
    });
  };

  companion.start(runCompanionOpportunity);

  const methods: Record<string, RpcHandler> = {
    // ── 0.4 product model ─────────────────────────────────────
    "project.create": (params) => {
      const rootPath = reqStr(params, "rootPath");
      const resolved = path.resolve(rootPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new RpcError(-32000, `project root does not exist: ${resolved}`, {
          code: "workspace_required",
        });
      }
      const realRoot = fs.realpathSync(resolved);
      const existing = productStore.getProjectByRootPath(realRoot);
      if (existing) return existing;
      return productStore.createProject({
        name: optStr(params, "name") ?? (path.basename(realRoot) || "Project"),
        rootPath: realRoot,
        repositoryUrl: optStr(params, "repositoryUrl"),
        repositoryBranch: optStr(params, "repositoryBranch"),
        // Folder selection establishes a binding, not code-execution trust.
        // Trust requires the separate project.trust path confirmation.
        trusted: false,
        defaultModelProfileId: optStr(params, "defaultModelProfileId"),
      });
    },

    "project.list": (params) => productStore.listProjects(params.includeArchived === true),

    "project.get": (params) => {
      const projectId = reqStr(params, "projectId");
      const project = productStore.getProject(projectId);
      if (!project) {
        throw new RpcError(-32000, `unknown projectId: ${projectId}`, {
          code: "project_not_found",
        });
      }
      return { project, tasks: productStore.listTasks(projectId) };
    },

    "project.trust": (params) => {
      const projectId = reqStr(params, "projectId");
      const confirmedRootPath = fs.realpathSync(reqStr(params, "confirmedRootPath"));
      const project = productStore.getProject(projectId);
      if (!project) {
        throw new RpcError(-32000, `unknown projectId: ${projectId}`, {
          code: "project_not_found",
        });
      }
      if (confirmedRootPath !== fs.realpathSync(project.rootPath)) {
        throw new RpcError(-32602, "confirmed project path does not match");
      }
      return productStore.setProjectTrusted(projectId, true);
    },

    "project.untrust": async (params) => {
      const projectId = reqStr(params, "projectId");
      const project = productStore.getProject(projectId);
      if (!project) {
        throw new RpcError(-32000, `unknown projectId: ${projectId}`, {
          code: "project_not_found",
        });
      }
      if (revokingProjects.has(projectId)) {
        throw new RpcError(-32000, "project authority mutation already in progress", {
          code: "authority_changed",
        });
      }
      revokingProjects.add(projectId);
      try {
        await Promise.all([
          abortProjectConversationEpisodes(projectId),
          taskRunner.abortProjectEpisodes(
            projectId,
            "project trust was revoked by the owner",
          ),
        ]);
        return productStore.setProjectTrusted(projectId, false);
      } finally {
        revokingProjects.delete(projectId);
      }
    },

    "task.create": (params) =>
      productStore.createTask({
        projectId: reqStr(params, "projectId"),
        title: reqStr(params, "title"),
        objective: reqStr(params, "objective"),
        acceptanceCriteria: optStringArray(params, "acceptanceCriteria"),
        sourceChannel: reqEnum(
          params,
          "sourceChannel",
          ["desktop", "feishu", "wechat", "schedule", "api"] as const,
          "desktop",
        ),
      }),

    "task.list": (params) => productStore.listTasks(reqStr(params, "projectId")),

    "task.get": (params) => {
      const taskId = reqStr(params, "taskId");
      const bundle = productStore.getTaskBundle(taskId);
      if (!bundle) {
        throw new RpcError(-32000, `unknown taskId: ${taskId}`, {
          code: "task_not_found",
        });
      }
      return bundle;
    },

    "artifact.resolve": (params) => {
      const { evidence, target, stat } = resolveArtifactFile(params);
      return { path: target, name: path.basename(target), bytes: stat.size, sha256: evidence.sha256 ?? null };
    },

    "artifact.preview": async (params) => {
      const { root, target } = resolveArtifactFile(params);
      try {
        return await previewArtifactFile(
          root,
          target,
          optPositiveNumber(params, "maxChars") ?? 80_000,
        );
      } catch (error) {
        throw new RpcError(
          -32000,
          error instanceof Error ? error.message : String(error),
          { code: "preview_unavailable" },
        );
      }
    },

    "task.start": async (params) => {
      const taskId = reqStr(params, "taskId");
      const task = productStore.getTask(taskId);
      if (!task) {
        throw new RpcError(-32000, `unknown taskId: ${taskId}`, {
          code: "task_not_found",
        });
      }
      const project = productStore.getProject(task.projectId);
      if (!project) {
        throw new RpcError(-32000, `project missing for task: ${taskId}`, {
          code: "project_not_found",
        });
      }
      const modelProfileId =
        optStr(params, "modelProfileId") ??
        project.defaultModelProfileId ??
        "";
      const profile = profiles.get(modelProfileId);
      if (!profile) {
        throw new RpcError(-32000, "select a valid model profile before starting", {
          code: "model_error",
        });
      }
      const source = reqEnum(
        params,
        "source",
        ["desktop", "cli", "feishu", "wechat", "scheduler", "system"] as const,
        "desktop",
      );
      // M2′：飞书渠道毕业——jail + 审批四级制就是隔离边界，IM 源任务在
      // 项目 jail 内跑全约束。wechat/scheduler/system 等无人值守源仍关闭。
      if (source !== "desktop" && source !== "cli" && source !== "feishu") {
        throw new RpcError(
          -32000,
          "unattended execution (wechat/scheduler) remains disabled until the isolation boundary is active",
          { code: "isolation_required" },
        );
      }
      const taskBudget = optRecord(params, "budget");
      return taskRunner.start({
        task,
        project,
        profile,
        apiKey:
          customApiKeys.get(profile.id) ??
          (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : ""),
        source,
        mode: "work",
        conversationId: optStr(params, "conversationId"),
        budget: taskBudget
          ? {
              maxDurationMs: optPositiveNumber(taskBudget, "maxDurationMs"),
              maxTokens: optPositiveNumber(taskBudget, "maxTokens"),
              maxToolFailures: optPositiveNumber(taskBudget, "maxToolFailures"),
              maxTurns: optPositiveNumber(taskBudget, "maxTurns"),
            }
          : undefined,
      });
    },

    "task.abort": async (params) => ({
      ok: await taskRunner.abort(reqStr(params, "runId")),
    }),

    "task.pause": async (params) => {
      const taskId = reqStr(params, "taskId");
      const runId = taskRunner.activeRunForTask(taskId);
      if (!runId) {
        return { ok: true, paused: false, message: "no active run for this task" };
      }
      return { ok: true, paused: await taskRunner.pause(runId), runId };
    },

    "task.cancel": async (params) => {
      const taskId = reqStr(params, "taskId");
      // 覆盖执行中的 run 与停在前置审批门的 run（预算熔断降级态）。
      const activeRunId =
        taskRunner.activeRunForTask(taskId) ?? taskRunner.pendingRunForTask(taskId);
      if (activeRunId) {
        return {
          ok: true,
          cancelled: await taskRunner.abort(activeRunId),
          runId: activeRunId,
        };
      }
      // No live episode: cancel the latest non-terminal run (e.g. paused).
      const bundle = productStore.getTaskBundle(taskId);
      if (!bundle) {
        throw new RpcError(-32000, `unknown taskId: ${taskId}`, {
          code: "task_not_found",
        });
      }
      const lastRun = bundle.runs.at(-1);
      if (lastRun && !["completed", "failed", "cancelled"].includes(lastRun.status)) {
        const run = productStore.transitionRun(
          lastRun.id,
          "cancelled",
          "Cancelled by owner",
        );
        broadcast(taskId, {
          event: "task.run.cancelled",
          taskId,
          runId: run.id,
        });
        return { ok: true, cancelled: true, runId: run.id };
      }
      return { ok: true, cancelled: false, message: "task has no cancellable run" };
    },

    "task.steer": async (params) => {
      await taskRunner.steer(reqStr(params, "runId"), reqStr(params, "text"));
      return { ok: true };
    },

    "task.followUp": async (params) => {
      await taskRunner.followUp(reqStr(params, "runId"), reqStr(params, "text"));
      return { ok: true };
    },

    "run.create": (params) => {
      const budget = optRecord(params, "budget");
      return productStore.createRun({
        taskId: reqStr(params, "taskId"),
        modelProfileId: reqStr(params, "modelProfileId"),
        budget: budget
          ? {
              maxDurationMs: optPositiveNumber(budget, "maxDurationMs"),
              maxTokens: optPositiveNumber(budget, "maxTokens"),
              maxToolFailures: optPositiveNumber(budget, "maxToolFailures"),
              maxTurns: optPositiveNumber(budget, "maxTurns"),
            }
          : undefined,
      });
    },

    "run.transition": (params) =>
      productStore.transitionRun(
        reqStr(params, "runId"),
        reqEnum(
          params,
          "status",
          [
            "queued",
            "running",
            "paused",
            "waiting_approval",
            "blocked",
            "completed",
            "failed",
            "cancelled",
          ] as const,
        ),
        optStr(params, "error"),
      ),

    "step.create": (params) =>
      productStore.createStep({
        runId: reqStr(params, "runId"),
        title: reqStr(params, "title"),
        summary: optStr(params, "summary") ?? "",
      }),

    "step.transition": (params) =>
      productStore.transitionStep(
        reqStr(params, "stepId"),
        reqEnum(
          params,
          "status",
          ["pending", "running", "completed", "failed", "skipped", "blocked"] as const,
        ),
        optStr(params, "summary") ?? undefined,
      ),

    "evidence.add": (params) =>
      productStore.addEvidence({
        taskId: reqStr(params, "taskId"),
        runId: optStr(params, "runId"),
        stepId: optStr(params, "stepId"),
        kind: reqEnum(
          params,
          "kind",
          [
            "diff",
            "command",
            "test",
            "artifact",
            "screenshot",
            "file",
            "source",
            "external_response",
            "log",
          ] as const,
        ),
        title: reqStr(params, "title"),
        summary: optStr(params, "summary") ?? "",
        uri: optStr(params, "uri"),
        sha256: optStr(params, "sha256"),
        metadata: optRecord(params, "metadata") ?? {},
      }),

    "approval.request": (params) =>
      productStore.requestApproval({
        taskId: reqStr(params, "taskId"),
        runId: optStr(params, "runId"),
        capability: reqStr(params, "capability"),
        action: reqStr(params, "action"),
        reason: reqStr(params, "reason"),
        requestedBy: reqStr(params, "requestedBy"),
      }),

    /**
     * 审批四级制 RPC surface. The kernel gate creates requests itself; thin
     * clients (CLI first) list and decide them here. approve/reject resume
     * the paused run (waiting_approval → running) and resolve the held
     * tool call; L2 approve may persist a per-project 同类免问 grant.
     */
    "approval.list": (params) =>
      approvalService.list({
        status: reqEnum(params, "status", ["pending", "all"] as const, "pending"),
        projectId: optStr(params, "projectId") ?? undefined,
      }),

    "approval.approve": (params) =>
      approvalService.approve({
        approvalId: reqStr(params, "approvalId"),
        decidedBy: reqStr(params, "decidedBy"),
        note: optStr(params, "note"),
        remember: params.remember === true,
      }),

    "approval.reject": (params) =>
      approvalService.reject({
        approvalId: reqStr(params, "approvalId"),
        decidedBy: reqStr(params, "decidedBy"),
        note: optStr(params, "note"),
      }),

    // Conversation-path approvals (chat surface one-click cards).
    "conversation.approval.list": (params) =>
      conversationApprovals.list({
        conversationId: optStr(params, "conversationId") ?? undefined,
        status: reqEnum(params, "status", ["pending", "all"] as const, "pending"),
      }),
    "conversation.approval.approve": (params) => {
      const approvalId = reqStr(params, "approvalId");
      // Approvals raised by the new EpisodeRunner resolve through it; its
      // ids are not registered in the legacy ConversationApprovalService.
      // Try the runner first, then fall back to the legacy service.
      const note = optStr(params, "note");
      const remember = params.rememberSession === true || params.remember === "session";
      const handled = episodeRunner.resolveApproval(approvalId, {
        approved: true,
        note: note ?? "approved",
        remember,
      });
      if (handled) return { ok: true, runner: "episode" };
      return conversationApprovals.approve({
        approvalId,
        decidedBy: reqStr(params, "decidedBy"),
        note,
        // Grok-style: allow for this conversation (session grant) on L2.
        rememberSession: remember,
      });
    },
    "conversation.approval.reject": (params) => {
      const approvalId = reqStr(params, "approvalId");
      const note = optStr(params, "note");
      const handled = episodeRunner.resolveApproval(approvalId, {
        approved: false,
        note: note ?? "denied",
      });
      if (handled) return { ok: true, runner: "episode" };
      return conversationApprovals.reject({
        approvalId,
        decidedBy: reqStr(params, "decidedBy"),
        note,
      });
    },

    // Legacy spelling, routed through the same service so old callers also
    // resume paused runs and resolve gates.
    "approval.decide": (params) => {
      const status = reqEnum(params, "status", ["approved", "denied"] as const);
      const input = {
        approvalId: reqStr(params, "approvalId"),
        decidedBy: reqStr(params, "decidedBy"),
        note: optStr(params, "decisionNote"),
      };
      return status === "approved"
        ? approvalService.approve(input)
        : approvalService.reject(input);
    },

    // ── workspace ──────────────────────────────────────────────
    "workspace.open": (params) => {
      const rootPath = reqStr(params, "rootPath");
      const name = optStr(params, "name") ?? (path.basename(path.resolve(rootPath)) || "workspace");
      const resolved = path.resolve(rootPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new RpcError(-32000, `workspace root is not an existing directory: ${resolved}`, { code: "workspace_required" });
      }
      let realRoot: string;
      try {
        realRoot = fs.realpathSync(resolved);
      } catch {
        realRoot = resolved;
      }
      const ws: Workspace = {
        schemaVersion: SCHEMA_VERSION,
        id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        rootPath: realRoot,
        name,
        trust: { mode: "project", extraReadRoots: [], extraWriteRoots: [] },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      workspaces.set(ws.id, ws);
      return { id: ws.id, rootPath: ws.rootPath, name: ws.name };
    },

    // ── conversation ─────────────────────────────────────────────
    "conversation.update": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      let next = { ...conversation, updatedAt: Date.now() };
      const title = optStr(params, "title");
      if (title !== null && title !== undefined) next = { ...next, title };
      const modelProfileId = optStr(params, "modelProfileId");
      if (modelProfileId) {
        if (!profiles.has(modelProfileId)) {
          throw new RpcError(-32000, `unknown modelProfileId: ${modelProfileId}`, {
            code: "model_error",
          });
        }
        next = { ...next, modelProfileId };
      }
      const requestedStatus = optStr(params, "status");
      if (requestedStatus) {
        if (requestedStatus !== "archived" && requestedStatus !== "idle") {
          throw new RpcError(-32602, "conversation.update status must be archived or idle");
        }
        if (conversationExecutor.isBusy(conversationId)) {
          throw new RpcError(-32000, "cannot archive or restore a busy conversation", { code: "conversation_busy" });
        }
        next = {
          ...next,
          status: requestedStatus,
          endedAt: requestedStatus === "archived" ? Date.now() : null,
        };
      }
      conversations.set(next.id, next);
      saveConversationMeta(productDataDir, next);
      return next;
    },

    "conversation.create": (params) => {
      const workspaceId = reqStr(params, "workspaceId");
      const workspace = workspaces.get(workspaceId);
      if (!workspace) {
        throw new RpcError(-32000, `unknown workspaceId: ${workspaceId}`, { code: "workspace_required" });
      }
      const modelProfileId = reqStr(params, "modelProfileId");
      if (!profiles.has(modelProfileId)) {
        throw new RpcError(-32000, `unknown modelProfileId: ${modelProfileId}`, { code: "model_error" });
      }
      const title = optStr(params, "title") ?? "新对话";
      // 协议不变量：work ⇔ activeTaskId != null（index.ts 声明）。mode 只能由
      // mode.confirmWork 派生（它在 Owner 精确确认后锚定任务），create 恒置 chat——拒绝
      // mode:"work" + activeTaskId:null 的非法一致态。
      if (params.mode !== undefined && params.mode !== "chat") {
        throw new RpcError(
          -32000,
          `mode is derived from the task anchor; create conversations as 'chat', then use mode.proposeWork + mode.confirmWork`,
          { code: "invalid_params" },
        );
      }
      const mode: "chat" = "chat";
      const conversation: Conversation = {
        schemaVersion: SCHEMA_VERSION,
        id: `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        title,
        status: "idle",
        modelProfileId,
        mode,
        activeTaskId: null,
        goal: null,
        contextPins: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        endedAt: null,
      };
      conversations.set(conversation.id, conversation);
      saveConversationMeta(productDataDir, conversation);
      return conversation;
    },

    "conversation.list": () => {
      const out: Conversation[] = [];
      const seen = new Set<string>();
      for (const c of conversations.values()) {
        out.push(c);
        seen.add(c.id);
      }
      // Prefer meta index — never full-scan transcripts for the sidebar.
      for (const meta of listConversationIndex()) {
        if (seen.has(meta.id)) continue;
        const row = conversationFromDisk(meta.id);
        if (row) {
          out.push(row);
          seen.add(meta.id);
        }
      }
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return out;
    },

    "conversation.get": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, { code: "conversation_not_found" });
      }
      const messages = loadMessages(conversationId);
      return { conversation, messages };
    },

    "conversation.attachment.import": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, { code: "conversation_not_found" });
      const workspace = workspaces.get(conversation.workspaceId);
      if (!workspace) throw new RpcError(-32000, "conversation workspace is unavailable", { code: "workspace_required" });
      const sourceInput = reqStr(params, "sourcePath");
      const source = path.resolve(sourceInput);
      const sourceStat = fs.lstatSync(source);
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new RpcError(-32000, "attachment must be a regular non-symlink file", { code: "invalid_params" });
      }
      if (sourceStat.size > 25 * 1024 * 1024) {
        throw new RpcError(-32000, "attachment exceeds 25 MB", { code: "invalid_params" });
      }
      const extension = path.extname(source).toLowerCase();
      const allowed = new Set([".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".rtf", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);
      if (!allowed.has(extension)) throw new RpcError(-32000, `unsupported attachment format: ${extension || "(none)"}`, { code: "invalid_params" });
      if (source.split(/[\\/]+/).some((segment) => [".ssh", ".gnupg", ".aws", ".env", "credentials"].includes(segment.toLowerCase()))) {
        throw new RpcError(-32000, "sensitive paths cannot be imported as attachments", { code: "l4_denied" });
      }
      const root = fs.realpathSync(workspace.rootPath);
      const inbox = path.join(root, ".penglai", "inbox", conversationId);
      fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
      const rawBase = path.basename(source).replace(/[^A-Za-z0-9._\-\u4e00-\u9fff]/g, "_").slice(0, 120) || `attachment${extension}`;
      const stem = path.basename(rawBase, path.extname(rawBase));
      const suffix = path.extname(rawBase) || extension;
      let target = path.join(inbox, `${stem}${suffix}`);
      for (let index = 2; fs.existsSync(target); index += 1) target = path.join(inbox, `${stem}-${index}${suffix}`);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o600);
      const bytes = fs.readFileSync(target);
      const relativePath = path.relative(root, target).split(path.sep).join("/");
      return {
        path: target,
        relativePath,
        name: path.basename(target),
        bytes: bytes.byteLength,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      };
    },

    "conversation.prompt": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      const permissionRaw = optStr(params, "permissionMode") ?? "auto_edit";
      const permissionMode =
        permissionRaw === "confirm" ||
        permissionRaw === "auto_edit" ||
        permissionRaw === "full" ||
        permissionRaw === "plan"
          ? permissionRaw
          : "auto_edit";
      const deliveryRaw = optStr(params, "delivery") ?? "queue";
      const thinkingRaw = optStr(params, "thinkingLevel") ?? "medium";
      const thinkingLevel =
        thinkingRaw === "off" ||
        thinkingRaw === "minimal" ||
        thinkingRaw === "low" ||
        thinkingRaw === "medium" ||
        thinkingRaw === "high" ||
        thinkingRaw === "xhigh" ||
        thinkingRaw === "max"
          ? thinkingRaw
          : "medium";
      return promptConversation({
        conversationId,
        text: typeof params.text === "string" ? params.text : "",
        permissionMode,
        thinkingLevel,
        delivery: deliveryRaw === "now" ? "now" : "queue",
        images: Array.isArray(params.images)
          ? (params.images as Array<Record<string, unknown>>).map((row) => ({
              data: typeof row?.data === "string" ? row.data : "",
              mimeType: typeof row?.mimeType === "string" ? row.mimeType : "",
              name: typeof row?.name === "string" ? row.name : undefined,
            }))
          : undefined,
      });
    },

    // Low-level two-phase EpisodeRunner API used by advanced clients.
    "agent.submit": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      if (!getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const text = typeof params.text === "string" ? params.text : "";
      const deliveryRaw = optStr(params, "delivery") ?? "steer";
      const delivery =
        deliveryRaw === "interrupt" ||
        deliveryRaw === "followup" ||
        deliveryRaw === "scheduled"
          ? deliveryRaw
          : "steer";
      const permRaw = optStr(params, "permissionMode") ?? "auto_edit";
      const permissionMode =
        permRaw === "confirm" ||
        permRaw === "auto_edit" ||
        permRaw === "full" ||
        permRaw === "plan"
          ? permRaw
          : "auto_edit";
      const thinkingRaw = optStr(params, "thinkingLevel");
      const thinkingLevel =
        thinkingRaw === "off" || thinkingRaw === "minimal" || thinkingRaw === "low" ||
        thinkingRaw === "medium" || thinkingRaw === "high" || thinkingRaw === "xhigh" ||
        thinkingRaw === "max"
          ? thinkingRaw
          : undefined;
      // Images: same mime allowlist / 4 MiB cap / jpg→jpeg normalization as
      // EpisodeRunner. Image-only prompts get a Chinese fallback prompt so the
      // model has a user turn to anchor the vision request.
      const images = sanitizeImages(
        Array.isArray(params.images)
          ? (params.images as Array<Record<string, unknown>>).map((row) => ({
              data: typeof row?.data === "string" ? row.data : "",
              mimeType: typeof row?.mimeType === "string" ? row.mimeType : "",
              name: typeof row?.name === "string" ? row.name : undefined,
            }))
          : undefined,
      );
      const trimmedText = text.trim();
      // Image-only prompts get a Chinese fallback anchor; otherwise require text.
      const promptText = trimmedText
        ? trimmedText
        : images.length > 0
          ? imageOnlyPrompt(images.length)
          : "";
      if (!promptText) {
        throw new RpcError(-32602, "invalid params: 'text' or 'images' required");
      }
      // Cost day-breaker: refuse before any token is spent, mirroring
      // The conversation budget gate. A project-anchored conversation also
      // passes the project daily gate.
      const { projectId } = resolveEpisodeAnchor(conversationId);
      const gate = budgetService.gateForChat(projectId || null);
      if (gate.tripped) {
        throw new RpcError(-32000, gate.message, { code: "budget_exceeded" });
      }
      // Persist the user beat before the kernel runs.
      if (promptText.trim()) {
        const userMessage = {
          id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          conversationId,
          role: "user" as const,
          createdAt: Date.now(),
          content: [
            { type: "text" as const, text: promptText },
            ...images.map((img) => ({
              type: "image" as const,
              data: img.data,
              mimeType: img.mimeType,
              name: img.name,
            })),
          ],
        };
        saveMessage(conversationId, userMessage);
        broadcast(conversationId, {
          event: "conversation.message.user",
          conversationId,
          message: userMessage,
        });
      }
      const runId =
        `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      // Auto-title from the owner's actual words, not the image fallback.
      runPrompts.set(runId, text);
      episodeRunner.submit(conversationId, {
        text: promptText,
        delivery,
        permissionMode,
        thinkingLevel,
        images: images.length > 0 ? images : undefined,
        runId,
      });
      return { runId };
    },
    "agent.interrupt": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      return { interrupted: episodeRunner.interrupt(conversationId) };
    },
    "agent.resolveApproval": async (params) => {
      const approvalId = reqStr(params, "approvalId");
      const approved = params.approved !== false;
      const note = optStr(params, "note") ?? (approved ? "approved" : "denied");
      const ok = episodeRunner.resolveApproval(approvalId, {
        approved,
        note,
        remember: params.remember === true,
      });
      return { ok };
    },
    "agent.active": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      return { active: episodeRunner.active(conversationId) };
    },

    "conversation.compact": async (params) => {
      // Explicit compact (ZCode session/compact). Active episode uses Pi harness;
      // otherwise deferred — auto-compact still runs near the window on next prompt.
      const conversationId = reqStr(params, "conversationId");
      if (!getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const instructions = optStr(params, "instructions") ?? undefined;
      const result = await conversationExecutor.compact(conversationId, instructions);
      return {
        ok: result.ok,
        deferred: result.deferred,
        detail: result.detail ?? null,
        note: result.deferred
          ? "no active episode; compaction runs automatically before the next prompt when near the model context window"
          : result.ok
            ? "session compacted"
            : result.detail ?? "compact failed",
      };
    },

    "conversation.goal.set": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      const goalText = reqStr(params, "goal").trim();
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      if (!goalText) {
        throw new RpcError(-32602, "invalid params: 'goal' must be a non-empty string");
      }
      const kick = params.kick === true;
      if (kick && conversationExecutor.isBusy(conversationId)) {
        throw new RpcError(-32000, "conversation has an active episode; wait before starting a permission-isolated goal plan", {
          code: "conversation_busy",
        });
      }
      const activeGoal = setActiveGoal({ conversationId, objective: goalText });
      const next: Conversation = {
        ...conversation,
        goal: mirrorGoalText(activeGoal),
        activeGoal,
        updatedAt: Date.now(),
      };
      conversations.set(next.id, next);
      saveConversationMeta(productDataDir, next);
      broadcast(conversationId, {
        event: "conversation.goal.updated",
        conversationId,
        goal: next.goal,
        activeGoal,
      });
      let kickResult: unknown = null;
      if (kick) {
        kickResult = await conversationExecutor.prompt({
          conversationId,
          text:
            `【目标模式已开启】ACTIVE GOAL:
${goalText}

` +
            `请先做研究与拆解：给出可执行计划（步骤、风险、需要的文件/技能）。` +
            `把计划交给主人；不要改变目标状态，也不要改写工作区。`,
          permissionMode: "plan",
          thinkingLevel: "medium",
          requireNewEpisode: true,
          delivery: "queue",
        });
      }
      return {
        conversation: next,
        goal: next.goal,
        activeGoal,
        suggestedPermissionMode: "plan" as const,
        kick: kick ? kickResult : null,
      };
    },

    "conversation.goal.clear": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const cleared = clearGoal(conversationId);
      const next: Conversation = {
        ...conversation,
        goal: null,
        activeGoal: null,
        updatedAt: Date.now(),
      };
      conversations.set(next.id, next);
      saveConversationMeta(productDataDir, next);
      broadcast(conversationId, {
        event: "conversation.goal.updated",
        conversationId,
        goal: null,
        activeGoal: cleared,
      });
      return { conversation: next, goal: null, activeGoal: cleared };
    },

    "conversation.goal.get": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const activeGoal =
        loadGoal(conversationId) ??
        hydrateGoal(conversationId, conversation.goal ?? null);
      return {
        conversationId: conversation.id,
        goal: mirrorGoalText(activeGoal) ?? conversation.goal ?? null,
        activeGoal,
        contextPins: conversation.contextPins ?? [],
      };
    },

    "conversation.goal.continue": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      let goal = loadGoal(conversationId);
      if (!goal) {
        throw new RpcError(-32000, "no goal on this conversation", { code: "invalid_params" });
      }
      if (conversationExecutor.isBusy(conversationId)) {
        throw new RpcError(-32000, "conversation has an active episode; wait before starting a permission-isolated goal plan", {
          code: "conversation_busy",
        });
      }
      if (goal.status === "blocked" || goal.status === "failed") {
        // Owner channel: re-activating a blocked/failed goal is the owner's
        // decision (the model cannot un-block its own budget ceiling).
        goal = updateGoalStatus({
          conversationId,
          status: "active",
          ownerUnblock: true,
        });
      }
      if (goal.status !== "active") {
        throw new RpcError(-32000, `goal is ${goal.status}, cannot continue`, {
          code: "invalid_params",
        });
      }
      const result = await conversationExecutor.prompt({
        conversationId,
        text:
          `【主人要求继续目标】ACTIVE GOAL:\n${goal.objective}\n\n` +
          `请在只读计划模式下梳理下一步并把计划交给主人；不要改变目标状态或执行修改。`,
        // A continuation request does not carry a durable, trustworthy record
        // of the owner's current dial. Fail closed instead of letting this
        // helper silently promote a plan goal to workspace writes.
        permissionMode: "plan",
        requireNewEpisode: true,
        delivery: "queue",
      });
      return { ok: true, goal, result };
    },

    "conversation.pin.add": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const kind = reqEnum(
        params,
        "kind",
        ["file", "skill", "note", "mcp", "url", "session"] as const,
        "note",
      );
      const ref = reqStr(params, "ref").trim();
      const label = (optStr(params, "label") ?? ref).trim() || ref;
      if (!ref) {
        throw new RpcError(-32602, "invalid params: 'ref' must be a non-empty string");
      }
      const pins = [...(conversation.contextPins ?? [])];
      // Dedupe same kind+ref
      const existing = pins.findIndex((p) => p.kind === kind && p.ref === ref);
      if (existing >= 0) {
        pins[existing] = { ...pins[existing], label, ref, kind };
      } else {
        pins.push({
          id: `pin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          label,
          ref,
          createdAt: Date.now(),
        });
      }
      const next: Conversation = {
        ...conversation,
        contextPins: pins,
        updatedAt: Date.now(),
      };
      conversations.set(next.id, next);
      saveConversationMeta(productDataDir, next);
      return { conversation: next, pin: pins[existing >= 0 ? existing : pins.length - 1] };
    },

    "conversation.pin.remove": (params) => {
      const conversationId = reqStr(params, "conversationId");
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const pinId = optStr(params, "pinId");
      const ref = optStr(params, "ref");
      if (!pinId && !ref) {
        throw new RpcError(-32602, "invalid params: pass pinId or ref");
      }
      const before = conversation.contextPins ?? [];
      const pins = before.filter((p) => {
        if (pinId && p.id === pinId) return false;
        if (!pinId && ref && (p.ref === ref || p.label === ref)) return false;
        return true;
      });
      const next: Conversation = {
        ...conversation,
        contextPins: pins,
        updatedAt: Date.now(),
      };
      conversations.set(next.id, next);
      saveConversationMeta(productDataDir, next);
      return { conversation: next, removed: before.length - pins.length };
    },

    // ── conversation TODO workbench ──────────────────────────────
    "conversation.workbench.get": (params) => {
      const conversationId = reqStr(params, "conversationId");
      if (!getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      return loadWorkbench(conversationId);
    },
    "conversation.todo.setAll": (params) => {
      const conversationId = reqStr(params, "conversationId");
      if (!getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      const itemsRaw = params.items;
      if (!Array.isArray(itemsRaw)) {
        throw new RpcError(-32602, "invalid params: items must be an array");
      }
      const items = itemsRaw.map((row) => {
        const r = row as Record<string, unknown>;
        const status =
          r.status === "in_progress" ||
          r.status === "completed" ||
          r.status === "cancelled" ||
          r.status === "pending"
            ? (r.status as "pending" | "in_progress" | "completed" | "cancelled")
            : ("pending" as const);
        return {
          id: typeof r.id === "string" ? r.id : undefined,
          content: String(r.content ?? ""),
          status,
        };
      });
      return setTodos(conversationId, items);
    },
    "conversation.todo.upsert": (params) => {
      const conversationId = reqStr(params, "conversationId");
      if (!getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      return upsertTodo(conversationId, {
        id: optStr(params, "id") ?? undefined,
        content: optStr(params, "content") ?? undefined,
        status: reqEnum(
          params,
          "status",
          ["pending", "in_progress", "completed", "cancelled"] as const,
          "pending",
        ),
      });
    },
    "conversation.todo.remove": (params) => {
      const conversationId = reqStr(params, "conversationId");
      if (!getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      return removeTodo(conversationId, reqStr(params, "todoId"));
    },

    // ── conversation resume (crash recovery) ─────────────────────
    "conversation.resume": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      const { messages } = await resumeConversation(conversationId);
      const conversation = getOrHydrateConversation(conversationId);
      if (!conversation) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, { code: "conversation_not_found" });
      }
      return { conversation, messages };
    },

    "conversation.abort": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      return { ok: true, aborted: await conversationExecutor.abort(conversationId) };
    },


    // ── MCP registry + manual connection (never auto-started) ──
    "mcp.list": () => {
      const servers = listMcpServers(productDataDir);
      const surface = describeBuiltinToolSurface();
      return {
        servers: servers.map(({ env, headers, ...server }) => ({
          ...server,
          envKeys: Object.keys(env ?? {}),
          headerKeys: Object.keys(headers ?? {}),
        })),
        runtimes: mcpSessions.listRuntimes(),
        tools: surface,
        mountedTools: mcpSessions.listToolDescriptors(),
        note: "MCP never auto-starts. Owner must connect manually; every mounted tool call requires a fresh L3 approval.",
      };
    },
    "mcp.upsert": (params) => upsertMcpServer({
      id: optStr(params, "id") ?? undefined,
      name: reqStr(params, "name"),
      enabled: params.enabled !== false,
      transport: reqEnum(params, "transport", ["stdio", "sse", "http"] as const),
      command: optStr(params, "command") ?? undefined,
      args: Array.isArray(params.args) ? params.args.map(String) : undefined,
      env: params.env && typeof params.env === "object" && !Array.isArray(params.env) ? params.env as Record<string, string> : undefined,
      url: optStr(params, "url") ?? undefined,
      headers: params.headers && typeof params.headers === "object" && !Array.isArray(params.headers) ? params.headers as Record<string, string> : undefined,
    }, productDataDir),
    "mcp.remove": (params) => ({ ok: removeMcpServer(reqStr(params, "id"), productDataDir) }),
    "mcp.connect": async () => ({ runtimes: await mcpSessions.refresh(productDataDir) }),
    "mcp.disconnect": () => {
      mcpSessions.dispose();
      return { ok: true };
    },
    "tools.surface": () => ({
      ...describeBuiltinToolSurface(),
      mcpMounted: mcpSessions.listToolDescriptors().map((tool) => tool.name),
      skills: [...memoryStore.listSops().map((s) => s.name), ...skillStore.list().filter((s) => s.enabled).map((s) => s.name)],
    }),

    // ── two-layer memory (design §6) ───────────────────────────
    // Reads are open. Writes obey the anti-pollution iron rules:
    //   - global layer: CLOSED channel until the M2′ distillation loop;
    //   - project layer: only while that project is genuinely anchored.
    "memory.readGlobal": (params) => {
      const name = optStr(params, "name");
      if (name) {
        return { layer: "global", name, content: memoryStore.readGlobalNote(name) };
      }
      return {
        layer: "global",
        l1: memoryStore.readGlobalL1(),
        notes: memoryStore.listGlobal(),
      };
    },

    "memory.writeGlobal": (params) =>
      memoryStore.writeGlobalNote(reqStr(params, "name"), reqStr(params, "content")),

    "memory.readProject": (params) => {
      const projectId = reqStr(params, "projectId");
      const project = productStore.getProject(projectId);
      if (!project) {
        throw new RpcError(-32000, `unknown projectId: ${projectId}`, {
          code: "project_not_found",
        });
      }
      const name = optStr(params, "name");
      if (name) {
        return {
          layer: "project",
          projectId,
          name,
          content: memoryStore.readProjectNote(project.rootPath, name),
        };
      }
      return {
        layer: "project",
        projectId,
        notes: memoryStore.listProject(project.rootPath),
      };
    },

    "memory.writeProject": (params) => {
      const projectId = reqStr(params, "projectId");
      const project = productStore.getProject(projectId);
      if (!project) {
        throw new RpcError(-32000, `unknown projectId: ${projectId}`, {
          code: "project_not_found",
        });
      }
      // Anti-pollution: derive `anchored` from the conversation's real
      // activeTaskId when a conversationId is supplied, instead of trusting a
      // caller-declared compatibility label (closes the forged-anchor bypass).
      // Without a conversationId (CLI/owner direct write) a registered project
      // is considered anchored by definition.
      const conversationId = optStr(params, "conversationId");
      let anchored = true;
      if (conversationId) {
        const conversation = getOrHydrateConversation(conversationId);
        const activeTaskId = conversation?.activeTaskId ?? null;
        const task = activeTaskId ? productStore.getTask(activeTaskId) : null;
        anchored = !!task && task.projectId === projectId;
      }
      return memoryStore.writeProjectNote(
        project.rootPath,
        reqStr(params, "name"),
        reqStr(params, "content"),
        { anchored },
      );
    },

    // ── SOP 技能树（蒸馏环产物；读/删开放，写入只走蒸馏专属通道） ──
    "memory.sopList": () => memoryStore.listSops(),

    "memory.sopShow": (params) => {
      const name = reqStr(params, "name");
      return { name, content: memoryStore.readSop(name) };
    },

    "memory.sopRemove": (params) => ({
      ok: memoryStore.removeSop(reqStr(params, "name")),
    }),

    // ── Owner-installed Agent Skills (declarative resources, no extensions) ──
    "skill.list": () => ({
      installed: skillStore.list(),
      distilled: memoryStore.listSops(),
      note: "Installed skills are declarative Pi resources. Penglai does not execute package installers, lifecycle hooks, or arbitrary TypeScript extensions.",
    }),

    "skill.inspect": (params) => {
      const name = reqStr(params, "name");
      const skill = skillStore.inspect(name);
      if (!skill) throw new RpcError(-32000, `skill not found or disabled: ${name}`, { code: "invalid_params" });
      return skill;
    },

    "skill.install": async (params) => {
      const source = reqStr(params, "source");
      const result = await skillStore.install(source);
      if (memoryStore.listSops().some((sop) => sop.name === result.name)) {
        skillStore.remove(result.name);
        throw new RpcError(-32000, `skill name collides with a distilled SOP: ${result.name}`, { code: "invalid_params" });
      }
      return result;
    },

    "skill.enable": (params) => skillStore.setEnabled(reqStr(params, "name"), params.enabled !== false),

    "skill.remove": (params) => ({ ok: skillStore.remove(reqStr(params, "name")) }),

    // ── 蒸馏环配置（复盘/审计模型档位；审计位 = 不同 provider 预留） ──
    "distill.getConfig": () => productStore.getDistillConfig(),

    "distill.setConfig": (params) => {
      const current = productStore.getDistillConfig();
      const reviewProfileId = Object.prototype.hasOwnProperty.call(params, "reviewProfileId")
        ? optStr(params, "reviewProfileId")
        : current.reviewProfileId;
      const auditProfileId = Object.prototype.hasOwnProperty.call(params, "auditProfileId")
        ? optStr(params, "auditProfileId")
        : current.auditProfileId;
      for (const profileId of [reviewProfileId, auditProfileId]) {
        if (profileId !== null && !profiles.has(profileId)) {
          throw new RpcError(-32000, `unknown modelProfileId: ${profileId}`, {
            code: "model_error",
          });
        }
      }
      // 设计 §6 铁律：审计 LLM 必须与复盘/执行模型不同 provider——同模型
      // 自审可被与被审模型相同的权重绕过。配置期强制拒绝，不留运行时缺口。
      if (
        reviewProfileId &&
        auditProfileId &&
        profiles.get(reviewProfileId)?.provider === profiles.get(auditProfileId)?.provider
      ) {
        throw new RpcError(
          -32000,
          `audit profile '${auditProfileId}' uses the same provider as review profile '${reviewProfileId}' — ` +
            `the audit LLM must be a different provider (design §6 防自审)`,
          { code: "invalid_params" },
        );
      }
      return productStore.setDistillConfig({
        enabled:
          typeof params.enabled === "boolean" ? params.enabled : current.enabled,
        reviewProfileId,
        auditProfileId,
        updatedBy: reqStr(params, "updatedBy"),
      });
    },

    // ── mode switch (deterministic loop, design §5) ────────────
    "mode.proposeWork": (params) =>
      proposeWork(modeSwitchCtx, {
        conversationId: reqStr(params, "conversationId"),
        projectId: optStr(params, "projectId"),
        rootPath: optStr(params, "rootPath"),
        // Empty objective is allowed (ZCode-like folder anchor); mode-switch fills a default.
        objective: optStr(params, "objective") ?? "",
        title: optStr(params, "title"),
        sourceChannel: reqEnum(
          params,
          "sourceChannel",
          ["desktop", "feishu", "wechat", "schedule", "api"] as const,
          "api",
        ),
      }),

    "mode.confirmWork": (params) =>
      confirmWorkWithAuthorityDrain({
        proposalId: reqStr(params, "proposalId"),
        conversationId: reqStr(params, "conversationId"),
        confirmedRootPath: reqStr(params, "confirmedRootPath"),
        confirmedBy: optStr(params, "confirmedBy") ?? "owner",
      }),

    "mode.exitWork": async (params) => {
      const conversationId = reqStr(params, "conversationId");
      return exitWorkWithAuthorityDrain({
        conversationId,
        outcome: reqEnum(
          params,
          "outcome",
          ["completed", "paused"] as const,
          "paused",
        ),
      });
    },

    "mode.get": (params) => getMode(modeSwitchCtx, reqStr(params, "conversationId")),

    // ── usage ──────────────────────────────────────────────────
    "usage.get": () => {
      // The durable ledger (product.db) is the source of truth: it aggregates
      // by (day, mode, project) and survives restarts. The in-memory counters
      // on the handle are since-boot mirrors for embedders.
      return productStore.getUsageReport();
    },

    /** ZCode-like overview: KPI + daily + byModel (model from usage-models.jsonl). */
    "usage.stats": (params) => {
      const rangeRaw = optStr(params, "range") ?? "30d";
      const range = (["7d", "30d", "all"].includes(rangeRaw) ? rangeRaw : "30d") as UsageRange;
      return buildUsageStats(productStore.getUsageReport(), productDataDir, range);
    },

    /** Jail-aware @ path complete. rootPath defaults to cwd. */
    "files.complete": (params) => {
      const rootPath = optStr(params, "rootPath") ?? process.cwd();
      return completeFiles({
        rootPath,
        query: optStr(params, "query") ?? "",
        limit: optPositiveNumber(params, "limit") ?? 30,
      });
    },

    // ── budget (成本熔断, design §7) ────────────────────────────
    // 配置落 product-store；80% 预警 / 撞线降级（task.start 前置 L3 审批、
    // chat budget_exceeded）/ owner lift 全部经 BudgetService 留痕。
    "budget.get": () => budgetService.getConfig(),

    "budget.status": () => budgetService.status(),

    "budget.set": (params) => {
      // 键存在即更新（null = 清除该维度上限）；键缺失 = 保留现状。
      const current = budgetService.getConfig();
      const daily = Object.prototype.hasOwnProperty.call(params, "dailyTokenLimit")
        ? params.dailyTokenLimit === null
          ? null
          : optPositiveNumber(params, "dailyTokenLimit") ?? null
        : current.dailyTokenLimit;
      const perProject = Object.prototype.hasOwnProperty.call(params, "projectDailyTokenLimit")
        ? params.projectDailyTokenLimit === null
          ? null
          : optPositiveNumber(params, "projectDailyTokenLimit") ?? null
        : current.projectDailyTokenLimit;
      return budgetService.setConfig({
        dailyTokenLimit: daily,
        projectDailyTokenLimit: perProject,
        updatedBy: reqStr(params, "updatedBy"),
      });
    },

    "budget.lift": (params) => ({
      lifted: budgetService.lift({
        dimension: optStr(params, "dimension") ?? "all",
        liftedBy: reqStr(params, "liftedBy"),
        note: optStr(params, "note"),
      }),
    }),

    // ── config ─────────────────────────────────────────────────
    "config.listProfiles": () => {
      // Never leak API keys: ModelProfile only carries apiKeyEnv.
      return Array.from(profiles.values());
    },

    /** Structured health report for desktop Doctor (never throws per-check). */
    "doctor.run": async () => {
      const port = Number(process.env.PENGLAI_HOST_PORT || 14169);
      const checks = await runDoctor({ port });
      const fail = checks.filter((c) => c.status === "fail").length;
      const warn = checks.filter((c) => c.status === "warn").length;
      return {
        checks,
        summary: {
          ok: fail === 0,
          fail,
          warn,
          total: checks.length,
        },
      };
    },

    /** Owner-triggered, redacted support bundle; never includes product state. */
    "doctor.export": async () => exportDiagnostics({ dataDir: productDataDir }),

    /**
     * Deterministic profile resolution for thin clients (CLI): an explicit
     * id wins; otherwise the first profile whose API key resolves in THIS
     * host process (custom key or env var) is offered. Key material itself
     * never leaves the host — only the boolean hasKey.
     */
    "config.resolveProfile": (params) => {
      const keyFor = (profile: ModelProfile): string =>
        customApiKeys.get(profile.id) ??
        (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : "");
      const preferred = optStr(params, "profileId");
      if (preferred) {
        const profile = profiles.get(preferred);
        if (!profile) {
          throw new RpcError(-32000, `unknown modelProfileId: ${preferred}`, {
            code: "model_error",
          });
        }
        return { profile, hasKey: keyFor(profile).trim() !== "" };
      }
      for (const profile of profiles.values()) {
        if (keyFor(profile).trim() !== "") return { profile, hasKey: true };
      }
      return { profile: null, hasKey: false };
    },

    "config.createProfile": (params) => {
      const baseUrl = assertSafeProviderBaseUrl(reqStr(params, "baseUrl"));
      const model = reqStr(params, "model");
      const apiKey = optStr(params, "apiKey") ?? "";
      const apiKeyEnv = optStr(params, "apiKeyEnv") ?? "";
      const label = optStr(params, "label") ?? `${model} @ ${baseUrl}`;
      const provider = optStr(params, "provider") ?? "custom";
      const id =
        optStr(params, "id") ?? `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const catalogModel = findCatalogModel(model);
      const contextWindowTokens =
        optPositiveNumber(params, "contextWindowTokens") ??
        catalogContextTokens(catalogModel);
      const maxOutputTokens =
        optPositiveNumber(params, "maxOutputTokens") ??
        catalogMaxOutputTokens(catalogModel);
      const vision =
        params.vision === true ||
        params.vision === false
          ? params.vision === true
          : (catalogModel?.features?.includes("vision") ?? false);
      const profile: ModelProfile = {
        id,
        label,
        provider,
        baseUrl,
        apiKeyEnv,
        model,
        capabilities: { tools: true, streaming: true, vision },
        contextWindowTokens,
        maxOutputTokens,
      };
      profiles.set(id, profile);
      if (apiKey) customApiKeys.set(id, apiKey);
      // Durable BYOK (design §7 安装即配模型): the profile lands in
      // <data-dir>/profiles.json (0600) so it survives host restarts. A
      // literal key is stored in the file; an apiKeyEnv entry stores only
      // the env var NAME — never the key material.
      savePersistedProfile(productDataDir, {
        id,
        label,
        provider,
        baseUrl,
        model,
        apiKeyEnv,
        ...(apiKey ? { apiKey } : {}),
        ...(typeof contextWindowTokens === "number"
          ? { contextWindowTokens }
          : {}),
        ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
        capabilities: profile.capabilities,
      });
      return profile;
    },

    /** Update profile fields (context window, vision, label, model) without re-keying. */
    "config.updateProfile": (params) => {
      const id = reqStr(params, "id");
      const existing = profiles.get(id);
      if (!existing) {
        throw new RpcError(-32000, `unknown modelProfileId: ${id}`, { code: "model_error" });
      }
      const nextModel = optStr(params, "model") ?? existing.model;
      const catalogModel = findCatalogModel(nextModel);
      const contextWindowTokens =
        params.contextWindowTokens === null
          ? null
          : optPositiveNumber(params, "contextWindowTokens") ??
            existing.contextWindowTokens ??
            catalogContextTokens(catalogModel);
      const maxOutputTokens =
        params.maxOutputTokens === null
          ? null
          : optPositiveNumber(params, "maxOutputTokens") ??
            existing.maxOutputTokens ??
            catalogMaxOutputTokens(catalogModel);
      const vision =
        params.vision === true || params.vision === false
          ? params.vision === true
          : existing.capabilities.vision;
      const baseUrl = assertSafeProviderBaseUrl(
        optStr(params, "baseUrl") ?? existing.baseUrl,
      );
      const profile: ModelProfile = {
        ...existing,
        label: optStr(params, "label") ?? existing.label,
        model: nextModel,
        baseUrl,
        provider: optStr(params, "provider") ?? existing.provider,
        capabilities: {
          tools: true,
          streaming: true,
          vision,
        },
        contextWindowTokens,
        maxOutputTokens,
      };
      profiles.set(id, profile);
      const persisted = loadPersistedProfiles(productDataDir).find((p) => p.id === id);
      savePersistedProfile(productDataDir, {
        id,
        label: profile.label,
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKeyEnv: profile.apiKeyEnv,
        ...(persisted?.apiKey ? { apiKey: persisted.apiKey } : {}),
        ...(typeof contextWindowTokens === "number"
          ? { contextWindowTokens }
          : {}),
        ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
        capabilities: profile.capabilities,
      });
      return profile;
    },

    /**
     * One-shot model smoke test (setup wizard): a single non-streaming
     * chat-completions call with a hard timeout and classified failures
     * (auth / network / endpoint / timeout). The key travels exactly one
     * hop (CLI → host) and is never logged or persisted by this call.
     */
    "config.smokeTest": async (params) => {
      const baseUrl = reqStr(params, "baseUrl");
      const model = reqStr(params, "model");
      const apiKeyEnv = optStr(params, "apiKeyEnv");
      const apiKey =
        optStr(params, "apiKey") ??
        (apiKeyEnv ? (process.env[apiKeyEnv] ?? "") : "");
      return smokeTestModel({
        baseUrl,
        model,
        apiKey,
        timeoutMs: optPositiveNumber(params, "timeoutMs") ?? 30_000,
      });
    },

    /**
     * Live model list (setup wizard): GET {baseUrl}/models on the
     * OpenAI-compatible endpoint, with a short timeout and classified
     * failures (auth / network / endpoint / timeout) so the wizard can
     * degrade to the built-in catalog. Same one-hop key discipline as
     * config.smokeTest — never logged or persisted.
     */
    "config.listModels": async (params) => {
      const baseUrl = reqStr(params, "baseUrl");
      const apiKeyEnv = optStr(params, "apiKeyEnv");
      const apiKey =
        optStr(params, "apiKey") ??
        (apiKeyEnv ? (process.env[apiKeyEnv] ?? "") : "");
      return listRemoteModels({
        baseUrl,
        apiKey,
        timeoutMs: optPositiveNumber(params, "timeoutMs") ?? 8_000,
      });
    },

    // ── 目录自校准（三层新鲜度：yaml 种子 → 实时拉取 → refresh 覆盖层） ──

    /**
     * Catalog freshness status: the yaml seed date plus the persistent
     * calibration overlay (<data-dir>/catalog-overlay.json) — which
     * provider/billing was calibrated against GET /models, when, and how
     * many live models it saw. The wizard and `penglai catalog status`
     * render 「已知模型 N 个 · 校准于 <时间>」from this.
     */
    "catalog.status": () => ({
      catalogUpdated: catalogUpdated(),
      overlay: loadCatalogOverlay(productDataDir),
    }),

    /**
     * Self-calibration (`penglai catalog refresh`): every profile whose key
     * resolves host-side gets a live GET /models; the result lands in the
     * overlay (yaml seed stays the fallback). Profiles without keys are
     * reported as 「配置后可校准」 — never silently skipped.
     */
    "catalog.refresh": async () => {
      return refreshCatalog({
        listProfiles: () => Array.from(profiles.values()),
        resolveApiKey: (profile) =>
          customApiKeys.get(profile.id) ??
          (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : ""),
        saveEntry: (entry) => {
          saveCatalogOverlayEntry(productDataDir, entry);
        },
      });
    },

    // ── 身份诞生（桌面首次启动向导；CLI 走 cli/identity-ceremony.ts） ──

    /**
     * 身份查询：L1 托管区的身份（名字 + 诞生日），未诞生为 null。
     * 桌面首次启动向导据此决定「身份诞生」页是举行仪式还是直接跳过。
     */
    "onboarding.status": () => ({ identity: memoryStore.readIdentity() }),

    /**
     * 举行诞生仪式（host 侧核心，幂等）：起名（名字卫生同 CLI）→ 种子 SOP
     * 逐条过蒸馏环审计规则器入树 → 身份落 L1 托管区。已有身份直接短路返
     * 回 existingName，不重复仪式、不重复播种；L1 已满时如实报
     * identityWritten=false（种子照常入树）。全局记忆写面是 owner 触发
     * 的 onboarding 专属通道（与 memory.sopRemove / migrate 同类），内核
     * 永不走这里。
     */
    "onboarding.birthIdentity": async (params) => {
      return runBirth(memoryStore, optStr(params, "name") ?? "");
    },

    // ── 语音（统一会话的本地 ASR+TTS，数据不出机） ──

    /** 语音能力探测：引擎/模型/ffmpeg 逐项 components → ready/partial/disabled。 */
    "voice.status": () => voiceService.status(),

    /**
     * 按需下载语音模型（which=asr|tts|all）。镜像优先 + .part 断点续传 +
     * 固定官方 revision/大小/SHA-256；进度经 voice 频道广播 voice.download.progress。
     */
    "voice.install": async (params) => {
      const which = reqEnum(params, "which", ["asr", "tts", "all"] as const);
      return { results: await voiceService.install(which) };
    },

    /** 本地转写（SenseVoice，含情绪标签）：audioBase64 + format → 文本。 */
    "voice.transcribe": async (params) => {
      const audioBase64 = reqStr(params, "audioBase64");
      const format = optStr(params, "format");
      const result = await voiceService.transcribe({
        audioBase64,
        ...(format ? { format } : {}),
      });
      if (result.ok && ["SAD", "ANGRY", "FEARFUL", "DISGUSTED"].includes(result.emotion ?? "")) {
        void companion.trigger("emotion");
      }
      return result;
    },

    /** 本地合成（TTS）：text → wavBase64。诚实降级：未就绪给精确指引。 */
    "voice.synthesize": async (params) => {
      const text = reqStr(params, "text");
      return voiceService.synthesize({ text });
    },

    // ── IM 渠道（飞书先行；配置面板 RPC） ──────────────────────
    // 白名单/路由走 product-store（重启不丢）；app 密钥走 channels.json
    // （0600）或 PENGLAI_FEISHU_* 环境变量；密钥永不出 host、永不进日志。

    "channel.list": () => {
      // Always return the product catalog so Desktop can show Feishu + WeChat
      // cards even before configuration (honest empty state, not a blank page).
      const resolved = resolveChannelConfig(productDataDir);
      const runtime = channelController.feishu;
      const wechat = loadWechatToken(productDataDir);
      return [
        {
          channel: "feishu",
          configured: resolved !== null,
          enabled: resolved?.enabled ?? false,
          state: runtime ? runtime.ws.getState() : resolved ? "stopped" : "unconfigured",
          appId: resolved?.appId ?? null,
          domain: resolved?.domain ?? null,
          whitelist: productStore.listChannelIdentities("feishu").length,
          routes: productStore.listChannelRoutes("feishu").length,
        },
        {
          channel: "wechat",
          configured: wechat !== null,
          enabled:
            channelController.wechatBridge?.status().state === "live" ||
            channelController.wechat?.status().state === "live",
          state: (() => {
            if (!wechat) return "unconfigured";
            const st =
              channelController.wechatBridge?.status().state ??
              channelController.wechat?.status().state ??
              "stopped";
            if (st === "live") return "live";
            if (st === "starting" || st === "reconnecting") return st;
            if (st === "error") return "error";
            return "bound_polling";
          })(),
          appId: wechat?.botId || null,
          domain: "ilinkai.weixin.qq.com",
          whitelist: productStore.listChannelIdentities("wechat").length,
          routes: productStore.listChannelRoutes("wechat").length,
          bridged: channelController.wechatBridge?.status().bridged ?? 0,
        },
      ];
    },

    "channel.setup": async (params) => {
      const channel = reqEnum(params, "channel", ["feishu"] as const);
      const appId = reqStr(params, "appId");
      const appSecret = reqStr(params, "appSecret");
      const domain = optStr(params, "domain") ?? undefined;
      saveChannelConfig(productDataDir, { appId, appSecret, domain, enabled: true });
      const state = await startFeishuChannel({
        appId,
        appSecret,
        domain: domain ?? "https://open.feishu.cn",
        enabled: true,
      });
      hostLog(`channel ${channel} configured and started (ws ${state})`);
      return { ok: true, channel, state };
    },

    "channel.disable": async (params) => {
      reqEnum(params, "channel", ["feishu"] as const);
      const fileConfig = loadChannelConfig(productDataDir);
      await stopFeishuChannel();
      if (fileConfig) {
        saveChannelConfig(productDataDir, { ...fileConfig, enabled: false });
      }
      return { ok: true };
    },

    "channel.allow": (params) => {
      const channel = reqEnum(params, "channel", ["feishu", "wechat"] as const);
      const channelUserId = reqStr(params, "channelUserId");
      const identity =
        optStr(params, "identity") ?? `…${channelUserId.slice(-6)}`;
      return productStore.allowChannelIdentity({
        channel,
        channelUserId,
        identity,
        note: optStr(params, "note"),
      });
    },

    "channel.deny": (params) => {
      const channel = reqEnum(params, "channel", ["feishu", "wechat"] as const);
      const channelUserId = reqStr(params, "channelUserId");
      return { ok: productStore.denyChannelIdentity(channel, channelUserId) };
    },

    "channel.identities": (params) => {
      const channel = reqEnum(params, "channel", ["feishu", "wechat"] as const);
      return productStore.listChannelIdentities(channel);
    },

    "channel.routes": (params) => {
      const channel = reqEnum(params, "channel", ["feishu", "wechat"] as const);
      return productStore.listChannelRoutes(channel);
    },

    // Feishu device-code QR app create (0.3 / Hermes-style). After confirmed,
    // Desktop/CLI should call channel.setup with the returned appId/appSecret.
    "channel.feishu.qrStart": async () => {
      const session = await startFeishuQrCreate();
      return {
        sessionId: session.sessionId,
        qrUrl: session.qrUrl,
        status: session.status,
        expiresAt: session.expiresAt,
        intervalSec: session.intervalSec,
      };
    },

    "channel.feishu.qrPoll": async (params) => {
      const sessionId = reqStr(params, "sessionId");
      const session = await pollFeishuQrCreate(sessionId);
      const credentials = takeFeishuQrCredentials(sessionId);
      if (credentials) {
        saveChannelConfig(productDataDir, { ...credentials, enabled: true });
        await startFeishuChannel({
          ...credentials,
          domain: "https://open.feishu.cn",
          enabled: true,
        });
      }
      return {
        sessionId: session.sessionId,
        qrUrl: session.qrUrl,
        status: session.status,
        appId: session.appId ?? null,
        configured: credentials !== null,
        error: session.error ?? null,
        expiresAt: session.expiresAt,
        intervalSec: session.intervalSec,
      };
    },

    // WeChat iLink QR login — Host owns token under data-dir.
    "channel.wechat.qrStart": async () => {
      const session = await startWechatQrBind();
      return {
        sessionId: session.sessionId,
        qrUrl: session.qrUrl,
        status: session.status,
      };
    },

    "channel.wechat.qrPoll": async (params) => {
      const sessionId = reqStr(params, "sessionId");
      const session = await pollWechatQrBind(sessionId);
      if (session.status === "confirmed" && session.token?.botToken) {
        saveWechatToken(productDataDir, session.token);
        const probe = await probeWechatToken(session.token);
        hostLog(
          `wechat token saved (botId=${session.token.botId || "?"}; probe ${probe.ok ? "ok" : probe.detail})`,
        );
        try {
          channelController.wechatBridge?.stop();
          channelController.wechatBridge?.start();
        } catch (error) {
          hostLog(
            `wechat bridge start after bind failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return {
        sessionId: session.sessionId,
        qrUrl: session.qrUrl,
        status: session.status,
        botId: session.token?.botId ?? null,
        error: session.error ?? null,
        tokenSaved: session.status === "confirmed" && !!session.token?.botToken,
        runtime: channelController.wechatBridge?.status() ?? channelController.wechat?.status() ?? null,
      };
    },

    "channel.wechat.clear": () => {
      channelController.wechatBridge?.stop();
      channelController.wechat?.stop();
      clearWechatToken(productDataDir);
      return { ok: true };
    },

    "channel.wechat.start": () =>
      channelController.wechatBridge?.start() ?? channelController.wechat?.start() ?? { state: "stopped" },
    "channel.wechat.stop": () => {
      channelController.wechatBridge?.stop();
      channelController.wechat?.stop();
      return { state: "stopped" };
    },
    "channel.wechat.status": () =>
      channelController.wechatBridge?.status() ??
      channelController.wechat?.status() ?? { state: "stopped" },

    // ── scheduler / companion / autonomous ─────────────────────
    // Scheduler/Autonomous stay migration-only in 0.4.0. Active companion is
    // a retained 0.3.x capability and enters the same EpisodeRunner Core.
    "scheduler.list": () => scheduler.listTasks(),

    "scheduler.add": () => {
      throw new RpcError(
        -32000,
        "scheduler is not available in 0.4.0 (post-release feature); the scheduler RPC surface exists for migration only",
        { code: "invalid_params" },
      );
    },

    "scheduler.remove": () => {
      throw new RpcError(
        -32000,
        "scheduler is not available in 0.4.0 (post-release feature)",
        { code: "invalid_params" },
      );
    },

    "scheduler.update": () => {
      throw new RpcError(
        -32000,
        "scheduler is not available in 0.4.0 (post-release feature)",
        { code: "invalid_params" },
      );
    },

    // ── companion (opt-in, persisted, same Core) ───────────────
    "companion.status": () => companion.status(),

    "companion.enable": (params) => {
      const mode = reqEnum(params, "mode", ["quiet", "present", "active"] as const);
      const conversationId = optStr(params, "conversationId");
      if (conversationId && !getOrHydrateConversation(conversationId)) {
        throw new RpcError(-32000, `unknown conversationId: ${conversationId}`, {
          code: "conversation_not_found",
        });
      }
      companion.enable({ mode: mode as CompanionMode, conversationId: conversationId ?? null });
      return companion.status();
    },

    "companion.disable": () => {
      companion.disable();
      return companion.status();
    },

    "companion.mode": (params) => {
      const mode = reqEnum(params, "mode", ["quiet", "present", "active"] as const);
      companion.setMode(mode as CompanionMode);
      return companion.status();
    },

    "companion.trigger": async (params) => {
      const source = reqEnum(params, "source", ["weather", "morning", "evening", "emotion", "free"] as const);
      return { accepted: await companion.trigger(source as CompanionSource), status: companion.status() };
    },

    // ── autonomous (post-release; status-only in 0.4.0) ──────────
    "autonomous.status": () => ({
      lastActivity: autonomous.getLastActivity(),
      idleThresholdMs: autonomous.getIdleThresholdMs(),
      isIdle: autonomous.isIdle(),
    }),
  };

  // Legacy background services remain inspectable for migration, but are not
  // started. Scheduler/IM execution must be rebuilt on TaskRunner plus the real
  // isolation boundary.

  const handle: HostHandle = {
    workspaces,
    conversations,
    profiles,
    usage,
    productStore,
    taskRunner,
    episodeRunner,
    conversationExecutor,
    memory: memoryStore,
    approvals: approvalService,
    budget: budgetService,
    voice: voiceService,
    subscribeEvents,
  };

  return {
    methods,
    broadcast,
    handle,
    wsClients,
    services: { scheduler, autonomous, companion, mcpSessions },
    productStore,
    ownsProductStore,
    stopChannels: async () => {
      await stopFeishuChannel();
      channelController.wechatBridge?.stop();
      channelController.wechat?.stop();
    },
    drainBackground: async () => {
      await Promise.allSettled([...distillJobs]);
    },
  };
}

// ── default model profiles ─────────────────────────────────────

/** Default env-based profiles (fallback before wizard). Context from catalog SSOT. */
function defaultProfiles(): ModelProfile[] {
  const withCatalog = (
    profile: Omit<ModelProfile, "contextWindowTokens" | "maxOutputTokens"> & {
      contextWindowTokens?: number | null;
      maxOutputTokens?: number | null;
    },
  ): ModelProfile => {
    const cat = findCatalogModel(profile.model);
    return {
      ...profile,
      contextWindowTokens:
        profile.contextWindowTokens ?? catalogContextTokens(cat) ?? 128_000,
      maxOutputTokens: profile.maxOutputTokens ?? catalogMaxOutputTokens(cat),
      capabilities: {
        ...profile.capabilities,
        vision:
          profile.capabilities.vision ||
          (cat?.features?.includes("vision") ?? false),
      },
    };
  };
  return [
    withCatalog({
      id: "grok",
      label: "Grok (x.ai)",
      provider: "xai",
      baseUrl: "https://api.x.ai/v1",
      apiKeyEnv: "GROK_API_KEY",
      model: "grok-4.5",
      capabilities: { tools: true, streaming: true, vision: false },
    }),
    withCatalog({
      id: "deepseek",
      label: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      model: "deepseek-v4-flash",
      capabilities: { tools: true, streaming: true, vision: false },
    }),
    withCatalog({
      id: "glm",
      label: "GLM / Z.ai",
      provider: "zhipu",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
      apiKeyEnv: "ZAI_API_KEY",
      model: "glm-5.2",
      capabilities: { tools: true, streaming: true, vision: true },
    }),
    withCatalog({
      id: "moonshot",
      label: "Moonshot Kimi",
      provider: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKeyEnv: "MOONSHOT_API_KEY",
      model: "kimi-k3",
      capabilities: { tools: true, streaming: true, vision: false },
    }),
    withCatalog({
      id: "openai",
      label: "OpenAI-compatible (custom)",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-4.1-mini",
      capabilities: { tools: true, streaming: true, vision: true },
    }),
  ];
}

// ── HTTP helpers ───────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        // Drain the rest of the request so the connection stays reusable
        // (rejecting is NOT followed by destroying the socket — the caller
        // still writes a 4xx response; destroying first would make that
        // write fail on a closed socket).
        req.resume();
        reject(new RpcError(-32603, "request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (e) => {
      if (!aborted) reject(e);
    });
  });
}

/** Constant-time string equality to avoid token timing leaks. */
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Extract a candidate token from Authorization or X-Penglai-Token headers. */
function tokenFromHeaders(req: http.IncomingMessage): string {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.length > 0) {
    const trimmed = auth.trim();
    if (trimmed.slice(0, 6).toLowerCase() === "bearer" && /\s/.test(trimmed[6] ?? "")) {
      return trimmed.slice(7).trimStart();
    }
    return trimmed;
  }
  const x = req.headers["x-penglai-token"];
  if (typeof x === "string") return x.trim();
  const protocols = req.headers["sec-websocket-protocol"];
  if (typeof protocols === "string") {
    for (const protocol of protocols.split(",").map((value) => value.trim())) {
      if (!protocol.startsWith("penglai.auth.")) continue;
      try {
        return Buffer.from(protocol.slice("penglai.auth.".length), "base64url").toString("utf-8");
      } catch {
        return "";
      }
    }
  }
  return "";
}

/** True if the Host header names a loopback address (DNS-rebinding guard). */
function isLoopbackHost(req: http.IncomingMessage): boolean {
  const host = req.headers["host"];
  if (typeof host !== "string" || host.length === 0) return false;
  const h = host.toLowerCase();
  const hostname = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
  return LOOPBACK_HOSTS.has(hostname);
}

// ── param helpers ──────────────────────────────────────────────

function reqStr(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new RpcError(-32602, `invalid params: '${key}' must be a non-empty string`);
  }
  return v;
}

function optStr(params: Record<string, unknown>, key: string): string | null {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function optStringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RpcError(-32602, `invalid params: '${key}' must be an array of strings`);
  }
  return value;
}

function optRecord(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RpcError(-32602, `invalid params: '${key}' must be an object`);
  }
  return value as Record<string, unknown>;
}

function optPositiveNumber(
  params: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RpcError(-32602, `invalid params: '${key}' must be a positive number`);
  }
  return value;
}

function reqEnum<const T extends readonly string[]>(
  params: Record<string, unknown>,
  key: string,
  allowed: T,
  fallback?: T[number],
): T[number] {
  const value = params[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new RpcError(
      -32602,
      `invalid params: '${key}' must be one of ${allowed.join(", ")}`,
    );
  }
  return value as T[number];
}

/** Convert a thrown application error (with a `.code`) into an RpcError. */
function toRpcError(e: unknown): RpcError {
  if (e instanceof RpcError) return e;
  const coded = e as { code?: unknown };
  if (typeof coded?.code === "string") {
    return new RpcError(-32000, e instanceof Error ? e.message : String(e), { code: coded.code });
  }
  return new RpcError(-32603, e instanceof Error ? e.message : String(e));
}

// ── transcript helpers ─────────────────────────────────────────

function joinText(content: MessageContent[]): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// ── server entrypoint ──────────────────────────────────────────

function resolvedServerStorage(options: ServerOptions): {
  dataDir: string;
  databasePath: string;
} {
  const databasePath =
    options.databasePath ??
    (process.env.VITEST ? ":memory:" : path.join(penglaiDataDir(), "product.db"));
  const dataDir =
    options.dataDir ??
    (databasePath !== ":memory:" ? path.dirname(path.resolve(databasePath)) : penglaiDataDir());
  return { dataDir: path.resolve(dataDir), databasePath };
}

/**
 * Start the HTTP + WebSocket server. Resolves once the server is listening.
 *
 * The data-directory operation lock is acquired before token I/O, database
 * open/schema recovery, or profile/channel reads, and remains held until the
 * returned server has fully closed. Migration uses the same exclusive lane.
 */
export function startServer(options: ServerOptions = {}): Promise<StartedServer> {
  const requestedHost = (options.host ?? DEFAULT_HOST).toLowerCase();
  if (!LOOPBACK_HOSTS.has(requestedHost)) {
    return Promise.reject(
      new Error(`Penglai Host refuses a non-loopback bind address: ${options.host}`),
    );
  }
  if (
    options.token !== undefined &&
    !process.env.VITEST &&
    options.token.trim().length < 32
  ) {
    return Promise.reject(
      new Error("Penglai Host token must contain at least 32 characters"),
    );
  }
  const storage = resolvedServerStorage(options);
  let operationLock: DataDirOperationLock | null = null;
  try {
    operationLock = acquireDataDirOperationLock(storage.dataDir, "runtime");
    const started = startServerLocked(
      { ...options, dataDir: storage.dataDir, databasePath: storage.databasePath },
      operationLock,
    );
    return started.catch((error) => {
      operationLock?.release();
      throw error;
    });
  } catch (error) {
    operationLock?.release();
    return Promise.reject(error);
  }
}

function startServerLocked(
  options: ServerOptions,
  operationLock: DataDirOperationLock,
): Promise<StartedServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const token = options.token ?? loadOrCreateHostToken(options.dataDir ?? penglaiDataDir());
  const log = options.log ?? ((line: string) => {
    const singleLine = line.replace(/[\r\n\u2028\u2029]+/g, " ");
    console.error(`[host] ${singleLine}`);
  });

  const {
    methods,
    broadcast,
    handle,
    wsClients,
    services,
    productStore,
    ownsProductStore,
    stopChannels,
    drainBackground,
  } = createHost(options);

  const server = http.createServer(async (req, res) => {
    // A client that disconnects mid-RPC must never crash the host: writes on
    // a closed socket fire an unhandled 'error' on the response otherwise.
    res.on("error", () => {});
    // Always respond with CORS-disabled cross-origin headers: this server is
    // loopback-only and the browser UI is same-origin, so we explicitly refuse
    // cross-origin reads (defense-in-depth against DNS rebinding / CSRF).
    res.setHeader("X-Content-Type-Options", "nosniff");

    const reqUrl = req.url ?? "/";
    const url = new URL(reqUrl, `http://${host}`);

    // DNS-rebinding guard: reject non-loopback Host headers early.
    if (!isLoopbackHost(req)) {
      log(`${req.method} ${url.pathname} -> 403 (bad host)`);
      json(res, 403, { error: "forbidden: non-loopback host" });
      return;
    }

    // Health probe: unauthenticated, no body.
    if (req.method === "GET" && url.pathname === "/health") {
      const handshake: RuntimeHandshake = {
        ok: true,
        product: "Penglai",
        productVersion: PRODUCT_VERSION,
        runtime: "host",
        runtimeVersion: PRODUCT_VERSION,
        protocolSchemaVersion: SCHEMA_VERSION,
        databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        minimumDesktopVersion: MIN_DESKTOP_VERSION,
        instanceId: RUNTIME_INSTANCE_ID,
      };
      json(res, 200, handshake);
      return;
    }

    // JSON-RPC endpoint.
    if (req.method === "POST" && url.pathname === "/api") {
      if (!constantTimeEq(tokenFromHeaders(req), token)) {
        log(`POST /api -> 401 (bad token)`);
        json(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" } });
        return;
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch (e) {
        log(`POST /api -> 400 (bad body)`);
        json(res, 400, { jsonrpc: "2.0", error: { code: -32603, message: e instanceof Error ? e.message : "bad body" } });
        return;
      }

      let reqObj: unknown;
      try {
        reqObj = JSON.parse(body);
      } catch {
        log(`POST /api -> parse error`);
        json(res, 200, { jsonrpc: "2.0", error: { code: -32700, message: "parse error" } });
        return;
      }

      const r = reqObj as { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };
      const id = r.id ?? null;
      if (typeof r.method !== "string") {
        log(`POST /api -> invalid request`);
        json(res, 200, { jsonrpc: "2.0", id, error: { code: -32600, message: "invalid request" } });
        return;
      }

      const handler = methods[r.method];
      if (!handler) {
        log(`POST /api ${r.method} -> method not found`);
        json(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${r.method}` } });
        return;
      }

      try {
        const result = await handler((r.params as Record<string, unknown>) ?? {});
        log(`POST /api ${r.method} -> ok`);
        json(res, 200, { jsonrpc: "2.0", id, result });
      } catch (e) {
        const err = toRpcError(e);
        log(`POST /api ${r.method} -> error ${err.code}`);
        json(res, 200, { jsonrpc: "2.0", id, error: { code: err.code, message: err.message, data: err.data } });
      }
      return;
    }

    json(res, 404, { error: "not found" });
  });

  // WebSocket at /ws. Credentials are never accepted in the URL.
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: (
      info: { req: http.IncomingMessage },
      cb: (res: boolean, code?: number, message?: string) => void,
    ) => {
      if (!isLoopbackHost(info.req)) {
        cb(false, 403, "forbidden");
        return;
      }
      cb(constantTimeEq(tokenFromHeaders(info.req), token));
    },
  });

  wss.on("connection", (ws, req) => {
    const u = new URL(req.url ?? "/ws", `http://${host}`);
    const initial = u.searchParams.get("channel");
    const client: WsClient = { ws, channelId: typeof initial === "string" ? initial : null };
    wsClients.add(client);

    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return; // ignore malformed frames
      }
      const p = parsed as { type?: unknown; channelId?: unknown };
      if (p.type === "subscribe" && typeof p.channelId === "string") {
        client.channelId = p.channelId;
        ws.send(JSON.stringify({ event: "subscribed", channelId: p.channelId }));
      } else if (p.type === "unsubscribe") {
        client.channelId = null;
      }
    });

    const cleanup = (): void => {
      wsClients.delete(client);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  // broadcast closes over wsClients inside createHost; keep the reference live.
  void broadcast;

  return new Promise((resolve, reject) => {
    let listening = false;
    let resourcesReleased = false;
    const releaseResources = (): void => {
      if (resourcesReleased) return;
      resourcesReleased = true;
      try {
        if (ownsProductStore) productStore.close();
      } finally {
        operationLock.release();
      }
    };
    const handleServerError = (error: Error): void => {
      if (!listening) {
        try {
          releaseResources();
        } finally {
          reject(error);
        }
        return;
      }
      log(`server error: ${error instanceof Error ? error.message : String(error)}`);
    };
    server.on("error", handleServerError);
    // ws mirrors errors from the supplied HTTP server. Handle that emitter as
    // well so a listen failure cannot become an unhandled exception after the
    // HTTP-side cleanup already ran.
    wss.on("error", handleServerError);
    server.listen(port, host, () => {
      listening = true;
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      log(`listening on http://${host}:${boundPort}`);
      // H7: do NOT log the auth token value (credential leak). The token file
      // path is documented as ~/.penglai/host.token; callers retrieve it from
      // there rather than from server logs.

      let closePromise: Promise<void> | null = null;
      const close = (): Promise<void> => {
        if (closePromise) return closePromise;
        closePromise = (async () => {
          try {
            await Promise.race([
              handle.taskRunner.shutdown(),
              new Promise((r) => setTimeout(r, 8_000)),
            ]);
            for (const conversationId of handle.conversations.keys()) {
              handle.episodeRunner.interrupt(conversationId);
            }
            await Promise.race([
              Promise.all(
                [...handle.conversations.keys()].map((conversationId) =>
                  handle.episodeRunner.join(conversationId),
                ),
              ),
              new Promise((r) => setTimeout(r, 8_500)),
            ]);
            await drainBackground();
            await stopChannels();
            await new Promise<void>((resolveClose) => {
              // Stop the background service tickers first.
              services.scheduler.stop();
              services.autonomous.stop();
              services.companion.stop();
              services.mcpSessions.dispose();
              // Stop accepting WS upgrades and close existing clients.
              for (const c of wsClients) {
                try {
                  c.ws.close(1001, "server shutting down");
                } catch {
                  /* ignore */
                }
              }
              wss.close(() => {
                server.close(() => resolveClose());
              });
            });
          } finally {
            releaseResources();
          }
        })();
        return closePromise;
      };

      resolve({ server, wss, token, port: boundPort, host, close, handle });
    });
  });
}
