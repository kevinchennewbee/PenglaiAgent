import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION } from "./product.mjs";
import {
  currentNativeLifecycleScope,
  currentWorkflowFetchesPreviousInstallers,
  currentWorkflowRequiresNativeUpgradePaths,
  expectedUpgradeSourceVersions,
  upgradeUninstallEvidenceMatches,
} from "./native-upgrade-set.mjs";

const sources = JSON.parse(readFileSync(join(ROOT, "docs", PRODUCT_VERSION, "UPGRADE_SOURCES.json"), "utf8"));

function passingPath(version, sourceSha, installerSha256) {
  return {
    verdict: "PASS",
    sourceSha,
    previous: { version, boot: { freshReadiness: true } },
    current: { installerSha256, boot: { freshReadiness: true } },
    upgradePreservedOwnerData: true,
    uninstallPreservedOwnerData: true,
    uninstallRemovedApp: true,
  };
}

test("current 0.6.1 workflow excludes previous-installer fetch and native upgrade paths", () => {
  const scope = currentNativeLifecycleScope(sources);
  assert.equal(scope.fetchPreviousInstallers, false);
  assert.equal(scope.olderInstalledUpgradeStatus, "OWNER_EXCLUDED");
  assert.equal(scope.requiredLifecycleGate, "verify:fresh-install-uninstall");
  assert.equal(scope.nativeUosStatus, "OWNER_POST_RELEASE");
  assert.equal(currentWorkflowFetchesPreviousInstallers(sources), false);
  assert.equal(currentWorkflowRequiresNativeUpgradePaths(sources), false);
  const historical = currentNativeLifecycleScope({ sources: sources.sources });
  assert.equal(historical.fetchPreviousInstallers, true);
  assert.equal(historical.olderInstalledUpgradeStatus, "REQUIRED");
  assert.equal(historical.requiredLifecycleGate, "verify:upgrade-uninstall");
});

test("native upgrade set follows every pinned previous version, not a hardcoded pair", () => {
  const expected = expectedUpgradeSourceVersions(sources);
  assert.ok(expected.includes("0.5.8"));
  assert.ok(expected.includes("0.5.11"));
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
