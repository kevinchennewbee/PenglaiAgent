import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DRIFT_SUBGATES,
  DRIFT_SUBGATE_NAMES,
  HARD_SUBGATES,
  SUPPLEMENTAL_ACCEPTANCE_SUBGATES,
} from "./pins.js";

/**
 * The drift probes are a third category, and the distinction is the whole point.
 * They must not become a hard gate (an unreachable vendor would then be able to
 * stop a complete release) and they must not be filed as supplemental acceptance
 * (which reads as "nice to have" for the checks that would have caught every
 * serious 0.6.x defect). These assertions keep that separation from eroding by
 * accident.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const HARD_NAMES = HARD_SUBGATES.map((gate) => gate.name);
const SUPPLEMENTAL_NAMES = SUPPLEMENTAL_ACCEPTANCE_SUBGATES.map((gate) => gate.name);

test("verify:drift is declared exactly once, as a drift subgate", () => {
  assert.deepEqual([...DRIFT_SUBGATE_NAMES], ["verify:drift"]);
  assert.ok(
    !HARD_NAMES.includes("verify:drift"),
    "verify:drift must not be a hard release gate: an unreachable external service must not block a complete release",
  );
  assert.ok(
    !SUPPLEMENTAL_NAMES.includes("verify:drift"),
    "verify:drift is not supplemental acceptance; it is the check that detects frozen assumptions about the outside world",
  );
});

test("the drift subgate names a script that exists and is wired into package.json", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  assert.equal(typeof scripts["verify:drift"], "string");
  assert.match(scripts["verify:drift"], /scripts\/verify-drift\.mjs/);
  assert.ok(
    existsSync(join(ROOT, "scripts", "verify-drift.mjs")),
    "scripts/verify-drift.mjs must exist",
  );
});

test("a scheduled workflow runs the drift probes, so drift is found without a user report", () => {
  const workflow = join(ROOT, ".github", "workflows", "drift-probes.yml");
  assert.ok(existsSync(workflow), ".github/workflows/drift-probes.yml must exist");
  const source = readFileSync(workflow, "utf8");
  assert.match(source, /cron:/, "the drift workflow must be scheduled, not only manual");
  assert.match(source, /pnpm verify:drift/, "the drift workflow must run the probes");
});

test("the probe set covers the assumptions that actually broke", () => {
  // Each of these ids pins a frozen external assumption that shipped a defect.
  // Removing one silently would remove the only automatic warning for that class.
  const script = readFileSync(join(ROOT, "scripts", "verify-drift.mjs"), "utf8");
  for (const id of ["weixin-ilink", "dsh-upstream", "dsh-im-channel", "published-facts", "opencode-go"]) {
    assert.match(script, new RegExp(`"${id}"`), `drift probe ${id} must remain declared`);
  }
});
