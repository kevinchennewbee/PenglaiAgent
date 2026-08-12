/**
 * Workbench view models — pure derivations from Host facts (projects, tasks,
 * run bundles, evidence, usage, budget). No DOM, no React: the components
 * render exactly what these functions return, and the vitest suites pin the
 * derivations (tree building, evidence grouping, progress/next-action).
 */

import {
  DATABASE_SCHEMA_VERSION,
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  type Approval,
  type BudgetDimensionStatus,
  type Conversation,
  type Evidence,
  type Project,
  type Run,
  type RunCheckpoint,
  type RuntimeHandshake,
  type Step,
  type Task,
  type TaskStatus,
  type UsageReport,
  type UsageRow,
} from "@penglai/protocol";
import { compareVersions } from "./format.js";

// ── handshake compatibility (启动握手：版本/协议兼容检查) ────────

export interface CompatResult {
  compatible: boolean;
  reason: string | null;
}

export function checkHandshake(handshake: RuntimeHandshake): CompatResult {
  if (!handshake.ok || handshake.product !== "Penglai" || handshake.runtime !== "host") {
    return { compatible: false, reason: "端口上的服务不是蓬莱 Host" };
  }
  if (handshake.protocolSchemaVersion !== SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `协议版本不兼容：桌面 v${SCHEMA_VERSION} · Host v${handshake.protocolSchemaVersion}`,
    };
  }
  if (handshake.databaseSchemaVersion !== DATABASE_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `数据库版本不兼容：桌面 v${DATABASE_SCHEMA_VERSION} · Host v${handshake.databaseSchemaVersion}`,
    };
  }
  if (compareVersions(PRODUCT_VERSION, handshake.minimumDesktopVersion) < 0) {
    return {
      compatible: false,
      reason: `桌面 ${PRODUCT_VERSION} 低于 Host 要求的最低版本 ${handshake.minimumDesktopVersion}`,
    };
  }
  return { compatible: true, reason: null };
}

// ── task status presentation ───────────────────────────────────

export type TaskStateClass = "working" | "waiting" | "done" | "ready" | "failed" | "paused";

export function taskStateClass(status: TaskStatus): TaskStateClass {
  switch (status) {
    case "running":
      return "working";
    case "waiting_approval":
    case "blocked":
      return "waiting";
    case "completed":
      return "done";
    case "draft":
    case "ready":
      return "ready";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "paused";
  }
}

export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "running":
      return "执行中";
    case "waiting_approval":
      return "待审批";
    case "blocked":
      return "已熔断";
    case "completed":
      return "已完成";
    case "draft":
      return "草稿";
    case "ready":
      return "待开始";
    case "failed":
      return "未完成";
    case "cancelled":
      return "已取消";
    case "archived":
      return "已归档";
    default:
      return "已暂停";
  }
}

export function runStatusLabel(status: Run["status"]): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "paused":
      return "已暂停";
    case "waiting_approval":
      return "待审批";
    case "blocked":
      return "已熔断";
    case "completed":
      return "已完成";
    case "failed":
      return "未完成";
    case "cancelled":
      return "已取消";
  }
}

// ── project tree (左导航：项目 → 任务树) ───────────────────────

export interface ProjectNode {
  project: Project;
  tasks: Task[];
}

