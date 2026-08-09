/**
 * Stable boundary between the Penglai product and an upstream agent runtime.
 *
 * This interface deliberately exposes Penglai concepts and keeps the original
 * upstream event as evidence/debug data. It is not a multi-engine router.
 */

export type KernelInputSource =
  | "desktop"
  | "cli"
  | "feishu"
  | "wechat"
  | "scheduler"
  | "system";

export type KernelEventKind =
  | "run.started"
  | "run.completed"
  | "run.settled"
  | "turn.started"
  | "turn.completed"
  | "message.started"
  | "message.delta"
  | "message.completed"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "queue.changed"
  | "compaction.started"
  | "compaction.completed"
  | "retry.started"
  | "retry.completed"
  | "runtime.event";

export interface KernelEvent {
  kind: KernelEventKind;
  occurredAt: number;
  sessionId: string;
  textDelta?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  data?: unknown;
  /**
   * Exact upstream event. Persist this with the Run so future adapters and
   * diagnostics do not depend on a lossy normalization.
   */
  raw: unknown;
}

export interface KernelImage {
  /** base64 without data: prefix */
  data: string;
  mimeType: string;
}

export interface KernelPrompt {
  text: string;
  source: KernelInputSource;
  /** Optional vision attachments for this prompt / followUp / steer. */
  images?: KernelImage[];
}

export type KernelEventListener = (event: KernelEvent) => void;

// ── host-side tools ────────────────────────────────────────────

/**
 * Safe deterministic Host functions exposed to the kernel. Model-driven
 * project trust/activation and unbrokered external tools are absent in W1.
 */
export interface HostToolHandlers {
  /**
   * Codex-style goal completion signal. Model may only complete/block the
   * active ThreadGoal; other transitions are host/owner controlled.
   */
  updateGoal?: (input: {
    status: "complete" | "blocked" | "active";
    summary?: string;
    reason?: string;
    conversationId?: string;
  }) => unknown | Promise<unknown>;
  /** List distilled SOP / skill tree entries (names + titles). */
  listSkills?: () => Array<{ name: string; title: string; updatedAt?: number }> | Promise<
    Array<{ name: string; title: string; updatedAt?: number }>
  >;
  /** Read one SOP body by name (owner-approved skill tree only). */
  showSkill?: (name: string) => string | null | Promise<string | null>;
  /** Receipt-verified installed Agent Skills to mount as Pi resources. */
  loadSkills?: () => Array<{
    name: string;
    title: string;
    content: string;
    filePath: string;
    updatedAt?: number;
  }>;
  /** Manually connected third-party tools. The kernel still applies L3 per call. */
  externalTools?: () => Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    call: (args: Record<string, unknown>) => Promise<string>;
  }> | Promise<Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    call: (args: Record<string, unknown>) => Promise<string>;
  }>>;
}

export type KernelThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface AgentKernel {
  readonly engine: "pi";
  readonly engineVersion: string;
  readonly sessionId: string;
  readonly isRunning: boolean;

  subscribe(listener: KernelEventListener): () => void;
  prompt(input: KernelPrompt): Promise<void>;
  steer(text: string, images?: KernelImage[]): Promise<void>;
  followUp(text: string, images?: KernelImage[]): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  /** Pi-native session compaction result (summary + retained tail + usage). */
  compact?(customInstructions?: string): Promise<KernelCompactResult>;
  setThinkingLevel?(level: KernelThinkingLevel): Promise<void>;
  getThinkingLevel?(): KernelThinkingLevel | string | undefined;
}

/**
 * Outcome of a session compaction. Mirrors the useful fields of Pi's
 * `CompactResult` so callers (EpisodeRunner, doctor, UI) can report tokens saved
 * and the summary without depending on the upstream type directly.
 */
export interface KernelCompactResult {
  ok: boolean;
  /** Human-readable compaction summary (the model's condensed history). */
  summary?: string;
  /** Token count of the branch before compaction. */
  tokensBefore?: number;
  /** Usage from the LLM call(s) that produced the summary, if available. */
  usage?: unknown;
  detail?: string;
}
