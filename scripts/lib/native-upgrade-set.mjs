export function expectedUpgradeSourceVersions(upgradeSources) {
  if (!Array.isArray(upgradeSources?.sources)) return [];
  return upgradeSources.sources.map((row) => String(row.version ?? "")).filter(Boolean).sort();
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
      row.uninstallPreservedOwnerData === true &&
      row.uninstallRemovedApp === true,
  );
}
