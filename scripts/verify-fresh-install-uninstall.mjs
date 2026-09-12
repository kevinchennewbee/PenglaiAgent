#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  cleanupRegisteredWindowsInstallerFixture,
  exeInside,
  forceStopChild,
  installFromExactInstaller,
  launchPackaged,
  leftoversByCommand,
  readInstalledAppIdentity,
  reapWindowsInstallTree,
  resourcesInside,
  sha256File,
  waitOwnedWindowsProcessesGone,
  windowsRegisteredInstallDir,
} from "./lib/installed-app.mjs";
import {
  classifyUninstallResidue,
  listInstallTreeFiles,
  removeUninstallerResidualOnly,
} from "./lib/windows-uninstall-residue.mjs";
import { observeFreshInstalledBoot, observeInstalledRestart } from "./lib/installed-readiness.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import { sanitizeEvidenceText } from "./lib/evidence-json.mjs";
import {
  hostMatchesTarget,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import {
  FRESH_LIFECYCLE_COMMAND,
  FRESH_LIFECYCLE_SCHEMA,
  FRESH_LIFECYCLE_SCOPE,
} from "./lib/native-fresh-set.mjs";
import { currentNativeLifecycleScope } from "./lib/native-upgrade-set.mjs";
import {
  FRESH_LIFECYCLE_SENTINEL_NAME,
  WINDOWS_DEFAULT_APP_SEGMENTS,
  classifyApplicationShutdown,
  currentGenerationProfileIdentity,
  profileRestartProblems,
  readExactSentinel,
  requestNativeApplicationClose,
  sha256Bytes,
  waitForChildExitNoKill,
  windowsDefaultInstallDir,
  windowsDefaultUserDataDir,
  windowsFreshProfilePreflight,
  windowsUpdateCacheDir,
} from "./lib/native-lifecycle-proof.mjs";
import { ROOT } from "./lib/repo.mjs";

const COMMAND = FRESH_LIFECYCLE_COMMAND;
const upgradeSources = JSON.parse(readFileSync(join(ROOT, "docs", PRODUCT_VERSION, "UPGRADE_SOURCES.json"), "utf8"));
const lifecycleScope = currentNativeLifecycleScope(upgradeSources);

function fail(reason, details = {}) {
  finish("FAIL", {
    command: COMMAND,
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

async function waitRemoved(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return !existsSync(path);
}

async function cleanupProcesses(app, label) {
  const resources = resourcesInside(app, target);
  const executable = exeInside(app, target);
  if (process.platform === "win32") {
    const observed = await waitOwnedWindowsProcessesGone(app, userData);
    if (observed.ok) return { ok: true, leftover: [], forced: false };
    const reaped = await reapWindowsInstallTree(app, 15_000, userData);
    fail(`${label} required forced descendant cleanup; that is not a normal lifecycle proof`, {
      leftover: observed.leftover.slice(0, 20),
      forcedCleanup: true,
      reaped: { ok: reaped.ok, leftover: reaped.leftover.slice(0, 20) },
    });
  }
  const leftoverNeedles = [executable, join(resources, "runtime/dsh/lib/bin.js"), app].filter(Boolean);
  const leftoverDeadline = Date.now() + 30_000;
  let leftover = leftoverNeedles.flatMap((needle) => leftoversByCommand(needle));
  while (Date.now() < leftoverDeadline) {
    leftover = leftoverNeedles.flatMap((needle) => leftoversByCommand(needle));
    if (leftover.length === 0) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  if (leftover.length) fail(`${label} left processes after shutdown`, { leftover: leftover.slice(0, 20) });
  return { ok: true, leftover: [], forced: false };
}

function launchFreshApp(app, userData) {
  const resources = resourcesInside(app, target);
  const executable = exeInside(app, target);
  if (!executable) fail("installed Penglai executable missing");
  if (target === "win32-x86_64") {
    return launchPackaged(executable, resources, userData, [], {}, { isolateUserData: false });
  }
  return launchPackaged(executable, resources, userData);
}

function installWindowsDefault(installer, label) {
  const run = spawnSync(installer, ["/S"], { encoding: "utf8", windowsHide: true, timeout: 20 * 60_000 });
  if (run.error || run.status !== 0) {
    fail(`${label} NSIS install failed`, {
      status: run.status,
      timedOut: run.error?.code === "ETIMEDOUT",
      error: run.error?.code,
      stdout: sanitizeEvidenceText(String(run.stdout ?? ""), 1_000),
      stderr: sanitizeEvidenceText(String(run.stderr ?? ""), 1_000),
    });
  }
  const localAppData = resolve(String(process.env.LOCALAPPDATA ?? ""));
  if (!localAppData) fail("LOCALAPPDATA is unavailable on the Windows native runner");
  const app = windowsDefaultInstallDir(localAppData);
  if (!existsSync(join(app, "Penglai.exe"))) fail(`${label} NSIS app payload missing at the default native path`, { app });
  return app;
}

async function shutdownFresh(child, label) {
  const waiting = waitForChildExitNoKill(child, 20_000);
  const closeReq = await requestNativeApplicationClose(child, { platform: process.platform });
  const waited = await waiting;
  if (waited.timedOut) {
    const forced = await forceStopChild(child);
    fail(`${label} required forced process termination; that is not a graceful application shutdown`, {
      shutdown: { ...closeReq, ...forced, graceful: false },
    });
  }
  const shutdown = {
    ...closeReq,
    exitCode: waited.code,
    signal: waited.signal,
    forced: false,
    graceful: false,
  };
  const classified = classifyApplicationShutdown(shutdown, target);
  if (!classified.graceful) {
    fail(`${label} did not complete a normal application shutdown`, { shutdown, classified });
  }
  return { ...shutdown, graceful: true };
}

function requireSentinel(label) {
  const observed = readExactSentinel(sentinelPath, sentinelSha256);
  if (!observed.ok) {
    fail(`${label} did not preserve exact Owner-data sentinel bytes`, {
      sentinelPath,
      expectedSha256: sentinelSha256,
      observed,
    });
  }
  return observed;
}

async function boot(app, userData, label, previousIdentity) {
  const observed = previousIdentity
    ? await observeInstalledRestart(userData, () => launchFreshApp(app, userData), previousIdentity)
    : await observeFreshInstalledBoot(userData, () => launchFreshApp(app, userData));
  const shutdown = await shutdownFresh(observed.launched.child, label);
  const cleanup = await cleanupProcesses(app, label);
  const profileIdentity = currentGenerationProfileIdentity(userData);
  requireSentinel(label);
  if (!observed.freshReadiness || !observed.gateway || !observed.inventory) {
    fail(`${label} did not boot through the installed runtime`, {
      gateway: observed.gateway,
      inventory: observed.inventory,
      freshReadiness: observed.freshReadiness,
      shutdown,
      outputTail: sanitizeEvidenceText(observed.launched.output(), 2_000),
    });
  }
  if (!profileIdentity.ok) {
    fail(`${label} did not persist current-generation DSH home and profile identity`, { profileIdentity });
  }
  if (previousIdentity) {
    const restartProblems = profileRestartProblems(previousIdentity, profileIdentity);
    if (restartProblems.length) {
      fail(`${label} did not resume current-generation profile with a new process identity`, {
        previousIdentity,
        profileIdentity,
        restartProblems,
      });
    }
  }
  return {
    gateway: observed.gateway,
    inventory: observed.inventory,
    freshReadiness: observed.freshReadiness,
    resumed: Boolean(previousIdentity) && profileRestartProblems(previousIdentity, profileIdentity).length === 0,
    profileIdentity,
    shutdown,
    processCleanup: cleanup,
  };
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
    fail("Windows Defender preference could not be observed; native lifecycle requires default-on realtime monitoring with no Penglai exclusions", {
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
    fail("Windows Defender has a Penglai exclusion; Penglai must not add exclusions to pass native lifecycle", {
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

const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", {
    command: COMMAND,
    reason: source.reason,
    ...source.git,
  });
}
const target = parseTargetArg();
if (target === "linux-loong64") {
  finish("INCOMPLETE", {
    command: COMMAND,
    reason: "UOS native install/startup/function is OWNER_POST_RELEASE, not a 0.6.2 native PASS",
    target,
    sourceSha: source.git.head,
    nativeUosStatus: "OWNER_POST_RELEASE",
    claimedPass: false,
    packagingAbiDistinct: true,
  });
}
const blocked = nativeBlocked(COMMAND, target);
if (blocked) finish("BLOCKED", { command: COMMAND, ...blocked });
if (!hostMatchesTarget(target)) fail("fresh install/uninstall must run on its matching native host");
if (process.env.PENGLAI_LIFECYCLE_ALLOW_NATIVE !== "1") {
  finish("BLOCKED", {
    command: COMMAND,
    reason: "native lifecycle mutation requires PENGLAI_LIFECYCLE_ALLOW_NATIVE=1",
    target,
    sourceSha: source.git.head,
  });
}

const currentInstaller = join(ROOT, "dist", installerForTarget(target));
if (!existsSync(currentInstaller)) fail("current exact installer is missing");
const currentSha256 = sha256File(currentInstaller);

const appRoot = target === "win32-x86_64"
  ? ""
  : requireExactChild(join(ROOT, ".tmp", "fresh-install-uninstall", "app"), ROOT, "app test root");
const userData = target === "win32-x86_64"
  ? windowsDefaultUserDataDir(resolve(String(process.env.LOCALAPPDATA ?? "")))
  : requireExactChild(join(ROOT, ".tmp", "fresh-install-uninstall", "user"), ROOT, "user-data test root");
if (!userData) fail("Owner-data root for this target is unavailable");
if (target === "win32-x86_64") {
  const fixtureCleanup = cleanupRegisteredWindowsInstallerFixture();
  if (!fixtureCleanup.ok) fail(`Windows release-test fixture cleanup failed: ${fixtureCleanup.reason}`);
  const localAppData = resolve(String(process.env.LOCALAPPDATA ?? ""));
  const preflight = windowsFreshProfilePreflight({
    localAppData,
    env: process.env,
    registeredInstallDir: windowsRegisteredInstallDir(),
  });
  if (!preflight.ok) fail(preflight.reason, preflight);
} else {
  rmSync(userData, { recursive: true, force: true });
}
mkdirSync(userData, { recursive: true });
const sentinelPath = join(userData, FRESH_LIFECYCLE_SENTINEL_NAME);
if (target === "win32-x86_64") {
  const updateCache = windowsUpdateCacheDir(resolve(String(process.env.LOCALAPPDATA ?? "")));
  if (sentinelPath.startsWith(updateCache)) fail("Windows owner-data sentinel must not live in the NSIS update-cache tree");
}
const sentinelBytes = Buffer.from(
  `Penglai ${PRODUCT_VERSION} fresh-lifecycle owner sentinel\nnonce=${randomBytes(16).toString("hex")}\n`,
);
writeFileSync(sentinelPath, sentinelBytes);
const sentinelSha256 = sha256Bytes(sentinelBytes);

let app;
let windowsInstall = null;
if (target === "win32-x86_64") {
  app = installWindowsDefault(currentInstaller, `fresh ${PRODUCT_VERSION}`);
  windowsInstall = {
    path: app,
    segments: WINDOWS_DEFAULT_APP_SEGMENTS,
    defaultNativeInstdir: true,
    customDestination: false,
    payloadDeletedByHarness: false,
    nsisDefaultInstallDir: String.raw`$LOCALAPPDATA\Penglai\app\0.5`,
  };
} else {
  const installed = await installFromExactInstaller(currentInstaller, appRoot, target);
  if (!installed.ok) fail(`fresh ${PRODUCT_VERSION} install failed: ${installed.reason}`, { installed });
  app = installed.app;
}
const identity = assertVersion(app, PRODUCT_VERSION, "fresh install");
const currentPackage = inspectPackagedCandidate({ app, candidateSha: source.git.head, expectedTarget: target });
if (currentPackage.verdict !== "PASS") fail("fresh installer source identity mismatch", { currentPackage });
if (target === "win32-x86_64") observeWindowsDefender();

const bootProof = await boot(app, userData, "fresh install");
const restartProof = await boot(app, userData, "fresh restart", bootProof.profileIdentity);
if (!restartProof.resumed) fail("fresh restart did not resume persisted profile identity");

let uninstallLeftoverNames = [];
let uninstallRemovedApp = false;
const uninstallMethod = target === "win32-x86_64" ? "nsis-uninstaller" : "dedicated-app-removal";
if (target === "win32-x86_64") {
  const beforeUninstall = await waitOwnedWindowsProcessesGone(app, userData);
  if (!beforeUninstall.ok) {
    const reaped = await reapWindowsInstallTree(app, 15_000, userData);
    fail("uninstall required forced descendant cleanup; that is not a normal lifecycle proof", {
      leftover: beforeUninstall.leftover.slice(0, 20),
      forcedCleanup: true,
      reaped: { ok: reaped.ok, leftover: reaped.leftover.slice(0, 20) },
    });
  }
  observeWindowsDefender();
  const uninstaller = join(app, "Uninstall.exe");
  if (!existsSync(uninstaller)) fail("Windows uninstaller missing after fresh install");
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
  const residue = classifyUninstallResidue(listInstallTreeFiles(app));
  if (!residue.payloadRemoved) {
    fail("Windows uninstaller left app payload", {
      leftover: residue.payload.slice(0, 40),
      defender: lastWindowsDefender,
    });
  }
  uninstallLeftoverNames = residue.uninstallerOnly.slice();
  uninstallRemovedApp = residue.uninstallRemovedApp;
  removeUninstallerResidualOnly(app, residue);
} else {
  const exactAppRoot = requireExactChild(appRoot, ROOT, "macOS app test root");
  rmSync(exactAppRoot, { recursive: true, force: true });
  uninstallRemovedApp = true;
}
const removed = await waitRemoved(app, 60_000);
requireSentinel("fresh uninstall");
if (!removed) {
  fail("uninstall did not remove only the app while preserving Owner data", {
    appRemoved: removed,
    leftover: existsSync(app) ? readdirSync(app).slice(0, 40) : [],
  });
}
const afterUninstall = await cleanupProcesses(app, "fresh uninstall");

finish("PASS", {
  schema: FRESH_LIFECYCLE_SCHEMA,
  command: COMMAND,
  kind: "installed-lifecycle",
  scope: FRESH_LIFECYCLE_SCOPE,
  target,
  sourceSha: source.git.head,
  treeDirty: source.git.dirty === true,
  productVersion: PRODUCT_VERSION,
  host: { platform: process.platform, arch: process.arch },
  installer: installerForTarget(target),
  installerSha256: currentSha256,
  identity,
  destination: app,
  destinationTaskCreated: target !== "win32-x86_64",
  windowsInstall,
  boot: bootProof,
  restart: restartProof,
  processCleanup: {
    afterBoot: bootProof.processCleanup?.ok === true,
    afterRestart: restartProof.processCleanup?.ok === true,
    afterUninstall: afterUninstall.ok === true,
    forced: false,
  },
  onboardingCompleted: false,
  uninstall: {
    method: uninstallMethod,
    uninstallRemovedApp,
    leftover: uninstallLeftoverNames,
    residualAllowed: uninstallLeftoverNames.length ? uninstallLeftoverNames : target === "win32-x86_64" ? ["Uninstall.exe"] : [],
    wholeInstdirDeletedToManufacturePass: false,
  },
  leftover: uninstallLeftoverNames,
  ownerData: {
    path: sentinelPath,
    scope: target === "win32-x86_64"
      ? "localappdata-penglai-0.5-excluding-update-cache"
      : "task-created-user-data",
    sentinelSha256,
    sentinelUnchanged: true,
    sentinelPreservedAfterBoot: true,
    sentinelPreservedAfterRestart: true,
    sentinelPreservedAfterUninstall: true,
  },
  olderInstalledUpgrade: {
    status: lifecycleScope.olderInstalledUpgradeStatus,
    claimedPass: false,
  },
  nativeUos: {
    status: lifecycleScope.nativeUosStatus ?? "OWNER_POST_RELEASE",
    claimedPass: false,
  },
  deferred: false,
  fabricated: false,
  defender: lastWindowsDefender,
});
