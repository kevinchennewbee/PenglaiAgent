import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { UPDATE_TARGETS } from "@penglai/contracts";
import { EXCLUDED_CURRENT_RELEASE_TARGET_KEY, PRODUCT_VERSION, RELEASE_TARGETS } from "./pins.js";

/**
 * The release pipeline and the runtime updater keep separate target tables on
 * purpose: `pins.ts` must stay a closed literal array because
 * `scripts/lib/release-pins-source.mjs` extracts it textually, and the runtime
 * table must stay executable so the updater and both manifest schemas can share
 * it. Neither can import the other without breaking one of those properties, so
 * this test is what holds them together.
 *
 * It exists because they drifted in opposite directions and nothing noticed:
 *
 * - `linux-loong64` was a published release target and `releaseTarget()` already
 *   resolved to it on UOS, but the runtime table omitted it, so every update
 *   check on UOS threw "unsupported update target".
 * - `darwin-x86_64` was dropped from the release contract at 0.6.1 but stayed in
 *   the runtime table, which kept advertising an installer this version does not
 *   publish.
 */

const PINS_SOURCE = join(import.meta.dirname, "pins.ts");

test("every published release target is carryable by the runtime update table", () => {
  for (const target of RELEASE_TARGETS) {
    const spec = UPDATE_TARGETS.find((row) => row.key === target.key);
    assert.ok(
      spec,
      `release target ${target.key} is published but the runtime update table cannot carry it`,
    );
    assert.equal(spec.platform, target.platform, `${target.key} platform`);
    assert.equal(spec.arch, target.arch, `${target.key} arch`);
  }
});

test("published installer filenames match the runtime installer template at this version", () => {
  for (const target of RELEASE_TARGETS) {
    const spec = UPDATE_TARGETS.find((row) => row.key === target.key)!;
    assert.equal(
      target.installer,
      spec.installer.replace("{version}", PRODUCT_VERSION),
      `${target.key} installer name disagrees between pins.ts and UPDATE_TARGETS`,
    );
  }
});

test("the excluded historical target is declared but not published", () => {
  assert.ok(
    UPDATE_TARGETS.some((row) => row.key === EXCLUDED_CURRENT_RELEASE_TARGET_KEY),
    "the historical Intel target must stay known to the updater so old manifests still parse",
  );
  assert.ok(
    !RELEASE_TARGETS.some((row) => row.key === EXCLUDED_CURRENT_RELEASE_TARGET_KEY),
    "the historical Intel target must not be published by this version",
  );
});

test("pins.ts keeps RELEASE_TARGETS as one closed literal declaration", () => {
  // The textual extractor in scripts/lib/release-pins-source.mjs depends on this
  // shape. Asserting it here means a future refactor fails in the identity
  // package rather than only in the release pipeline.
  const source = readFileSync(PINS_SOURCE, "utf8").replace(/\r\n?/g, "\n");
  const matches = [...source.matchAll(/export const RELEASE_TARGETS = \[([\s\S]*?)\n\] as const;/g)];
  assert.equal(matches.length, 1, "RELEASE_TARGETS must have exactly one closed literal declaration");
  const rows = [
    ...matches[0]![1]!.matchAll(
      /\{\n    key: "([^"\n]+)",\n    platform: "([^"\n]+)",\n    arch: "([^"\n]+)",\n    installer: "([^"\n]+)",\n  \}/g,
    ),
  ];
  assert.equal(rows.length, RELEASE_TARGETS.length, "every RELEASE_TARGETS row must be textually extractable");
});
