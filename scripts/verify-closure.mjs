import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { hostTarget, inspectClosureCredential, stagingForTarget } from "./lib/closure-credential.mjs";
import { PINNED_DSH, PINNED_PNPM } from "./lib/product.mjs";
import { assertUos20OldWorldAddonFiles } from "./lib/uos20-oldworld-addons.mjs";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const target = argValue("--target", hostTarget());
const staging = argValue("--staging", stagingForTarget(ROOT, target));
const git = gitState();
const closure = inspectClosureCredential({ staging, candidateSha: git.head, expectedTarget: target });
if (closure.verdict !== "PASS") {
  finish(closure.verdict, { command: "verify:closure", target, reason: closure.reason });
}

const nodeBin = join(staging, target === "win32-x86_64" ? "runtime/node/node.exe" : "runtime/node/bin/node");
const dsh = join(staging, "runtime/dsh/lib/bin.js");
const launcher = join(staging, "runtime/dsh/lib/penglai-dsh-launcher.mjs");
const pnpmManifest = join(staging, "runtime/pnpm/package.json");
const pnpmEntry = join(staging, "runtime/pnpm/bin/pnpm.mjs");
const productPolicy = join(staging, "runtime/dsh/penglai-profile-policy.yml");
const loongPolicy = join(staging, "runtime/dsh/penglai-loong64-policy.yml");
const requiredRuntimeFiles = [nodeBin, dsh, launcher, pnpmManifest, pnpmEntry, productPolicy, loongPolicy];
if (requiredRuntimeFiles.some((file) => !existsSync(file))) {
  finish("FAIL", { command: "verify:closure", target, reason: "closure credential present but Node/DSH launcher/pnpm/profile policy is missing" });
}
let pnpmIdentity;
try {
  pnpmIdentity = JSON.parse(readFileSync(pnpmManifest, "utf8"));
} catch {
  finish("FAIL", { command: "verify:closure", target, reason: "bundled pnpm manifest is unreadable" });
}
if (pnpmIdentity?.name !== "pnpm" || pnpmIdentity?.version !== PINNED_PNPM) {
  finish("FAIL", { command: "verify:closure", target, reason: `bundled pnpm identity mismatch ${pnpmIdentity?.version ?? "missing"}` });
}
const required = ["zod", "ws", "fflate", "eventsource-parser", "node-addon-require-builtin", "node-addon-native-custom-loader"];
const missing = required.filter((name) => !existsSync(join(staging, "runtime/dsh/node_modules", name, "package.json")));
if (missing.length) {
  finish("FAIL", { command: "verify:closure", target, reason: `flattened DSH closure missing ${missing.join(",")}` });
}
const nativeName = {
  "darwin-aarch64": "node-addon-require-builtin-darwin-arm64",
  "darwin-x86_64": "node-addon-require-builtin-darwin-x64",
  "win32-x86_64": "node-addon-require-builtin-win32-x64-msvc",
}[target];
if (nativeName && !existsSync(join(staging, "runtime/dsh/node_modules", nativeName, "package.json"))) {
  finish("FAIL", { command: "verify:closure", target, reason: `flattened DSH closure missing ${nativeName}` });
}

