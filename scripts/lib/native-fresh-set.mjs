import { NATIVE_INSTALLED_TARGETS } from "./release-targets.mjs";
import {
  classifyApplicationShutdown,
  hostFactsMatchTarget,
  profileRestartProblems,
  windowsDestinationIsDefaultInstdir,
} from "./native-lifecycle-proof.mjs";

export const FRESH_LIFECYCLE_COMMAND = "verify:fresh-install-uninstall";
export const FRESH_LIFECYCLE_SCHEMA = 4;
export const FRESH_LIFECYCLE_SCOPE = "fresh-install-restart-default-uninstall";

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uninstallMethodForTarget(target) {
  if (target === "win32-x86_64") return "nsis-uninstaller";
  if (String(target).startsWith("darwin-")) return "dedicated-app-removal";
  return "";
}

export function freshInstallUninstallEvidenceProblems(record, expected = {}) {
  if (!isRecord(record)) return ["incompatible receipt shape"];
  const problems = [];
  const target = String(record.target ?? "");
  const expectedTarget = expected.target;
  if (
    record.schema !== FRESH_LIFECYCLE_SCHEMA ||
    record.command !== FRESH_LIFECYCLE_COMMAND ||
    record.kind !== "installed-lifecycle" ||
    record.scope !== FRESH_LIFECYCLE_SCOPE ||
    Array.isArray(record.upgradePaths) ||
    Array.isArray(record.previousVersions) ||
    typeof record.installer !== "string" ||
    !record.installer ||
    (record.sourceSha != null && !HEX40.test(String(record.sourceSha))) ||
    (record.installerSha256 != null && !HEX64.test(String(record.installerSha256)))
  ) {
    problems.push("incompatible receipt shape");
  }
  if (!target || (expectedTarget && target !== expectedTarget) || !NATIVE_INSTALLED_TARGETS.includes(target)) {
    problems.push("missing target");
  }
  if (expected.sourceSha && record.sourceSha !== expected.sourceSha) problems.push("wrong source SHA");
  if (expected.installerSha256 && record.installerSha256 !== expected.installerSha256) {
    problems.push("wrong installer hash");
  }
  const bootOk = record.boot?.freshReadiness === true;
  const restartOk = record.restart?.freshReadiness === true && record.restart?.resumed === true;
  const restartIdentityProblems = profileRestartProblems(record.boot?.profileIdentity, record.restart?.profileIdentity);
  const uninstallOk =
    record.uninstall?.uninstallRemovedApp === true &&
    record.uninstall?.method === uninstallMethodForTarget(target || expectedTarget) &&
    record.uninstall?.wholeInstdirDeletedToManufacturePass === false;
  const cleanupOk =
    record.processCleanup?.afterBoot === true &&
    record.processCleanup?.afterRestart === true &&
    record.processCleanup?.afterUninstall === true &&
    record.processCleanup?.forced !== true;
  const ownerDataOk =
    record.ownerData?.sentinelPreservedAfterBoot === true &&
    record.ownerData?.sentinelPreservedAfterRestart === true &&
    record.ownerData?.sentinelPreservedAfterUninstall === true &&
    record.ownerData?.sentinelUnchanged === true &&
    HEX64.test(String(record.ownerData?.sentinelSha256 ?? ""));
  if (!bootOk || !restartOk || !uninstallOk || !cleanupOk) {
    problems.push("absent fresh boot/restart/uninstall proof");
  }
  if (record.processCleanup?.forced === true) problems.push("forced process cleanup");
  if (bootOk && restartOk) problems.push(...restartIdentityProblems);
  if (record.boot?.profileIdentity?.generation?.ok !== true || record.restart?.profileIdentity?.generation?.ok !== true) {
    problems.push("absent current generation identity");
  }
  if (record.onboardingCompleted === true || record.boot?.profileIdentity?.onboardingCompleted === true) {
    problems.push("fabricated/deferred native PASS");
  }
  if (!ownerDataOk) problems.push("absent or changed owner-data proof");
  const bootShutdown = classifyApplicationShutdown(record.boot?.shutdown, target || expectedTarget);
  const restartShutdown = classifyApplicationShutdown(record.restart?.shutdown, target || expectedTarget);
  if (!bootShutdown.graceful || !restartShutdown.graceful) {
    problems.push("forced or abnormal shutdown");
  }
  if (!hostFactsMatchTarget(record.host, target || expectedTarget)) problems.push("missing target");
  if ((target || expectedTarget) === "win32-x86_64") {
    const dest = record.windowsInstall?.path ?? record.destination;
    if (!windowsDestinationIsDefaultInstdir(dest) || record.windowsInstall?.customDestination === true) {
      problems.push("incompatible receipt shape");
    }
    if (record.windowsInstall?.payloadDeletedByHarness === true) {
      problems.push("fabricated/deferred native PASS");
    }
    if (record.ownerData?.scope !== "localappdata-penglai-0.5-excluding-update-cache") {
      problems.push("absent or changed owner-data proof");
    }
  }
  if (
    (record.boot?.shutdown?.graceful === true && (record.boot.shutdown.forced === true || record.boot.shutdown.signal === "SIGKILL")) ||
    (record.restart?.shutdown?.graceful === true && (record.restart.shutdown.forced === true || record.restart.shutdown.signal === "SIGKILL"))
  ) {
    problems.push("fabricated/deferred native PASS");
  }
  const fabricated =
    record.deferred === true ||
    record.fabricated === true ||
    (record.verdict === "PASS" && (record.native === false || record.translated === true || record.emulated === true)) ||
    record.nativeUos?.claimedPass === true ||
    record.nativeUos?.status === "PASS" ||
    record.olderInstalledUpgrade?.claimedPass === true ||
    record.olderInstalledUpgrade?.status === "PASS" ||
    record.uninstall?.wholeInstdirDeletedToManufacturePass === true ||
    (target === "linux-loong64" && (record.verdict === "PASS" || record.nativeUos?.claimedPass === true));
  if (fabricated) problems.push("fabricated/deferred native PASS");
  return [...new Set(problems)];
}

