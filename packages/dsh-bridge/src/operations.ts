import { PenglaiError } from "@penglai/contracts";

export const BRIDGE_DEFAULT_DEADLINE_MS = 30_000;

export interface BridgeCallOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
  generation?: number;
  operationId?: string;
}

export class BridgeOperationGate {
  private generation = 0;
  private readonly completed = new Map<string, unknown>();

  currentGeneration(): number {
    return this.generation;
  }

  bumpGeneration(): number {
    this.generation += 1;
    this.completed.clear();
    return this.generation;
  }

  assertGeneration(expected?: number): void {
    if (expected !== undefined && expected !== this.generation) {
      throw new PenglaiError("DSH_UNAVAILABLE", "stale bridge generation");
    }
  }

  async run<T>(options: BridgeCallOptions | undefined, fn: () => Promise<T> | T): Promise<T> {
    const opts = options ?? {};
    this.assertGeneration(opts.generation);
    if (opts.signal?.aborted) {
      throw new PenglaiError("DSH_UNAVAILABLE", "bridge operation cancelled");
    }
    if (opts.operationId && this.completed.has(opts.operationId)) {
      return this.completed.get(opts.operationId) as T;
    }
    const deadlineMs = opts.deadlineMs ?? BRIDGE_DEFAULT_DEADLINE_MS;
    const started = this.generation;
    const value = await new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(() => reject(new PenglaiError("DSH_UNAVAILABLE", "bridge operation deadline exceeded")));
      }, deadlineMs);
      const onAbort = () => {
        finish(() => reject(new PenglaiError("DSH_UNAVAILABLE", "bridge operation cancelled")));
      };
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        settle();
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(fn)
        .then((result) => finish(() => resolve(result)))
        .catch((error) => finish(() => reject(error)));
    });
    this.assertGeneration(opts.generation ?? started);
    if (opts.operationId) this.completed.set(opts.operationId, value);
    return value;
  }
}
