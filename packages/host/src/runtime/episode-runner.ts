/**
 * EpisodeRunner — the unified execution core for 0.4.
 *
 * There is ONE agent loop per
 * session key (a conversation id for chat, a task/run id for background
 * work), serialized by a RunCoordinator. Interactive prompts, steering,
 * scheduled jobs, and heartbeats all enter through `submit()` with a
 * Delivery mode; the runner decides whether to queue, interrupt, or
 * coalesce. Approvals suspend the loop via a callback that transports
 * (CLI/desktop/Feishu) resolve.
 *
 * Architecture references:
 *   - Codex: one Session per thread, Op-in/Event-out, oneshot approvals
 *   - OpenCode: SessionRunCoordinator + wake/run/interrupt
 *   - OpenClaw: queue modes steer/followup/collect/interrupt
 *   - Pi v2: lanes share a session tree (future; one key per lane today)
 */

import { EventEmitter } from "node:events";
import { RunCoordinator, type RunHandle } from "./run-coordinator.js";
import type { ApprovalVerdict } from "./approval-gate.js";
import type { KernelThinkingLevel } from "../kernel/kernel.js";

/** How an inbound message is delivered relative to an active run. */
export type Delivery =
  /** Inject after the current tool batch, before the next LLM call. */
  | "steer"
  /** Enqueue for after the current run completes. */
  | "followup"
  /** Abort the active run and start fresh with this input. */
  | "interrupt"
  /**
   * Headless/background: no human is watching; pre-baked policies apply
   * (auto-approve L1/L2, L3 surfaces an approval event that a transport
   * may resolve asynchronously). Scheduled jobs and heartbeats use this.
   */
  | "scheduled";

/** A unit of work submitted to the runner. */
export interface EpisodeInput {
  /** The text prompt (user message, cron payload, heartbeat directive). */
  text: string;
  delivery: Delivery;
  /** Opaque correlation id (for two-phase RPC: accept then final). */
  runId?: string;
  /** Optional image attachments. */
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  /**
   * Permission dial for THIS episode. Defaults to the session's dial.
   * Scheduled deliveries force a headless policy regardless.
   */
  permissionMode?: "plan" | "confirm" | "auto_edit" | "full";
  /**
   * Reasoning effort for THIS episode. Defaults to the kernel profile's
   * level when omitted.
   */
  thinkingLevel?: KernelThinkingLevel;
}

/** Events emitted by the runner (transports subscribe to these). */
export type EpisodeEvent =
  | { event: "episode.started"; sessionKey: string; runId: string }
  | { event: "episode.delta"; sessionKey: string; runId: string; textDelta: string }
  | { event: "episode.message"; sessionKey: string; runId: string; role: "user" | "assistant"; text: string }
  | { event: "episode.tool.started"; sessionKey: string; runId: string; toolName: string; toolCallId?: string; args?: unknown }
  | { event: "episode.tool.completed"; sessionKey: string; runId: string; toolName: string; toolCallId?: string; data?: unknown; isError: boolean }
  | { event: "episode.turn.completed"; sessionKey: string; runId: string }
  | {
      event: "episode.usage";
      sessionKey: string;
      runId: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      event: "episode.approval.requested";
      sessionKey: string;
      runId: string;
      approvalId: string;
      toolName: string;
      level: "L2" | "L3";
      capability: string;
      action: string;
      argsExcerpt: string;
    }
  | { event: "episode.approval.decided"; sessionKey: string; runId: string; approvalId: string; verdict: ApprovalVerdict }
  | { event: "episode.mode.changed"; sessionKey: string; mode: string; taskId?: string | null }
  | {
      event: "episode.completed";
      sessionKey: string;
      runId: string;
      stopReason: "completed" | "aborted" | "budget" | "failed";
      /** Human-readable detail for non-clean stops. */
      stopDetail?: string | null;
      text: string;
      inputTokens: number;
      outputTokens: number;
      /** Number of tool rounds executed this episode. */
      turns: number;
    }
  | { event: "episode.error"; sessionKey: string; runId: string; error: string };

/**
 * A request to the kernel (Pi AgentHarness) to run one turn. EpisodeRunner
 * depends on this seam so it does not import Pi directly; the production
 * implementation lives in kernel/episode-kernel.ts and is the only place
 * that knows about AgentHarness/createProductionPiKernel.
 */
export interface EpisodeKernel {
  /** Run one episode (prompt → stream events → completion). */
  run(input: {
    sessionKey: string;
    runId: string;
    prompt: string;
    images?: EpisodeInput["images"];
    permissionMode: "plan" | "confirm" | "auto_edit" | "full";
    thinkingLevel?: KernelThinkingLevel;
    signal: AbortSignal;
    /** Called when the kernel needs a human decision on an L2/L3 tool call. */
    requestApproval: (req: {
      toolName: string;
      action: string;
      capability: string;
      level: "L2" | "L3";
      argsExcerpt: string;
    }) => Promise<ApprovalVerdict>;
    emit: (event: EpisodeKernelEvent) => void;
  }): Promise<{
    stopReason: "completed" | "aborted" | "budget" | "failed";
    /** Human-readable detail for non-clean stops (budget ceiling, error, etc.). */
    stopDetail?: string | null;
    text: string;
    inputTokens: number;
    outputTokens: number;
    /** Number of tool rounds (LLM turns) executed this episode. */
    turns: number;
  }>;
}

