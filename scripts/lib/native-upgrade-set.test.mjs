import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION, UPDATER_SEQUENCE } from "./product.mjs";
import {
  assertNextUpdaterSequence,
  currentNativeLifecycleScope,
  currentWorkflowFetchesPreviousInstallers,
  currentWorkflowRequiresNativeUpgradePaths,
  expectedUpgradeSourceVersions,
  seedUpgradePluginDesiredState,
  upgradeUninstallEvidenceMatches,
} from "./native-upgrade-set.mjs";

const sources = JSON.parse(readFileSync(join(ROOT, "docs", PRODUCT_VERSION, "UPGRADE_SOURCES.json"), "utf8"));

function passingPath(version, sourceSha, installerSha256) {
  const preservation = {
    originalSettingsUnchanged: true,
    migratedSettingsExact: true,
    legacySettingsImported: true,
    migratedLocaleApplied: true,
    originalSessionUnchanged: true,
    migratedSessionExact: true,
    pluginDesiredExact: true,
    memoryExact: true,
  };
  return {
    verdict: "PASS",
    sourceSha,
    previous: { version, boot: { freshReadiness: true } },
    current: { installerSha256, boot: { freshReadiness: true } },
    upgradePreservedOwnerData: true,
    upgradePreservation: preservation,
    uninstallPreservedOwnerData: true,
    uninstallPreservation: preservation,
    uninstallRemovedApp: true,
  };
}

test("current 0.6.6 workflow requires pinned installed upgrade", () => {
  const scope = currentNativeLifecycleScope(sources);
  assert.equal(scope.fetchPreviousInstallers, true);
  assert.equal(scope.olderInstalledUpgradeStatus, "REQUIRED");
  assert.equal(scope.requiredLifecycleGate, "verify:upgrade-uninstall");
  assert.equal(scope.nativeUosStatus, "OWNER_POST_RELEASE");
  assert.equal(currentWorkflowFetchesPreviousInstallers(sources), true);
  assert.equal(currentWorkflowRequiresNativeUpgradePaths(sources), true);
  const historical = currentNativeLifecycleScope({ sources: sources.sources });
  assert.equal(historical.fetchPreviousInstallers, true);
  assert.equal(historical.olderInstalledUpgradeStatus, "REQUIRED");
  assert.equal(historical.requiredLifecycleGate, "verify:upgrade-uninstall");
});

test("release aggregation consumes required installed upgrade evidence", () => {
  const releaseVerifier = readFileSync(join(ROOT, "scripts", "verify-release.mjs"), "utf8");
  assert.match(
    releaseVerifier,
    /const nativeSetGates = new Set\(\[[\s\S]*?"verify:upgrade-uninstall"[\s\S]*?\]\);/,
  );
});

test("0.6.6 updater sequence is exactly one after immutable v0.6.5", () => {
  // The pinned predecessor v0.6.5 published updater sequence 13, so the release
  // under development must carry exactly 14. `UPDATER_SEQUENCE` is the value the
  // invariant is about, so it is the input; 13 is the historical fact being
  // pinned, so it stays a literal. The old form hardcoded the input (12) as well,
  // which meant a bump that forgot to advance the pin still failed here — for the
  // right reason, but with nothing left to compare the pin against.
  assert.equal(assertNextUpdaterSequence(sources, UPDATER_SEQUENCE), 13);
  assert.throws(
    () => assertNextUpdaterSequence(sources, UPDATER_SEQUENCE - 1),
    /must follow public sequence 13/,
  );
  assert.throws(
    () =>
      assertNextUpdaterSequence(
        { sources: [{ ...sources.sources[0], updateSequence: undefined }] },
        UPDATER_SEQUENCE,
      ),
    /must pin its public updater sequence/,
  );
});

test("native upgrade seeds an explicit previous-version plugin preference", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-upgrade-desired-"));
  const desired = join(root, "plugins", "desired.json");
  try {
    assert.deepEqual(seedUpgradePluginDesiredState(desired), { "@penglai/im": false });
    assert.deepEqual(JSON.parse(readFileSync(desired, "utf8")), {
      "@penglai/im": false,
    });

    writeFileSync(desired, `${JSON.stringify({ "@penglai/asr": true })}\n`);
    assert.deepEqual(seedUpgradePluginDesiredState(desired), {
      "@penglai/asr": true,
      "@penglai/im": false,
    });

    mkdirSync(join(root, "invalid"));
    const invalid = join(root, "invalid", "desired.json");
    writeFileSync(invalid, `${JSON.stringify({ "@penglai/im": "false" })}\n`);
    assert.throws(
      () => seedUpgradePluginDesiredState(invalid),
      /boolean object/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native upgrade set follows every pinned previous version, not a hardcoded pair", () => {
  const expected = expectedUpgradeSourceVersions(sources);
  assert.deepEqual(expected, ["0.6.3", "0.6.5"]);
  assert.equal(expected.length, sources.sources.length);
  assert.deepEqual(expected, [...expected].sort());
  const sourceSha = "a".repeat(40);
  const installerSha256 = "b".repeat(64);
  const twoPaths = {
    previousVersions: ["0.5.8", "0.5.9"],
    upgradePaths: [
      passingPath("0.5.8", sourceSha, installerSha256),
      passingPath("0.5.9", sourceSha, installerSha256),
    ],
  };
  assert.equal(
    upgradeUninstallEvidenceMatches(twoPaths, { sourceSha, installerSha256, expectedVersions: expected }),
    false,
  );
  const allPaths = {
    previousVersions: expected,
    upgradePaths: expected.map((version) => passingPath(version, sourceSha, installerSha256)),
  };
  assert.equal(
    upgradeUninstallEvidenceMatches(allPaths, { sourceSha, installerSha256, expectedVersions: expected }),
    true,
  );
});

test("installed upgrade reads each published DSH generation from its verified installer", () => {
  const runner = readFileSync(join(ROOT, "scripts", "verify-upgrade-uninstall.mjs"), "utf8");
  assert.match(runner, /function installedDshVersion\(app, userData, previousVersion\)/);
  assert.match(runner, /info\.dshSource\?\.tag !== `dsh-v\$\{previousDsh\}`/);
  assert.match(runner, /active\.activeVersion !== previousDsh/);
  assert.match(runner, /currentHome: join\(userData, "dsh-homes", "dsh-v0\.1\.7-alpha\.2"\)/);
  assert.match(runner, /settings\.yaml\.imported/);
  assert.match(runner, /legacySettingsImported/);
  assert.doesNotMatch(runner, /previousVersion !== "0\.6\.1"/);
});
