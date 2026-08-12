import type { KernelThinkingLevel } from "./kernel/kernel.js";

export interface ConversationImageAttachment {
  /** Base64 payload without a data: prefix. */
  data: string;
  mimeType: string;
  name?: string;
}

export interface ConversationPromptInput {
  conversationId: string;
  text: string;
  /** Retained for transport compatibility; Host authority selects the real root. */
  workspaceRoot?: string | null;
  permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
  thinkingLevel?: KernelThinkingLevel;
  /** Fail closed when a caller requires a fresh permission-isolated episode. */
  requireNewEpisode?: boolean;
  /** Internal observed events (for example an opt-in companion heartbeat) can
   * prompt the same Core without forging a visible user-authored message. */
  recordUserMessage?: boolean;
  delivery?: "queue" | "now";
  images?: ConversationImageAttachment[];
  /**
   * F1: when the session already has an active episode:
   * - true (default): wait for this input's real terminal result (IM channels)
   * - false: return a non-terminal queued ack immediately (Desktop RPC)
   */
  waitForTerminal?: boolean;
}

export interface ConversationPromptResult {
  conversationId: string;
  episodeId: string;
  text: string;
  /**
   * Terminal episode outcomes, or "queued" for a non-terminal ack when the
   * session already has an active episode (C3: never fake "completed").
   */
  stopReason: "completed" | "budget" | "aborted" | "failed" | "queued";
  stopDetail: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /** Present on non-terminal ack responses (active session queue/steer). */
  status?: "queued";
  accepted?: boolean;
  delivery?: string;
}

/**
 * The single conversation execution surface shared by Desktop, CLI, Goal and
 * IM transports. Implementations must route through EpisodeRunner; transports
 * never own an agent loop.
 */
export interface ConversationExecutor {
  prompt(input: ConversationPromptInput): Promise<ConversationPromptResult>;
  isBusy(conversationId: string): boolean;
  abort(conversationId: string): Promise<boolean>;
  abortAndWait(conversationId: string, detail?: string): Promise<boolean>;
  compact(
    conversationId: string,
    instructions?: string,
  ): Promise<{ ok: boolean; deferred: boolean; detail?: string }>;
}
