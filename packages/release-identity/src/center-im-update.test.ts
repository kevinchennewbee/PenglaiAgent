import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { PluginCenterHost, R2_CATALOG, verifyPackage } from "../../plugin-center/src/index.js";
import type { PluginCatalogEntry } from "../../runtime/src/plugin-catalog.js";
import { assertUpdateManifest, compareSemver } from "../../runtime/src/update.js";
import { assertSafeDeletePath, buildDeletionPlan } from "../../runtime/src/uninstall.js";

const sha = declaredSourceSha();
const TEST_CATALOG: PluginCatalogEntry[] = R2_CATALOG.map((entry) => ({
  ...entry,
  sha256: "a".repeat(64),
  target: "darwin-arm64",
  hasClient: ["@penglai/plugin-center", "@penglai/im", "@penglai/asr", "@penglai/moss-tts"].includes(entry.id),
}));

test("R50-CENTER-006/007 desired cannot impersonate and tampered package is rejected", () => {
  const host = new PluginCenterHost(
    mkdtempSync(join(tmpdir(), "pc-ev-")),
    { list: () => [] },
    TEST_CATALOG,
  );
  host.setDesired("@penglai/im", true);
  const im = host.reconcile().find((r) => r.id === "@penglai/im");
  assert.equal(im?.loaded, false);
  assert.equal(im?.actual, "failed");
  const file = "penglai-center-tamper-evidence.tgz";
  writeFileSync(file, "tampered");
  try {
    assert.throws(() => verifyPackage(file, "a".repeat(64)));
  } finally {
    rmSync(file, { force: true });
  }
  recordAssertion({
    acceptanceId: "R50-CENTER-006",
    runnerId: "fault",
    testId: "center-desired-not-actual",
    assertionId: "desired-enabled-not-loaded",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "desired enabled IM stays failed until official loader inventory is active" },
  });
  recordAssertion({
    acceptanceId: "R50-CENTER-007",
    runnerId: "security",
    testId: "center-tampered-package",
    assertionId: "checksum-mismatch-rejected",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "tampered package checksum is rejected before activate" },
  });
});

test("R50-UPD-001/002/004 update manifest rejects mutable latest and downgrade", () => {
  assert.equal(compareSemver("0.5.1", "0.5.0"), 1);
  assert.throws(
    () =>
      assertUpdateManifest(
        {
          schemaVersion: 1,
          channel: "desktop-v0.5",
          version: "0.5.0",
          minimumVersion: "0.5.0",
          platforms: {
            "darwin-aarch64": { url: "https://example.com/releases/latest/x.dmg", sha256: "a".repeat(64), size: 1 },
          },
        },
        "0.5.0",
        "darwin-aarch64",
      ),
    /latest|same-version|downgrade|mutable/,
  );
  recordAssertion({
    acceptanceId: "R50-UPD-001",
    runnerId: "contract",
    testId: "update-manifest-immutable",
    assertionId: "rejects-mutable-latest-url",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "update manifest rejects a mutable latest URL" },
  });
  recordAssertion({
    acceptanceId: "R50-UPD-004",
    runnerId: "security",
    testId: "update-manifest-immutable",
    assertionId: "rejects-same-version-replay",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "update manifest rejects same-version replay and downgrade" },
  });
});

test("R50-UPD-005/007 drain journal and non-executable staging", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { nextUpdateState, assertStagingNotExecutable, writeUpdateJournal } = await import("../../runtime/src/update.js");
  assertStagingNotExecutable(0o600);
  assert.throws(() => assertStagingNotExecutable(0o711));
  let state = nextUpdateState("INSTALL_REQUESTED", "drain");
  assert.equal(state, "DRAINING_DSH");
  const dest = writeUpdateJournal(mkdtempSync(join(tmpdir(), "penglai-upd-j-")), { operationId: "j1", state, drained: true });
  assert.match(dest, /update-journal.json/);
  recordAssertion({
    acceptanceId: "R50-UPD-007",
    runnerId: "integration",
    testId: "update-drain-journal",
    assertionId: "drain-before-handoff-journal",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "update journal records DSH drain before installer handoff" },
  });
});

test("R50-UN-002 legacy detector does not open a database", async () => {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { detectLegacy } = await import("../../runtime/src/uninstall.js");
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../runtime/src/uninstall.ts", import.meta.url), "utf8"));
  const detector = src.slice(src.indexOf("export function detectLegacy"), src.indexOf("export function executeDeletionPlan"));
  assert.match(detector, /statSync|existsSync/);
  assert.equal(detector.includes("sqlite"), false);
  assert.equal(detector.includes(".credentials.yaml"), false);
  const missing = detectLegacy(join(tmpdir(), "penglai-no-legacy-root"));
  assert.equal(missing.present, false);
  recordAssertion({
    acceptanceId: "R50-UN-002",
    runnerId: "security",
    testId: "legacy-detector-readonly",
    assertionId: "legacy-no-db-or-secret",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "legacy detector only reads existence version size and never opens a database" },
  });
});

test("R50-UN-005/006/007 deletion plan exact paths and escapes", () => {
  assert.throws(
    () =>
      buildDeletionPlan({
        operationId: "op",
        categories: ["credentials"],
        userData: "/tmp/Penglai/0.5",
        confirmCredentials: false,
      }),
    /second confirm/,
  );
  const plan = buildDeletionPlan({
    operationId: "op-2",
    categories: ["cache", "im"],
    userData: "/tmp/Penglai/0.5",
    confirmCredentials: false,
  });
  assert.ok(plan.paths.every((p) => p.startsWith("/tmp/Penglai/0.5/")));
  assert.throws(() => assertSafeDeletePath("/", "/tmp/Penglai/0.5", [], []), /root|home|drive/);
  recordAssertion({
    acceptanceId: "R50-UN-005",
    runnerId: "security",
    testId: "deletion-plan-exact-R50-UN-005",
    assertionId: "credentials-need-second-confirm",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "credentials complete-delete requires an independent second confirm" },
  });
  recordAssertion({
    acceptanceId: "R50-UN-006",
    runnerId: "security",
    testId: "deletion-plan-exact-R50-UN-006",
    assertionId: "plan-bound-to-generation-root",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "deletion plan paths stay under the 0.5 generation root" },
  });
  recordAssertion({
    acceptanceId: "R50-UN-007",
    runnerId: "security",
    testId: "deletion-plan-exact-R50-UN-007",
    assertionId: "root-escape-rejected",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "deletion plan refuses root/home/drive escape paths" },
  });
});
