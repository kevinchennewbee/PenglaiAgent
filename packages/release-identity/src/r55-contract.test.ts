import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_SCHEMA,
  PINNED_DSH,
  PINNED_DSH_CLOSURE_MANIFEST_SHA256,
  PINNED_DSH_COMMIT,
  PINNED_DSH_TARBALL_SHA256,
  PRODUCT_VERSION,
  RELEASE_TARGETS,
} from "./pins.js";
import { MNEMON_UPSTREAM } from "./mnemon-assets.js";
import { FIRST_PARTY_PLUGIN_METADATA } from "../../runtime/src/plugin-catalog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");


test("release truth pins Penglai 0.6.3", () => {
  assert.equal(PRODUCT_VERSION, "0.6.3");
});

test("DSH alpha.2 source commit and closure digests are exact", () => {
  assert.equal(PINNED_DSH, "0.1.6-alpha.2");
  assert.equal(PINNED_DSH_COMMIT, "ddefc45fbc7f8e46dd73185e68295696d1297887");
  assert.equal(PINNED_DSH_TARBALL_SHA256, "a3c14d175c051023dcde078fb273b287b13b4b77654ea90b52d956cbf409178d");
  assert.equal(PINNED_DSH_CLOSURE_MANIFEST_SHA256, "eee9d9b1d350d337eb74489efd2ecbfd069054e0ef8751d45a94b857e691fd7f");
});

test("R55-TRUTH-003 three exact target installers including linux-loong64", () => {
  assert.deepEqual(
    RELEASE_TARGETS.map((row) => row.key),
    ["darwin-aarch64", "win32-x86_64", "linux-loong64"],
  );
});

test("release version has no older tag drift", () => {
  assert.equal(PRODUCT_VERSION, "0.6.3");
  assert.equal(PRODUCT_VERSION.includes("0.5.6") || PRODUCT_VERSION.includes("0.5.7"), false);
});

test("bundled Mnemon uses its actual Apache-2.0 license", () => {
  const manifest = JSON.parse(readFileSync(join(root, "third_party/mnemon/manifest.json"), "utf8"));
  const sbomSource = readFileSync(join(root, "scripts/sbom.mjs"), "utf8");
  const noticesSource = readFileSync(join(root, "scripts/third-party-notices.mjs"), "utf8");
  assert.equal(MNEMON_UPSTREAM.license, "Apache-2.0");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.licenseSha256, MNEMON_UPSTREAM.licenseSha256);
  assert.equal(sbomSource.includes("Noto Sans SC variable font"), false);
  assert.equal(sbomSource.includes("Mnemon"), true);
  assert.equal(sbomSource.includes("Poppler pdftoppm"), false);
  assert.equal(noticesSource.includes("Poppler pdftoppm"), false);
  assert.equal(noticesSource.includes("Penglai Office, Budget, Companion"), true);
  assert.equal(noticesSource.includes("are not part of this"), true);
  assert.equal(noticesSource.includes("Penglai Memory"), true);
});

test("0.5.12 does not ship bundled Poppler pdftoppm", () => {
  const lock = JSON.parse(readFileSync(join(root, "third_party/sources.lock.json"), "utf8"));
  assert.equal(existsSync(join(root, "packages/release-identity/src/poppler-assets.js")), false);
  assert.equal(existsSync(join(root, "scripts/fetch-poppler.mjs")), false);
  assert.equal(existsSync(join(root, "scripts/lib/package-poppler.mjs")), false);
  assert.equal(
    (lock.sources ?? []).some((row: { id?: string }) => row.id === "poppler-pdftoppm"),
    false,
  );
});

test("official Web/Agent/Session/Workspace stay on the one fixed DSH core", () => {
  assert.equal(PINNED_DSH, "0.1.6-alpha.2");
});

test("R55-DSH-002 official attachment/settings/slot seams used", () => {
  const packer = readFileSync(join(root, "scripts/pack-plugins.mjs"), "utf8");
  assert.match(packer, /dsh-client-ui-slots/);
  assert.match(packer, /dsh-api-remotes/);
  assert.doesNotMatch(packer, /unpublished-on-linux-loong64/);
  const embed = readFileSync(join(root, "scripts/embed-runtime.mjs"), "utf8");
  assert.doesNotMatch(embed, /unpublished-on-linux-loong64/);
});

test("R55-DSH-003 no parallel model/provider/chat runtime", () => {
  const constitution = readFileSync(join(root, "PRODUCT_CONSTITUTION.md"), "utf8");
  assert.match(constitution, /DeepSeek Harness/);
});

test("R63-DSH-004 Memory failure does not replace the DSH core", () => {
  assert.equal(
    FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/plugin-center")?.defaultEnabled,
    true,
  );
});

test("R63-BUILTIN-001 fresh profile loads Memory", () => {
  const memory = FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/memory");
  assert.equal(memory?.defaultEnabled, true);
});

test("R55-BUILTIN-002 actual inventory, not desired, drives UI", () => {
  const client = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.match(client, /data-penglai-plugin-loaded/);
});

test("R55-BUILTIN-003 baseline repair works offline", () => {
  assert.equal(CATALOG_SCHEMA, 3);
});

test("alpha runtime uses official slots and does not apply the historical rc.2 overlay", () => {
  const embed = readFileSync(join(root, "scripts/embed-runtime.mjs"), "utf8");
  assert.doesNotMatch(embed, /applyOverlayToRoot/);
  assert.match(embed, /official-slots-no-source-patch/);
});

test("native and installed probes use the alpha Remote stream mux", () => {
  for (const relative of [
    "apps/desktop/src/electron-main.ts",
    "scripts/lib/browser-window-walk.mjs",
    "scripts/lib/runner-live.mjs",
  ]) {
    const source = readFileSync(join(root, relative), "utf8");
    assert.match(source, /\/api\/remote\.mux/);
    assert.doesNotMatch(source, /\/api\/events\.host/);
  }
});

test("R55-BUILTIN-005 overlay failure returns last-good/baseline", () => {
  const runtime = readFileSync(join(root, "packages/runtime/src/plugin-catalog.ts"), "utf8");
  assert.match(runtime, /last-good-profile/);
});

test("R55-BUILTIN-007 Memory disable preserves data and stops recall", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/memory")?.installClass, "required-builtin");
});

test("R55-BUILTIN-008 enable/restart persistence", () => {
  assert.equal(FIRST_PARTY_PLUGIN_METADATA.find((row) => row.id === "@penglai/memory")?.updatePolicy, "signed-overlay");
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
  assert.equal(PINNED_DSH, "0.1.6-alpha.2");
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
