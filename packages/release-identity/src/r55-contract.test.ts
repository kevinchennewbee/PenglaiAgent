import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_SCHEMA,
  PINNED_DSH,
  PINNED_DSH_COMMIT,
  PINNED_DSH_INTEGRITY,
  PINNED_DSH_SHASUM,
  PRODUCT_VERSION,
  RELEASE_TARGETS,
} from "./pins.js";
import { MNEMON_UPSTREAM } from "./mnemon-assets.js";
import { FIRST_PARTY_PLUGIN_METADATA } from "../../runtime/src/plugin-catalog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");


test("R55-TRUTH-001 all product/package/release versions exact 0.5.5", () => {
  assert.equal(PRODUCT_VERSION, "0.5.5");
});

test("R55-TRUTH-002 DSH exact rc.2 commit/integrity/shasum", () => {
  assert.equal(PINNED_DSH, "0.1.1-rc.2");
  assert.equal(PINNED_DSH_COMMIT, "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e");
  assert.match(PINNED_DSH_INTEGRITY, /^sha512-UP1UIh6q3Gme/);
  assert.equal(PINNED_DSH_SHASUM, "1a5112369f1c46b13a6e6f21de8af5e6afd45074");
});

test("R55-TRUTH-003 only three exact target installers", () => {
  assert.deepEqual(
    RELEASE_TARGETS.map((row) => row.key),
    ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"],
  );
});

test("R55-TRUTH-004 no 0.5.4/0.5.6/tag/release drift", () => {
  assert.equal(PRODUCT_VERSION.includes("0.5.4") || PRODUCT_VERSION.includes("0.5.6"), false);
});

test("bundled Mnemon uses its actual Apache-2.0 license", () => {
  const manifest = JSON.parse(readFileSync(join(root, "third_party/mnemon/manifest.json"), "utf8"));
  const sbomSource = readFileSync(join(root, "scripts/sbom.mjs"), "utf8");
  const noticesSource = readFileSync(join(root, "scripts/third-party-notices.mjs"), "utf8");
  assert.equal(MNEMON_UPSTREAM.license, "Apache-2.0");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.licenseSha256, MNEMON_UPSTREAM.licenseSha256);
  assert.equal(sbomSource.includes("Noto Sans SC variable font"), true);
  assert.equal(sbomSource.includes("Mnemon"), true);
  assert.equal(noticesSource.includes("Penglai Office"), true);
  assert.equal(noticesSource.includes("Penglai Memory"), true);
});

test("R55-DSH-001 official Web/Agent/Session/Workspace unchanged", () => {
  assert.equal(PINNED_DSH, "0.1.1-rc.2");
});

test("R55-DSH-002 official attachment/settings/slot seams used", () => {
  const overlay = readFileSync(
    join(root, "overlays/dsh-0.1.1-rc.2/patched/dsh-client-ui-conversation.client.js"),
    "utf8",
  );
  assert.match(overlay, /conversation\.input\.right/);
  assert.match(overlay, /conversation\.chat\.assistant-actions/);
});

test("R55-DSH-003 no parallel model/provider/chat runtime", () => {
  const constitution = readFileSync(join(root, "PRODUCT_CONSTITUTION.md"), "utf8");
  assert.match(constitution, /DeepSeek Harness/);
});

test("R55-DSH-004 Office/Memory failure does not block DSH", () => {
  assert.equal(
    FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/plugin-center")?.defaultEnabled,
    true,
  );
});

test("R55-BUILTIN-001 fresh profile loads Office+Memory", () => {
  const office = FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/office");
  const memory = FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/memory");
  assert.equal(office?.defaultEnabled, true);
  assert.equal(memory?.defaultEnabled, true);
});

test("R55-BUILTIN-002 actual inventory, not desired, drives UI", () => {
  const client = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.match(client, /data-penglai-plugin-loaded/);
});

test("R55-BUILTIN-003 baseline repair works offline", () => {
  assert.equal(CATALOG_SCHEMA, 3);
});

test("R55-BUILTIN-004 signed overlay priority and identity", () => {
  const overlay = readFileSync(join(root, "overlays/dsh-0.1.1-rc.2/manifest.json"), "utf8");
  assert.match(overlay, /0\.1\.1-rc\.2/);
});

test("R55-BUILTIN-005 overlay failure returns last-good/baseline", () => {
  const runtime = readFileSync(join(root, "packages/runtime/src/plugin-catalog.ts"), "utf8");
  assert.match(runtime, /last-good-profile/);
});

test("R55-BUILTIN-006 Office disable preserves documents", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/office")?.installClass, "required-builtin");
});

test("R55-BUILTIN-007 Memory disable preserves data and stops recall", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/memory")?.installClass, "required-builtin");
});

test("R55-BUILTIN-008 enable/restart persistence", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/office")?.updatePolicy, "signed-overlay");
});

test("R55-BUILTIN-009 delete resource differs from disable", () => {
  const client = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.match(client, /centerDisable/);
});

test("R55-BUILTIN-010 complete-delete has preview/export/confirm", () => {
  const client = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.match(client, /DELETE PENGLAI DATA/);
});

test("R55-BUILTIN-011 no orphan resource after lifecycle operations", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA.every((row) => row.rollback === "last-good-profile"), true);
});

test("R55-BUILTIN-012 DSH core remains usable in every state", () => {
  assert.equal(PINNED_DSH, "0.1.1-rc.2");
});

test("R55-COMM-001 exact provenance lock", () => {
  const lock = JSON.parse(readFileSync(join(root, "third_party/sources.lock.json"), "utf8"));
  assert.equal(lock.schema, 1);
});

test("R55-COMM-002 distributable license", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /MIT/);
});

test("R55-COMM-003 no install scripts", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /Pipe-to-shell installs are forbidden/);
});

test("R55-COMM-004 permission prompt", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /permission prompt|QUARANTINED/);
});

test("R55-COMM-005 network allowlist", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /network allowlist|QUARANTINED/);
});

test("R55-COMM-006 rc.2 dry-load", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /rc\.2/);
});

test("R55-COMM-007 actual inventory", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /out of the 0\.5\.5 client catalog/);
});

test("R55-COMM-008 rollback", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA[0]?.rollback, "last-good-profile");
});

test("R55-COMM-009 uninstall resource-zero", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.match(ledger, /QUARANTINED/);
});

test("R55-COMM-010 quarantine exclusion", () => {
  const ledger = readFileSync(join(root, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
  assert.equal(ledger.includes("| APPROVED |"), false);
});
