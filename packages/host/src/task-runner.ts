import * as path from "node:path";
import type { Mode, ModelProfile, Project, Run, RunBudget, Task } from "@penglai/protocol";
import type {
  AgentKernel,
  HostToolHandlers,
  KernelEvent,
  KernelInputSource,
} from "./kernel/kernel.js";
import type { ProductStore } from "./storage/product-store.js";
import { indexRunCheckpoint } from "./checkpoints.js";
import { POLICY_PROFILE, type PolicyDecision } from "./policy.js";
import { recordToolEvidence } from "./tool-evidence.js";
import type {
  ApprovalGateRequest,
  ApprovalService,
  ApprovalVerdict,
} from "./approvals.js";
import type { MemoryStore } from "./memory.js";
import { cleanFinalText, splitModelText } from "./output-clean.js";
import {
  EpisodeAuthorityError,
  resolveWorkspaceAuthority,
  sameEpisodeAuthority,
  type EpisodeAuthoritySnapshot,
} from "./episode-authority.js";

export interface TaskKernelOptions {
  runId: string;
  taskId: string;
  workspaceRoot: string;
  dataDir: string;
  profile: ModelProfile;
  apiKey: string;
  mode: Mode;
  /**
   * Permission dial for the episode. Task/run path always uses `confirm` so
   * L2/L3 still park at awaiting_approval.
   */
  permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
  /** Fail-closed Host authority check run before every Pi tool call. */
  revalidateAuthority?: () => void | Promise<void>;
  /** Whether this episode is project-anchored (selects memory depth). */
  projectAnchored?: boolean;
  /** Conversation this run grew out of (chat runner; null for bare tasks). */
  conversationId?: string | null;
  /** Two-layer memory for the mode-aware assembly. */
  memory?: MemoryStore;
  /** Safe Host-side skill/goal handlers. */
  hostTools?: HostToolHandlers;
  /** Per-project L2 grant lookup (审批四级制 同类免问). */
  hasPolicyGrant?: (grantKey: string) => boolean;
  /** L2/L3 human-in-the-loop gate; absent → fail closed. */
  approvalGate?: (request: ApprovalGateRequest) => Promise<ApprovalVerdict>;
  /** L4 denial recorder (evidence on the durable task). */
  onL4Denied?: (info: {
    toolName: string;
    args: Record<string, unknown>;
    decision: PolicyDecision;
  }) => void;
}

export type TaskKernelFactory = (options: TaskKernelOptions) => Promise<AgentKernel>;

export interface StartTaskOptions {
  task: Task;
  project: Project;
  profile: ModelProfile;
  apiKey: string;
  source: KernelInputSource;
  mode: Mode;
  /**
   * Per-run budget overrides. Any dimension left unset falls back to the
   * active Mode's policy profile (policy.ts, 待 owner 校准); the merged
   * result is persisted on the Run record for audit.
   */
  budget?: Partial<RunBudget>;
  /** Conversation this run grew out of, if any. */
  conversationId?: string | null;
}

