/** Best-effort processing/success/error reactions. Failures never block the reply. */

const DEFAULT_TIMEOUT_MS = 2_500;

export type ReactionKind = "processing" | "success" | "error";

export const CHANNEL_STATUS_REACTIONS: Record<string, { processing: string; success: string; error: string }> = {
  slack: { processing: "eyes", success: "white_check_mark", error: "x" },
  telegram: { processing: "👀", success: "👍", error: "👎" },
  discord: { processing: "👀", success: "✅", error: "❌" },
  feishu: { processing: "ONIT", success: "OK", error: "Disappointed" },
};

export interface ReactionCall {
  key: string;
  kind: ReactionKind;
  send: (kind: ReactionKind, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

const queues = new Map<string, Promise<void>>();
const sent = new Set<string>();

export async function runReaction(input: ReactionCall): Promise<"ok" | "skipped" | "failed"> {
  const idempotency = `${input.key}:${input.kind}`;
  if (sent.has(idempotency)) return "skipped";
  const previous = queues.get(input.key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (sent.has(idempotency)) return;
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await input.send(input.kind, controller.signal);
        sent.add(idempotency);
      } finally {
        clearTimeout(timer);
      }
    });
  queues.set(input.key, next);
  try {
    await next;
    return sent.has(idempotency) ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export interface StatusReactionHandle {
  success(): void;
  error(): void;
  clear(): void;
  settled(): Promise<void>;
}

/**
 * Serialized per source message. Processing starts immediately; success/error
 * replace the previous emoji. Provider failures are absorbed.
 */
export function beginStatusReaction(input: {
  key: string;
  emojis: { processing: string; success: string; error?: string };
  add: (emoji: string, signal: AbortSignal) => Promise<void>;
  remove: (emoji: string, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}): StatusReactionHandle {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current: string | null = null;
  let terminal = false;

  const safely = async (operation: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await operation(controller.signal);
    } catch {
      /* status reactions never block the reply */
    } finally {
      clearTimeout(timer);
    }
  };

  const transition = async (emoji: string | null) => {
    if (current) {
      const previous = current;
      current = null;
      await safely((signal) => input.remove(previous, signal));
    }
    if (!emoji) return;
    await safely((signal) => input.add(emoji, signal));
    current = emoji;
  };

  let tail = transition(input.emojis.processing);
  const finish = (emoji: string | null) => {
    if (terminal) return;
    terminal = true;
    tail = tail.then(() => transition(emoji), () => transition(emoji));
    void tail.catch(() => undefined);
  };

  return {
    success: () => finish(input.emojis.success),
    error: () => finish(input.emojis.error ?? null),
    clear: () => finish(null),
    settled: () => tail.then(() => undefined, () => undefined),
  };
}
