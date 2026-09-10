import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_DSH, PINNED_DSH_COMMIT } from "./pins.js";
import {
  assertActiveOfficialDshWorkflowCheckouts,
  assertOfficialDshWorkflowCheckouts,
  assertSourceCiOfficialDshEntrypoint,
  parseOfficialDshWorkflowCheckouts,
} from "./dsh-workflow-checkout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const STALE_ALPHA_CHECKOUT = `
      - name: Check out immutable official DSH 0.1.5-alpha.1 source
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          repository: deepseek-ai/DeepSeek-Harness
          ref: 5dda764ed3aa172535a7967b06ff95d9cbfe536a
          path: upstream-dsh
          fetch-depth: 1
`;

function currentPinnedCheckout(label = PINNED_DSH): string {
  return `
      - name: Check out immutable official DSH ${label} source
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          repository: deepseek-ai/DeepSeek-Harness
          ref: ${PINNED_DSH_COMMIT}
          path: upstream-dsh
          fetch-depth: 1
      - name: Verify fixed DSH npm cohort
        env:
          PENGLAI_DSH_UPSTREAM: \${{ github.workspace }}/upstream-dsh
        run: |
          pnpm verify:dsh-npm-cohort
          pnpm verify:dsh-npm-cohort:live
      - name: Fetch and verify the pinned native Mnemon binary
        run: pnpm fetch:mnemon-assets
      - name: Source, contract, and evidence-class gates
        env:
          PENGLAI_DSH_UPSTREAM: \${{ github.workspace }}/upstream-dsh
        run: |
          pnpm test:unit
          pnpm verify:dsh-alpha-owner-remotes
`;
}

test("stale official DSH workflow checkout is rejected against the current source contract", () => {
  const checkouts = parseOfficialDshWorkflowCheckouts(STALE_ALPHA_CHECKOUT, ".github/workflows/source-ci.yml");
  assert.equal(checkouts.length, 1);
  assert.equal(checkouts[0]?.ref, "5dda764ed3aa172535a7967b06ff95d9cbfe536a");
  assert.throws(
    () => assertOfficialDshWorkflowCheckouts(checkouts),
    /does not match current source contract/,
  );
});

test("current-commit checkout with a stale alpha label is rejected", () => {
  const checkouts = parseOfficialDshWorkflowCheckouts(
    currentPinnedCheckout("0.1.5-alpha.1"),
    ".github/workflows/source-ci.yml",
  );
  assert.throws(
    () => assertOfficialDshWorkflowCheckouts(checkouts),
    /is not pinned to 0\.1\.5-rc\.1/,
  );
});

test("source-ci still fails locally if Mnemon fetch moves after unit gates", () => {
  const text = currentPinnedCheckout().replace(
    "pnpm fetch:mnemon-assets",
    "pnpm test:unit\n          pnpm fetch:mnemon-assets",
  );
  assert.throws(
    () => assertSourceCiOfficialDshEntrypoint(text),
    /fetch pinned Mnemon before unit gates/,
  );
});

test("source-ci still fails locally if the official checkout is rebound to the alpha env", () => {
  const text = currentPinnedCheckout().replaceAll("PENGLAI_DSH_UPSTREAM", "PENGLAI_DSH_ALPHA_SOURCE");
  assert.throws(
    () => assertSourceCiOfficialDshEntrypoint(text),
    /PENGLAI_DSH_ALPHA_SOURCE/,
  );
});

test("active official DSH workflow checkouts match the current source contract", () => {
  const checkouts = assertActiveOfficialDshWorkflowCheckouts(root);
  assert.ok(checkouts.length >= 2);
  const files = new Set(checkouts.map((row) => row.file));
  assert.equal(files.has(".github/workflows/source-ci.yml"), true);
  assert.equal(files.has(".github/workflows/native-release-candidate.yml"), true);
  assert.equal(
    checkouts.every((row) => row.ref === PINNED_DSH_COMMIT && row.name.includes(PINNED_DSH)),
    true,
  );
  const workflowNames = readdirSync(join(root, ".github/workflows"));
  for (const name of workflowNames) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const text = readFileSync(join(root, ".github/workflows", name), "utf8");
    assert.equal(text.includes("5dda764ed3aa172535a7967b06ff95d9cbfe536a"), false);
  }
});
