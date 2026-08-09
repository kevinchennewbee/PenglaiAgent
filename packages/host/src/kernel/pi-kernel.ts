import {
  AgentHarness,
  type AgentHarnessEvent,
  type AgentHarnessOptions,
} from "@earendil-works/pi-agent-core";
import type {
  AgentKernel,
  KernelCompactResult,
  KernelEvent,
  KernelEventKind,
  KernelEventListener,
  KernelPrompt,
} from "./kernel.js";

export const PI_ENGINE_VERSION = "0.83.0";

interface PiHarnessLike {
  subscribe(
    listener: (event: AgentHarnessEvent) => Promise<void> | void,
  ): () => void;
  prompt(
    text: string,
    options?: { images?: Array<{ type: "image"; data: string; mimeType: string }> },
  ): Promise<unknown>;
  steer(
    text: string,
    options?: { images?: Array<{ type: "image"; data: string; mimeType: string }> },
  ): Promise<void>;
  followUp(
    text: string,
    options?: { images?: Array<{ type: "image"; data: string; mimeType: string }> },
  ): Promise<void>;
  abort(): Promise<unknown>;
  dispose?(): void;
  compact?(customInstructions?: string): Promise<unknown>;
  setThinkingLevel?(level: string): Promise<void>;
  getThinkingLevel?(): string;
  /** Optional: host runs auto-compact before prompt when near context window. */
  prepareForPrompt?: () => Promise<void>;
}

type PiHarnessFactory<TContext extends object | undefined> = (
  options: AgentHarnessOptions<TContext>,
) => PiHarnessLike;

export interface CreatePiKernelOptions<
  TContext extends object | undefined = undefined,
> {
  sessionId: string;
  /**
   * Penglai creates the model collection, durable Session, capability-scoped
   * tools and isolated execution environment, then hands them to Pi.
   */
  harnessOptions: AgentHarnessOptions<TContext>;
  /** Test seam. Production constructs Pi's AgentHarness directly. */
  harnessFactory?: PiHarnessFactory<TContext>;
  now?: () => number;
}

function eventKind(event: AgentHarnessEvent): KernelEventKind {
  switch (event.type) {
    case "agent_start":
      return "run.started";
    case "agent_end":
      return "run.completed";
    case "settled":
      return "run.settled";
    case "turn_start":
      return "turn.started";
    case "turn_end":
      return "turn.completed";
    case "message_start":
      return "message.started";
    case "message_update":
      return "message.delta";
    case "message_end":
      return "message.completed";
    case "tool_execution_start":
      return "tool.started";
    case "tool_execution_update":
      return "tool.progress";
    case "tool_execution_end":
      return "tool.completed";
    case "queue_update":
      return "queue.changed";
    case "session_before_compact":
      return "compaction.started";
    case "session_compact":
      return "compaction.completed";
    case "retry_scheduled":
      return "retry.started";
    case "retry_finished":
      return "retry.completed";
    default:
      return "runtime.event";
  }
}

function normalizeEvent(
  event: AgentHarnessEvent,
  sessionId: string,
  now: () => number,
): KernelEvent {
  const normalized: KernelEvent = {
    kind: eventKind(event),
    occurredAt: now(),
    sessionId,
    raw: event,
  };

  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    normalized.textDelta = event.assistantMessageEvent.delta;
  }

  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    normalized.toolCallId = event.toolCallId;
    normalized.toolName = event.toolName;
  }

  if (event.type === "tool_execution_end") {
    normalized.isError = event.isError;
    normalized.data = event.result;
  } else if (event.type === "tool_execution_start") {
    normalized.data = event.args;
  } else if (event.type === "tool_execution_update") {
    normalized.data = event.partialResult;
  } else if (event.type === "session_compact") {
    // Carry the CompactionEntry (summary / tokensBefore / usage) so downstream
    // listeners can attribute the compaction's LLM cost.
    normalized.data = event.compactionEntry;
  }

  return normalized;
}

class PiAgentKernel implements AgentKernel {
  readonly engine = "pi" as const;
  readonly engineVersion = PI_ENGINE_VERSION;

  private readonly listeners = new Set<KernelEventListener>();
  private readonly unsubscribePi: () => void;
  private disposed = false;
  private running = false;

  constructor(
    private readonly harness: PiHarnessLike,
    readonly sessionId: string,
    private readonly now: () => number,
  ) {
    this.unsubscribePi = harness.subscribe((event) => {
      const normalized = normalizeEvent(event, this.sessionId, this.now);
      for (const listener of this.listeners) listener(normalized);
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  subscribe(listener: KernelEventListener): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(input: KernelPrompt): Promise<void> {
    this.assertActive();
    this.running = true;
    try {
      await this.harness.prepareForPrompt?.();
      const images = (input.images ?? [])
        .filter((img) => img.data && img.mimeType)
        .map((img) => ({
          type: "image" as const,
          data: img.data,
          mimeType: img.mimeType,
        }));
      // Only pass the options argument when there are images, so spy assertions
      // on harness.prompt(text) see a single-arg call in the no-image path.
      if (images.length > 0) {
        await this.harness.prompt(input.text, { images });
      } else {
        await this.harness.prompt(input.text);
      }
    } finally {
      this.running = false;
    }
  }

  steer(text: string, images?: KernelPrompt["images"]): Promise<void> {
    this.assertActive();
    const imgs = (images ?? [])
      .filter((img) => img.data && img.mimeType)
      .map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
    return imgs.length > 0 ? this.harness.steer(text, { images: imgs }) : this.harness.steer(text);
  }

  followUp(text: string, images?: KernelPrompt["images"]): Promise<void> {
    this.assertActive();
    const imgs = (images ?? [])
      .filter((img) => img.data && img.mimeType)
      .map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
    return imgs.length > 0 ? this.harness.followUp(text, { images: imgs }) : this.harness.followUp(text);
  }

  async abort(): Promise<void> {
    this.assertActive();
    await this.harness.abort();
  }

  async compact(customInstructions?: string): Promise<KernelCompactResult> {
    this.assertActive();
    if (!this.harness.compact) {
      return { ok: false, detail: "compact not available on this harness" };
    }
    try {
      const result = (await this.harness.compact(customInstructions)) as {
        summary?: string;
        tokensBefore?: number;
        usage?: unknown;
      } | undefined;
      // Preserve Pi's real CompactResult instead of fabricating { ok: true };
      // EpisodeRunner / doctor can report tokens saved and the summary.
      return {
        ok: true,
        summary: result?.summary,
        tokensBefore: result?.tokensBefore,
        usage: result?.usage,
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.assertActive();
    await this.harness.setThinkingLevel?.(level);
  }

  getThinkingLevel(): string | undefined {
    return this.harness.getThinkingLevel?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribePi();
    this.listeners.clear();
    this.harness.dispose?.();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Pi kernel has been disposed");
  }
}

export async function createPiKernel<TContext extends object | undefined = undefined>(
  options: CreatePiKernelOptions<TContext>,
): Promise<AgentKernel> {
  const harnessFactory: PiHarnessFactory<TContext> =
    options.harnessFactory ??
    ((harnessOptions) => new AgentHarness(harnessOptions));
  const harness = harnessFactory(options.harnessOptions);
  return new PiAgentKernel(
    harness,
    options.sessionId,
    options.now ?? Date.now,
  );
}
