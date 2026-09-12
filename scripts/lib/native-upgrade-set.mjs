import { closeSync, constants, fsyncSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

import {
  readVerifiedRegularFile,
  updateVerifiedRegularFile,
  writeAllVerified,
} from "./verified-file.mjs";

function parsePluginDesiredState(bytes) {
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== "boolean")
  ) {
    throw new Error("plugin desired state must be a boolean object");
  }
  return parsed;
}

/** Create a meaningful 0.6.1 owner-state fixture after its installed boot. */
export function seedUpgradePluginDesiredState(path, pluginId = "@penglai/im") {
  if (typeof pluginId !== "string" || !pluginId.startsWith("@penglai/")) {
    throw new Error("upgrade plugin fixture requires a first-party plugin id");
  }
  mkdirSync(dirname(path), { recursive: true });
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    const payload = Buffer.from(
      `${JSON.stringify({ [pluginId]: false }, null, 2)}\n`,
    );
    writeAllVerified(descriptor, payload);
    fsyncSync(descriptor);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    updateVerifiedRegularFile(path, (bytes) => {
      const current = parsePluginDesiredState(bytes);
      return Buffer.from(
        `${JSON.stringify({ ...current, [pluginId]: false }, null, 2)}\n`,
      );
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const verified = parsePluginDesiredState(readVerifiedRegularFile(path).bytes);
  if (verified[pluginId] !== false) {
    throw new Error("upgrade plugin fixture was not persisted exactly");
  }
  return verified;
}

export function expectedUpgradeSourceVersions(upgradeSources) {
  if (!Array.isArray(upgradeSources?.sources)) return [];
  return upgradeSources.sources.map((row) => String(row.version ?? "")).filter(Boolean).sort();
}

export function assertNextUpdaterSequence(upgradeSources, currentSequence) {
  if (!Number.isSafeInteger(currentSequence) || currentSequence < 1) {
    throw new Error("current updater sequence must be a positive safe integer");
  }
  const sources = upgradeSources?.sources;
  if (!Array.isArray(sources) || sources.length < 1) {
    throw new Error("at least one immutable previous release is required");
  }
  const previous = sources.map((row) => Number(row?.updateSequence));
  if (previous.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("every previous release must pin its public updater sequence");
  }
  const maximum = Math.max(...previous);
  if (currentSequence !== maximum + 1) {
    throw new Error(`updater sequence ${currentSequence} must follow public sequence ${maximum}`);
  }
  return maximum;
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
