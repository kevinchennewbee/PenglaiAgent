export function expectedUpgradeSourceVersions(upgradeSources) {
  if (!Array.isArray(upgradeSources?.sources)) return [];
  return upgradeSources.sources.map((row) => String(row.version ?? "")).filter(Boolean).sort();
}

/** Current-version native workflow scope. Historical sources[] stay immutable pins. */
export function currentNativeLifecycleScope(upgradeSources) {
  const workflow = upgradeSources?.currentWorkflow;
  if (!workflow || typeof workflow !== "object") {
    return {
      fetchPreviousInstallers: true,
      olderInstalledUpgradeStatus: "REQUIRED",
      requiredLifecycleGate: "verify:upgrade-uninstall",
      nativeUosStatus: null,
      twoHourSoak: null,
    };
  }
  return {
    fetchPreviousInstallers: workflow.fetchPreviousInstallers === true,
    olderInstalledUpgradeStatus: String(workflow.olderInstalledUpgradeStatus ?? "OWNER_EXCLUDED"),
    requiredLifecycleGate: String(workflow.requiredLifecycleGate ?? "verify:fresh-install-uninstall"),
    nativeUosStatus: workflow.nativeUosStatus == null ? "OWNER_POST_RELEASE" : String(workflow.nativeUosStatus),
    twoHourSoak: workflow.twoHourSoak == null ? "OWNER_EXCLUDED" : String(workflow.twoHourSoak),
  };
}

export function currentWorkflowFetchesPreviousInstallers(upgradeSources) {
  return currentNativeLifecycleScope(upgradeSources).fetchPreviousInstallers === true;
}

export function currentWorkflowRequiresNativeUpgradePaths(upgradeSources) {
  const scope = currentNativeLifecycleScope(upgradeSources);
  return scope.olderInstalledUpgradeStatus !== "OWNER_EXCLUDED" && currentWorkflowFetchesPreviousInstallers(upgradeSources);
}

export function upgradeUninstallEvidenceMatches(record, { sourceSha, installerSha256, expectedVersions }) {
  const versions = [...(record?.previousVersions ?? [])].sort();
  if (JSON.stringify(versions) !== JSON.stringify(expectedVersions)) return false;
  if (!Array.isArray(record.upgradePaths) || record.upgradePaths.length !== expectedVersions.length) return false;
  return record.upgradePaths.every(
    (row) =>
      row?.verdict === "PASS" &&
      row.previous?.boot?.freshReadiness === true &&
      row.current?.boot?.freshReadiness === true &&
      row.sourceSha === sourceSha &&
      row.current?.installerSha256 === installerSha256 &&
      row.upgradePreservedOwnerData === true &&
      row.upgradePreservation?.originalSettingsUnchanged === true &&
      row.upgradePreservation?.migratedSettingsExact === true &&
      row.upgradePreservation?.originalSessionUnchanged === true &&
      row.upgradePreservation?.migratedSessionExact === true &&
      row.upgradePreservation?.pluginDesiredExact === true &&
      row.upgradePreservation?.memoryExact === true &&
      row.uninstallPreservedOwnerData === true &&
      row.uninstallPreservation?.originalSettingsUnchanged === true &&
      row.uninstallPreservation?.migratedSettingsExact === true &&
      row.uninstallPreservation?.originalSessionUnchanged === true &&
      row.uninstallPreservation?.migratedSessionExact === true &&
      row.uninstallPreservation?.pluginDesiredExact === true &&
      row.uninstallPreservation?.memoryExact === true &&
      row.uninstallRemovedApp === true,
  );
}
