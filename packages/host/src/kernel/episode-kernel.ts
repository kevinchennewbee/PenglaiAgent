/**
 * Production EpisodeKernel — bridges Pi AgentHarness to EpisodeRunner.
 *
 * This is the ONLY place that imports Pi's AgentHarness and
 * createProductionPiKernel. It owns:
 *   - resolving model profile/key/workspace for a session
 *   - constructing the Pi kernel per-run
 *   - translating Pi streaming events into EpisodeKernelEvent
 *   - routing policy approvals through the runner's requestApproval callback
 *
 * It deliberately reuses the existing kernel factory
 * (createProductionPiKernel) so policy/jail/memory/assembly logic is not
 * duplicated; the factory's approvalGate is wired to the runner callback.
 *
 * Because kernel.prompt() resolves to void, this adapter accumulates the
 * assistant text and token usage from kernel events and returns the
 * aggregated result.
 */

import type { ModelProfile } from "@penglai/protocol";
import { createProductionPiKernel, type ProductionPiKernelOptions } from "./create-production-pi-kernel.js";
import type { AgentKernel, KernelEvent, KernelEventKind, KernelInputSource, KernelThinkingLevel } from "./kernel.js";
import type {
  EpisodeKernel,
  EpisodeKernelEvent,
} from "../runtime/episode-runner.js";
import type { ApprovalVerdict } from "../runtime/approval-gate.js";
import { POLICY_PROFILE } from "../policy.js";
import { redactSensitiveText } from "../security/redaction.js";

/**
 * Extract assistant token usage from a Pi harness event. Mirrors
 * extractAssistantUsage in task-runner.ts: usage arrives on message_end
 * as raw.message.usage.{input,output}. Also tolerates the flat
 * usage.{inputTokens,outputTokens} / snake_case shapes some providers emit.
 */
function extractUsage(raw: unknown): { input: number; output: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Pi message_end shape: { type: "message_end", message: { role, usage } }
  if (r.type === "message_end") {
    const message = r.message as
      | { role?: unknown; usage?: { input?: unknown; output?: unknown } }
      | undefined;
    if (message?.role === "assistant" && message.usage) {
      const input = typeof message.usage.input === "number" ? message.usage.input : 0;
      const output = typeof message.usage.output === "number" ? message.usage.output : 0;
      if (input + output > 0) return { input, output };
    }
  }
  // Tolerate flat / snake_case shapes from other providers.
  const usage =
    (r.usage as Record<string, unknown> | undefined) ??
    ((r.assistantMessage as Record<string, unknown> | undefined)?.usage as
      | Record<string, unknown>
      | undefined);
  if (!usage) return null;
  const input = Number(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.input ?? 0);
  const output = Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.output ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input + output === 0) return null;
  return { input, output };
}

export interface ResolvedSession {
  profile: ModelProfile;
  apiKey: string;
  workspaceRoot: string;
  projectAnchored: boolean;
  taskId?: string | null;
  conversationId?: string | null;
  memory?: ProductionPiKernelOptions["memory"];
  hostTools?: ProductionPiKernelOptions["hostTools"];
  hasPolicyGrant?: (grantKey: string) => boolean;
  /** Active goal text, re-injected every episode. */
  goal?: string | null;
  /** Owner-pinned context, re-injected every episode. */
  contextPins?: ProductionPiKernelOptions["contextPins"];
  /** Owner TODO block, re-injected every episode. */
  workbenchInjection?: string | null;
  /** Personal Context V1 auto-retrieve block for this episode. */
  personalContextBlock?: string | null;
  contextService?: ProductionPiKernelOptions["contextService"];
  contextScope?: ProductionPiKernelOptions["contextScope"];
  onContextUsed?: ProductionPiKernelOptions["onContextUsed"];
  /**
   * Stable Pi/engine session id for this durable surface (Task runId or
   * conversation id). Distinct from EpisodeRunner episodeRequestId (C4).
   * Checkpoint indexing matches files by this id.
   */
  engineSessionId?: string | null;
  /** Called when the kernel blocks an L4 policy violation. */
  onL4Denied?: (info: {
    toolName: string;
    code: string;
    reason: string;
    args: Record<string, unknown>;
  }) => void;
  /** Fail-closed authority revalidation before every Pi tool call. */
  revalidateAuthority?: ProductionPiKernelOptions["revalidateAuthority"];
  /** Per-session factory seam used by durable task episodes and tests. */
  kernelFactory?: ProductionEpisodeKernelDeps["kernelFactory"];
}

