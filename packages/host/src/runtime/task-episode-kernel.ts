import type {
  AgentKernel,
  KernelEvent,
  KernelEventListener,
  KernelImage,
  KernelPrompt,
} from "../kernel/kernel.js";
import type { TaskKernelOptions } from "../task-runner.js";
import type { EpisodeEvent, EpisodeRunner } from "./episode-runner.js";

export interface TaskEpisodeKernelDeps {
  runner: EpisodeRunner;
  registerSession: (sessionKey: string) => () => void;
  log?: (line: string) => void;
}

/**
 * Adapter from TaskRunner's durable lifecycle boundary to the one 0.4 agent
 * loop. TaskRunner keeps Run/Step/Evidence semantics; every model/tool episode
 * is submitted to EpisodeRunner and therefore reaches Pi through one path.
 */
export function createTaskEpisodeKernel(
  options: TaskKernelOptions,
  deps: TaskEpisodeKernelDeps,
): AgentKernel {
  const sessionKey = `task:${options.runId}`;
  const listeners = new Set<KernelEventListener>();
  let disposed = false;
  const unregisterSession = deps.registerSession(sessionKey);

  const emit = (event: Omit<KernelEvent, "occurredAt" | "sessionId">): void => {
    const row: KernelEvent = {
      ...event,
      occurredAt: Date.now(),
      sessionId: sessionKey,
    };
    for (const listener of listeners) listener(row);
  };

  const unsubscribe = deps.runner.on((event: EpisodeEvent) => {
    if (!("sessionKey" in event) || event.sessionKey !== sessionKey) return;
    switch (event.event) {
      case "episode.started":
        emit({ kind: "run.started", raw: event });
        break;
      case "episode.delta":
        emit({ kind: "message.delta", textDelta: event.textDelta, raw: event });
        break;
      case "episode.tool.started":
        emit({
          kind: "tool.started",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          data: event.args,
          raw: event,
        });
        break;
      case "episode.tool.completed":
        emit({
          kind: "tool.completed",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          data: event.data,
          isError: event.isError,
          raw: event,
        });
        break;
      case "episode.turn.completed":
        emit({ kind: "turn.completed", raw: event });
        break;
      case "episode.usage":
        emit({
          kind: "message.completed",
          raw: {
            type: "message_end",
            message: {
              role: "assistant",
              usage: {
                input: event.inputTokens,
                output: event.outputTokens,
              },
            },
          },
        });
        break;
      case "episode.approval.requested": {
        const request = {
          toolName: event.toolName,
          args: { excerpt: event.argsExcerpt },
          decision: {
            allowed: false,
            code: "needs_approval" as const,
            level: event.level,
            reason: `${event.action}: ${event.argsExcerpt}`,
            approval: {
              capability: event.capability,
              action: event.action,
            },
          },
        };
        void (options.approvalGate
          ? options.approvalGate(request)
          : Promise.resolve({ approved: false, note: "approval gate unavailable" })
        )
          .then((verdict) => {
            deps.runner.resolveApproval(event.approvalId, verdict);
          })
          .catch((error) => {
            deps.runner.resolveApproval(event.approvalId, {
              approved: false,
              note: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }
      default:
        break;
    }
  });

  const submit = async (
    input: KernelPrompt,
    delivery: "followup" | "steer",
  ): Promise<void> => {
    if (disposed) throw new Error("task episode kernel is disposed");
    const result = await deps.runner.prompt(sessionKey, {
      text: input.text,
      images: input.images,
      delivery,
      permissionMode: options.permissionMode ?? "confirm",
      runId: options.runId,
    });
    emit({ kind: "run.completed", raw: result });
    if (result.stopReason === "failed") {
      throw new Error(result.stopDetail ?? "task episode failed");
    }
  };

  return {
    engine: "pi",
    engineVersion: "0.83.0",
    sessionId: options.runId,
    get isRunning() {
      return deps.runner.active(sessionKey);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt(input) {
      return submit(input, "followup");
    },
    steer(text: string, images?: KernelImage[]) {
      return submit({ text, source: "system", images }, "steer");
    },
    followUp(text: string, images?: KernelImage[]) {
      return submit({ text, source: "system", images }, "followup");
    },
    async abort() {
      deps.runner.interrupt(sessionKey);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      unregisterSession();
      listeners.clear();
    },
  };
}
