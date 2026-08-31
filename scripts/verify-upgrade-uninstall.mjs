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
  installFromExactDmg,
  launchPackaged,
  readInstalledAppIdentity,
  resourcesInside,
  sha256File,
  stopChild,
  waitForFile,
} from "./lib/installed-app.mjs";
import { ROOT } from "./lib/repo.mjs";
import {
  hostMatchesTarget,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";

const PREVIOUS_INSTALLERS = Object.freeze({
  "darwin-aarch64": "Penglai_0.5.8_macos_aarch64.dmg",
  "darwin-x86_64": "Penglai_0.5.8_macos_x64.dmg",
  "win32-x86_64": "Penglai_0.5.8_windows_x64_setup.exe",
});

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
  const launched = launchPackaged(executable, resources, userData);
  const gateway = await waitForFile(join(userData, "gateway.port"), 90_000);
  const inventory = await waitForFile(
    join(userData, "plugins", "inventory-snapshot.json"),
    30_000,
  );
  const [code, signal] = await stopChild(launched.child);
  if (!gateway || !inventory || (code !== 0 && signal === null)) {
    fail(`${label} did not boot and exit through the installed runtime`, {
      gateway,
      inventory,
      code,
      signal,
    });
  }
  return { gateway, inventory, exitCode: code, signal };
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

const previousInstaller = resolve(String(process.env.PENGLAI_PREVIOUS_INSTALLER ?? ""));
const sumsPath = resolve(String(process.env.PENGLAI_PREVIOUS_SHA256SUMS ?? ""));
const expectedPreviousName = PREVIOUS_INSTALLERS[target];
if (
  !previousInstaller ||
  !existsSync(previousInstaller) ||
  !sumsPath ||
  !existsSync(sumsPath) ||
  previousInstaller.split(/[\\/]/).at(-1) !== expectedPreviousName
) {
  fail("exact previous 0.5.8 installer and SHA256SUMS are required");
}
const previousSha256 = sha256File(previousInstaller);
const expectedPreviousSha = readFileSync(sumsPath, "utf8")
  .split(/\r?\n/u)
  .map((line) => line.trim().split(/\s+/u))
  .find((parts) => parts.at(-1)?.replace(/^\*/, "") === expectedPreviousName)?.[0];
if (expectedPreviousSha !== previousSha256) {
  fail("previous installer does not match immutable public SHA256SUMS", {
    previousSha256,
  });
}

const currentInstaller = join(ROOT, "dist", installerForTarget(target));
if (!existsSync(currentInstaller)) fail("current exact installer is missing");
const currentSha256 = sha256File(currentInstaller);
const appRoot = requireExactChild(join(ROOT, ".tmp-upgrade-uninstall-app"), ROOT, "app test root");
const userData = requireExactChild(join(ROOT, ".tmp-upgrade-uninstall-user"), ROOT, "user-data test root");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
const sentinel = join(userData, "owner-data-preserved.txt");
writeFileSync(sentinel, "Penglai upgrade/uninstall preservation sentinel\n");

let app;
if (target === "win32-x86_64") {
  const localAppData = resolve(String(process.env.LOCALAPPDATA ?? ""));
  const expectedApp = join(localAppData, "Penglai", "app", "0.5");
  if (existsSync(expectedApp)) {
    fail("Windows native runner is not clean; refusing to overwrite an existing Penglai install", {
      expectedApp,
    });
  }
  app = installWindows(previousInstaller, "0.5.8");
} else {
  const previous = installFromExactDmg(previousInstaller, appRoot, expectedPreviousName);
  if (!previous.ok) fail(`0.5.8 DMG install failed: ${previous.reason}`);
  app = previous.app;
}

const previousIdentity = assertVersion(app, "0.5.8", "previous install");
const previousBoot = await boot(app, userData, "previous install");

if (target === "win32-x86_64") {
  app = installWindows(currentInstaller, "0.5.9 upgrade");
} else {
  const current = installFromExactDmg(
    currentInstaller,
    appRoot,
    installerForTarget(target),
  );
  if (!current.ok) fail(`0.5.9 DMG upgrade failed: ${current.reason}`);
  app = current.app;
}
const currentIdentity = assertVersion(app, "0.5.9", "upgraded install");
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