/** Token usage observed from kernel events during one episode. */
export interface EpisodeUsage {
  runId: string;
  taskId: string;
  /** The Mode the episode ran under (cost aggregation dimension). */
  mode: Mode;
  /** Project the episode was anchored to (cost aggregation dimension). */
  projectId: string;
  modelProfileId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TaskRunnerExtras {
  memory?: MemoryStore;
  hostTools?: HostToolHandlers;
  /** The L2/L3 approval service (审批四级制); absent → L2/L3 fail closed. */
  approvals?: ApprovalService;
  /**
   * 成本熔断前置门（approval-mode degradation, design §7）: invoked once
   * the Run row exists and BEFORE the kernel is constructed. The server's
   * wiring returns a trivial pass when no breaker is tripped, and routes
   * through the L3 approval service (capability l3:budget-override) when
   * one is — the run pauses at awaiting_approval before spending a single
   * token. A denied verdict cancels the fresh run.
   */
  preFlightApproval?: (ctx: {
    task: Task;
    run: Run;
    project: Project;
  }) => Promise<ApprovalVerdict>;
  /** Sink for per-episode token usage (host cost visibility). */
  onUsage?: (usage: EpisodeUsage) => void;
  /**
   * 蒸馏环入口（design §6/§9）: fired once per run whose final status is
   * "completed", after the checkpoint is indexed. The DistillService turns
   * the transcript into an audited candidate SOP. Fire-and-forget — the
   * runner never awaits it and the run's outcome never depends on it.
   */
  onRunCompleted?: (info: {
    task: Task;
    run: Run;
    project: Project;
    sessionPath: string | null;
  }) => void;
  /** One-line logger (defaults to silence in embedders/tests). */
  log?: (line: string) => void;
  /** False while the Host is draining a project/task authority mutation. */
  isProjectAuthorityAvailable?: (projectId: string) => boolean;
  isTaskAuthorityAvailable?: (taskId: string) => boolean;
}

interface ActiveTaskRun {
  kernel: AgentKernel;
  taskId: string;
  stepId: string;
  authority: EpisodeAuthoritySnapshot;
  cancelled: boolean;
  completion: Promise<void>;
}

interface AssemblingTaskRun {
  taskId: string;
  projectId: string;
  revokedReason: string | null;
  settled: Promise<void>;
  resolveSettled: () => void;
}

function settlement(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const MAX_RESPONSE_EVIDENCE_CHARS = 64 * 1024;

/**
 * Best-effort extraction of provider-reported token usage from a raw Pi
 * `message_end` event. Returns null when the event is not an assistant
 * message or the provider reported nothing — token budgets simply do not
 * fire without provider accounting. Shared by the task and chat runners.
 */
export function extractAssistantUsage(
  raw: unknown,
): { input: number; output: number } | null {
  const event = raw as {
    type?: unknown;
    message?: {
      role?: unknown;
      usage?: { input?: unknown; output?: unknown };
    };
  };
  if (event?.type !== "message_end") return null;
  const message = event.message;
  if (message?.role !== "assistant" || !message.usage) return null;
  const input =
    typeof message.usage.input === "number" ? message.usage.input : 0;
  const output =
    typeof message.usage.output === "number" ? message.usage.output : 0;
  return input + output > 0 ? { input, output } : null;
}

export class TaskRunner {
  private readonly active = new Map<string, ActiveTaskRun>();
  private readonly assembling = new Map<string, AssemblingTaskRun>();
  /** Runs parked at the pre-flight budget gate (deferred continuation). */
  private readonly pendingStarts = new Map<string, Promise<void>>();
  /**
   * Tasks whose start() is in flight (synchronous section between the check
   * and the first await). Guards the same-tick double-start race: two
   * concurrent task.start calls for the same task must not both proceed.
   */
  private readonly starting = new Set<string>();

  constructor(
    private readonly store: ProductStore,
    private readonly dataDir: string,
    private readonly kernelFactory: TaskKernelFactory,
    private readonly publish: (taskId: string, event: unknown) => void = () => {},
    private readonly extras: TaskRunnerExtras = {},
  ) {}

  private authoritySnapshot(
    runId: string,
    task: Task,
    project: Project,
  ): EpisodeAuthoritySnapshot {
    const workspace = resolveWorkspaceAuthority(project.rootPath);
    return {
      kind: "task",
      conversationId: null,
      runId,
      taskId: task.id,
      projectId: project.id,
      workspaceRoot: workspace.workspaceRoot,
      workspaceIdentity: workspace.workspaceIdentity,
      trusted: project.trusted === true,
      permissionMode: "confirm",
    };
  }

  private currentAuthority(
    expected: EpisodeAuthoritySnapshot,
  ): EpisodeAuthoritySnapshot {
    const taskId = expected.taskId;
    const projectId = expected.projectId;
    if (!taskId || !projectId) {
      throw new EpisodeAuthorityError("task authority is incomplete");
    }
    if (this.extras.isTaskAuthorityAvailable?.(taskId) === false) {
      throw new EpisodeAuthorityError(`task ${taskId} authority is being revoked`);
    }
    if (this.extras.isProjectAuthorityAvailable?.(projectId) === false) {
      throw new EpisodeAuthorityError(
        `project ${projectId} authority is being revoked`,
      );
    }
    const task = this.store.getTask(taskId);
    const project = this.store.getProject(projectId);
    if (!task || task.projectId !== projectId || !project) {
      throw new EpisodeAuthorityError("task project authority no longer exists");
    }
    return this.authoritySnapshot(expected.runId ?? "", task, project);
  }

  private assertAuthority(expected: EpisodeAuthoritySnapshot): void {
    const current = this.currentAuthority(expected);
    if (!sameEpisodeAuthority(expected, current) || current.trusted !== true) {
      throw new EpisodeAuthorityError();
    }
  }

  private revalidateToolAuthority(
    runId: string,
    authority: EpisodeAuthoritySnapshot,
  ): void {
    try {
      this.assertAuthority(authority);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "episode authority changed";
      void this.abortWithReason(runId, detail).catch((abortError) => {
        this.extras.log?.(
          `run ${runId}: authority abort failed: ${
            abortError instanceof Error ? abortError.message : String(abortError)
          }`,
        );
      });
      throw error;
    }
  }

  async start(options: StartTaskOptions): Promise<Run> {
    if (
      !options.project.trusted ||
      this.extras.isProjectAuthorityAvailable?.(options.project.id) === false ||
      this.extras.isTaskAuthorityAvailable?.(options.task.id) === false
    ) {
      throw new Error("project is not trusted for execution");
    }
    if (this.starting.has(options.task.id)) {
      throw new Error("task is already starting");
    }
    if ([...this.active.values()].some((active) => active.taskId === options.task.id)) {
      throw new Error("task already has an active run");
    }
    for (const runId of this.pendingStarts.keys()) {
      if (this.store.getRun(runId)?.taskId === options.task.id) {
        throw new Error("task already has an active run");
      }
    }
    this.starting.add(options.task.id);
    try {
      return await this.startInner(options);
    } finally {
      this.starting.delete(options.task.id);
    }
  }

  private settlePreFlight(
    runId: string,
    taskId: string,
    status: "cancelled" | "failed",
    message: string,
  ): void {
    const liveRun = this.store.getRun(runId);
    if (!liveRun || !["running", "waiting_approval"].includes(liveRun.status)) return;
    this.store.transitionRun(runId, status, message);
    this.publish(taskId, {
      event: `task.run.${status}`,
      taskId,
      runId,
      message,
    });
  }

  private async startInner(options: StartTaskOptions): Promise<Run> {
    // Bounded episode: any budget dimension not set on the Run falls back to
    // the single policy profile (safety rails, not a product budget); the
    // merged ceiling is persisted on the Run record so the stop condition is
    // auditable. `mode` is now only a storage/usage label, not a profile key.
    const profileSpec = POLICY_PROFILE;
    const effectiveBudget = {
      maxTurns: options.budget?.maxTurns ?? profileSpec.maxTurns,
      maxDurationMs:
        options.budget?.maxDurationMs ?? profileSpec.budget.maxDurationMs,
      maxTokens: options.budget?.maxTokens ?? profileSpec.budget.maxTokens,
      maxToolFailures:
        options.budget?.maxToolFailures ?? profileSpec.budget.maxToolFailures,
    };
    const run = this.store.createRun({
      taskId: options.task.id,
      modelProfileId: options.profile.id,
      budget: effectiveBudget,
    });
    this.store.transitionRun(run.id, "running");

    // 成本熔断前置门（approval-mode degradation）：有前置门时 start 不等
    // 裁决——run 创建后即停 waiting_approval 并立即返回（RPC/CLI 不悬挂）；
    // 批准后同一 run 异步构建内核开工，拒绝则取消。无前置门走内联路径。
    if (this.extras.preFlightApproval) {
      const continuation = (async () => {
        const verdict = await this.extras.preFlightApproval!({
          task: options.task,
          run,
          project: options.project,
        });
        if (!verdict.approved) {
          this.settlePreFlight(run.id, options.task.id, "cancelled", verdict.note);
          return;
        }
        await this.executeEpisode(run, options, effectiveBudget);
      })();
      const tracked = continuation
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          try {
            this.settlePreFlight(run.id, options.task.id, "failed", message);
          } catch (settleError) {
            this.extras.log?.(
              `run ${run.id}: pre-flight failure did not settle cleanly: ` +
                `${settleError instanceof Error ? settleError.message : String(settleError)}`,
            );
          }
          this.extras.log?.(
            `run ${run.id}: pre-flight continuation failed: ${message}`,
          );
        })
        .finally(() => {
          this.pendingStarts.delete(run.id);
        });
      this.pendingStarts.set(run.id, tracked);
      return this.store.getRun(run.id) ?? run;
    }

    await this.executeEpisode(run, options, effectiveBudget);
    return this.store.getRun(run.id) ?? run;
  }

