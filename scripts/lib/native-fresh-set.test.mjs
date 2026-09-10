import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION } from "./product.mjs";
import { NATIVE_INSTALLED_TARGETS } from "./release-targets.mjs";
import {
  evaluateFreshLifecycleSet,
  FRESH_LIFECYCLE_COMMAND,
  FRESH_LIFECYCLE_SCHEMA,
  FRESH_LIFECYCLE_SCOPE,
  freshInstallUninstallEvidenceMatches,
  freshInstallUninstallEvidenceProblems,
  worstFreshLifecycleVerdict,
} from "./native-fresh-set.mjs";

const sourceSha = "a".repeat(40);
const installerSha256 = "b".repeat(64);

function passingReceipt(target, extra = {}) {
  const method = target === "win32-x86_64" ? "nsis-uninstaller" : "dedicated-app-removal";
  return {
    schema: FRESH_LIFECYCLE_SCHEMA,
    command: FRESH_LIFECYCLE_COMMAND,
    kind: "installed-lifecycle",
    scope: FRESH_LIFECYCLE_SCOPE,
    verdict: "PASS",
    target,
    sourceSha,
    installer: `Penglai_${PRODUCT_VERSION}_${target}.bin`,
    installerSha256,
    boot: { freshReadiness: true },
    restart: { freshReadiness: true, resumed: true },
    processCleanup: { afterBoot: true, afterRestart: true, afterUninstall: true },
    uninstall: {
      method,
      uninstallRemovedApp: true,
      leftover: target === "win32-x86_64" ? ["Uninstall.exe"] : [],
      wholeInstdirDeletedToManufacturePass: false,
    },
    ownerData: {
      sentinelPreservedAfterBoot: true,
      sentinelPreservedAfterRestart: true,
      sentinelPreservedAfterUninstall: true,
    },
    olderInstalledUpgrade: { status: "OWNER_EXCLUDED", claimedPass: false },
    nativeUos: { status: "OWNER_POST_RELEASE", claimedPass: false },
    deferred: false,
    fabricated: false,
    ...extra,
  };
}

test("fresh lifecycle matcher accepts a complete Mac/Windows receipt", () => {
  for (const target of NATIVE_INSTALLED_TARGETS) {
    assert.equal(
      freshInstallUninstallEvidenceMatches(passingReceipt(target), { sourceSha, installerSha256, target }),
      true,
    );
  }
});

test("fresh lifecycle aggregation negatives: missing target, SHA, hash, proofs, fabricated PASS, shape", () => {
  const expected = { sourceSha, installerSha256, target: "darwin-aarch64" };
  assert.deepEqual(freshInstallUninstallEvidenceProblems(null, expected), ["incompatible receipt shape"]);
  assert.ok(freshInstallUninstallEvidenceProblems({ verdict: "PASS" }, expected).includes("incompatible receipt shape"));
  assert.ok(
    freshInstallUninstallEvidenceProblems(passingReceipt("darwin-x86_64"), expected).includes("missing target"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(passingReceipt("darwin-aarch64", { sourceSha: "c".repeat(40) }), expected)
      .includes("wrong source SHA"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { installerSha256: "d".repeat(64) }),
      expected,
    ).includes("wrong installer hash"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { boot: { freshReadiness: false } }),
      expected,
    ).includes("absent fresh boot/restart/uninstall proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { restart: { freshReadiness: true, resumed: false } }),
      expected,
    ).includes("absent fresh boot/restart/uninstall proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { uninstall: { method: "dedicated-app-removal", uninstallRemovedApp: false, wholeInstdirDeletedToManufacturePass: false } }),
      expected,
    ).includes("absent fresh boot/restart/uninstall proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { deferred: true }),
      expected,
    ).includes("fabricated/deferred native PASS"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", {
        uninstall: {
          method: "dedicated-app-removal",
          uninstallRemovedApp: true,
          wholeInstdirDeletedToManufacturePass: true,
        },
      }),
      expected,
    ).includes("fabricated/deferred native PASS"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("linux-loong64", {
        uninstall: { method: "dedicated-app-removal", uninstallRemovedApp: true, wholeInstdirDeletedToManufacturePass: false },
      }),
      { ...expected, target: "linux-loong64" },
    ).includes("fabricated/deferred native PASS"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { upgradePaths: [{ verdict: "PASS" }], previousVersions: ["0.5.12"] }),
      expected,
    ).includes("incompatible receipt shape"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { nativeUos: { status: "PASS", claimedPass: true } }),
      expected,
    ).includes("fabricated/deferred native PASS"),
  );
  assert.equal(worstFreshLifecycleVerdict(["incompatible receipt shape"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["fabricated/deferred native PASS"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["wrong source SHA"]), "STALE");
  assert.equal(worstFreshLifecycleVerdict(["wrong installer hash"]), "STALE");
  assert.equal(worstFreshLifecycleVerdict(["missing target"]), "INCOMPLETE");
  assert.equal(worstFreshLifecycleVerdict(["absent fresh boot/restart/uninstall proof"]), "INCOMPLETE");
});

test("fresh lifecycle set requires every Mac/Windows target and rejects a UOS native PASS", () => {
  const installerByTarget = Object.fromEntries(NATIVE_INSTALLED_TARGETS.map((target) => [target, installerSha256]));
  const complete = NATIVE_INSTALLED_TARGETS.map((target) => passingReceipt(target));
  assert.equal(evaluateFreshLifecycleSet({ records: complete, sourceSha, installerByTarget }).ok, true);
  const missing = evaluateFreshLifecycleSet({
    records: complete.filter((row) => row.target !== "win32-x86_64"),
    sourceSha,
    installerByTarget,
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.failReasons.includes("missing target"));
  assert.deepEqual(missing.missingTargets, ["win32-x86_64"]);
  const withUos = evaluateFreshLifecycleSet({
    records: [...complete, { ...passingReceipt("linux-loong64"), target: "linux-loong64", verdict: "PASS" }],
    sourceSha,
    installerByTarget,
  });
  assert.equal(withUos.ok, false);
  assert.ok(withUos.failReasons.includes("fabricated/deferred native PASS"));
});

test("current 0.6.1 native workflow does not fetch previous installers", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/native-release-candidate.yml"), "utf8");
  assert.match(workflow, /verify:fresh-install-uninstall/);
  assert.doesNotMatch(workflow, /fetch-upgrade-sources/);
  assert.doesNotMatch(workflow, /previous: Penglai_/);
  assert.doesNotMatch(workflow, /Penglai_0\.5\.12_macos/);
  assert.doesNotMatch(workflow, /pnpm verify:upgrade-uninstall/);
  const fetch = spawnSync(process.execPath, [join(ROOT, "scripts/fetch-upgrade-sources.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(fetch.status, 2);
  assert.match(fetch.stderr, /OWNER_EXCLUDED/);
  assert.doesNotMatch(fetch.stderr, /"verdict":"PASS"/);
});
