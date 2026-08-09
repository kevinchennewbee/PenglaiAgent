/**
 * RunCoordinator — per-key serialization with coalesced wake.
 *
 * Port of OpenCode's `SessionRunCoordinator` (sst/opencode, dev branch),
 * adapted to TypeScript promises. This is the concurrency primitive for the
 * unified EpisodeRunner: exactly one active run per session key, and
 * concurrent wake requests coalesce into a SINGLE successor run instead of
 * an unbounded queue.
 *
 * Semantics:
 *   - `run(key, fn)`: if a run is active for `key`, awaits it (join). The
 *     caller's `fn` does NOT execute concurrently; callers that want work to
 *     happen should call `wake()` instead. If no run is active, executes `fn`
 *     as the active run.
 *   - `wake(key)`: requests a successor run. If a run is active, marks
 *     `pendingWake = true`; when the active run settles, exactly one more run
 *     starts (re-running the registered worker). Multiple wakes while active
 *     collapse to one. If idle, does nothing (nothing to coalesce into);
 *     callers should `run()` to start from idle.
 *   - `interrupt(key)`: requests the active run to stop by rejecting its
 *     provided AbortSignal. Coalesced wakes are cleared (an interrupt
 *     replaces them).
 *   - `active(key)`: whether a run is in flight.
 *
 * The worker function is registered once via `setWorker` (or the constructor)
 * and is what `wake` re-runs. This mirrors OpenCode's separation of
 * "coordinator owns scheduling; runner owns execution".
 */

export interface RunHandle {
  /** Rejects when the run is interrupted; resolves when it completes. */
  readonly signal: AbortSignal;
  /** Correlation id for this run. */
  readonly runId: string;
}

export type RunWorker<T> = (key: string, handle: RunHandle) => Promise<T>;

interface Entry<T> {
  /** The currently active run's promise, or null when idle. */
  active: Promise<T> | null;
  /** Abort controller for the active run. */
  controller: AbortController | null;
  /** The active run id. */
  runId: string | null;
  /** A successor run has been requested and will fire on settle. */
  pendingWake: boolean;
  /** The result/error of the last completed run (for joiners from idle). */
  last: { ok: true; value: T } | { ok: false; reason: unknown } | null;
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class RunCoordinator<T = void> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly worker: RunWorker<T>;

  constructor(worker: RunWorker<T>) {
    this.worker = worker;
  }

  private entry(key: string): Entry<T> {
    let e = this.entries.get(key);
    if (!e) {
      e = {
        active: null,
        controller: null,
        runId: null,
        pendingWake: false,
        last: null,
      };
      this.entries.set(key, e);
    }
    return e;
  }

  /** True when a run is in flight for `key`. */
  active(key: string): boolean {
    return this.entry(key).active !== null;
  }

  /** The active run id, or null when idle. */
  activeRunId(key: string): string | null {
    return this.entry(key).runId;
  }

  /**
   * Ensure a run is executing. If idle, starts the worker; if active, joins
   * the active run (the caller's desire to run is coalesced into it).
   * Returns the result of the run that executed.
   */
  async run(key: string): Promise<T> {
    const e = this.entry(key);
    if (e.active) return e.active;
    return this.start(key);
  }

  /**
   * Request a successor run after the current one settles. Coalesces: many
   * wakes during one active run collapse to one successor. If idle, starts
   * a run immediately (there is nothing to coalesce into).
   */
  wake(key: string): void {
    const e = this.entry(key);
    if (e.active) {
      e.pendingWake = true;
      return;
    }
    // Idle: start now. Fire-and-forget; errors settle on the entry and are
    // observable via run()/join().
    void this.start(key).catch(() => {
      /* the rejection is stored on entry.last */
    });
  }

  /**
   * Interrupt the active run (aborts its signal) and clear any coalesced
   * successor. Returns true if a run was interrupted.
   */
  interrupt(key: string): boolean {
    const e = this.entry(key);
    e.pendingWake = false;
    if (e.controller) {
      e.controller.abort(new InterruptedError());
      return true;
    }
    return false;
  }

  /** Wait for the active run (if any) to settle. */
  async join(key: string): Promise<T | undefined> {
    const e = this.entry(key);
    if (e.active) await e.active.catch(() => {});
    return e.last?.ok ? e.last.value : undefined;
  }

  private start(key: string): Promise<T> {
    const e = this.entry(key);
    e.pendingWake = false;
    const controller = new AbortController();
    const runId = newRunId();
    e.controller = controller;
    e.runId = runId;
    const handle: RunHandle = { signal: controller.signal, runId };

    const promise = (async () => this.worker(key, handle))();
    e.active = promise;

    // Settle: store result, clear active, and run ONE successor if woken.
    const settle = async (): Promise<T> => {
      try {
        const value = await promise;
        e.last = { ok: true, value };
        return value;
      } catch (reason) {
        e.last = { ok: false, reason };
        throw reason;
      } finally {
        e.active = null;
        e.controller = null;
        e.runId = null;
        // Coalesced successor: exactly one, and it sees any wakes that
        // arrived during its run via the same pendingWake flag.
        if (e.pendingWake) {
          e.pendingWake = false;
          // Defer to the next microtask so the current run is fully
          // observable as settled before the successor starts.
          void Promise.resolve().then(() => {
            if (!e.active) void this.start(key).catch(() => {});
          });
        }
      }
    };

    const settled = settle();
    // Replace the stored active promise with the settling one so joiners
    // wait through the successor-triggering tail.
    e.active = settled;
    return settled;
  }
}

/** Raised on the run signal when `interrupt()` is called. */
export class InterruptedError extends Error {
  constructor() {
    super("run interrupted");
    this.name = "InterruptedError";
  }
}
