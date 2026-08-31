#!/usr/bin/env node
// Assemble win32-x86_64 NSIS payload. Native Setup PASS remains win32-x64 only.
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
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { stagingForTarget } from "./lib/closure-credential.mjs";
import { writeRequiredFuses } from "./lib/electron-fuses.mjs";
import { readReleaseIdentityPins } from "./lib/release-pins-source.mjs";

const releasePins = readReleaseIdentityPins();

const staging = stagingForTarget(ROOT, "win32-x86_64");
const payload = join(staging, "payload");
const native = process.platform === "win32" && process.arch === "x64";
const git = gitState();
const source = requireCleanCandidateSource();
const publicExportPath = join(
  ROOT,
  "evidence",
  "generated",
  "public-export.json",
);
const publicExport = existsSync(publicExportPath)
  ? JSON.parse(readFileSync(publicExportPath, "utf8"))
  : null;
if (
  native &&
  (!source.ok ||
    publicExport?.privateCandidateSourceSha !== git.head ||
    publicExport?.treeDirty !== false ||
    !/^[0-9a-f]{64}$/.test(String(publicExport?.publicExportTreeSha256 ?? "")))
) {
  finish("STALE", {
    command: "package:windows-payload",
    reason:
      "native Windows payload requires a clean candidate and current public export evidence",
  });
}

function run(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    ...extra,
  });
  return result.status ?? 1;
}

// Never reuse a prior desktop bundle. Release identity is stamped from the
// current Git commit, so the BrowserWindow code and static pages must be
// rebuilt from that same checkout on every packaging invocation.
const bundled = run(process.execPath, ["scripts/bundle-desktop.mjs"]);
if (bundled !== 0)
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "desktop bundle failed",
  });
const sourceSplash = join(ROOT, "apps", "desktop", "static", "splash.html");
const bundledSplash = join(
  ROOT,
  "dist",
  "desktop-bundle",
  "static",
  "splash.html",
);
if (
  !existsSync(join(ROOT, "dist", "desktop-bundle", "electron-main.js")) ||
  !existsSync(bundledSplash) ||
  readFileSync(bundledSplash, "utf8") !== readFileSync(sourceSplash, "utf8")
) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason:
      "desktop bundle is missing or does not match the current startup page",
  });
}

if (native) {
  const helperBuild = run(process.execPath, ["scripts/build-windows-host.mjs"]);
  if (helperBuild !== 0) {
    finish("FAIL", {
      command: "package:windows-payload",
      reason: "native Windows helper build failed",
    });
  }
}

const embed = run(process.execPath, [
  "scripts/embed-runtime.mjs",
  "--target",
  "win32-x86_64",
]);
if (embed !== 0) {
  finish(native ? "FAIL" : "BLOCKED", {
    command: "package:windows-payload",
    reason: "win32-x86_64 runtime staging failed",
    native,
  });
}

if (native) {
  const helper = join(
    ROOT,
    "dist",
    "native-win32-x86_64",
    "penglai-windows-host.exe",
  );
  if (!existsSync(helper)) {
    finish("FAIL", {
      command: "package:windows-payload",
      reason: "compiled Windows helper missing",
    });
  }
  if (
    !existsSync(join(staging, "runtime", "helpers", "penglai-windows-host.exe"))
  ) {
    finish("FAIL", {
      command: "package:windows-payload",
      reason: "embedded runtime is missing the compiled Windows helper",
    });
  }
}

const ensure = spawnSync(
  process.execPath,
  ["scripts/ensure-electron.mjs", "--target", "win32-x64"],
  {
    cwd: ROOT,
    encoding: "utf8",
  },
);
if (ensure.status !== 0) {
  process.stderr.write(
    ensure.stderr || ensure.stdout || "ensure-electron failed\n",
  );
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
  finish("BLOCKED", {
    command: "package:windows-payload",
    reason: "extracted Electron path missing",
  });
}

rmSync(payload, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });
const electronDir = existsSync(join(dirname(electronRoot), "electron.exe"))
  ? dirname(electronRoot)
  : electronRoot;
cpSync(electronDir, payload, { recursive: true });
const electronExe = join(payload, "electron.exe");
const penglaiExe = join(payload, "Penglai.exe");
const penglaiIcon = join(ROOT, "dist", "native-win32-x86_64", "Penglai.ico");
if (existsSync(electronExe) && !existsSync(penglaiExe))
  renameSync(electronExe, penglaiExe);
