export const INTERNAL_CURATOR_MAX_JOBS = 8;
export const INTERNAL_CURATOR_TIMEOUT_MS = 45_000;
export const INTERNAL_CURATOR_SEEN_KEYS = 2_048;

export interface InternalCuratorJob {
  key: string;
  execute(signal: AbortSignal): Promise<string>;
  commit(raw: string): Promise<void> | void;
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
  dropped: number;
}

interface ActiveJob {
  job: InternalCuratorJob;
  controller: AbortController;
}

/**
 * Memory-owned queue for auxiliary curator calls. It deliberately owns no DSH
 * Agent or Session: one official LLM request runs at a time, duplicate Turns
 * collapse, overload fails open, and plugin teardown aborts the active call.
 */
export class InternalCuratorQueue {
  private readonly pending: InternalCuratorJob[] = [];
  private readonly liveKeys = new Set<string>();
  private readonly seenKeys = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private active: ActiveJob | undefined;
  private closed = false;
  private completed = 0;
  private failed = 0;
  private cancelled = 0;
  private dropped = 0;

  constructor(
    private readonly options: {
      maxJobs?: number;
      timeoutMs?: number;
      maxSeenKeys?: number;
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
      return { accepted: false, reason: "capacity" };
    }
    this.liveKeys.add(job.key);
    this.pending.push(job);
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
    for (const job of this.pending.splice(0)) this.liveKeys.delete(job.key);
    this.active?.controller.abort();
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

  private pump(): void {
    if (this.closed || this.active) return;
    const job = this.pending.shift();
    if (!job) {
      this.resolveIdleIfNeeded();
      return;
    }
    const controller = new AbortController();
    const active = { job, controller };
    this.active = active;
    const timeoutMs = this.bounded(this.options.timeoutMs, INTERNAL_CURATOR_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let removeAbort = (): void => undefined;
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = (): void => reject(new Error("memory curator cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => controller.signal.removeEventListener("abort", onAbort);
    });
    const execution = Promise.resolve().then(() => job.execute(controller.signal));
    void Promise.race([execution, aborted])
      .then(async (raw) => {
        if (this.closed || controller.signal.aborted) return;
        await job.commit(raw);
        this.completed += 1;
      })
      .catch(() => {
        if (controller.signal.aborted) this.cancelled += 1;
        else this.failed += 1;
      })
      .finally(() => {
        clearTimeout(timer);
        removeAbort();
        this.liveKeys.delete(job.key);
        this.remember(job.key);
        if (this.active === active) this.active = undefined;
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
