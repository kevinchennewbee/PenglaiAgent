import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION } from "./product.mjs";
import {
  assertNextUpdaterSequence,
  currentNativeLifecycleScope,
  currentWorkflowFetchesPreviousInstallers,
  currentWorkflowRequiresNativeUpgradePaths,
  expectedUpgradeSourceVersions,
  upgradeUninstallEvidenceMatches,
} from "./native-upgrade-set.mjs";

const sources = JSON.parse(readFileSync(join(ROOT, "docs", PRODUCT_VERSION, "UPGRADE_SOURCES.json"), "utf8"));

function passingPath(version, sourceSha, installerSha256) {
  const preservation = {
    originalSettingsUnchanged: true,
    migratedSettingsExact: true,
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

test("current 0.6.2 workflow requires the 0.6.1 native upgrade path", () => {
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

test("0.6.2 updater sequence is exactly one after immutable v0.6.1", () => {
  assert.equal(assertNextUpdaterSequence(sources, 11), 10);
  assert.throws(() => assertNextUpdaterSequence(sources, 10), /must follow public sequence 10/);
  assert.throws(
    () => assertNextUpdaterSequence({ sources: [{ ...sources.sources[0], updateSequence: undefined }] }, 11),
    /must pin its public updater sequence/,
  );
});

test("native upgrade set follows every pinned previous version, not a hardcoded pair", () => {
  const expected = expectedUpgradeSourceVersions(sources);
  assert.deepEqual(expected, ["0.6.1"]);
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
