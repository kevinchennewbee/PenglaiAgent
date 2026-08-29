import assert from "node:assert/strict";
import test from "node:test";
import { InternalCuratorQueue, internalCuratorJobKey } from "./internal-curator.js";

test("internal curator is single-flight, deduplicated, and bounded", async () => {
  const queue = new InternalCuratorQueue({ maxJobs: 2, timeoutMs: 1_000 });
  let releaseFirst = (): void => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let active = 0;
  let maxActive = 0;
  const committed: string[] = [];
  const job = (key: string, gate?: Promise<void>) => ({
    key,
    async execute() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (gate) await gate;
      active -= 1;
      return key;
    },
    commit(raw: string) {
      committed.push(raw);
    },
  });

  assert.deepEqual(queue.enqueue(job("turn-1", firstGate)), { accepted: true });
  assert.deepEqual(queue.enqueue(job("turn-1")), { accepted: false, reason: "duplicate" });
  assert.deepEqual(queue.enqueue(job("turn-2")), { accepted: true });
  assert.deepEqual(queue.enqueue(job("turn-3")), { accepted: false, reason: "capacity" });
  assert.deepEqual(queue.snapshot(), {
    closed: false,
    active: 1,
    queued: 1,
    timers: 1,
    completed: 0,
    failed: 0,
    cancelled: 0,
    dropped: 1,
  });
  releaseFirst();
  await queue.whenIdle();
  assert.deepEqual(committed, ["turn-1", "turn-2"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(queue.enqueue(job("turn-1")), { accepted: false, reason: "duplicate" });
  assert.equal(queue.snapshot().completed, 2);
  queue.close();
});

test("internal curator timeout advances the queue and close cancels without commit", async () => {
  const waitIdle = async (queue: InternalCuratorQueue): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queue.whenIdle(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("queue did not become idle")), 1_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const timed = new InternalCuratorQueue({ maxJobs: 2, timeoutMs: 20 });
  let secondCommitted = false;
  timed.enqueue({
    key: "stuck",
    execute: () => new Promise<string>(() => undefined),
    commit: () => assert.fail("timed-out work must not commit"),
  });
  timed.enqueue({
    key: "next",
    execute: async () => "ok",
    commit: () => {
      secondCommitted = true;
    },
  });
  await waitIdle(timed);
  assert.equal(secondCommitted, true);
  assert.equal(timed.snapshot().cancelled, 1);
  assert.equal(timed.snapshot().completed, 1);

  const closing = new InternalCuratorQueue({ maxJobs: 2, timeoutMs: 1_000 });
  let activeSignal: AbortSignal | undefined;
  let committed = false;
  closing.enqueue({
    key: "active",
    execute: (signal) => {
      activeSignal = signal;
      return new Promise<string>(() => undefined);
    },
    commit: () => {
      committed = true;
    },
  });
  closing.enqueue({
    key: "queued",
    execute: async () => "queued",
    commit: () => {
      committed = true;
    },
  });
  await Promise.resolve();
  closing.close();
  await waitIdle(closing);
  assert.equal(activeSignal?.aborted, true);
  assert.equal(committed, false);
  assert.deepEqual(closing.snapshot(), {
    closed: true,
    active: 0,
    queued: 0,
    timers: 0,
    completed: 0,
    failed: 0,
    cancelled: 1,
    dropped: 0,
  });
});

test("internal curator key binds Workspace, Session, and Turn", () => {
  assert.notEqual(
    internalCuratorJobKey({ workspaceId: "ws-a", sessionId: "s1", turnId: "1" }),
    internalCuratorJobKey({ workspaceId: "ws-b", sessionId: "s1", turnId: "1" }),
  );
  assert.notEqual(
    internalCuratorJobKey({ workspaceId: "ws-a", sessionId: "s1", turnId: "1" }),
    internalCuratorJobKey({ workspaceId: "ws-a", sessionId: "s2", turnId: "1" }),
  );
});
