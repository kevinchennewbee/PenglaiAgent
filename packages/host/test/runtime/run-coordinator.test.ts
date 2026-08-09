import { describe, it, expect, vi } from "vitest";
import { RunCoordinator, InterruptedError } from "../../src/runtime/run-coordinator.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("RunCoordinator", () => {
  it("runs the worker when idle and records the result", async () => {
    const coord = new RunCoordinator(async () => 42);
    const result = await coord.run("k");
    expect(result).toBe(42);
    expect(coord.active("k")).toBe(false);
  });

  it("joins the active run instead of starting a second one", async () => {
    let started = 0;
    const gate = deferred<void>();
    const coord = new RunCoordinator(async () => {
      started += 1;
      await gate.promise;
      return started;
    });
    const first = coord.run("k");
    // Give the worker a tick to reach its await.
    await Promise.resolve();
    const second = coord.run("k");
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(started).toBe(1); // worker ran once, both callers joined
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("serializes per key but allows different keys concurrently", async () => {
    const inFlight = new Map<string, number>();
    const maxConcurrent = new Map<string, number>();
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const coord = new RunCoordinator(async (key) => {
      inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
      maxConcurrent.set(key, Math.max(maxConcurrent.get(key) ?? 0, inFlight.get(key)!));
      let gate = gates.get(key);
      if (!gate) {
        gate = deferred<void>();
        gates.set(key, gate);
      }
      await gate.promise;
      inFlight.set(key, (inFlight.get(key) ?? 1) - 1);
      return key;
    });
    const a1 = coord.run("alpha");
    const a2 = coord.run("alpha"); // joins a1
    const b1 = coord.run("beta");
    await Promise.resolve();
    expect(coord.active("alpha")).toBe(true);
    expect(coord.active("beta")).toBe(true);
    gates.get("alpha")!.resolve();
    gates.get("beta")!.resolve();
    await Promise.all([a1, a2, b1]);
    expect(maxConcurrent.get("alpha")).toBe(1); // never two at once
    expect(maxConcurrent.get("beta")).toBe(1);
  });

  it("coalesces multiple wakes into one successor run", async () => {
    let runs = 0;
    let gate = deferred<void>();
    const coord = new RunCoordinator(async () => {
      runs += 1;
      const myGate = gate;
      await myGate.promise;
      return runs;
    });
    // First run starts.
    const first = coord.run("k");
    await Promise.resolve();
    // Five wakes while active — must collapse to one successor.
    coord.wake("k");
    coord.wake("k");
    coord.wake("k");
    coord.wake("k");
    coord.wake("k");
    gate.resolve();
    await first;
    // The successor starts; let it run, then settle.
    gate = deferred<void>();
    await vi.waitFor(() => expect(runs).toBe(2));
    gate.resolve();
    await coord.join("k");
    expect(runs).toBe(2); // not 6
  });

  it("wake from idle starts a run immediately", async () => {
    let runs = 0;
    const coord = new RunCoordinator(async () => {
      runs += 1;
      return runs;
    });
    coord.wake("k");
    await vi.waitFor(() => expect(runs).toBe(1));
    await coord.join("k");
    expect(coord.active("k")).toBe(false);
  });

  it("interrupt aborts the active run and clears pending wake", async () => {
    const started = deferred<void>();
    let runs = 0;
    let interrupted = false;
    const coord = new RunCoordinator(async (_key, { signal }) => {
      runs += 1;
      started.resolve();
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const run = coord.run("k").catch((error) => {
      if (error instanceof InterruptedError) interrupted = true;
      throw error;
    });
    await started.promise;
    coord.wake("k"); // schedule a successor
    const didInterrupt = coord.interrupt("k");
    expect(didInterrupt).toBe(true);
    await expect(run).rejects.toBeInstanceOf(InterruptedError);
    expect(interrupted).toBe(true);
    // The pending wake was cleared; no successor should start.
    await new Promise((r) => setTimeout(r, 20));
    expect(runs).toBe(1);
  });

  it("surfaces worker errors and lets the next run start cleanly", async () => {
    let attempt = 0;
    const coord = new RunCoordinator(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return "ok";
    });
    await expect(coord.run("k")).rejects.toThrow("boom");
    expect(coord.active("k")).toBe(false);
    const second = await coord.run("k");
    expect(second).toBe("ok");
  });

  it("join waits for the active run and returns its value", async () => {
    const gate = deferred<number>();
    const coord = new RunCoordinator(async () => {
      const v = await gate.promise;
      return v;
    });
    const run = coord.run("k");
    const join = coord.join("k");
    gate.resolve(7);
    expect(await run).toBe(7);
    expect(await join).toBe(7);
  });
});