if (!existsSync(penglaiExe) && !existsSync(join(payload, "Penglai.exe"))) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "Penglai.exe missing after Electron copy",
  });
}
const stamped = run(process.execPath, [
  "scripts/stamp-windows-exe.mjs",
  penglaiExe,
  join(ROOT, "packaging", "icon.iconset", "icon_256x256.png"),
  penglaiIcon,
]);
if (stamped !== 0) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "Penglai.exe resource stamping failed",
  });
}
try {
  writeRequiredFuses(penglaiExe);
} catch (error) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason: `Penglai.exe fuse hardening failed: ${String(error)}`,
  });
}

const resources = join(payload, "resources");
mkdirSync(resources, { recursive: true });
cpSync(join(ROOT, "dist", "desktop-bundle"), join(resources, "app"), {
  recursive: true,
});
cpSync(join(staging, "runtime"), join(resources, "runtime"), {
  recursive: true,
});
cpSync(join(staging, "profile-seed"), join(resources, "profile-seed"), {
  recursive: true,
});
cpSync(join(staging, "plugins"), join(resources, "plugins"), {
  recursive: true,
});
if (existsSync(join(staging, "mnemon"))) {
  cpSync(join(staging, "mnemon"), join(resources, "mnemon"), {
    recursive: true,
  });
}
cpSync(join(staging, "licenses"), join(resources, "licenses"), {
  recursive: true,
});
for (const name of [
  "runtime-manifest.json",
  "release-contract.json",
  "LGPL_SOURCE_OFFER.txt",
  ".closure-complete",
]) {
  const src = join(staging, name);
  if (existsSync(src))
    cpSync(
      src,
      join(
        resources,
        name === ".closure-complete" ? "closure-credential.json" : name,
      ),
    );
}
if (native) {
  writeFileSync(
    join(resources, "release-info.json"),
    `${JSON.stringify(
      {
        productName: "Penglai",
        productVersion: "0.5.9",
        buildNumber: 0,
        candidateOrdinal: 0,
        candidateKind: "public-community-release",
        trustTier: "community-verified",
        generationId: "penglai-dsh-v0.5",
        phase: "TARGET_BUILT",
        sourceSha: git.head,
        treeDirty: false,
        targetPlatform: "win32-x64",
        electron: "43.4.0",
        node: "22.22.2",
        embeddedNode: "22.22.2",
        dsh: "0.1.2-alpha.2",
        dshSource: releasePins.dshSource,
        profileSchema: 3,
        catalogSchema: 3,
        imSchema: 4,
        schemaVersion: 2,
        signed: false,
        notarized: false,
        authenticode: false,
        signatureKind: "unsigned-nsis",
        developerIdSigned: false,
        publicExportTreeSha256: publicExport.publicExportTreeSha256,
      },
      null,
      2,
    )}\n`,
  );
}
if (
  native &&
  !existsSync(join(resources, "runtime", "helpers", "penglai-windows-host.exe"))
) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "payload is missing the compiled Windows helper",
  });
}
if (
  native &&
  (!existsSync(join(resources, "mnemon", "mnemon.exe")) ||
    !existsSync(join(resources, "mnemon", "LICENSE")))
) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "payload is missing the pinned Mnemon binary or license",
  });
}

const arch = spawnSync(
  process.execPath,
  ["scripts/verify-native-arch.mjs", payload, "win32-x86_64"],
  {
    cwd: ROOT,
    encoding: "utf8",
  },
);
if (arch.status !== 0 && arch.status !== 4) {
  process.stderr.write(arch.stderr || arch.stdout || "PE scan failed\n");
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "PE architecture scan failed",
  });
}
if (arch.status === 4 && native) {
  finish("FAIL", {
    command: "package:windows-payload",
    reason: "native Windows payload had no PE binaries",
  });
}

writeFileSync(
  join(ROOT, "evidence/generated", "windows-payload.json"),
  JSON.stringify(
    {
      command: "package:windows-payload",
      verdict: native ? "READY" : "CROSS_PREP",
      payload,
      native,
      peScan:
        arch.status === 0 ? "PASS" : arch.status === 4 ? "BLOCKED" : "FAIL",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ verdict: "PASS", payload, native, nsisNativeOnly: true }),
);
