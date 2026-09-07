import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { expectedUpgradeSourceVersions, upgradeUninstallEvidenceMatches } from "./native-upgrade-set.mjs";

const sources = JSON.parse(readFileSync(join(ROOT, "docs/0.5.11/UPGRADE_SOURCES.json"), "utf8"));

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

test("native upgrade set follows every pinned previous version, not a hardcoded pair", () => {
  const expected = expectedUpgradeSourceVersions(sources);
  assert.deepEqual(expected, ["0.5.10", "0.5.8", "0.5.9"]);
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
  const threePaths = {
    previousVersions: ["0.5.8", "0.5.9", "0.5.10"],
    upgradePaths: expected.map((version) => passingPath(version, sourceSha, installerSha256)),
  };
  assert.equal(
    upgradeUninstallEvidenceMatches(threePaths, { sourceSha, installerSha256, expectedVersions: expected }),
    true,
  );
});