export function buildProjectTree(projects: Project[], tasksByProject: Map<string, Task[]>): ProjectNode[] {
  return projects.map((project) => ({
    project,
    tasks: [...(tasksByProject.get(project.id) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}

/** 进行中：有活 run 的任务（running / waiting_approval / blocked）。 */
export function collectActiveTasks(nodes: ProjectNode[]): Array<{ project: Project; task: Task }> {
  const active: Array<{ project: Project; task: Task }> = [];
  for (const node of nodes) {
    for (const task of node.tasks) {
      if (["running", "waiting_approval", "blocked"].includes(task.status)) {
        active.push({ project: node.project, task });
      }
    }
  }
  return active.sort((a, b) => b.task.updatedAt - a.task.updatedAt);
}

// ── task bundle derivations (主面板：进度与下一步) ─────────────

export interface TaskBundleLike {
  task: Task;
  runs: Run[];
  steps: Step[];
  evidence: Evidence[];
  approvals: Approval[];
  checkpoints: RunCheckpoint[];
}

export interface TaskProgress {
  latestRun: Run | null;
  latestSteps: Step[];
  latestCheckpoint: RunCheckpoint | null;
  pendingApprovals: Approval[];
  /** Can a fresh run be started now (no live episode)? */
  canStart: boolean;
  /** Live episode states that accept pause/cancel. */
  live: boolean;
  nextAction: string;
}

export function deriveProgress(bundle: TaskBundleLike | null): TaskProgress {
  if (!bundle) {
    return {
      latestRun: null,
      latestSteps: [],
      latestCheckpoint: null,
      pendingApprovals: [],
      canStart: false,
      live: false,
      nextAction: "读取任务中…",
    };
  }
  const latestRun = bundle.runs.at(-1) ?? null;
  const latestSteps = latestRun
    ? bundle.steps.filter((step) => step.runId === latestRun.id)
    : [];
  const latestCheckpoint = latestRun
    ? (bundle.checkpoints.filter((cp) => cp.runId === latestRun.id).at(-1) ?? null)
    : null;
  const pendingApprovals = bundle.approvals.filter((approval) => approval.status === "pending");
  const live =
    latestRun !== null && ["running", "waiting_approval", "queued"].includes(latestRun.status);
  const canStart = !live;
  let nextAction: string;
  if (pendingApprovals.length > 0) {
    nextAction = `等待审批（${pendingApprovals.length} 项）`;
  } else if (!latestRun) {
    nextAction = "尚未运行 — 信任项目并启动";
  } else if (latestRun.status === "running") {
    nextAction = "正在执行 — 可暂停或取消";
  } else if (latestRun.status === "waiting_approval") {
    nextAction = "运行停在审批门";
  } else if (latestRun.status === "completed") {
    nextAction = "本轮已完成 — 可重新运行或退出工作模式";
  } else if (latestRun.status === "paused" || latestRun.status === "blocked") {
    nextAction = "已暂停 — 启动新 run 从 checkpoint 续接";
  } else if (latestRun.status === "failed") {
    nextAction = "未完成 — 排查后可重新启动";
  } else {
    nextAction = "已取消 — 可重新启动";
  }
  return { latestRun, latestSteps, latestCheckpoint, pendingApprovals, canStart, live, nextAction };
}

// ── evidence grouping (右证据轨：全部来自观测，零 LLM 自述) ─────

export interface EvidenceGroups {
  /** 当前输出：log 行（运行回复、checkpoint 说明）。 */
  outputs: Evidence[];
  /** 变更文件：真实 diff（工具自带 diff / 磁盘观测）。 */
  diffs: Evidence[];
  /** 测试/检查结果。 */
  tests: Evidence[];
  /** 其他命令执行。 */
  commands: Evidence[];
  /** 产物（checkpoint 会话索引、蒸馏产物等）。 */
  artifacts: Evidence[];
  /** R5: Host-observed personal context sources (opaque refs). */
  sources: Evidence[];
}

export function groupEvidence(evidence: Evidence[]): EvidenceGroups {
  const groups: EvidenceGroups = {
    outputs: [],
    diffs: [],
    tests: [],
    commands: [],
    artifacts: [],
    sources: [],
  };
  for (const item of [...evidence].sort((a, b) => b.createdAt - a.createdAt)) {
    switch (item.kind) {
      case "diff":
        groups.diffs.push(item);
        break;
      case "test":
        groups.tests.push(item);
        break;
      case "command":
        groups.commands.push(item);
        break;
      case "source":
        groups.sources.push(item);
        break;
      case "artifact":
      case "file":
      case "screenshot":
        groups.artifacts.push(item);
        break;
      default:
        groups.outputs.push(item);
        break;
    }
  }
  return groups;
}

// ── usage / budget view models ─────────────────────────────────

export function usageForProject(report: UsageReport | null, projectId: string): UsageRow[] {
  if (!report) return [];
  return report.rows.filter((row) => row.projectId === projectId);
}

export function usageTotalForProject(report: UsageReport | null, projectId: string): number {
  return usageForProject(report, projectId).reduce(
    (sum, row) => sum + row.inputTokens + row.outputTokens,
    0,
  );
}

/** 预算维度标签："day" → 全局日预算；"project:<id>" → 项目名。 */
export function dimensionLabel(dimension: string, projects: Project[]): string {
  if (dimension === "day") return "全局日预算";
  if (dimension.startsWith("project:")) {
    const projectId = dimension.slice("project:".length);
    const project = projects.find((candidate) => candidate.id === projectId);
    return project ? `项目「${project.name}」日预算` : `项目 ${projectId.slice(0, 8)} 日预算`;
  }
  return dimension;
}

export function dimensionSeverity(dimension: BudgetDimensionStatus): "ok" | "warn" | "alert" {
  if (dimension.tripped && !dimension.lifted) return "alert";
  if (dimension.warned) return "warn";
  return "ok";
}

// ── conversations (左导航进行中 / 会话列表) ────────────────────

export function conversationBadge(conversation: Conversation): string {
  return conversation.activeTaskId ? "有工作区" : "助理目录";
}
