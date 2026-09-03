#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import {
  exeInside,
  cleanupRegisteredWindowsInstallerFixture,
  installFromExactDmg,
  launchPackaged,
  readInstalledAppIdentity,
  resourcesInside,
  sha256File,
  stopChild,
} from "./lib/installed-app.mjs";
import { ROOT } from "./lib/repo.mjs";
import { observeFreshInstalledBoot } from "./lib/installed-readiness.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import { sanitizeEvidenceText } from "./lib/evidence-json.mjs";
import {
  hostMatchesTarget,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";

const versionIndex = process.argv.indexOf("--previous-version");
const previousVersion = versionIndex < 0 ? undefined : process.argv[versionIndex + 1];
const upgradeSources = JSON.parse(readFileSync(join(ROOT, "docs/0.5.10/UPGRADE_SOURCES.json"), "utf8"));
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

async function boot(app, userData, label) {
  const resources = resourcesInside(app, target);
  const executable = exeInside(app, target);
  if (!executable) fail(`${label} installed Penglai executable missing`);
  const { launched, gateway, inventory, freshReadiness } = await observeFreshInstalledBoot(
    userData, () => launchPackaged(executable, resources, userData),
  );
  const [code, signal] = await stopChild(launched.child);
  if (!freshReadiness || !gateway || !inventory || (code !== 0 && signal === null)) {
    fail(`${label} did not boot and exit through the installed runtime`, {
      gateway,
      inventory,
      freshReadiness,
      code,
      signal,
      outputTail: sanitizeEvidenceText(launched.output(), 2_000),
    });
  }
  return { gateway, inventory, freshReadiness, exitCode: code, signal };
}

function installWindows(installer, label) {
  const run = spawnSync(installer, ["/S"], { encoding: "utf8" });
  if (run.status !== 0) {
    fail(`${label} NSIS install failed`, { status: run.status });
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
    upgradePreservedOwnerData: true, uninstallRemovedApp: true, uninstallPreservedOwnerData: true,
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

const previousIdentity = assertVersion(app, previousVersion, "previous install");
const previousBoot = await boot(app, userData, "previous install");

if (target === "win32-x86_64") {
  app = installWindows(currentInstaller, "0.5.10 upgrade");
} else {
  const current = installFromExactDmg(
    currentInstaller,
    appRoot,
    installerForTarget(target),
  );
  if (!current.ok) fail(`0.5.10 DMG upgrade failed: ${current.reason}`);
  app = current.app;
}
const currentIdentity = assertVersion(app, "0.5.10", "upgraded install");
const currentPackage = inspectPackagedCandidate({ app, candidateSha: source.git.head, expectedTarget: target });
if (currentPackage.verdict !== "PASS") fail("upgraded installer source identity mismatch", { currentPackage });
const currentBoot = await boot(app, userData, "upgraded install");
if (!existsSync(sentinel)) fail("upgrade did not preserve isolated Owner data");

if (target === "win32-x86_64") {
  const uninstaller = join(app, "Uninstall.exe");
  if (!existsSync(uninstaller)) fail("Windows uninstaller missing after upgrade");
  const uninstall = spawnSync(uninstaller, ["/S"], { encoding: "utf8" });
  if (uninstall.status !== 0) fail("Windows uninstaller returned failure", { status: uninstall.status });
} else {
  const exactAppRoot = requireExactChild(appRoot, ROOT, "macOS app test root");
  rmSync(exactAppRoot, { recursive: true, force: true });
}
const removed = await waitRemoved(app, 30_000);
if (!removed || !existsSync(sentinel)) {
  fail("uninstall did not remove only the app while preserving Owner data", {
    appRemoved: removed,
    ownerDataPreserved: existsSync(sentinel),
  });
}

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
  upgradePreservedOwnerData: true,
  uninstallRemovedApp: true,
  uninstallPreservedOwnerData: true,
});