// Native addons koffi (FFI) and sharp (image) live under optionalDependencies.
// The flatten step must carry them or embedded DSH crashes at boot with
// "Cannot find the native Koffi module" / "failed to install the sharp module".
const nativeAddonPackages = {
  "darwin-aarch64": ["@koromix/koffi-darwin-arm64", "@img/sharp-darwin-arm64", "@img/sharp-libvips-darwin-arm64"],
  "darwin-x86_64": ["@koromix/koffi-darwin-x64", "@img/sharp-darwin-x64", "@img/sharp-libvips-darwin-x64"],
  // DSH alpha.2 sharp 0.35.4 folds the Windows libvips DLLs into sharp-win32-x64;
  // unlike the Darwin packages there is no separate sharp-libvips-win32-x64.
  "win32-x86_64": ["@koromix/koffi-win32-x64", "@img/sharp-win32-x64"],
  "linux-loong64": ["@koromix/koffi-linux-loong64"],
}[target] ?? [];
const missingAddons = nativeAddonPackages.filter(
  (name) => !existsSync(join(staging, "runtime/dsh/node_modules", name, "package.json")),
);
if (missingAddons.length) {
  finish("FAIL", { command: "verify:closure", target, reason: `flattened DSH closure missing native addon(s) ${missingAddons.join(",")}` });
}
if (target === "linux-loong64") {
  try {
    assertUos20OldWorldAddonFiles(join(staging, "runtime/dsh/node_modules"));
  } catch (error) {
    finish("FAIL", {
      command: "verify:closure",
      target,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
if (target === "win32-x86_64") {
  const sharpLib = join(staging, "runtime/dsh/node_modules/@img/sharp-win32-x64/lib");
  const sharpFiles = [
    "sharp-win32-x64-0.35.4.node",
    "libvips-42.dll",
    "libvips-cpp-8.18.6.dll",
  ];
  const missingSharpFiles = sharpFiles.filter((name) => !existsSync(join(sharpLib, name)));
  if (missingSharpFiles.length) {
    finish("FAIL", {
      command: "verify:closure",
      target,
      reason: `flattened DSH closure missing sharp Windows payload ${missingSharpFiles.join(",")}`,
    });
  }
}
if (target.startsWith("darwin-")) {
  const helper = join(staging, "runtime/dsh/node_modules/node-pty/prebuilds", target === "darwin-aarch64" ? "darwin-arm64" : "darwin-x64", "spawn-helper");
  if (!existsSync(helper) || (statSync(helper).mode & 0o111) === 0) {
    finish("FAIL", { command: "verify:closure", target, reason: "node-pty spawn-helper missing or not executable" });
  }
}
if (target !== hostTarget()) {
  finish("INCOMPLETE", {
    command: "verify:closure",
    target,
    reason: "cross-staged closure is structurally complete but requires the matching native runner",
  });
}
const probeEnv =
  target === "win32-x86_64"
    ? (() => {
        const windowsRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
        return {
          SystemRoot: windowsRoot,
          WINDIR: process.env.WINDIR || windowsRoot,
          ComSpec: process.env.ComSpec || join(windowsRoot, "System32", "cmd.exe"),
          PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
          TEMP: process.env.TEMP || process.env.TMP || staging,
          TMP: process.env.TMP || process.env.TEMP || staging,
          PATH: [dirname(nodeBin), join(windowsRoot, "System32"), windowsRoot].join(delimiter),
          NODE_PATH: "",
        };
      })()
    : { PATH: "/usr/bin:/bin", NODE_PATH: "" };
const probe = spawnSync(nodeBin, [dsh, "--version"], {
  encoding: "utf8",
  env: probeEnv,
  cwd: staging,
});
const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
if (probe.status !== 0 || !output.includes(PINNED_DSH)) {
  finish("FAIL", {
    command: "verify:closure",
    target,
    reason: "embedded DSH closure probe failed",
    probeStatus: probe.status,
    probeError: probe.error?.code ?? null,
  });
}
const launcherProbe = spawnSync(nodeBin, [launcher, "--version"], {
  encoding: "utf8",
  cwd: staging,
});
if (launcherProbe.status !== 0 || !String(launcherProbe.stdout ?? "").includes(PINNED_DSH)) {
  finish("FAIL", { command: "verify:closure", target, reason: "Penglai DSH launcher probe failed" });
}
const pnpmProbe = spawnSync(nodeBin, [pnpmEntry, "--version"], {
  encoding: "utf8",
  cwd: staging,
});
if (pnpmProbe.status !== 0 || String(pnpmProbe.stdout ?? "").trim() !== PINNED_PNPM) {
  finish("FAIL", { command: "verify:closure", target, reason: "bundled pnpm execution probe failed" });
}
const nodePtyModule = join(staging, "runtime/dsh/node_modules/node-pty");
if (existsSync(join(nodePtyModule, "package.json"))) {
  const shell = target === "win32-x86_64" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
  const shellArgs = target === "win32-x86_64" ? ["/d", "/c", "echo|set /p=PENGLAI_PTY_OK"] : ["-lc", "printf PENGLAI_PTY_OK"];
  const ptyProbe = spawnSync(nodeBin, [
    "-e",
    `const p=require(${JSON.stringify(nodePtyModule)});let out="";const t=p.spawn(${JSON.stringify(shell)},${JSON.stringify(shellArgs)},{cols:80,rows:24,cwd:process.cwd(),env:process.env});t.onData(d=>out+=d);t.onExit(()=>process.exit(out.includes("PENGLAI_PTY_OK")?0:2));setTimeout(()=>process.exit(3),8000).unref();`,
  ], { cwd: staging, encoding: "utf8", timeout: 10_000 });
  if (ptyProbe.status !== 0) {
    finish("FAIL", { command: "verify:closure", target, reason: "embedded node-pty native smoke failed" });
  }
}
finish("PASS", {
  command: "verify:closure",
  target,
  sourceSha: git.head,
  manifestSha256: closure.manifestSha256,
  version: output.trim(),
});