export function freshInstallUninstallEvidenceMatches(record, expected = {}) {
  return freshInstallUninstallEvidenceProblems(record, expected).length === 0 && record?.verdict === "PASS";
}

export function worstFreshLifecycleVerdict(problems) {
  if (
    problems.includes("fabricated/deferred native PASS") ||
    problems.includes("incompatible receipt shape") ||
    problems.includes("forced or abnormal shutdown") ||
    problems.includes("forced process cleanup") ||
    problems.includes("stale process-bound readiness") ||
    problems.includes("changed stable generation state") ||
    problems.includes("absent persisted profile proof") ||
    problems.includes("changed persisted profile state") ||
    problems.includes("required plugin inventory failed") ||
    problems.includes("absent current generation identity")
  ) {
    return "FAIL";
  }
  if (problems.includes("wrong source SHA") || problems.includes("wrong installer hash")) return "STALE";
  if (problems.length) return "INCOMPLETE";
  return "PASS";
}

export function evaluateFreshLifecycleSet({ records, sourceSha, installerByTarget }) {
  const failReasons = [];
  const missingTargets = [];
  const list = Array.isArray(records) ? records : [];
  for (const target of NATIVE_INSTALLED_TARGETS) {
    const record = list.find((row) => row?.target === target);
    if (!record) {
      missingTargets.push(target);
      failReasons.push("missing target");
      continue;
    }
    failReasons.push(
      ...freshInstallUninstallEvidenceProblems(record, {
        sourceSha,
        installerSha256: installerByTarget?.[target],
        target,
      }),
    );
    if (record.verdict !== "PASS") failReasons.push("absent fresh boot/restart/uninstall proof");
  }
  if (list.some((row) => row?.target === "linux-loong64" && (row?.verdict === "PASS" || row?.nativeUos?.claimedPass === true))) {
    failReasons.push("fabricated/deferred native PASS");
  }
  const problems = [...new Set(failReasons)];
  return {
    ok: problems.length === 0 && missingTargets.length === 0,
    failReasons: problems,
    missingTargets,
    verdict: worstFreshLifecycleVerdict(problems),
  };
}
