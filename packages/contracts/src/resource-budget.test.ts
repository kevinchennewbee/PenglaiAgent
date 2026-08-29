import assert from "node:assert/strict";
import test from "node:test";
import { PENGLAI_RESOURCE_JOB_BUDGETS } from "./index.js";

test("Penglai job budgets are exact, bounded, and internally consistent", () => {
  assert.deepEqual(Object.keys(PENGLAI_RESOURCE_JOB_BUDGETS).sort(), [
    "@penglai/asr",
    "@penglai/memory",
    "@penglai/moss-tts",
  ]);
  assert.deepEqual(PENGLAI_RESOURCE_JOB_BUDGETS, {
    "@penglai/asr": { activeJobs: 1, queuedJobs: 7, totalJobs: 8 },
    "@penglai/memory": { activeJobs: 1, queuedJobs: 7, totalJobs: 8 },
    "@penglai/moss-tts": { activeJobs: 1, queuedJobs: 3, totalJobs: 4 },
  });
  for (const budget of Object.values(PENGLAI_RESOURCE_JOB_BUDGETS)) {
    assert.equal(Number.isSafeInteger(budget.activeJobs), true);
    assert.equal(Number.isSafeInteger(budget.queuedJobs), true);
    assert.equal(Number.isSafeInteger(budget.totalJobs), true);
    assert.ok(budget.activeJobs > 0);
    assert.ok(budget.queuedJobs >= 0);
    assert.equal(budget.totalJobs, budget.activeJobs + budget.queuedJobs);
  }
});
