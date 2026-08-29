import assert from "node:assert/strict";
import test from "node:test";
import { buildResourcePressure } from "./resource-pressure.js";

const BASE = {
  workers: 0,
  sockets: 0,
  timers: 2,
  remotes: 1,
  db: 1,
  modelSessions: 0,
  audioHandles: 0,
};

test("resource pressure separates active and queued work from legacy workers", () => {
  const snapshot = buildResourcePressure(
    ["@penglai/memory", "@penglai/memory"],
    () => ({
      snapshot: () => ({
        ...BASE,
        workers: 8,
        activeJobs: 1,
        queuedJobs: 7,
      }),
    }),
  );
  assert.equal(snapshot.schema, 2);
  assert.equal(snapshot.plugins.length, 1);
  assert.deepEqual(snapshot.plugins[0], {
    id: "@penglai/memory",
    measured: true,
    jobBudget: { activeJobs: 1, queuedJobs: 7, totalJobs: 8 },
    budgetState: "at-budget",
    evidence: "service-resource-snapshot",
    activeJobs: 1,
    queuedJobs: 7,
    remoteRequests: null,
    workerThreads: null,
    childProcesses: null,
    openFiles: null,
    timers: 2,
    sockets: 0,
    modelSessions: 0,
    audioHandles: 0,
  });
  assert.deepEqual(snapshot.core, {
    evidence: "DSH_ALPHA_RUNTIME_EVIDENCE_REQUIRED",
    trueSubagents: null,
    activeToolCalls: null,
    activeRemoteRequests: null,
    openFiles: null,
  });
});

test("resource pressure keeps unavailable and failed probes distinct from zero", () => {
  const snapshot = buildResourcePressure(
    ["@penglai/missing", "@penglai/broken"],
    (id) =>
      id === "@penglai/broken"
        ? {
            snapshot() {
              throw new Error("private diagnostic");
            },
          }
        : undefined,
  );
  assert.equal(snapshot.plugins[0]?.id, "@penglai/broken");
  assert.equal(snapshot.plugins[0]?.evidence, "resource-probe-failed");
  assert.equal(snapshot.plugins[1]?.id, "@penglai/missing");
  assert.equal(snapshot.plugins[1]?.evidence, "runtime-evidence-unavailable");
  for (const row of snapshot.plugins) {
    assert.equal(row.measured, false);
    assert.equal(row.jobBudget, null);
    assert.equal(row.budgetState, "unavailable");
    assert.equal(row.activeJobs, null);
    assert.equal(row.queuedJobs, null);
    assert.equal(row.remoteRequests, null);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /private diagnostic/);
});

test("resource pressure keeps a known budget when live measurement is unavailable", () => {
  const snapshot = buildResourcePressure(
    ["@penglai/moss-tts"],
    () => undefined,
  );
  assert.deepEqual(snapshot.plugins[0], {
    id: "@penglai/moss-tts",
    measured: false,
    jobBudget: { activeJobs: 1, queuedJobs: 3, totalJobs: 4 },
    budgetState: "unavailable",
    evidence: "runtime-evidence-unavailable",
    activeJobs: null,
    queuedJobs: null,
    remoteRequests: null,
    workerThreads: null,
    childProcesses: null,
    openFiles: null,
    timers: null,
    sockets: null,
    modelSessions: null,
    audioHandles: null,
  });
});

test("resource pressure rejects invalid counters instead of normalizing them to zero", () => {
  const snapshot = buildResourcePressure(["@penglai/memory"], () => ({
    snapshot: () => ({
      ...BASE,
      activeJobs: -1,
      queuedJobs: Number.POSITIVE_INFINITY,
      remoteRequests: 0,
    }),
  }));
  assert.equal(snapshot.plugins[0]?.activeJobs, null);
  assert.equal(snapshot.plugins[0]?.queuedJobs, null);
  assert.equal(snapshot.plugins[0]?.remoteRequests, 0);
  assert.equal(snapshot.plugins[0]?.budgetState, "unavailable");
});

test("resource pressure classifies capacity without relying on visible arithmetic", () => {
  const counts = new Map([
    ["@penglai/asr", { activeJobs: 0, queuedJobs: 2 }],
    ["@penglai/memory", { activeJobs: 1, queuedJobs: 4 }],
    ["@penglai/moss-tts", { activeJobs: 2, queuedJobs: 3 }],
    ["@penglai/unbudgeted", { activeJobs: 99, queuedJobs: 99 }],
  ]);
  const snapshot = buildResourcePressure([...counts.keys()], (id) => ({
    snapshot: () => ({ ...BASE, ...counts.get(id) }),
  }));
  assert.deepEqual(
    Object.fromEntries(
      snapshot.plugins.map((row) => [row.id, row.budgetState]),
    ),
    {
      "@penglai/asr": "within-budget",
      "@penglai/memory": "at-budget",
      "@penglai/moss-tts": "over-budget",
      "@penglai/unbudgeted": "unbudgeted",
    },
  );
});

test("resource pressure isolates a probe lookup failure", () => {
  const snapshot = buildResourcePressure(["@penglai/broken"], () => {
    throw new Error("private lookup failure");
  });
  assert.equal(snapshot.plugins[0]?.measured, false);
  assert.equal(snapshot.plugins[0]?.evidence, "resource-probe-failed");
  assert.doesNotMatch(JSON.stringify(snapshot), /private lookup failure/);
});