/** Events the kernel emits upward (subset of EpisodeEvent, run-scoped). */
export type EpisodeKernelEvent =
  | { type: "delta"; textDelta: string }
  | { type: "tool.started"; toolName: string; toolCallId?: string; args?: unknown }
  | { type: "tool.completed"; toolName: string; toolCallId?: string; data?: unknown; isError: boolean }
  | { type: "turn.completed" }
  | { type: "usage"; inputTokens: number; outputTokens: number };

/** Configuration + external services for one EpisodeRunner. */
export interface EpisodeRunnerDeps {
  kernel: EpisodeKernel;
  /** Default permission dial for interactive sessions. */
  defaultPermissionMode?: "plan" | "confirm" | "auto_edit" | "full";
  /** Log sink for operational messages. */
  log?: (line: string) => void;
}

/**
 * The unified runner. One instance serves many session keys concurrently;
 * within a key, runs are serialized by the coordinator.
 */
export class EpisodeRunner {
  private readonly coordinator: RunCoordinator<void>;
  private readonly dials = new Map<string, "plan" | "confirm" | "auto_edit" | "full">();
  private readonly followups = new Map<string, EpisodeInput[]>();
  private readonly signals = new Map<string, AbortController>();
  private readonly emitter = new EventEmitter();

  constructor(private readonly deps: EpisodeRunnerDeps) {
    this.coordinator = new RunCoordinator(async (sessionKey, handle) => {
      await this.execute(sessionKey, handle);
    });
    this.deps.log?.(
      `EpisodeRunner ready (default dial: ${deps.defaultPermissionMode ?? "auto_edit"})`,
    );
  }

