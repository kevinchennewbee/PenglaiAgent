#!/usr/bin/env node
// Assemble linux-loong64 Electron payload + old-world runtime.
// Native UOS install/startup/function remain OWNER_POST_RELEASE.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, gitState } from "./lib/repo.mjs";
import { stagingForTarget } from "./lib/closure-credential.mjs";
import { writeRequiredFuses } from "./lib/electron-fuses.mjs";
import { readReleaseIdentityPins } from "./lib/release-pins-source.mjs";
import { LINUX_LOONG64_TARGET } from "./lib/package-linux-deb.mjs";
import { assertUos20OldWorldAddonFiles } from "./lib/uos20-oldworld-addons.mjs";
import {
  PINNED_ELECTRON_LINUX_LOONG64,
  PINNED_NODE_LINUX_LOONG64,
} from "../packages/release-identity/src/pins.ts";

const releasePins = readReleaseIdentityPins();
const staging = stagingForTarget(ROOT, LINUX_LOONG64_TARGET);
const payload = join(staging, "payload");

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status ?? 1;
}

const bundled = run(process.execPath, ["scripts/bundle-desktop.mjs"]);
if (bundled !== 0) {
  console.error("stage-linux-loong64 refused: desktop bundle failed");
  process.exit(bundled);
}

const embed = run(process.execPath, [
  "scripts/embed-runtime.mjs",
  "--target",
  LINUX_LOONG64_TARGET,
]);
if (embed !== 0) {
  console.error("stage-linux-loong64 refused: embed-runtime linux-loong64 failed");
  process.exit(embed);
}

const ensure = spawnSync(
  process.execPath,
  ["scripts/ensure-electron.mjs", "--target", "linux-loong64"],
  { cwd: ROOT, encoding: "utf8" },
);
if (ensure.status !== 0) {
  process.stderr.write(ensure.stderr || ensure.stdout || "ensure-electron failed\n");
  process.exit(ensure.status ?? 4);
}
const electronBin = String(ensure.stdout || "")
  .trim()
  .split("\n")
  .at(-1);
if (!electronBin || !existsSync(electronBin)) {
  console.error("stage-linux-loong64 refused: extracted Electron path missing");
  process.exit(4);
}
const electronDir = dirname(electronBin);

rmSync(payload, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });
cpSync(electronDir, payload, { recursive: true, dereference: true });
const electronExe = join(payload, "electron");
const penglai = join(payload, "Penglai");
if (existsSync(electronExe) && !existsSync(penglai)) renameSync(electronExe, penglai);
if (!existsSync(penglai)) {
  console.error("stage-linux-loong64 refused: Penglai binary missing after Electron copy");
  process.exit(1);
}
try {
  writeRequiredFuses(penglai);
} catch (error) {
  console.error(
    "stage-linux-loong64: Electron 31.7.7 fuse wire:",
    error instanceof Error ? error.message : String(error),
  );
}

const resources = join(payload, "resources");
mkdirSync(resources, { recursive: true });
cpSync(join(ROOT, "dist", "desktop-bundle"), join(resources, "app"), {
  recursive: true,
});
cpSync(join(staging, "runtime"), join(resources, "runtime"), { recursive: true });
cpSync(join(staging, "profile-seed"), join(resources, "profile-seed"), {
  recursive: true,
});
cpSync(join(staging, "plugins"), join(resources, "plugins"), { recursive: true });
if (existsSync(join(staging, "mnemon"))) {
  cpSync(join(staging, "mnemon"), join(resources, "mnemon"), { recursive: true });
}
cpSync(join(staging, "licenses"), join(resources, "licenses"), { recursive: true });
for (const name of [
  "runtime-manifest.json",
  "release-contract.json",
  "LGPL_SOURCE_OFFER.txt",
  ".closure-complete",
]) {
  const src = join(staging, name);
  if (existsSync(src)) {
    cpSync(
      src,
      join(resources, name === ".closure-complete" ? "closure-credential.json" : name),
    );
  }
}
writeFileSync(
  join(resources, "release-info.json"),
  `${JSON.stringify(
    {
      productName: "Penglai",
      productVersion: releasePins.productVersion,
      target: LINUX_LOONG64_TARGET,
      electron: PINNED_ELECTRON_LINUX_LOONG64,
      node: PINNED_NODE_LINUX_LOONG64,
      dsh: releasePins.dsh,
      native: false,
      ownerPostRelease: true,
      sourceSha: gitState().head,
    },
    null,
    2,
  )}\n`,
);

assertUos20OldWorldAddonFiles(join(resources, "runtime", "dsh", "node_modules"));
console.log(
  JSON.stringify({
    verdict: "STAGED",
    target: LINUX_LOONG64_TARGET,
    payload,
    native: false,
    ownerPostRelease: true,
  }),
);
