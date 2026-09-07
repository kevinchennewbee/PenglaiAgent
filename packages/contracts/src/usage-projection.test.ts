import assert from "node:assert/strict";
import test from "node:test";
import { projectOfficialUsage } from "./usage-projection.js";

test("official usage projection keeps occupancy, cache, cumulative and estimated cost distinct", () => {
  const seen = projectOfficialUsage({
    occupancyTokens: 1200,
    inputTokens: 800,
    outputTokens: 200,
    cacheReadTokens: 40,
    estimatedCost: 0.12,
    estimatedCurrency: "USD",
  });
  assert.equal(seen.occupancy.availability, "available");
  assert.equal(seen.occupancy.tokens, 1200);
  assert.equal(seen.cumulative.inputTokens, 800);
  assert.equal(seen.cache.readTokens, 40);
  assert.equal(seen.estimatedCost.availability, "estimated");
  assert.equal(seen.estimatedCost.amount, 0.12);
  const missing = projectOfficialUsage({});
  assert.equal(missing.occupancy.availability, "unavailable");
  assert.equal(missing.cumulative.availability, "unavailable");
  assert.equal(missing.cache.availability, "unavailable");
  assert.equal(missing.estimatedCost.availability, "unavailable");
  assert.equal("amount" in missing.estimatedCost, false);
});
