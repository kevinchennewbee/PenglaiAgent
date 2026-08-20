import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCapabilityBaseline, captureCapabilityBaseline, PINNED_DSH_INTEGRITY } from "./capability-baseline.js";
import { PINNED_DSH, PINNED_DSH_COMMIT } from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R2I RC1 DSH capability baseline matches pinned official seams", () => {
  const baseline = captureCapabilityBaseline();
  assertCapabilityBaseline(baseline);
  assert.equal(baseline.dsh, PINNED_DSH);
  assert.equal(baseline.commit, PINNED_DSH_COMMIT);
  assert.equal(baseline.integrity, PINNED_DSH_INTEGRITY);
  assert.deepEqual(baseline.seams.themePreferences, ["light", "dark", "system"]);
  assert.deepEqual(baseline.seams.locales, ["zh", "en"]);
  assert.equal(baseline.seams.onboardingSlot, "settings.onboarding");
  assert.equal(baseline.seams.pluginsTabSlot, "settings.plugins.tab");
  assert.equal(baseline.overlay.sidebarWordmarkHasNameProp, false);
});

test("R2I RC1 lockfile integrity matches sources pin", () => {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(lock, new RegExp(`@deepseek-ai/dsh@${PINNED_DSH.replaceAll(".", "\\.")}`));
  assert.ok(lock.includes(PINNED_DSH_INTEGRITY));
});
