#!/usr/bin/env node
/**
 * Deterministic unsigned macOS acceptance bundle.
 *
 * Tauri's decorative DMG path drives Finder with AppleScript. That is useful
 * on an interactive release Mac, but it can time out while the Mac is locked
 * or in a non-GUI CI session. Local acceptance needs a reproducible artifact,
 * so this script builds the .app, applies a complete ad-hoc seal, and creates
 * a plain read-only DMG without Finder automation.
 *
 * This is intentionally not the updater-signed release path.
 * `tauri:build:release` still owns updater signing and release assets. Both
 * paths use an ad-hoc macOS app seal; neither claims Developer ID notarization.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("tauri:build:local is a macOS DMG acceptance command");
}

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(desktopDir, "src-tauri", "target", "release", "bundle");
const appPath = path.join(bundleDir, "macos", "Penglai.app");
const arch = process.arch === "arm64" ? "aarch64" : "x64";
const dmgDir = path.join(bundleDir, "dmg");
const dmgPath = path.join(dmgDir, `Penglai_0.4.0_${arch}.dmg`);
const reuseApp = process.argv.includes("--reuse-app");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: desktopDir,
    stdio: "inherit",
    ...options,
  });
}

if (!reuseApp) {
  run("npx", ["--no-install", "tauri", "build", "--no-sign", "--bundles", "app"]);
}
if (!fs.existsSync(path.join(appPath, "Contents", "Info.plist"))) {
  throw new Error(`Tauri app was not produced at ${appPath}`);
}

const version = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleShortVersionString", path.join(appPath, "Contents", "Info.plist")],
  { encoding: "utf8" },
).trim();
if (version !== "0.4.0") throw new Error(`unexpected app version ${version}`);

// Linker ad-hoc signing covers only the Mach-O. Seal the complete application
// so resources (including the bundled Host runtime) are bound and verifiable.
run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

fs.mkdirSync(dmgDir, { recursive: true });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-local-dmg-"));
try {
  run("ditto", [appPath, path.join(staging, "Penglai.app")]);
  fs.symlinkSync("/Applications", path.join(staging, "Applications"));
  run("hdiutil", [
    "create",
    "-volname", "Penglai",
    "-srcfolder", staging,
    "-format", "UDZO",
    "-imagekey", "zlib-level=9",
    "-ov",
    dmgPath,
  ]);
  run("hdiutil", ["verify", dmgPath]);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

const hash = execFileSync("shasum", ["-a", "256", dmgPath], { encoding: "utf8" }).split(/\s+/)[0];
console.log(`[local-dmg] ${dmgPath}`);
console.log(`[local-dmg] sha256 ${hash}`);
console.log("[local-dmg] ad-hoc signed for local acceptance only; not notarized");
