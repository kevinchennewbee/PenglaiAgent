/** Best-effort processing/success/error reactions. Failures never block the reply. */

const DEFAULT_TIMEOUT_MS = 2_500;

export type ReactionKind = "processing" | "success" | "error";

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