  /** Subscribe to lifecycle/streaming events for a session (or all). */
  on(listener: (event: EpisodeEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  /** Set the permission dial for a session (CLI /mode, desktop toggle). */
  setDial(sessionKey: string, dial: "plan" | "confirm" | "auto_edit" | "full"): void {
    this.dials.set(sessionKey, dial);
  }

  getDial(sessionKey: string): "plan" | "confirm" | "auto_edit" | "full" {
    return this.dials.get(sessionKey) ?? this.deps.defaultPermissionMode ?? "auto_edit";
  }

  /**
   * Submit input. Returns immediately with a runId (two-phase accept);
   * the caller observes completion via events or `wait(runId)`.
   */
  submit(sessionKey: string, input: EpisodeInput): { runId: string } {
    const runId = input.runId ?? `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const delivery = input.delivery;
    // Queue the input FIRST, then wake the coordinator — otherwise a
    // fast worker can observe an empty queue and exit before we enqueue.
    const queue = this.followups.get(sessionKey) ?? [];

    if (delivery === "interrupt") {
      // Abort any active run; the queued input becomes the successor.
      queue.length = 0;
      queue.push(input);
      this.followups.set(sessionKey, queue);
      const wasActive = this.coordinator.active(sessionKey);
      this.coordinator.interrupt(sessionKey);
      if (wasActive) {
        // interrupt cleared pendingWake; re-request one successor.
        this.coordinator.wake(sessionKey);
      } else {
        void this.coordinator.run(sessionKey);
      }
      return { runId };
    }

    queue.push(input);
    this.followups.set(sessionKey, queue);

    if (delivery === "followup" || delivery === "steer") {
      // Wake coalesces: if active, a successor drains the queue; if idle,
      // it starts now.
      this.coordinator.wake(sessionKey);
      return { runId };
    }

    // scheduled / interactive default: ensure a run is active.
    if (this.coordinator.active(sessionKey)) {
      // Already running; the queued input is drained by a successor when
      // the current run settles (coalesced wake).
      this.coordinator.wake(sessionKey);
    } else {
      void this.coordinator.run(sessionKey);
    }
    return { runId };
  }

  /** Interrupt/abort whatever is running for this session key. */
  interrupt(sessionKey: string): boolean {
    this.cancelApprovalsForSession(sessionKey, "episode interrupted");
    return this.coordinator.interrupt(sessionKey);
  }

  active(sessionKey: string): boolean {
    return this.coordinator.active(sessionKey);
  }

  async join(sessionKey: string): Promise<void> {
    await this.coordinator.join(sessionKey);
  }

  // ── execution (runs inside the coordinator) ──────────────────

  private async execute(sessionKey: string, handle: RunHandle): Promise<void> {
    // Drain one input per run. Coalesced wakes cause successor runs that
    // drain subsequent inputs.
    const queue = this.followups.get(sessionKey) ?? [];
    const input = queue.shift();
    if (queue.length === 0) this.followups.delete(sessionKey);
    if (!input) return; // spurious wake with nothing to do

    const runId = input.runId ?? handle.runId;
    const controller = new AbortController();
    this.signals.set(sessionKey, controller);
    // Link the coordinator's interrupt signal to our controller.
    const onAbort = () => controller.abort(handle.signal.reason);
    handle.signal.addEventListener("abort", onAbort, { once: true });

    const emit = (event: EpisodeEvent): void => {
      this.emitter.emit("event", event);
    };

    const permissionMode =
      input.delivery === "scheduled" ? "auto_edit" : input.permissionMode ?? this.getDial(sessionKey);

    emit({ event: "episode.started", sessionKey, runId });

    try {
      const result = await this.deps.kernel.run({
        sessionKey,
        runId,
        prompt: input.text,
        images: input.images,
        permissionMode,
        thinkingLevel: input.thinkingLevel,
        signal: controller.signal,
        requestApproval: (req) =>
          new Promise<ApprovalVerdict>((resolve) => {
            const approvalId = `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
            // Scheduled runs auto-approve L2 but still ask L3 (which may
            // never arrive — the kernel should treat timeout as denied).
            if (input.delivery === "scheduled" && req.level === "L2") {
              resolve({ approved: true, note: "scheduled: L2 auto-approved" });
              return;
            }
            const timeout = setTimeout(() => {
              this.pendingApprovals.delete(approvalId);
              resolve({ approved: false, note: "approval timed out" });
            }, 30 * 60_000);
            this.pendingApprovals.set(approvalId, {
              sessionKey,
              resolve: (verdict) => {
                clearTimeout(timeout);
                resolve(verdict);
              },
            });
            // Register before notifying transports. An in-process desktop/CLI
            // listener may decide synchronously from this event; emitting first
            // creates a race where a valid decision is reported as "not found".
            emit({
              event: "episode.approval.requested",
              sessionKey,
              runId,
              approvalId,
              toolName: req.toolName,
              level: req.level,
              capability: req.capability,
              action: req.action,
              argsExcerpt: req.argsExcerpt,
            });
          }),
        emit: (ke) => {
          if (ke.type === "delta") {
            emit({ event: "episode.delta", sessionKey, runId, textDelta: ke.textDelta });
          } else if (ke.type === "tool.started") {
            emit({ event: "episode.tool.started", sessionKey, runId, toolName: ke.toolName, toolCallId: ke.toolCallId, args: ke.args });
          } else if (ke.type === "tool.completed") {
            emit({ event: "episode.tool.completed", sessionKey, runId, toolName: ke.toolName, toolCallId: ke.toolCallId, data: ke.data, isError: ke.isError });
          } else if (ke.type === "turn.completed") {
            emit({ event: "episode.turn.completed", sessionKey, runId });
          } else if (ke.type === "usage") {
            emit({
              event: "episode.usage",
              sessionKey,
              runId,
              inputTokens: ke.inputTokens,
              outputTokens: ke.outputTokens,
            });
          }
        },
      });

      emit({
        event: "episode.completed",
        sessionKey,
        runId,
        stopReason: result.stopReason,
        stopDetail: result.stopDetail ?? null,
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        turns: result.turns,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ event: "episode.error", sessionKey, runId, error: message });
    } finally {
      handle.signal.removeEventListener("abort", onAbort);
      this.signals.delete(sessionKey);
      // If followups arrived while running, coordinator.wake already
      // scheduled a successor; nothing to do here.
    }
  }

  /** Transport-facing: resolve a pending approval requested by a run. */
  resolveApproval(approvalId: string, verdict: ApprovalVerdict): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);
    pending.resolve(verdict);
    return true;
  }

  private cancelApprovalsForSession(sessionKey: string, note: string): void {
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.sessionKey !== sessionKey) continue;
      this.pendingApprovals.delete(approvalId);
      pending.resolve({ approved: false, note });
    }
  }

  /**
   * Submit input and await the terminal event for that run. This is the
   * request/response form (conversation.prompt); submit() alone is the
   * two-phase form (agent.submit + event stream).
   */
  async prompt(
    sessionKey: string,
    input: EpisodeInput,
  ): Promise<{
    stopReason: "completed" | "aborted" | "budget" | "failed";
    stopDetail: string | null;
    text: string;
    inputTokens: number;
    outputTokens: number;
    turns: number;
    runId: string;
  }> {
    // Determine the runId and attach the completion listener BEFORE
    // submitting, so a fast kernel can't emit completed between submit
    // and listener registration.
    const runId =
      input.runId ?? `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this.emitter.off("event", onEvent);
      };
      const onEvent = (event: EpisodeEvent): void => {
        if (!("runId" in event) || event.runId !== runId) return;
        if (event.event === "episode.completed") {
          cleanup();
          resolve({
            stopReason: event.stopReason,
            stopDetail: event.stopDetail ?? null,
            text: event.text,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            turns: event.turns,
            runId,
          });
        } else if (event.event === "episode.error") {
          cleanup();
          reject(new Error(event.error));
        }
      };
      this.emitter.on("event", onEvent);
      this.submit(sessionKey, { ...input, runId });
    });
  }

  private pendingApprovals = new Map<
    string,
    { sessionKey: string; resolve: (verdict: ApprovalVerdict) => void }
  >();
}