export interface ProductionEpisodeKernelDeps {
  dataDir: string;
  resolveSession: (sessionKey: string) => Promise<ResolvedSession>;
  log?: (line: string) => void;
  /**
   * In-episode safety ceilings (turns / tool failures / tokens / duration).
   * Defaults to the production POLICY_PROFILE; injectable for tests that
   * need to trip a ceiling without 200 turns.
   */
  policyProfile?: typeof POLICY_PROFILE;
  /**
   * Factory for the underlying Pi kernel. Defaults to the production
   * factory; tests inject a scripted kernel (echo, failure, budget trip).
   */
  kernelFactory?: (
    options: ProductionPiKernelOptions,
  ) => Promise<AgentKernel> | AgentKernel;
}

export function createProductionEpisodeKernel(
  deps: ProductionEpisodeKernelDeps,
): EpisodeKernel {
  const kernelFactory = deps.kernelFactory ?? createProductionPiKernel;
  return {
    async run({
      sessionKey,
      runId,
      prompt: promptText,
      images,
      permissionMode,
      thinkingLevel,
      signal,
      requestApproval,
      emit,
    }) {
      const resolved = await deps.resolveSession(sessionKey);

      // Personal Context V1: small-budget FTS pre-retrieval before the episode
      // (Host-owned; documents remain untrusted reference material).
      let personalContextBlock = resolved.personalContextBlock ?? null;
      if (!personalContextBlock && resolved.contextService) {
        try {
          const auto = resolved.contextService.buildAutoRetrieveBlock({
            query: promptText,
            projectId: resolved.contextScope?.projectId ?? null,
            globalOnly:
              resolved.contextScope?.globalOnly ?? !resolved.projectAnchored,
          });
          personalContextBlock = auto?.block ?? null;
          if (auto?.hits?.length && resolved.onContextUsed) {
            resolved.onContextUsed({
              tool: "context_search",
              query: promptText,
              hits: auto.hits.map((h) => ({
                contextRef: h.contextRef,
                sourceId: h.sourceId,
                relativePath: h.relativePath,
                documentSha256: h.documentSha256,
                chunkSha256: h.chunkSha256,
                title: h.title,
                headingPath: h.headingPath,
                location: h.location,
              })),
            });
          }
        } catch {
          personalContextBlock = null;
        }
      }

      // C4: episodeRequestId (runId arg) settles waiters; Pi session continuity
      // and checkpoint lookup use durable engineSessionId when provided.
      const engineSessionId =
        resolved.engineSessionId?.trim() ||
        resolved.taskId?.trim() ||
        runId;
      const kernel: AgentKernel = await (resolved.kernelFactory ?? kernelFactory)({
        runId: engineSessionId,
        taskId: resolved.taskId ?? null,
        workspaceRoot: resolved.workspaceRoot,
        dataDir: deps.dataDir,
        profile: resolved.profile,
        apiKey: resolved.apiKey,
        projectAnchored: resolved.projectAnchored,
        conversationId: resolved.conversationId ?? null,
        memory: resolved.memory,
        hostTools: resolved.hostTools,
        hasPolicyGrant: resolved.hasPolicyGrant,
        permissionMode,
        thinkingLevel,
        goal: resolved.goal,
        contextPins: resolved.contextPins?.map((pin) => ({
          kind: pin.kind,
          label: pin.label,
          ref: pin.ref,
        })),
        workbenchInjection: resolved.workbenchInjection,
        personalContextBlock,
        contextService: resolved.contextService ?? null,
        contextScope: resolved.contextScope,
        onContextUsed: resolved.onContextUsed,
        revalidateAuthority: resolved.revalidateAuthority,
        onL4Denied: resolved.onL4Denied
          ? (info) =>
              resolved.onL4Denied?.({
                toolName: info.toolName,
                code: info.decision.code,
                reason: info.decision.reason,
                args: info.args,
              })
          : undefined,
        approvalGate: async (request) => {
          const decision = request.decision;
          if (decision.allowed || decision.code === "allowed") {
            return { approved: true, note: "L1" };
          }
          if (decision.level === "L4") {
            resolved.onL4Denied?.({
              toolName: request.toolName,
              code: decision.code,
              reason: decision.reason,
              args: request.args,
            });
            return { approved: false, note: decision.reason };
          }
          const capability = decision.approval?.capability ?? "l2:conversation";
          const action = decision.approval?.action ?? request.toolName;
          const level: "L2" | "L3" = decision.level === "L3" ? "L3" : "L2";
          const argsExcerpt = redactSensitiveText(
            JSON.stringify(request.args ?? {}),
          ).text.slice(0, 400);
          return requestApproval({
            toolName: request.toolName,
            action,
            capability,
            level,
            argsExcerpt,
          }) as Promise<ApprovalVerdict>;
        },
      });

      // Accumulate assistant text + token usage from kernel events, and
      // enforce the in-episode safety ceilings (POLICY_PROFILE) so a
      // runaway tool loop or multi-hour episode cannot burn tokens
      // unbounded.
      let assistantText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let turns = 0;
      let toolFailures = 0;
      let budgetDetail: string | null = null;
      const state: { stopReason: "completed" | "aborted" | "budget" | "failed" } = {
        stopReason: "completed",
      };
      const spec = deps.policyProfile ?? POLICY_PROFILE;

      const stopForBudget = (detail: string): void => {
        if (state.stopReason !== "completed") return;
        state.stopReason = "budget";
        budgetDetail = detail;
        void kernel.abort().catch(() => {});
      };
      const checkBudget = (): void => {
        if (state.stopReason !== "completed") return;
        if (turns >= spec.maxTurns) {
          stopForBudget(
            `episode stopped after ${turns} tool rounds (safety ceiling ${spec.maxTurns})`,
          );
          return;
        }
        if (toolFailures >= spec.budget.maxToolFailures) {
          stopForBudget(
            `too many tool failures (${toolFailures}/${spec.budget.maxToolFailures})`,
          );
          return;
        }
        if (
          spec.budget.maxTokens !== null &&
          inputTokens + outputTokens >= spec.budget.maxTokens
        ) {
          stopForBudget(
            `episode token safety ceiling reached (${inputTokens + outputTokens})`,
          );
        }
      };
      const durationTimer =
        spec.budget.maxDurationMs !== null
          ? setTimeout(
              () =>
                stopForBudget(
                  `episode wall-clock safety ceiling (${Math.round(
                    spec.budget.maxDurationMs! / 60_000,
                  )} min)`,
                ),
              spec.budget.maxDurationMs,
            )
          : null;
      durationTimer?.unref?.();

      const unsubscribe = kernel.subscribe((event: KernelEvent) => {
        // Stream deltas upward.
        if (event.kind === "message.delta" && typeof event.textDelta === "string") {
          assistantText += event.textDelta;
          emit({ type: "delta", textDelta: event.textDelta });
        }
        if (event.kind === "tool.started") {
          emit({
            type: "tool.started",
            toolName: event.toolName ?? "tool",
            toolCallId: event.toolCallId,
            args: event.data,
          });
        }
        if (event.kind === "tool.completed") {
          const isError = event.isError ?? false;
          emit({
            type: "tool.completed",
            toolName: event.toolName ?? "tool",
            toolCallId: event.toolCallId,
            data: event.data,
            isError,
          });
          if (isError) {
            toolFailures += 1;
            checkBudget();
          }
        }
        // Token usage arrives on turn_end / message_end.
        const usage = extractUsage(event.raw);
        if (usage) {
          inputTokens += usage.input;
          outputTokens += usage.output;
          emit({
            type: "usage",
            inputTokens: usage.input,
            outputTokens: usage.output,
          });
          checkBudget();
        }
        if (event.kind === "turn.completed") {
          turns += 1;
          emit({ type: "turn.completed" });
          checkBudget();
        }
      });

      // Abort the kernel if the runner's signal aborts.
      const onAbort = (): void => {
        state.stopReason = "aborted";
        void kernel.abort().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        const source: KernelInputSource =
          permissionMode === "plan" ? "system" : "cli";
        await kernel.prompt({
          text: promptText,
          source,
          images: images?.map((img) => ({ data: img.data, mimeType: img.mimeType })),
        });
      } catch (error) {
        if (state.stopReason !== "aborted") state.stopReason = "failed";
        deps.log?.(
          `kernel prompt failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (durationTimer) clearTimeout(durationTimer);
        signal.removeEventListener("abort", onAbort);
        unsubscribe();
        kernel.dispose();
      }

      return {
        stopReason: state.stopReason,
        stopDetail:
          state.stopReason === "budget" ? budgetDetail :
          state.stopReason === "failed" ? "episode failed" :
          state.stopReason === "aborted" ? "episode aborted" : null,
        text: assistantText,
        inputTokens,
        outputTokens,
        turns,
      };
    },
  };
}
