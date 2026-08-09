/**
 * Penglai 0.4 Protocol Types
 *
 * Based on docs/0.4/05-PROTOCOL.md schemaVersion=1.
 * These types are the single source of truth for all surfaces (desktop/CLI/IM)
 * talking to the Agent Host.
 *
 * Design principle: one conversation truth, one tool contract, one turn
 * definition. Execution is owned by the Pi kernel behind AgentKernel.
 */

// ── schemaVersion ──────────────────────────────────────────────

export const SCHEMA_VERSION = 1 as const;
export const DATABASE_SCHEMA_VERSION = 7 as const;
export const PRODUCT_VERSION = "0.4.0" as const;
export const MIN_DESKTOP_VERSION = "0.4.0" as const;

export interface RuntimeHandshake {
  ok: true;
  product: "Penglai";
  productVersion: typeof PRODUCT_VERSION;
  runtime: "host";
  runtimeVersion: string;
  protocolSchemaVersion: typeof SCHEMA_VERSION;
  databaseSchemaVersion: typeof DATABASE_SCHEMA_VERSION;
  minimumDesktopVersion: string;
  instanceId: string;
}

// ── Product model ─────────────────────────────────────────────

export type ProjectStatus = "active" | "archived";

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  rootPath: string;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  status: ProjectStatus;
  trusted: boolean;
  defaultModelProfileId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export interface Task {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  projectId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  sourceChannel: "desktop" | "feishu" | "wechat" | "schedule" | "api";
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/**
 * Durable Owner-confirmation intent. A proposal is deliberately not a Task:
 * only an explicit Owner confirmation may create/activate executable work.
 */
export type WorkProposalStatus = "pending" | "confirmed" | "blocked";

export interface WorkProposal {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  conversationId: string;
  /** Existing project when proposed by id; null until confirm for a new path. */
  projectId: string | null;
  projectName: string;
  canonicalRootPath: string;
  objective: string;
  title: string;
  sourceChannel: Task["sourceChannel"];
  status: WorkProposalStatus;
  taskId: string | null;
  blockedReason: string | null;
  confirmedBy: string | null;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
}

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunBudget {
  maxDurationMs: number | null;
  maxTokens: number | null;
  maxToolFailures: number;
  /**
   * Turn ceiling for a bounded episode (optional for backward compatibility
   * with budgets persisted before M1'). When null, the active Mode's policy
   * profile default applies (host policy.ts).
   */
  maxTurns?: number | null;
}

export interface Run {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  taskId: string;
  sequence: number;
  status: RunStatus;
  kernel: string;
  modelProfileId: string;
  budget: RunBudget;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  error: string | null;
}

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";

export interface Step {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  runId: string;
  sequence: number;
  title: string;
  status: StepStatus;
  summary: string;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type EvidenceKind =
  | "diff"
  | "command"
  | "test"
  | "artifact"
  | "screenshot"
  | "file"
  | "source"
  | "external_response"
  | "log";

export interface Evidence {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  taskId: string;
  runId: string | null;
  stepId: string | null;
  kind: EvidenceKind;
  title: string;
  summary: string;
  uri: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface Approval {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  taskId: string;
  runId: string | null;
  capability: string;
  action: string;
  reason: string;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: number;
  decidedAt: number | null;
}

/**
 * A persisted per-project L2 grant (同类免问): the owner approved this
 * capability kind for the project once and chose "don't ask again". Grants
 * only exist for L2 capabilities (l2:*); L3 (l3:*) is never grantable.
 * The adjudication table in host policy.ts stays the default; grants are
 * the durable per-project override.
 */
export interface PolicyGrant {
  schemaVersion: typeof SCHEMA_VERSION;
  projectId: string;
  /** The granted capability key (e.g. "l2:modify-existing"). */
  grantKey: string;
  createdBy: string;
  note: string | null;
  createdAt: number;
}

// ── Channel（IM 渠道：feishu/wechat，远程监视+审批器） ──────────

/**
 * 渠道身份白名单行（设计存档 §5：Every incoming chat identity maps to an
 * allowlisted Penglai identity）。单 owner 原则：默认拒绝一切未白名单用户。
 * identity 是 Penglai 侧的决策署名（审批 decidedBy 记 `feishu:<identity>`）。
 */
export interface ChannelIdentity {
  schemaVersion: typeof SCHEMA_VERSION;
  channel: string;
  /** 渠道侧用户 id（飞书 open_id）。 */
  channelUserId: string;
  /** Penglai 身份名（owner 起的可读名，默认取 channelUserId 后段）。 */
  identity: string;
  note: string | null;
  createdAt: number;
}

/**
 * 会话路由（设计存档 §5：A conversation route maps to a project/task
 * explicitly or by a deterministic default. The route is persisted）。
 * chat_id → Conversation（同一产品记录，非独立 chatbot 会话）+ 可选默认项目。
 */
export interface ChannelRoute {
  schemaVersion: typeof SCHEMA_VERSION;
  channel: string;
  /** 渠道侧会话 id（飞书 chat_id）。 */
  chatId: string;
  conversationId: string;
  defaultProjectId: string | null;
  updatedAt: number;
}

export interface ProductEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  id: number;
  aggregateType: "project" | "task" | "run" | "step" | "evidence" | "approval";
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

// ── Workspace ──────────────────────────────────────────────────

export interface Workspace {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  rootPath: string;
  name: string;
  trust: WorkspaceTrust;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceTrust {
  mode: "project";
  extraReadRoots: string[];
  extraWriteRoots: string[];
}

// ── Conversation anchor (wire-compatible `mode` field) ─────────

/**
 * Storage label only (derived from activeTaskId). Capability is NOT split by
 * mode — ONE conversation surface with full tools. Jail root differs by anchor.
 *   chat = floating (no project jail)
 *   work = project-anchored
 */
export type Mode = "chat" | "work";

// ── Conversation ───────────────────────────────────────────────

/**
 * A Conversation is the daily dialog carrier of the identity (the Jarvis
 * narrative). There is ONE conversation surface with full tools; anchoring a
 * project only sets the workspace jail (activeTaskId). The `mode` field is
 * storage-compatible naming debt:
 *   - "chat"  = floating (no project jail)
 *   - "work"  = project-anchored (activeTaskId set)
 * Capability is not split by mode.
 */
export type ConversationStatus =
  | "idle"
  | "running"
  | "waiting_user"
  | "error"
  | "archived";

export type ThreadGoalStatus =
  | "active"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

/**
 * Codex-style conversation goal: durable objective + status machine.
 * `conversation.goal` string remains a mirror of activeGoal.objective.
 */
export interface ThreadGoal {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  conversationId: string;
  objective: string;
  status: ThreadGoalStatus;
  blockedReason?: string | null;
  completionSummary?: string | null;
  /** Optional per-goal ceilings; null/undefined = identity budget + episode rails only. */
  budget?: {
    maxTurns?: number | null;
    maxTokens?: number | null;
    maxDurationMs?: number | null;
  } | null;
  usage?: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    episodes: number;
    autoContinues: number;
  };
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface ConversationContextPin {
  id: string;
  kind: "file" | "skill" | "note" | "mcp" | "url" | "session";
  label: string;
  ref: string;
  createdAt: number;
}

export interface Conversation {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  title: string;
  status: ConversationStatus;
  modelProfileId: string;
  /**
   * Derived storage mirror of workspace bind (kept for older clients).
   * ALWAYS sync from activeTaskId: work ⇔ activeTaskId != null.
   * Product logic must use conversationHasWorkspace() / activeTaskId.
   */
  mode: Mode;
  /** When set, the conversation jail is the task's project root. SSOT for workspace bind. */
  activeTaskId: string | null;
  /**
   * Mirror of activeGoal.objective when status=active; null otherwise.
   * Prefer activeGoal for status/completion. Kept for older clients.
   */
  goal?: string | null;
  /** Structured active/last goal (Codex-style). SSOT for status/usage. */
  activeGoal?: ThreadGoal | null;
  /** Owner-pinned extra context re-injected every episode. */
  contextPins?: ConversationContextPin[];
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
}

/** True when the conversation is anchored to a project workspace jail. */
export function conversationHasWorkspace(conversation: {
  activeTaskId?: string | null;
  mode?: Mode;
}): boolean {
  // activeTaskId is the single source of truth; mode is a derived mirror.
  if (conversation.activeTaskId != null && conversation.activeTaskId !== "") {
    return true;
  }
  return false;
}

/** Keep legacy `mode` field consistent with activeTaskId. */
export function modeFromActiveTaskId(activeTaskId: string | null | undefined): Mode {
  return activeTaskId ? "work" : "chat";
}

// ── Conversation TODO workbench ──────────────────────────────────

export type ConversationTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface ConversationTodo {
  id: string;
  content: string;
  status: ConversationTodoStatus;
  createdAt: number;
  updatedAt: number;
}

/** Legacy persisted row; retained only to read pre-hardening workbench files. */
export type ConversationSubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export interface ConversationSubagent {
  id: string;
  title: string;
  prompt: string;
  status: ConversationSubagentStatus;
  resultText?: string | null;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number | null;
}

/** Legacy persisted row; retained only to read pre-hardening workbench files. */
export type ConversationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "killed";

export interface ConversationJob {
  id: string;
  command: string;
  cwd: string;
  status: ConversationJobStatus;
  pid?: number | null;
  exitCode?: number | null;
  outputTail?: string;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number | null;
}

export interface ConversationWorkbench {
  todos: ConversationTodo[];
  subagents: ConversationSubagent[];
  jobs: ConversationJob[];
  updatedAt: number;
}

// ── Message (transcript entry) ─────────────────────────────────

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface TextContent {
  type: "text";
  text: string;
}

/** User-pasted / attached image (vision models). data is base64 without data: prefix. */
export interface ImageContent {
  type: "image";
  mimeType: string;
  /** base64 payload (no data-url prefix) */
  data: string;
  /** Optional local path when Host also wrote the bytes to disk. */
  path?: string;
  /** Short display name e.g. paste-1.png */
  name?: string;
}

export interface ToolCallContent {
  type: "tool_call";
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: string;
  ok: boolean;
  isError: boolean;
  text: string;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ToolCallContent
  | ToolResultContent;

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  createdAt: number;
  content: MessageContent[];
  toolCallId?: string;
  name?: string;
  ok?: boolean;
  isError?: boolean;
}

// ── Turn ───────────────────────────────────────────────────────

export type TurnState =
  | "building_context"
  | "streaming_model"
  | "executing_tools"
  | "completed"
  | "aborted"
  | "failed";

export interface TurnSnapshot {
  modelProfileId: string;
  toolNames: string[];
  workingSetHash: string;
}

export interface Turn {
  id: string;
  conversationId: string;
  index: number;
  state: TurnState;
  snapshot: TurnSnapshot;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

// ── Tool ───────────────────────────────────────────────────────

export type ToolExecutionMode = "parallel" | "sequential";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  executionMode: ToolExecutionMode;
  sideEffects: boolean;
}

// ── Model Profile ──────────────────────────────────────────────

export interface ModelCapabilities {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
}

export interface ModelProfile {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  capabilities: ModelCapabilities;
  /**
   * Context window in tokens (from provider catalog context_k * 1000, or
   * owner override). Used by Pi model registration and the desktop usage chip.
   * When null/undefined, Host falls back to a conservative default.
   */
  contextWindowTokens?: number | null;
  /** Max output tokens when known (catalog max_output_k * 1000). */
  maxOutputTokens?: number | null;
}

// ── Run checkpoint (lightweight; the worldline replacement) ────

/**
 * The lightweight run checkpoint: when a Run ends, the engine's own session
 * transcript (Pi session JSONL) is indexed as the engine attachment, together
 * with the task summary and the episode's budget usage. Crash recovery
 * rebuilds the task view from these rows (runs/steps/evidence are durable in
 * the product database; the checkpoint adds the engine-side transcript).
 * Arbitrary node-level rewind is explicitly out of scope.
 */
export interface RunCheckpoint {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  taskId: string;
  /** Absolute path of the indexed engine session JSONL; null when the engine
   *  left no session file on disk (e.g. a test kernel). */
  sessionPath: string | null;
  /** Task summary captured at checkpoint time (survives later task edits). */
  taskTitle: string;
  taskObjective: string;
  /** The run's status when the checkpoint was recorded. */
  status: RunStatus;
  /** Episode counters at stop (budget usage). */
  turns: number;
  toolFailures: number;
  inputTokens: number;
  outputTokens: number;
  /** The merged budget ceiling the episode ran under. */
  budget: RunBudget;
  createdAt: number;
}

// ── Usage (cost visibility, design §7 成本可见性) ──────────────

/**
 * One row of the durable usage ledger, aggregated by (day, mode, project).
 * `day` is the local calendar day (YYYY-MM-DD) on the owner's machine;
 * `projectId` is "" for unanchored chat-mode usage (the global layer floats
 * above projects). Token counts are provider-reported, best-effort: a
 * provider that returns no usage yields a row with zero tokens (and the Host
 * logs the gap) — requests are always counted.
 */
export interface UsageRow {
  day: string;
  /**
   * @deprecated storage mirror only (v7+ usage_counters has no mode PK).
   * Floating usage: projectId=""; project-anchored rows omit meaningful mode.
   */
  mode?: Mode;
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  updatedAt: number;
}

/** The `usage.get` report: all-time totals plus the per-dimension rows. */
export interface UsageReport {
  totalTokens: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  /** Aggregated rows, most recently updated first. */
  rows: UsageRow[];
}

// ── Budget circuit breaker (成本熔断, design §7 成本可见性) ─────

/**
 * The owner-configured token budget (cost circuit breaker). Two dimensions,
 * both measured against the durable usage ledger's LOCAL calendar day:
 *
 *   dailyTokenLimit        — the whole identity's day (chat + work, every
 *                            project); null = unbounded.
 *   projectDailyTokenLimit — each project's day (work episodes anchored to
 *                            one project); null = unbounded.
 *
 * Token-based (provider-reported usage); estimated-cost budgets need
 * reliable per-model pricing, which the host does not have yet. Crossing
 * 80% broadcasts a warning; crossing 100% trips the breaker and degrades
 * that dimension into approval mode (host budget.ts).
 */
export interface BudgetConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  dailyTokenLimit: number | null;
  projectDailyTokenLimit: number | null;
  updatedAt: number;
  updatedBy: string;
}

/**
 * One breaker's day row (durable provenance for warnings / trips / lifts).
 * `dimension` is "day" (the identity-wide daily budget) or
 * "project:<projectId>" (one project's daily budget).
 */
export interface BudgetBreaker {
  schemaVersion: typeof SCHEMA_VERSION;
  dimension: string;
  /** Local calendar day (YYYY-MM-DD) this breaker row belongs to. */
  day: string;
  /** The configured limit in effect when the row was created. */
  limitTokens: number;
  /** 80% warning fired at (epoch ms); null = not yet. */
  warnedAt: number | null;
  /** Breaker tripped at (epoch ms); null = not tripped. */
  trippedAt: number | null;
  /** Tokens consumed when the breaker tripped. */
  tokensAtTrip: number | null;
  /** Owner lift (release) provenance; null while still tripped. */
  liftedAt: number | null;
  liftedBy: string | null;
  liftNote: string | null;
}

/** One dimension's live status (usage vs limit + breaker state). */
export interface BudgetDimensionStatus {
  dimension: string;
  day: string;
  limitTokens: number | null;
  usedTokens: number;
  /** used/limit in [0, ∞); null when no limit is configured. */
  ratio: number | null;
  warned: boolean;
  tripped: boolean;
  lifted: boolean;
}

/** The `budget.status` report: both dimensions for the local day. */
export interface BudgetStatus {
  day: string;
  config: BudgetConfig;
  dimensions: BudgetDimensionStatus[];
}

// ── Distillation loop (蒸馏环 v1, design §6/§9) ─────────────────

/**
 * Distillation-loop configuration. The review (复盘) and audit models are
 * ordinary model profiles — the owner may point them at a lighter tier
 * (轻量模型档位). `auditProfileId` reserves the "audit with a DIFFERENT
 * provider than execution" slot (design §6 注入防护: 审计 LLM 用不同
 * provider); when null, v1 audits with the deterministic rule table only.
 */
export interface DistillConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Master switch; when false, run completion triggers no review. */
  enabled: boolean;
  /** Review model profile; null = reuse the run's own profile. */
  reviewProfileId: string | null;
  /** Reserved audit-LLM profile (different provider slot); null = rules only. */
  auditProfileId: string | null;
  updatedAt: number;
  updatedBy: string;
}

/**
 * One SOP in the global memory SOP area (the skill tree). SOPs enter ONLY
 * through the audited distillation loop (复盘 → 候选 SOP → 审计 → 入树);
 * `sourceTaskId`/`sourceRunId` are the provenance of the episode that
 * produced them.
 */
export interface SopMeta {
  name: string;
  title: string;
  sizeBytes: number;
  updatedAt: number;
  sourceTaskId: string | null;
  sourceRunId: string | null;
}

// ── Error codes ────────────────────────────────────────────────
//
// The RPC surface's structured error codes. Single source of truth: every
// code below MUST be produced by the host RPC layer, and every code the host
// produces MUST be declared here (scripts/check-protocol-contract.mjs enforces
// both directions mechanically). Codes the host emits as tool-result TEXT
// (policy_denied / needs_approval / needs_confirm / l4_denied) are NOT RPC
// error codes and are intentionally absent here.

export type ErrorCode =
  | "workspace_required"
  | "model_error"
  | "preview_unavailable"
  | "conversation_busy"
  | "conversation_not_found"
  | "authority_changed"
  | "project_not_found"
  | "task_not_found"
  | "invalid_params"
  | "invalid_name"
  | "budget_exceeded"
  | "approval_not_found"
  | "approval_conflict"
  | "mode_conflict"
  | "proposal_not_found"
  | "proposal_mismatch"
  | "proposal_blocked"
  | "proposal_replayed"
  | "memory_denied"
  | "memory_not_found"
  | "needs_work_mode"
  | "note_too_large"
  | "isolation_required";
