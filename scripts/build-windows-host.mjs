#!/usr/bin/env node
// Compile the production Windows helper on a native Windows x64 runner.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const native = process.platform === "win32" && process.arch === "x64";
if (!native) {
  finish("BLOCKED", {
    command: "build:windows-host",
    reason: "penglai-windows-host.exe must be compiled on a native Windows x64 runner",
    platform: process.platform,
    arch: process.arch,
  });
}

const source = join(ROOT, "native", "windows-host", "penglai_windows_host.c");
const outputDir = join(ROOT, "dist", "native-win32-x86_64");
const output = join(outputDir, "penglai-windows-host.exe");
const object = join(outputDir, "penglai_windows_host.obj");
mkdirSync(outputDir, { recursive: true });
rmSync(output, { force: true });
rmSync(object, { force: true });

const result = spawnSync(
  "cl.exe",
  [
    "/nologo",
    "/O2",
    "/W4",
    "/WX",
    `/Fo${object}`,
    `/Fe${output}`,
    source,
    "advapi32.lib",
    "bcrypt.lib",
  ],
  { cwd: outputDir, encoding: "utf8", stdio: "inherit", windowsHide: true },
);

if (result.error?.code === "ENOENT") {
  finish("BLOCKED", {
    command: "build:windows-host",
    reason: "cl.exe is unavailable; run from an x64 Native Tools Command Prompt for Visual Studio",
  });
}
if (result.status !== 0 || !existsSync(output)) {
  finish("FAIL", {
    command: "build:windows-host",
    reason: "MSVC failed to compile the Windows native helper",
    exit: result.status ?? 1,
  });
}

const arch = spawnSync(process.execPath, ["scripts/verify-native-arch.mjs", output, "win32-x86_64"], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: "inherit",
});
if (arch.status !== 0) {
  finish("FAIL", { command: "build:windows-host", reason: "Windows helper PE architecture verification failed" });
}

console.log(JSON.stringify({ verdict: "PASS", command: "build:windows-host", output }));
