import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { hostTarget, inspectClosureCredential, stagingForTarget } from "./lib/closure-credential.mjs";
import { PINNED_DSH } from "./lib/product.mjs";

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
if (!existsSync(nodeBin) || !existsSync(dsh)) {
  finish("FAIL", { command: "verify:closure", target, reason: "closure credential present but node/dsh missing" });
}
if (target !== hostTarget()) {
  finish("INCOMPLETE", {
    command: "verify:closure",
    target,
    reason: "cross-staged closure is structurally complete but requires the matching native runner",
  });
}
const probe = spawnSync(nodeBin, [dsh, "--version"], {
  encoding: "utf8",
  env: { PATH: "/usr/bin:/bin", NODE_PATH: "" },
  cwd: "/tmp",
});
const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
if (probe.status !== 0 || !output.includes(PINNED_DSH)) {
  finish("FAIL", { command: "verify:closure", target, reason: "embedded DSH closure probe failed" });
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
  // sharp 0.35.3 folds the Windows libvips DLLs into sharp-win32-x64;
  // unlike the Darwin packages there is no separate sharp-libvips-win32-x64.
  "win32-x86_64": ["@koromix/koffi-win32-x64", "@img/sharp-win32-x64"],
}[target] ?? [];
const missingAddons = nativeAddonPackages.filter(
  (name) => !existsSync(join(staging, "runtime/dsh/node_modules", name, "package.json")),
);
if (missingAddons.length) {
  finish("FAIL", { command: "verify:closure", target, reason: `flattened DSH closure missing native addon(s) ${missingAddons.join(",")}` });
}
if (target === "win32-x86_64") {
  const sharpLib = join(staging, "runtime/dsh/node_modules/@img/sharp-win32-x64/lib");
  const sharpFiles = [
    "sharp-win32-x64-0.35.3.node",
    "libvips-42.dll",
    "libvips-cpp-8.18.3.dll",
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
finish("PASS", {
  command: "verify:closure",
  target,
  sourceSha: git.head,
  manifestSha256: closure.manifestSha256,
  version: output.trim(),
});