  /**
   * Build the kernel and run the episode (the old inline start path,
   * extracted so the budget pre-flight can defer it until approval).
   * Returns once the episode is SET UP; `wait(runId)` tracks settlement.
   */
  /**
   * Settle a run at a terminal status from the episode-completion path.
   *
   * H3 fix: an external `run.transition` RPC may have already moved the run
   * (or its step) to a terminal status while the episode was still finishing.
   * The state machine refuses terminal->terminal transitions, so blindly
   * calling transitionRun here would throw inside the .catch chain and crash
   * the process (unhandled rejection). Instead, re-read the live rows and
   * skip the transition when the target is already terminal, keeping the
   * first terminal timestamp intact.
   */
  private settleRun(
    stepId: string,
    runId: string,
    status: "completed" | "failed" | "cancelled",
    message: string | null,
  ): void {
    try {
      const liveRun = this.store.getRun(runId);
      const liveStep = this.store.getStep(stepId);
      const terminalRun =
        liveRun && ["completed", "failed", "cancelled"].includes(liveRun.status);
      const terminalStep =
        liveStep && ["completed", "failed", "skipped"].includes(liveStep.status);

      // Steps have no cancelled status; Owner abort maps step→failed, run→cancelled
      // (same as abortWithReason).
      const stepStatus = status === "cancelled" ? "failed" : status;
      if (!terminalStep && liveStep) {
        this.store.transitionStep(stepId, stepStatus, message ?? "Pi episode settled");
      }
      if (!terminalRun && liveRun) {
        this.store.transitionRun(runId, status, message);
      }
    } catch (error) {
      // The settle path must never throw into an already-caught chain; the
      // outer last-resort .catch records it, and crash recovery reconciles.
      this.extras.log?.(
        `run ${runId}: settle transition failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async executeEpisode(
    run: Run,
    options: StartTaskOptions,
    effectiveBudget: {
      maxTurns: number;
      maxDurationMs: number | null;
      maxTokens: number | null;
      maxToolFailures: number;
    },
  ): Promise<void> {

    // The approval gate closes over the run; the step id is filled in once
    // the step row exists (the gate only fires after the episode starts).
    let activeStepId: string | null = null;
    let kernel: AgentKernel | null = null;
    let authority: EpisodeAuthoritySnapshot;
    const assemblySettlement = settlement();
    const assembly: AssemblingTaskRun = {
      taskId: options.task.id,
      projectId: options.project.id,
      revokedReason: null,
      settled: assemblySettlement.promise,
      resolveSettled: assemblySettlement.resolve,
    };
    this.assembling.set(run.id, assembly);
    try {
      authority = this.authoritySnapshot(
        run.id,
        options.task,
        options.project,
      );
      this.assertAuthority(authority);
      kernel = await this.kernelFactory({
        runId: run.id,
        taskId: options.task.id,
        workspaceRoot: authority.workspaceRoot,
        dataDir: this.dataDir,
        profile: options.profile,
        apiKey: options.apiKey,
        mode: options.mode,
        // Task/run path always uses the confirm dial so L2/L3 still park at
        // awaiting_approval (auto_edit would auto-pass L2 and break the
        // four-level adjudication surface for owner-gated runs).
        permissionMode: "confirm",
        revalidateAuthority: () =>
          this.revalidateToolAuthority(run.id, authority),
        projectAnchored: true,
        conversationId: options.conversationId ?? null,
        memory: this.extras.memory,
        hostTools: this.extras.hostTools,
        // 审批四级制 wiring: L2 grant lookup, the L2/L3 human gate, and the
        // L4 denial recorder (evidence rows on the durable task).
        hasPolicyGrant: (grantKey) =>
          this.store.hasPolicyGrant(options.project.id, grantKey),
        approvalGate: this.extras.approvals
          ? (request) =>
              this.extras.approvals!.requestDecision(
                {
                  task: options.task,
                  run,
                  project: options.project,
                  stepId: activeStepId,
                },
                request,
              )
          : undefined,
        onL4Denied: (info) => {
          try {
            this.store.addEvidence({
              taskId: options.task.id,
              runId: run.id,
              stepId: activeStepId,
              kind: "log",
              title: `L4 拒绝：${info.toolName}`,
              summary: info.decision.reason,
              metadata: {
                code: info.decision.code,
                toolName: info.toolName,
                args: JSON.stringify(info.args).slice(0, 500),
              },
            });
          } catch (error) {
            this.extras.log?.(
              `run ${run.id}: L4 denial evidence failed: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      });
      if (assembly.revokedReason) {
        throw new EpisodeAuthorityError(assembly.revokedReason);
      }
      this.assertAuthority(authority);
    } catch (error) {
      try {
        await kernel?.abort();
      } catch {
        /* best-effort */
      }
      kernel?.dispose();
      const liveRun = this.store.getRun(run.id);
      if (liveRun && !["completed", "failed", "cancelled"].includes(liveRun.status)) {
        this.store.transitionRun(
          run.id,
          assembly.revokedReason ? "cancelled" : "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    } finally {
      this.assembling.delete(run.id);
      assembly.resolveSettled();
    }

    // The guarded assembly above establishes this invariant.
    const episodeKernel = kernel;

    const step = this.store.createStep({
      runId: run.id,
      title: "Pi Agent execution",
    });
    activeStepId = step.id;
    this.store.transitionStep(step.id, "running");

    const active: ActiveTaskRun = {
      kernel: episodeKernel,
      taskId: options.task.id,
      stepId: step.id,
      authority,
      cancelled: false,
      completion: Promise.resolve(),
    };
    this.active.set(run.id, active);

    let responseText = "";
    // Bounded-episode counters (design §5: 达到预算即停并写 checkpoint 说明).
    const counters = {
      turns: 0,
      toolFailures: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    let budgetStop: string | null = null;

    const stopForBudget = (reason: string): void => {
      if (active.cancelled || budgetStop) return;
      budgetStop = reason;
      // A gate may be holding a tool call when the budget fires: settle it
      // as denied so the kernel unblocks into the abort below.
      this.extras.approvals?.cancelPendingForRun(run.id, reason);
      // Checkpoint first: the episode's last word is an auditable note
      // explaining where it stopped and how to resume.
      this.store.addEvidence({
        taskId: options.task.id,
        runId: run.id,
        stepId: step.id,
        kind: "log",
        title: "Checkpoint: episode budget exhausted",
        summary:
          `${reason}. Counters at stop: turns=${counters.turns}/${effectiveBudget.maxTurns}, ` +
          `toolFailures=${counters.toolFailures}/${effectiveBudget.maxToolFailures}, ` +
          `tokens=${counters.inputTokens + counters.outputTokens}/${effectiveBudget.maxTokens ?? "unbounded"}. ` +
          `Transcript and evidence so far are durable; resume with a fresh run.`,
      });
      this.store.transitionStep(step.id, "blocked", reason);
      // Do not expose a terminal Run before its checkpoint exists.  The
      // prompt abort settles into the completion.finally path below, which
      // first indexes the flushed Pi transcript and only then transitions the
      // Run to blocked.  This preserves the product invariant that a caller
      // observing a stopped run can immediately inspect its durable evidence.
      void active.kernel.abort().catch(() => undefined);
    };

    const checkBudget = (): void => {
      if (budgetStop) return;
      if (counters.turns >= effectiveBudget.maxTurns) {
        stopForBudget(
          `turn budget exhausted (${counters.turns}/${effectiveBudget.maxTurns})`,
        );
        return;
      }
      if (counters.toolFailures >= effectiveBudget.maxToolFailures) {
        stopForBudget(
          `tool-failure budget exhausted (${counters.toolFailures}/${effectiveBudget.maxToolFailures})`,
        );
        return;
      }
      if (
        effectiveBudget.maxTokens !== null &&
        counters.inputTokens + counters.outputTokens >= effectiveBudget.maxTokens
      ) {
        stopForBudget(
          `token budget exhausted (${counters.inputTokens + counters.outputTokens}/${effectiveBudget.maxTokens})`,
        );
      }
    };

    const durationTimer =
      effectiveBudget.maxDurationMs !== null
        ? setTimeout(
            () =>
              stopForBudget(
                `duration budget exhausted (${effectiveBudget.maxDurationMs}ms)`,
              ),
            effectiveBudget.maxDurationMs,
          )
        : null;
    durationTimer?.unref?.();

    // Tool arguments captured at tool.started (per toolCallId) so the
    // completion can derive observational evidence (diff/command/preview).
    const pendingToolArgs = new Map<string, Record<string, unknown>>();

    const unsubscribe = episodeKernel.subscribe((event) => {
      const { raw: _raw, ...publicEvent } = event;
      this.publish(options.task.id, {
        event: event.kind,
        runId: run.id,
        ...publicEvent,
      });
      if (event.kind === "message.delta" && event.textDelta) {
        responseText = (responseText + event.textDelta).slice(
          -MAX_RESPONSE_EVIDENCE_CHARS,
        );
      }
      if (event.kind === "turn.completed") {
        counters.turns += 1;
        checkBudget();
      }
      if (event.kind === "message.completed") {
        const usage = extractAssistantUsage(event.raw);
        if (usage) {
          counters.inputTokens += usage.input;
          counters.outputTokens += usage.output;
          checkBudget();
        }
      }
      if (event.kind === "tool.started" && event.toolCallId) {
        const args =
          event.data && typeof event.data === "object" && !Array.isArray(event.data)
            ? (event.data as Record<string, unknown>)
            : {};
        pendingToolArgs.set(event.toolCallId, args);
      }
      if (event.kind === "tool.completed") {
        if (event.isError) {
          counters.toolFailures += 1;
          checkBudget();
        }
        // 证据轨（零 LLM 自述）: the row derives from the tool layer / disk
        // observation — the applied diff, the re-read written file, the
        // captured command output — never from model narration.
        const toolArgs = event.toolCallId
          ? pendingToolArgs.get(event.toolCallId) ?? {}
          : {};
        if (event.toolCallId) pendingToolArgs.delete(event.toolCallId);
        recordToolEvidence({
          store: this.store,
          taskId: options.task.id,
          runId: run.id,
          stepId: step.id,
          workspaceRoot: options.project.rootPath,
          toolCallId: event.toolCallId ?? null,
          toolName: event.toolName ?? null,
          args: toolArgs,
          result: event.data,
          isError: event.isError ?? false,
          log: this.extras.log,
        });
      }
    });

    active.completion = episodeKernel
      .prompt({ text: options.task.objective, source: options.source })
      .then(() => {
        if (active.cancelled || budgetStop) return;
        if (responseText.trim()) {
          // Same user-facing contract as chat: never put raw <think> into the
          // evidence rail. Engine session JSONL still holds the full stream.
          const split = splitModelText(responseText);
          const summary = (split.result || cleanFinalText(responseText)).trim();
          if (summary) {
            this.store.addEvidence({
              taskId: options.task.id,
              runId: run.id,
              stepId: step.id,
              kind: "log",
              title: "Pi Agent response",
              summary,
            });
          }
          if (split.thinking.trim()) {
            this.store.addEvidence({
              taskId: options.task.id,
              runId: run.id,
              stepId: step.id,
              kind: "log",
              title: "Thinking (activity)",
              summary: split.thinking.trim().slice(0, 4000),
            });
          }
        }
        // C5: .then only runs when the episode kernel reported completed
        // (budget/aborted/failed reject with stopReason; see task-episode-kernel).
        this.settleRun(step.id, run.id, "completed", null);
        this.publish(options.task.id, {
          event: "task.run.completed",
          taskId: options.task.id,
          runId: run.id,
        });
      })
      .catch((error) => {
        if (active.cancelled || budgetStop) return;
        const stopReason =
          error && typeof error === "object" && "stopReason" in error
            ? (error as { stopReason?: string }).stopReason
            : undefined;
        const message = error instanceof Error ? error.message : String(error);
        // Episode budget stop: keep the existing blocked path (not failed, not
        // completed) so onRunCompleted/distill never fires.
        if (stopReason === "budget") {
          budgetStop = message || "episode budget exhausted";
          return;
        }
        if (stopReason === "aborted") {
          // Owner abort / interrupt already transitions via abortWithReason;
          // if we still land here (e.g. episode abort without active.cancelled),
          // leave a cancelled terminal rather than mislabeling as failed.
          const live = this.store.getRun(run.id);
          if (live && !["completed", "failed", "cancelled"].includes(live.status)) {
            this.settleRun(step.id, run.id, "cancelled", message || "episode aborted");
            this.publish(options.task.id, {
              event: "task.run.cancelled",
              taskId: options.task.id,
              runId: run.id,
              message: message || "episode aborted",
            });
          }
          return;
        }
        this.settleRun(step.id, run.id, "failed", message);
        this.publish(options.task.id, {
          event: "task.run.failed",
          taskId: options.task.id,
          runId: run.id,
          message,
        });
      })
      .catch((error) => {
        // Last-resort guard (H3): the settle path itself must never throw an
        // unhandled rejection. If transitionRun still raised (e.g. a store
        // outage), record it and leave the DB state for crash recovery.
        this.extras.log?.(
          `run ${run.id}: settle path failed unexpectedly: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        if (durationTimer) clearTimeout(durationTimer);
        // Cost visibility (design §7): provider-reported usage is best-effort.
        // A silent provider still leaves a 0-token record — never a gap.
        if (counters.inputTokens + counters.outputTokens === 0) {
          this.extras.log?.(
            `run ${run.id}: provider reported no token usage; recording 0 ` +
              `(token ceilings never fired this episode)`,
          );
        }
        this.extras.onUsage?.({
          runId: run.id,
          taskId: options.task.id,
          mode: options.mode,
          projectId: options.project.id,
          modelProfileId: options.profile.id,
          model: options.profile.model,
          inputTokens: counters.inputTokens,
          outputTokens: counters.outputTokens,
          totalTokens: counters.inputTokens + counters.outputTokens,
        });
        // Lightweight checkpoint: index the engine session transcript (Pi
        // session JSONL) as the run's engine attachment, with the task
        // summary and the episode's budget usage.
        try {
          const storedRun = this.store.getRun(run.id);
          if (storedRun) {
            const settled = budgetStop && storedRun.status === "running"
              ? { ...storedRun, status: "blocked" as const, error: budgetStop }
              : storedRun;
            const checkpoint = indexRunCheckpoint(this.store, this.dataDir, {
              run: settled,
              task: options.task,
              turns: counters.turns,
              toolFailures: counters.toolFailures,
              inputTokens: counters.inputTokens,
              outputTokens: counters.outputTokens,
              sessionId: episodeKernel.sessionId,
            });
            // 蒸馏环 v1（design §6/§9）：只有干净完工的 run 才复盘；审计闸
            // 挡注入，入树走 writeGlobalSop 专属通道。异步触发，绝不阻塞
            // settle 尾段。
            if (settled.status === "completed") {
              try {
                this.extras.onRunCompleted?.({
                  task: options.task,
                  run: settled,
                  project: options.project,
                  sessionPath: checkpoint.sessionPath,
                });
              } catch (error) {
                this.extras.log?.(
                  `run ${run.id}: distillation trigger failed: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
          }
        } catch (error) {
          this.extras.log?.(
            `run ${run.id}: checkpoint indexing failed: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          if (budgetStop) {
            // R8: episode-kernel budget and local counters both end here.
            // Keep Run and the current Step on the same non-success terminal
            // (blocked) so distill never fires and restart recovery cannot
            // revive a budget-stopped step as still running.
            const currentStep = this.store.getStep(step.id);
            if (
              currentStep &&
              !["completed", "failed", "skipped", "blocked"].includes(
                currentStep.status,
              )
            ) {
              this.store.transitionStep(step.id, "blocked", budgetStop);
            }
            const current = this.store.getRun(run.id);
            if (current?.status === "running") {
              this.store.transitionRun(run.id, "blocked", budgetStop);
            }
            this.publish(options.task.id, {
              event: "task.run.blocked",
              taskId: options.task.id,
              runId: run.id,
              reason: budgetStop,
            });
          }
        }
        unsubscribe();
        episodeKernel.dispose();
        this.active.delete(run.id);
      });

    this.publish(options.task.id, {
      event: "task.run.started",
      taskId: options.task.id,
      runId: run.id,
    });
  }

  private async abortWithReason(
    runId: string,
    reason: string,
  ): Promise<boolean> {
    const assembly = this.assembling.get(runId);
    if (assembly) {
      assembly.revokedReason = reason;
      await assembly.settled;
      return true;
    }
    const active = this.active.get(runId);
    if (!active) {
      // A run parked at the pre-flight budget gate: settle the gate denied;
      // the deferred continuation cancels the run (no kernel ever existed).
      if (this.pendingStarts.has(runId)) {
        this.extras.approvals?.cancelPendingForRun(runId, reason);
        await this.pendingStarts.get(runId);
        return true;
      }
      return false;
    }
    active.cancelled = true;
    // Settle any approval gate the episode is waiting on (denied), or the
    // kernel would hang inside the held tool call.
    this.extras.approvals?.cancelPendingForRun(runId, reason);
    let abortError: unknown;
    try {
      await active.kernel.abort();
    } catch (error) {
      abortError = error;
    } finally {
      const run = this.store.getRun(runId);
      if (run && (run.status === "running" || run.status === "waiting_approval")) {
        this.store.transitionStep(active.stepId, "failed", reason);
        this.store.transitionRun(runId, "cancelled", reason);
      }
      this.publish(active.taskId, {
        event: "task.run.cancelled",
        taskId: active.taskId,
        runId,
      });
    }
    await active.completion;
    if (abortError) throw abortError;
    return true;
  }

  async abort(runId: string): Promise<boolean> {
    return this.abortWithReason(runId, "run aborted by owner");
  }

  async abortProjectEpisodes(
    projectId: string,
    reason = "project authority revoked",
  ): Promise<number> {
    const runIds = new Set<string>();
    for (const [runId, active] of this.active) {
      if (active.authority.projectId === projectId) runIds.add(runId);
    }
    for (const [runId, assembly] of this.assembling) {
      if (assembly.projectId === projectId) runIds.add(runId);
    }
    for (const runId of this.pendingStarts.keys()) {
      const task = this.store.getTask(this.store.getRun(runId)?.taskId ?? "");
      if (task?.projectId === projectId) runIds.add(runId);
    }
    await Promise.all(
      [...runIds].map((runId) => this.abortWithReason(runId, reason)),
    );
    return runIds.size;
  }

  async abortTaskEpisodes(
    taskId: string,
    reason = "task authority revoked",
  ): Promise<number> {
    const runIds = new Set<string>();
    for (const [runId, active] of this.active) {
      if (active.taskId === taskId) runIds.add(runId);
    }
    for (const [runId, assembly] of this.assembling) {
      if (assembly.taskId === taskId) runIds.add(runId);
    }
    for (const runId of this.pendingStarts.keys()) {
      if (this.store.getRun(runId)?.taskId === taskId) runIds.add(runId);
    }
    await Promise.all(
      [...runIds].map((runId) => this.abortWithReason(runId, reason)),
    );
    return runIds.size;
  }

  /**
   * Pause the active run: stop the engine but keep the episode resumable.
   * The run settles as "paused" (task blocked); `task.start` opens a fresh
   * run — the durable checkpoint (engine session + evidence) is what the
   * next episode resumes from.
   */
  async pause(runId: string): Promise<boolean> {
    const active = this.active.get(runId);
    if (!active) return false;
    active.cancelled = true;
    this.extras.approvals?.cancelPendingForRun(runId, "run paused by owner");
    try {
      await active.kernel.abort();
    } finally {
      const run = this.store.getRun(runId);
      if (run && (run.status === "running" || run.status === "waiting_approval")) {
        this.store.transitionStep(active.stepId, "blocked", "Paused by owner");
        this.store.transitionRun(runId, "paused", "Paused by owner");
      }
      this.publish(active.taskId, {
        event: "task.run.paused",
        taskId: active.taskId,
        runId,
      });
    }
    return true;
  }

  /** The active run id for a task, or null when no episode is running. */
  activeRunForTask(taskId: string): string | null {
    for (const [runId, active] of this.active) {
      if (active.taskId === taskId) return runId;
    }
    return null;
  }

  /** A run parked at the pre-flight budget gate for this task, if any. */
  pendingRunForTask(taskId: string): string | null {
    for (const runId of this.pendingStarts.keys()) {
      if (this.store.getRun(runId)?.taskId === taskId) return runId;
    }
    return null;
  }

  async steer(runId: string, text: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) throw new Error("run is not active");
    const rejectAuthorityChange = async (error: unknown): Promise<never> => {
      await this.abortWithReason(
        runId,
        error instanceof Error ? error.message : "episode authority changed",
      );
      throw error;
    };
    try {
      this.assertAuthority(active.authority);
    } catch (error) {
      return rejectAuthorityChange(error);
    }
    try {
      await active.kernel.steer(text);
    } catch (error) {
      try {
        this.assertAuthority(active.authority);
      } catch (authorityError) {
        return rejectAuthorityChange(authorityError);
      }
      throw error;
    }
    try {
      this.assertAuthority(active.authority);
    } catch (error) {
      return rejectAuthorityChange(error);
    }
  }

  async followUp(runId: string, text: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) throw new Error("run is not active");
    const rejectAuthorityChange = async (error: unknown): Promise<never> => {
      await this.abortWithReason(
        runId,
        error instanceof Error ? error.message : "episode authority changed",
      );
      throw error;
    };
    try {
      this.assertAuthority(active.authority);
    } catch (error) {
      return rejectAuthorityChange(error);
    }
    try {
      await active.kernel.followUp(text);
    } catch (error) {
      try {
        this.assertAuthority(active.authority);
      } catch (authorityError) {
        return rejectAuthorityChange(authorityError);
      }
      throw error;
    }
    try {
      this.assertAuthority(active.authority);
    } catch (error) {
      return rejectAuthorityChange(error);
    }
  }

  async wait(runId: string): Promise<void> {
    // A pre-flight continuation resolves once the approved episode has been
    // assembled, while the episode itself may still be running. Wait through
    // both phases so callers never observe a false settlement at that handoff.
    const pendingStart = this.pendingStarts.get(runId);
    if (pendingStart) await pendingStart;
    const active = this.active.get(runId);
    if (active) await active.completion;
  }

  async shutdown(): Promise<void> {
    // Settle runs parked at the pre-flight budget gate first (their gate
    // promise would otherwise outlive the runner).
    for (const runId of [...this.pendingStarts.keys()]) {
      this.extras.approvals?.cancelPendingForRun(runId, "host shutting down");
    }
    await Promise.all([...this.pendingStarts.values()]);
    for (const assembly of this.assembling.values()) {
      assembly.revokedReason = "host shutting down";
    }
    await Promise.all([...this.assembling.values()].map((row) => row.settled));
    const entries = [...this.active.entries()];
    await Promise.all(entries.map(([runId]) => this.abort(runId)));
    await Promise.all(entries.map(([, active]) => active.completion));
  }
}
