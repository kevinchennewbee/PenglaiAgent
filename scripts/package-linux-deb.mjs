#!/usr/bin/env node
// Portable linux-loong64 .deb class. Native UOS PASS remains Loongson hardware.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stagingForTarget } from "./lib/closure-credential.mjs";
import {
  LINUX_LOONG64_TARGET,
  UOS_DEB_ARCHITECTURE,
  UOS_DEB_INSTALLER_NAME,
  assertLinuxLoong64PackTarget,
  packageLinuxDeb,
} from "./lib/package-linux-deb.mjs";
import { ROOT } from "./lib/repo.mjs";

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

const targetArg = argValue("--target") ?? process.env.PENGLAI_PACK_TARGET;
try {
  assertLinuxLoong64PackTarget(targetArg);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const payloadArg = argValue("--payload-root");
const outDir = argValue("--out-dir") ?? join(ROOT, "dist");
const iconPath =
  argValue("--icon") ??
  join(ROOT, "packaging", "icon.iconset", "icon_256x256.png");
const payloadRoot =
  payloadArg ?? join(stagingForTarget(ROOT, LINUX_LOONG64_TARGET), "payload");

if (!payloadArg && !existsSync(payloadRoot)) {
  console.error(
    JSON.stringify({
      verdict: "BLOCKED",
      command: "package:linux-deb",
      reason:
        "linux-loong64 payload missing; portable .deb class requires a staged payload. This is not native UOS PASS.",
      target: LINUX_LOONG64_TARGET,
      architecture: UOS_DEB_ARCHITECTURE,
      installerName: UOS_DEB_INSTALLER_NAME,
      native: false,
    }),
  );
  process.exit(4);
}

try {
  const packed = packageLinuxDeb({
    target: LINUX_LOONG64_TARGET,
    payloadRoot,
    outDir,
    iconPath,
    requireRuntimeClosure: true,
  });
  console.log(
    JSON.stringify({
      verdict: "PACKAGED",
      native: false,
      ...packed,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
