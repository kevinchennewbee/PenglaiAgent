#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import {
  exeInside,
  forceStopChild,
  cleanupRegisteredWindowsInstallerFixture,
  installFromExactDmg,
  launchPackaged,
  leftoversByCommand,
  readInstalledAppIdentity,
  reapWindowsInstallTree,
  resourcesInside,
  sha256File,
} from "./lib/installed-app.mjs";
import {
  classifyUninstallResidue,
  listInstallTreeFiles,
  removeUninstallerResidualOnly,
} from "./lib/windows-uninstall-residue.mjs";
import { nsisScopedStopContract } from "./lib/windows-process-scope.mjs";

import { ROOT } from "./lib/repo.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { observeFreshInstalledBoot } from "./lib/installed-readiness.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import { sanitizeEvidenceText } from "./lib/evidence-json.mjs";
import {
  hostMatchesTarget,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";
import { currentNativeLifecycleScope, expectedUpgradeSourceVersions } from "./lib/native-upgrade-set.mjs";
import {
  classifyApplicationShutdown,
  requestNativeApplicationClose,
  waitForChildExitNoKill,
} from "./lib/native-lifecycle-proof.mjs";
import { updateVerifiedRegularFile } from "./lib/verified-file.mjs";

const versionIndex = process.argv.indexOf("--previous-version");
const previousVersion = versionIndex < 0 ? undefined : process.argv[versionIndex + 1];
const upgradeSources = JSON.parse(readFileSync(join(ROOT, "docs", PRODUCT_VERSION, "UPGRADE_SOURCES.json"), "utf8"));
const sourcePin = upgradeSources.sources.find((row) => row.version === previousVersion);

function fail(reason, details = {}) {
  finish("FAIL", {
    command: "verify:upgrade-uninstall",
    reason,
    target,
    sourceSha: source.git.head,
    ...details,
  });
}

function requireExactChild(path, parent, label) {
  const exact = resolve(path);
  const root = resolve(parent);
  if (!exact.startsWith(`${root}${sep}`) || exact === root) {
    fail(`${label} escaped its dedicated test root`);
  }
  return exact;
}

function assertVersion(app, expected, label) {
  const identity = readInstalledAppIdentity(app, target);
  if (
    identity.executable !== "Penglai" ||
    identity.shortVersion !== expected ||
    identity.version !== expected ||
    identity.bundleId !== "com.penglai.dsh"
  ) {
    fail(`${label} identity mismatch`, { identity });
  }
  return identity;
}

function seedOwnerDataForUpgrade(userData, previousVersion) {
  if (previousVersion !== "0.6.1") {
    fail(`native owner-data fixture is undefined for ${previousVersion}`);
  }
  const previousHome = join(userData, "dsh-homes", "dsh-v0.1.5-rc.1");
  const settings = join(previousHome, "settings.yaml");
  const settingsMarker = "# penglai-native-upgrade-preservation: 0.6.1-to-0.6.2\n";
  try {
    updateVerifiedRegularFile(settings, (bytes) =>
      `${bytes.toString("utf8").replace(/\n?$/u, "\n")}${settingsMarker}`,
    );
  } catch (error) {
    fail("previous installed boot did not leave writable pinned DSH settings", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const sessionRelative = join(
    "storages",
    "sessions",
    "penglai-native-upgrade-preservation.jsonl",
  );
  const sourceSession = join(previousHome, sessionRelative);
  mkdirSync(join(previousHome, "storages", "sessions"), { recursive: true });
  writeFileSync(
    sourceSession,
    `${JSON.stringify({ schema: 1, id: "penglai-native-upgrade-preservation", ownerData: true })}\n`,
  );

  const desired = join(userData, "plugins", "desired.json");
  if (!existsSync(desired)) {
    fail("previous installed boot did not create plugin desired state");
  }
  try {
    JSON.parse(readFileSync(desired, "utf8"));
  } catch {
    fail("previous installed plugin desired state is unreadable");
  }

  const memoryMarker = join(userData, "memory", "penglai-native-upgrade-preservation.json");
  mkdirSync(join(userData, "memory"), { recursive: true });
  writeFileSync(
    memoryMarker,
    `${JSON.stringify({ schema: 1, ownerData: true, from: previousVersion })}\n`,
  );

  return {
    previousHome,
    currentHome: join(userData, "dsh-homes", "dsh-v0.1.5-rc.2"),
    settings,
    sessionRelative,
    sourceSession,
    desired,
    memoryMarker,
    hashes: {
      settings: sha256File(settings),
      session: sha256File(sourceSession),
      pluginDesired: sha256File(desired),
      memory: sha256File(memoryMarker),
    },
  };
}

function assertOwnerDataAfterUpgrade(fixture, label) {
  const migratedSettings = join(fixture.currentHome, "settings.yaml");
  const migratedSession = join(fixture.currentHome, fixture.sessionRelative);
  const checks = {
    originalSettingsUnchanged:
      existsSync(fixture.settings) && sha256File(fixture.settings) === fixture.hashes.settings,
    migratedSettingsExact:
      existsSync(migratedSettings) && sha256File(migratedSettings) === fixture.hashes.settings,
    originalSessionUnchanged:
      existsSync(fixture.sourceSession) && sha256File(fixture.sourceSession) === fixture.hashes.session,
    migratedSessionExact:
      existsSync(migratedSession) && sha256File(migratedSession) === fixture.hashes.session,
    pluginDesiredExact:
      existsSync(fixture.desired) && sha256File(fixture.desired) === fixture.hashes.pluginDesired,
    memoryExact:
      existsSync(fixture.memoryMarker) && sha256File(fixture.memoryMarker) === fixture.hashes.memory,
  };
  if (Object.values(checks).some((value) => value !== true)) {
    fail(`${label} did not preserve the installed Owner data contract`, { preservation: checks });
  }
  return {
    ...checks,
    sourceGeneration: "dsh-v0.1.5-rc.1",
    targetGeneration: "dsh-v0.1.5-rc.2",
    fixtureDigests: fixture.hashes,
  };
}

async function boot(app, userData, label) {
  const resources = resourcesInside(app, target);
  const executable = exeInside(app, target);
  if (!executable) fail(`${label} installed Penglai executable missing`);
  const { launched, gateway, inventory, freshReadiness } = await observeFreshInstalledBoot(
    userData, () => launchPackaged(executable, resources, userData),
  );
  const waiting = waitForChildExitNoKill(launched.child, 20_000);
  const closeRequest = await requestNativeApplicationClose(launched.child, {
    platform: process.platform,
  });
  const waited = await waiting;
  if (waited.timedOut) {
    const forced = await forceStopChild(launched.child);
    fail(`${label} required forced process termination`, {
      shutdown: { ...closeRequest, ...forced, graceful: false },
    });
  }
  const shutdown = {
    ...closeRequest,
    exitCode: waited.code,
    signal: waited.signal,
    forced: false,
    graceful: false,
  };
  const classified = classifyApplicationShutdown(shutdown, target);
  if (!classified.graceful) {
    fail(`${label} did not complete a normal application shutdown`, {
      shutdown,
      classified,
    });
  }
  if (process.platform === "win32") {
    const reaped = await reapWindowsInstallTree(app);
    if (!reaped.ok) {
      fail(`${label} left Windows processes in the install tree`, {
        leftover: reaped.leftover.slice(0, 20),
      });
    }
  } else {
    const leftoverNeedles = [executable, join(resources, "runtime/dsh/lib/bin.js"), app].filter(Boolean);
    const leftoverDeadline = Date.now() + 30_000;
    while (Date.now() < leftoverDeadline) {
      const leftover = leftoverNeedles.flatMap((needle) => leftoversByCommand(needle));
      if (leftover.length === 0) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  if (!freshReadiness || !gateway || !inventory) {
    fail(`${label} did not boot and exit through the installed runtime`, {
      gateway,
      inventory,
      freshReadiness,
      shutdown,
      outputTail: sanitizeEvidenceText(launched.output(), 2_000),
    });
  }
  return { gateway, inventory, freshReadiness, shutdown: { ...shutdown, graceful: true } };
}

function readWindowsSetupLog() {
  const temp = process.env.TEMP || process.env.TMP || "";
  const log = temp ? join(temp, "penglai-setup.log") : "";
  if (!log || !existsSync(log)) return "";
  const bytes = readFileSync(log);
  const text =
    bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString("utf16le")
      : bytes.includes(0)
        ? bytes.toString("utf16le")
        : bytes.toString("utf8");
  return sanitizeEvidenceText(text, 2_000);
}

let lastWindowsDefender = { attempted: false, mutated: false };

function observeWindowsDefender() {
  if (process.platform !== "win32") return { attempted: false, mutated: false };
  const defender = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-MpPreference | Select-Object DisableRealtimeMonitoring, ExclusionPath | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  lastWindowsDefender = {
    attempted: true,
    mutated: false,
    status: defender.status,
    stdout: sanitizeEvidenceText(String(defender.stdout ?? ""), 800),
    stderr: sanitizeEvidenceText(String(defender.stderr ?? ""), 200),
  };
  if (defender.status !== 0) {
    fail("Windows Defender preference could not be observed; native lifecycle requires no Penglai exclusions", {
      defender: lastWindowsDefender,
    });
  }
  let parsed = {};
  try {
    parsed = JSON.parse(String(defender.stdout ?? "").trim() || "{}");
  } catch {
    fail("Windows Defender preference JSON could not be parsed", { defender: lastWindowsDefender });
  }
  const monitoringOff = parsed.DisableRealtimeMonitoring === true || parsed.DisableRealtimeMonitoring === "True";
  const exclusions = []
    .concat(parsed.ExclusionPath ?? [])
    .map((row) => String(row ?? ""))
    .filter(Boolean);
  const penglaiExclusion = exclusions.find((row) => /penglai/i.test(row));
  lastWindowsDefender = {
    ...lastWindowsDefender,
    monitoringOff,
    exclusions: exclusions.slice(0, 20),
    penglaiExclusion: penglaiExclusion ?? "",
    defaultOs: "UNPROVEN",
  };
  if (penglaiExclusion) {
    fail("Windows Defender has a Penglai exclusion; Penglai must not add exclusions to pass native upgrade", {
      defender: lastWindowsDefender,
    });
  }
  if (monitoringOff) {
    lastWindowsDefender = {
      ...lastWindowsDefender,
      defaultOs: "INCOMPLETE",
      reason:
        "runner baseline realtime monitoring already disabled; Penglai did not mutate Defender; I02 default-OS remains unproven",
    };
  }
  return lastWindowsDefender;
}

function installWindows(installer, label) {
  const run = spawnSync(installer, ["/S"], { encoding: "utf8", windowsHide: true, timeout: 20 * 60_000 });
  if (run.error || run.status !== 0) {
    fail(`${label} NSIS install failed`, {
      status: run.status,
      timedOut: run.error?.code === "ETIMEDOUT",
      error: run.error?.code,
      stdout: sanitizeEvidenceText(String(run.stdout ?? ""), 1_000),
      stderr: sanitizeEvidenceText(String(run.stderr ?? ""), 1_000),
      setupLog: readWindowsSetupLog(),
      lockers: leftoversByCommand(join(String(process.env.LOCALAPPDATA ?? ""), "Penglai", "app", "0.5")).slice(0, 20),
      defender: lastWindowsDefender,
    });
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) fail("LOCALAPPDATA is unavailable on the Windows native runner");
  const app = join(localAppData, "Penglai", "app", "0.5");
  if (!existsSync(join(app, "Penglai.exe"))) fail(`${label} NSIS app payload missing`);
  return app;
}

async function waitRemoved(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return !existsSync(path);
}

const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", {
    command: "verify:upgrade-uninstall",
    reason: source.reason,
    ...source.git,
  });
}
const target = parseTargetArg();
if (!previousVersion) {
  const scope = currentNativeLifecycleScope(upgradeSources);
  if (scope.olderInstalledUpgradeStatus === "OWNER_EXCLUDED") {
    finish("INCOMPLETE", {
      command: "verify:upgrade-uninstall",
      reason: "older installed upgrade is OWNER_EXCLUDED for this version; unrun upgrade paths are not PASS",
      target,
      sourceSha: source.git.head,
      olderInstalledUpgradeStatus: "OWNER_EXCLUDED",
      requiredLifecycleGate: scope.requiredLifecycleGate,
      fetchPreviousInstallers: scope.fetchPreviousInstallers,
      previousVersions: expectedUpgradeSourceVersions(upgradeSources),
      upgradePaths: [],
      claimedPass: false,
    });
  }
}
const blocked = nativeBlocked("verify:upgrade-uninstall", target);
if (blocked) finish("BLOCKED", { command: "verify:upgrade-uninstall", ...blocked });
if (!hostMatchesTarget(target)) fail("upgrade/uninstall must run on its matching native host");
if (process.env.PENGLAI_LIFECYCLE_ALLOW_NATIVE !== "1") {
  finish("BLOCKED", {
    command: "verify:upgrade-uninstall",
    reason: "native lifecycle mutation requires PENGLAI_LIFECYCLE_ALLOW_NATIVE=1",
    target,
    sourceSha: source.git.head,
  });
}

if (!previousVersion) {
  const upgradePaths = [];
  for (const prior of upgradeSources.sources) {
    const child = spawnSync(process.execPath, [import.meta.filename, "--previous-version", prior.version, "--target", target], {
      cwd: ROOT, env: process.env, stdio: "inherit",
    });
    if (child.status !== 0) fail(`native upgrade from ${prior.version} failed`, { upgradePaths });
    const record = JSON.parse(readFileSync(join(ROOT, "evidence/generated", `verify-upgrade-uninstall-${target}.json`), "utf8"));
    if (record.verdict !== "PASS" || record.previous?.version !== prior.version || record.sourceSha !== source.git.head) {
      fail(`native upgrade evidence mismatch for ${prior.version}`);
    }
    upgradePaths.push(record);
  }
  finish("PASS", {
    command: "verify:upgrade-uninstall", target, sourceSha: source.git.head,
    host: { platform: process.platform, arch: process.arch },
    previousVersions: upgradePaths.map((record) => record.previous.version),
    current: upgradePaths.at(-1).current, upgradePaths,
    leftover: upgradePaths.flatMap((record) => record.leftover ?? []),
    upgradePreservedOwnerData: upgradePaths.every((record) => record.upgradePreservedOwnerData === true),
    uninstallRemovedApp: upgradePaths.every((record) => record.uninstallRemovedApp === true),
    uninstallLeftoverNames: upgradePaths.flatMap((record) => record.leftover ?? []),
    uninstallPreservedOwnerData: upgradePaths.every((record) => record.uninstallPreservedOwnerData === true),
  });
}
if (!sourcePin) fail("unsupported previous version");
const suffix = { "darwin-aarch64": "macos_aarch64.dmg", "darwin-x86_64": "macos_x64.dmg", "win32-x86_64": "windows_x64_setup.exe" }[target];
const expectedPreviousName = `Penglai_${previousVersion}_${suffix}`;
const pinnedAsset = sourcePin.assets.find((row) => row.name === expectedPreviousName);
const previousInstaller = join(ROOT, ".previous", previousVersion, expectedPreviousName);
if (!pinnedAsset || !existsSync(previousInstaller)) fail("exact verified previous installer is required");
const previousSha256 = sha256File(previousInstaller);
if (pinnedAsset.sha256 !== previousSha256) fail("previous installer differs from pinned immutable public bytes");

const currentInstaller = join(ROOT, "dist", installerForTarget(target));
if (!existsSync(currentInstaller)) fail("current exact installer is missing");
const currentSha256 = sha256File(currentInstaller);
const appRoot = requireExactChild(join(ROOT, ".tmp", "upgrade-uninstall", "app"), ROOT, "app test root");
const userData = requireExactChild(join(ROOT, ".tmp", "upgrade-uninstall", "user"), ROOT, "user-data test root");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
const sentinel = join(userData, "owner-data-preserved.txt");
writeFileSync(sentinel, "Penglai upgrade/uninstall preservation sentinel\n");

let app;
if (target === "win32-x86_64") {
  const fixtureCleanup = cleanupRegisteredWindowsInstallerFixture();
  if (!fixtureCleanup.ok) fail(`Windows release-test fixture cleanup failed: ${fixtureCleanup.reason}`);
  const localAppData = resolve(String(process.env.LOCALAPPDATA ?? ""));
  const expectedApp = join(localAppData, "Penglai", "app", "0.5");
  if (existsSync(expectedApp)) {
    fail("Windows native runner is not clean; refusing to overwrite an existing Penglai install", {
      expectedApp,
    });
  }
  app = installWindows(previousInstaller, previousVersion);
} else {
  const previous = installFromExactDmg(previousInstaller, appRoot, expectedPreviousName);
  if (!previous.ok) fail(`${previousVersion} DMG install failed: ${previous.reason}`);
  app = previous.app;
}

let uninstallLeftoverNames = [];
let uninstallRemovedApp = false;
let uninstallMethod = "";
const previousIdentity = assertVersion(app, previousVersion, "previous install");
const previousBoot = await boot(app, userData, "previous install");
const ownerDataFixture = seedOwnerDataForUpgrade(userData, previousVersion);
if (target === "win32-x86_64") observeWindowsDefender();

if (target === "win32-x86_64") {
  app = installWindows(currentInstaller, `${PRODUCT_VERSION} upgrade`);
} else {
  const current = installFromExactDmg(
    currentInstaller,
    appRoot,
    installerForTarget(target),
  );
  if (!current.ok) fail(`${PRODUCT_VERSION} DMG upgrade failed: ${current.reason}`);
  app = current.app;
}
const currentIdentity = assertVersion(app, PRODUCT_VERSION, "upgraded install");
const currentPackage = inspectPackagedCandidate({ app, candidateSha: source.git.head, expectedTarget: target });
if (currentPackage.verdict !== "PASS") fail("upgraded installer source identity mismatch", { currentPackage });
const currentBoot = await boot(app, userData, "upgraded install");
if (!existsSync(sentinel)) fail("upgrade did not preserve isolated Owner data");
const upgradePreservation = assertOwnerDataAfterUpgrade(ownerDataFixture, "upgrade");

if (target === "win32-x86_64") {
  await reapWindowsInstallTree(app, 30_000, userData);
  observeWindowsDefender();
  const uninstaller = join(app, "Uninstall.exe");
  if (!existsSync(uninstaller)) fail("Windows uninstaller missing after upgrade");
  const uninstall = spawnSync(uninstaller, ["/S", `_?=${app}`], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20 * 60_000,
  });
  if (uninstall.error || uninstall.status !== 0) {
    fail("Windows uninstaller returned failure", {
      status: uninstall.status,
      timedOut: uninstall.error?.code === "ETIMEDOUT",
      error: uninstall.error?.code,
      stdout: sanitizeEvidenceText(String(uninstall.stdout ?? ""), 1_000),
      stderr: sanitizeEvidenceText(String(uninstall.stderr ?? ""), 1_000),
    });
  }
  // `_?=` keeps Uninstall.exe in INSTDIR so spawnSync observes the real
  // process; the in-use uninstaller cannot delete itself. Prove payload
  // absence first. Only Uninstall.exe may be removed as test cleanup.
  const residue = classifyUninstallResidue(listInstallTreeFiles(app));
  if (!residue.payloadRemoved) {
    fail("Windows uninstaller left app payload", {
      leftover: residue.payload.slice(0, 40),
      defender: lastWindowsDefender,
    });
  }
  uninstallLeftoverNames = residue.uninstallerOnly.slice();
  uninstallRemovedApp = residue.uninstallRemovedApp;
  uninstallMethod = "exact NSIS Uninstall.exe /S";
  removeUninstallerResidualOnly(app, residue);
} else {
  const exactAppRoot = requireExactChild(appRoot, ROOT, "macOS app test root");
  rmSync(exactAppRoot, { recursive: true, force: true });
  uninstallRemovedApp = true;
  uninstallMethod = "controlled app-copy removal equivalent to the documented Finder Move to Trash step";
}
const removed = await waitRemoved(app, 60_000);
if (!removed || !existsSync(sentinel)) {
  fail("uninstall did not remove only the app while preserving Owner data", {
    appRemoved: removed,
    leftover: existsSync(app) ? readdirSync(app).slice(0, 40) : [],
    ownerDataPreserved: existsSync(sentinel),
  });
}
const uninstallPreservation = assertOwnerDataAfterUpgrade(ownerDataFixture, "uninstall");
const upgradePreservedOwnerData = Object.values(upgradePreservation)
  .filter((value) => typeof value === "boolean")
  .every((value) => value === true);
const uninstallPreservedOwnerData = Object.values(uninstallPreservation)
  .filter((value) => typeof value === "boolean")
  .every((value) => value === true);

finish("PASS", {
  command: "verify:upgrade-uninstall",
  target,
  sourceSha: source.git.head,
  host: { platform: process.platform, arch: process.arch },
  previous: {
    version: previousIdentity.shortVersion,
    installer: expectedPreviousName,
    installerSha256: previousSha256,
    boot: previousBoot,
  },
  current: {
    version: currentIdentity.shortVersion,
    installer: installerForTarget(target),
    installerSha256: currentSha256,
    boot: currentBoot,
  },
  leftover: uninstallLeftoverNames,
  upgradePreservedOwnerData,
  upgradePreservation,
  uninstallRemovedApp,
  uninstallMethod,
  uninstallLeftoverNames,
  uninstallPreservedOwnerData,
  uninstallPreservation,
  defender: lastWindowsDefender,
  uninstallResidualAllowed: uninstallLeftoverNames.length
    ? uninstallLeftoverNames
    : ["Uninstall.exe"],
});
