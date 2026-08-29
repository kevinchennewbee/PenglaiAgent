import { PENGLAI_RESOURCE_JOB_BUDGETS } from "@penglai/contracts";

export const INTERNAL_CURATOR_MAX_JOBS =
  PENGLAI_RESOURCE_JOB_BUDGETS["@penglai/memory"].totalJobs;
export const INTERNAL_CURATOR_TIMEOUT_MS = 45_000;
export const INTERNAL_CURATOR_SEEN_KEYS = 2_048;
export const INTERNAL_CURATOR_MAX_ATTEMPTS = 2;

export interface InternalCuratorFailure {
  code: string;
  retry: boolean;
}

export interface InternalCuratorQueueEvent {
  key: string;
  outcome: "completed" | "retrying" | "failed" | "cancelled" | "dropped";
  attempt: number;
  code: string;
}

export interface InternalCuratorJob {
  key: string;
  execute(signal: AbortSignal, attempt: number): Promise<string>;
  commit(raw: string): Promise<void> | void;
  maxAttempts?: number;
  classifyFailure?(error: unknown): InternalCuratorFailure;
}

export type InternalCuratorEnqueueResult =
  | { accepted: true }
  | { accepted: false; reason: "closed" | "duplicate" | "capacity" };

export interface InternalCuratorQueueSnapshot {
  closed: boolean;
  active: number;
  queued: number;
  timers: number;
  completed: number;
  failed: number;
  cancelled: number;
  retried: number;
  dropped: number;
}

interface PendingJob {
  job: InternalCuratorJob;
  attempt: number;
}

interface ActiveJob extends PendingJob {
  controller: AbortController;
  cancelledByClose?: boolean;
}

/**
 * Memory-owned queue for auxiliary curator calls. It deliberately owns no DSH
 * Agent or Session: one official LLM request runs at a time, duplicate Turns
 * collapse, overload fails open, and plugin teardown aborts the active call.
 */
export class InternalCuratorQueue {
  private readonly pending: PendingJob[] = [];
  private readonly liveKeys = new Set<string>();
  private readonly seenKeys = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private active: ActiveJob | undefined;
  private closed = false;
  private completed = 0;
  private failed = 0;
  private cancelled = 0;
  private retried = 0;
  private dropped = 0;

  constructor(
    private readonly options: {
      maxJobs?: number;
      timeoutMs?: number;
      maxSeenKeys?: number;
      observe?: (event: InternalCuratorQueueEvent) => void;
    } = {},
  ) {}

  enqueue(job: InternalCuratorJob): InternalCuratorEnqueueResult {
    if (this.closed) return { accepted: false, reason: "closed" };
    if (!job.key) return { accepted: false, reason: "duplicate" };
    if (this.liveKeys.has(job.key) || this.seenKeys.has(job.key)) {
      return { accepted: false, reason: "duplicate" };
    }
    const maxJobs = this.bounded(this.options.maxJobs, INTERNAL_CURATOR_MAX_JOBS);
    if (this.liveKeys.size >= maxJobs) {
      this.dropped += 1;
      this.observe({ key: job.key, outcome: "dropped", attempt: 0, code: "CAPACITY" });
      return { accepted: false, reason: "capacity" };
    }
    this.liveKeys.add(job.key);
    this.pending.push({ job, attempt: 1 });
    this.pump();
    return { accepted: true };
  }

  snapshot(): InternalCuratorQueueSnapshot {
    return {
      closed: this.closed,
      active: this.active ? 1 : 0,
      queued: this.pending.length,
      timers: this.active ? 1 : 0,
      completed: this.completed,
      failed: this.failed,
      cancelled: this.cancelled,
      retried: this.retried,
      dropped: this.dropped,
    };
  }

