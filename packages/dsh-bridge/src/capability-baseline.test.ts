import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCapabilityBaseline,
  captureCapabilityBaseline,
  PINNED_DSH_SOURCE_TARBALL_SHA256,
} from "./capability-baseline.js";
import { PINNED_DSH, PINNED_DSH_COMMIT } from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("DSH alpha source capability baseline matches pinned official seams", () => {
  const baseline = captureCapabilityBaseline();
  assertCapabilityBaseline(baseline);
  assert.equal(baseline.dsh, PINNED_DSH);
  assert.equal(baseline.commit, PINNED_DSH_COMMIT);
  assert.equal(baseline.sourceTarballSha256, PINNED_DSH_SOURCE_TARBALL_SHA256);
  assert.deepEqual(baseline.seams.themePreferences, ["light", "dark", "system"]);
  assert.deepEqual(baseline.seams.locales, ["zh", "en"]);
  assert.equal(baseline.seams.onboardingSlot, "settings.onboarding");
  assert.equal(baseline.seams.pluginsTabSlot, "settings.plugins.tab");
  assert.equal(baseline.overlay.applied, false);
  assert.equal(baseline.overlay.officialSlots, true);
});

test("DSH alpha lockfile source digest matches the vendored tarball pin", () => {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(lock, new RegExp(`@deepseek-ai/dsh@${PINNED_DSH.replaceAll(".", "\\.")}`));
  assert.ok(lock.includes(PINNED_DSH_SOURCE_TARBALL_SHA256));
});
