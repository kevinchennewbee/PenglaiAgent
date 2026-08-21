#!/usr/bin/env node
// Assemble win32-x86_64 NSIS payload. Native Setup PASS remains win32-x64 only.
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const staging = join(ROOT, "dist", "runtime-staging-win32-x86_64");
const payload = join(staging, "payload");
const native = process.platform === "win32" && process.arch === "x64";

function run(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: "inherit", ...extra });
  return result.status ?? 1;
}

if (!existsSync(join(ROOT, "dist", "desktop-bundle", "electron-main.js"))) {
  const bundled = run(process.execPath, ["scripts/bundle-desktop.mjs"]);
  if (bundled !== 0) finish("FAIL", { command: "package:windows-payload", reason: "desktop bundle failed" });
}

const embed = run(process.execPath, ["scripts/embed-runtime.mjs", "--target", "win32-x86_64"]);
if (embed !== 0) {
  finish(native ? "FAIL" : "BLOCKED", {
    command: "package:windows-payload",
    reason: "win32-x86_64 runtime staging failed",
    native,
  });
}

const ensure = spawnSync(process.execPath, ["scripts/ensure-electron.mjs", "--target", "win32-x64"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (ensure.status !== 0) {
  process.stderr.write(ensure.stderr || ensure.stdout || "ensure-electron failed\n");
  finish(native ? "FAIL" : "BLOCKED", {
    command: "package:windows-payload",
    reason: "win32-x64 Electron zip missing or hash mismatch",
    native,
  });
}
const electronRoot = String(ensure.stdout || "")
  .trim()
  .split("\n")
  .at(-1);
if (!electronRoot || !existsSync(electronRoot)) {
  finish("BLOCKED", { command: "package:windows-payload", reason: "extracted Electron path missing" });
}

rmSync(payload, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });
const electronDir = existsSync(join(dirname(electronRoot), "electron.exe"))
  ? dirname(electronRoot)
  : electronRoot;
cpSync(electronDir, payload, { recursive: true });
const electronExe = join(payload, "electron.exe");
const penglaiExe = join(payload, "Penglai.exe");
if (existsSync(electronExe) && !existsSync(penglaiExe)) renameSync(electronExe, penglaiExe);
if (!existsSync(penglaiExe) && !existsSync(join(payload, "Penglai.exe"))) {
  finish("FAIL", { command: "package:windows-payload", reason: "Penglai.exe missing after Electron copy" });
}

const resources = join(payload, "resources");
mkdirSync(resources, { recursive: true });
cpSync(join(ROOT, "dist", "desktop-bundle"), join(resources, "app"), { recursive: true });
cpSync(join(staging, "runtime"), join(resources, "runtime"), { recursive: true });
cpSync(join(staging, "profile-seed"), join(resources, "profile-seed"), { recursive: true });
cpSync(join(staging, "plugins"), join(resources, "plugins"), { recursive: true });
for (const name of ["runtime-manifest.json", "release-contract.json", ".closure-complete"]) {
  const src = join(staging, name);
  if (existsSync(src)) cpSync(src, join(resources, name === ".closure-complete" ? "closure-credential.json" : name));
}

const arch = spawnSync(process.execPath, ["scripts/verify-native-arch.mjs", payload, "win32-x86_64"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (arch.status !== 0 && arch.status !== 4) {
  process.stderr.write(arch.stderr || arch.stdout || "PE scan failed\n");
  finish("FAIL", { command: "package:windows-payload", reason: "PE architecture scan failed" });
}
if (arch.status === 4 && native) {
  finish("FAIL", { command: "package:windows-payload", reason: "native Windows payload had no PE binaries" });
}

writeFileSync(
  join(ROOT, "evidence/generated", "windows-payload.json"),
  JSON.stringify(
    {
      command: "package:windows-payload",
      verdict: native ? "READY" : "CROSS_PREP",
      payload,
      native,
      peScan: arch.status === 0 ? "PASS" : arch.status === 4 ? "BLOCKED" : "FAIL",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ verdict: "PASS", payload, native, nsisNativeOnly: true }));