  whenIdle(): Promise<void> {
    if (!this.active && this.pending.length === 0) return Promise.resolve();
    return new Promise<void>((resolveIdle) => this.idleWaiters.add(resolveIdle));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.splice(0)) {
      this.liveKeys.delete(pending.job.key);
      this.cancelled += 1;
      this.observe({ key: pending.job.key, outcome: "cancelled", attempt: pending.attempt, code: "CANCELLED" });
    }
    if (this.active) {
      this.active.cancelledByClose = true;
      this.cancelled += 1;
      this.observe({ key: this.active.job.key, outcome: "cancelled", attempt: this.active.attempt, code: "CANCELLED" });
      this.active.controller.abort();
    }
    this.resolveIdleIfNeeded();
  }

  private bounded(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Math.max(1, Math.floor(value!)) : fallback;
  }

  private remember(key: string): void {
    this.seenKeys.add(key);
    const max = this.bounded(this.options.maxSeenKeys, INTERNAL_CURATOR_SEEN_KEYS);
    while (this.seenKeys.size > max) {
      const oldest = this.seenKeys.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seenKeys.delete(oldest);
    }
  }

  private resolveIdleIfNeeded(): void {
    if (this.active || this.pending.length > 0) return;
    for (const resolveIdle of this.idleWaiters) resolveIdle();
    this.idleWaiters.clear();
  }

  private observe(event: InternalCuratorQueueEvent): void {
    try {
      this.options.observe?.(event);
    } catch {
      // Diagnostics are subordinate to queue isolation and never change work.
    }
  }

  private failureFor(job: InternalCuratorJob, error: unknown): InternalCuratorFailure {
    try {
      const classified = job.classifyFailure?.(error);
      if (classified && /^[A-Z][A-Z0-9_]{0,63}$/.test(classified.code)) return classified;
    } catch {
      // A broken classifier is contained as an unknown terminal failure.
    }
    return { code: "UNKNOWN", retry: false };
  }

  private pump(): void {
    if (this.closed || this.active) return;
    const pending = this.pending.shift();
    if (!pending) {
      this.resolveIdleIfNeeded();
      return;
    }
    const controller = new AbortController();
    const active: ActiveJob = { ...pending, controller };
    const { job, attempt } = active;
    this.active = active;
    const timeoutMs = this.bounded(this.options.timeoutMs, INTERNAL_CURATOR_TIMEOUT_MS);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    let removeAbort = (): void => undefined;
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = (): void => reject(new Error("memory curator cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => controller.signal.removeEventListener("abort", onAbort);
    });
    const execution = Promise.resolve().then(() => job.execute(controller.signal, attempt));
    void Promise.race([execution, aborted])
      .then(async (raw) => {
        if (this.closed || controller.signal.aborted) return;
        await job.commit(raw);
        this.completed += 1;
        this.observe({ key: job.key, outcome: "completed", attempt, code: "OK" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) {
          if (!active.cancelledByClose) {
            this.cancelled += 1;
            this.observe({ key: job.key, outcome: "cancelled", attempt, code: "CANCELLED" });
          }
          return;
        }
        const failure = timedOut ? { code: "TIMEOUT", retry: true } : this.failureFor(job, error);
        const maxAttempts = this.bounded(job.maxAttempts, 1);
        if (!this.closed && failure.retry && attempt < Math.min(maxAttempts, INTERNAL_CURATOR_MAX_ATTEMPTS)) {
          this.retried += 1;
          this.pending.push({ job, attempt: attempt + 1 });
          this.observe({ key: job.key, outcome: "retrying", attempt, code: failure.code });
          return;
        }
        this.failed += 1;
        this.observe({ key: job.key, outcome: "failed", attempt, code: failure.code });
      })
      .finally(() => {
        clearTimeout(timer);
        removeAbort();
        if (this.active === active) this.active = undefined;
        const retryPending = this.pending.some((entry) => entry.job.key === job.key);
        if (!retryPending) {
          this.liveKeys.delete(job.key);
          this.remember(job.key);
        }
        this.pump();
        this.resolveIdleIfNeeded();
      });
  }
}

export function internalCuratorJobKey(input: {
  workspaceId: string;
  sessionId: string;
  turnId: string;
}): string {
  return JSON.stringify([input.workspaceId, input.sessionId, input.turnId]);
}
