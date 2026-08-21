#!/usr/bin/env node
/**
 * Community-verified macOS DMG for Penglai 0.5.1.
 * Follows PenglaiAgent v0.4.1: complete ad-hoc app seal, codesign strict
 * verification, ordinary UDZO DMG, hdiutil verify. Not Developer ID, not notarized.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";

if (process.platform !== "darwin") {
  throw new Error("build-local-dmg is a macOS acceptance command");
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
}

function sha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const reuseApp = process.argv.includes("--reuse-app");
const targetArg = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : process.env.PENGLAI_PACK_TARGET;
const TARGETS = {
  "darwin-arm64": {
    out: "dist/Penglai-v0.5.1-arm64",
    dmg: "dist/Penglai_0.5.1_macos_aarch64.dmg",
    from: "dist/Penglai-v0.5.1-arm64-from-dmg",
  },
  "darwin-x64": {
    out: "dist/Penglai-v0.5.1-x64",
    dmg: "dist/Penglai_0.5.1_macos_x64.dmg",
    from: "dist/Penglai-v0.5.1-x64-from-dmg",
  },
};
if (!targetArg || !TARGETS[targetArg]) {
  throw new Error(
    "build-local-dmg requires --target darwin-arm64 or darwin-x64",
  );
}
const targetSpec = TARGETS[targetArg];
const expectedTarget =
  targetArg === "darwin-arm64" ? "darwin-aarch64" : "darwin-x86_64";
const head = git(["rev-parse", "HEAD"]);
const originMain = git(["rev-parse", "origin/main"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const sourceDirty = git(["status", "--porcelain"]).length > 0;
if (branch !== "main" || head !== originMain || sourceDirty) {
  throw new Error(
    "build-local-dmg refused: candidate source must be clean main at origin/main",
  );
}
const outRoot = join(ROOT, targetSpec.out);
const appPath = join(outRoot, "Penglai.app");
if (!reuseApp || !existsSync(join(appPath, "Contents/Info.plist"))) {
  const packed = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/package-mac.mjs"), "--target", targetArg],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (packed.status !== 0) process.exit(packed.status ?? 1);
}
if (!existsSync(join(appPath, "Contents/Info.plist"))) {
  throw new Error(`Penglai.app was not produced at ${appPath}`);
}
const packagedBeforeSeal = inspectPackagedCandidate({
  app: appPath,
  candidateSha: head,
  expectedTarget,
});
if (packagedBeforeSeal.verdict !== "PASS") {
  throw new Error(
    `build-local-dmg refused: ${packagedBeforeSeal.verdict} packaged app: ${packagedBeforeSeal.reason}`,
  );
}

run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

const dmgPath = join(ROOT, targetSpec.dmg);
rmSync(dmgPath, { force: true });
const staging = mkdtempSync(join(tmpdir(), "penglai-local-dmg-"));
try {
  run("ditto", [appPath, join(staging, "Penglai.app")]);
  symlinkSync("/Applications", join(staging, "Applications"));
  run("hdiutil", [
    "create",
    "-volname",
    "Penglai",
    "-srcfolder",
    staging,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-ov",
    dmgPath,
  ]);
  run("hdiutil", ["verify", dmgPath]);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const mountRoot = mkdtempSync(join(tmpdir(), "penglai-dmg-mnt-"));
try {
  run("hdiutil", [
    "attach",
    dmgPath,
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mountRoot,
  ]);
  if (!existsSync(join(mountRoot, "Penglai.app/Contents/Info.plist"))) {
    throw new Error("mounted DMG missing Penglai.app");
  }
  if (!lstatSync(join(mountRoot, "Applications")).isSymbolicLink()) {
    throw new Error("mounted DMG missing Applications symlink");
  }
  run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    join(mountRoot, "Penglai.app"),
  ]);
  const copied = join(ROOT, targetSpec.from, "Penglai.app");
  rmSync(join(ROOT, targetSpec.from), { recursive: true, force: true });
  mkdirSync(join(ROOT, targetSpec.from), { recursive: true });
  run("ditto", [join(mountRoot, "Penglai.app"), copied]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", copied]);
  const packagedFromDmg = inspectPackagedCandidate({
    app: copied,
    candidateSha: head,
    expectedTarget,
  });
  if (packagedFromDmg.verdict !== "PASS") {
    throw new Error(
      `mounted DMG identity failed: ${packagedFromDmg.verdict} ${packagedFromDmg.reason}`,
    );
  }
} finally {
  spawnSync("hdiutil", ["detach", mountRoot, "-force"], { stdio: "inherit" });
  rmSync(mountRoot, { recursive: true, force: true });
}

const dirty =
  git([
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--",
    ".",
    ":!release-info.json",
  ]).length > 0;
const hash = sha256(dmgPath);
const info = {
  productName: "Penglai",
  productVersion: "0.5.1",
  name: targetSpec.dmg
    .split("/")
    .pop()
    ?.replace(/\.dmg$/, ""),
  buildNumber: 0,
  candidateOrdinal: 0,
  candidateKind: "public-publication-candidate",
  trustTier: "community-verified",
  generationId: "penglai-dsh-v0.5",
  phase: "TARGET_BUILT",
  sourceSha: head,
  treeDirty: dirty,
  targetPlatform: targetArg,
  minimumMacOS: "13.0",
  electron: "43.4.0",
  node: "22.22.2",
  embeddedNode: "22.22.2",
  dsh: "0.1.1-rc.1",
  profileSchema: 3,
  catalogSchema: 2,
  imSchema: 3,
  schemaVersion: 2,
  signed: false,
  notarized: false,
  signatureKind: "adhoc",
  developerIdSigned: false,
  artifactSha256: hash,
  publicExportTreeSha256: packagedBeforeSeal.release.publicExportTreeSha256,
};
writeFileSync(
  join(outRoot, "release-info.json"),
  JSON.stringify(info, null, 2) + "\n",
);
const sums = `${hash}  ${targetSpec.dmg.split("/").pop()}\n`;
writeFileSync(join(ROOT, "dist/SHA256SUMS"), sums);
writeFileSync(join(ROOT, "dist/SHA256SUMS.txt"), sums);
mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
writeFileSync(
  join(ROOT, "evidence/generated/local-dmg.json"),
  JSON.stringify(
    {
      dmg: targetSpec.dmg,
      sha256: hash,
      sourceSha: head,
      treeDirty: dirty,
      signatureKind: "adhoc",
      phase: "TARGET_BUILT",
      installer: targetSpec.dmg.split("/").pop(),
      target: expectedTarget,
      publicExportTreeSha256: packagedBeforeSeal.release.publicExportTreeSha256,
    },
    null,
    2,
  ),
);
writeFileSync(
  join(ROOT, "evidence/generated/TARGET_BUILT.json"),
  JSON.stringify(
    {
      phase: "TARGET_BUILT",
      ready: false,
      target: expectedTarget,
      installer: targetSpec.dmg.split("/").pop(),
      artifactSha256: hash,
      sourceSha: head,
      treeDirty: dirty,
      signatureKind: "adhoc",
      notarized: false,
      publicExportTreeSha256: packagedBeforeSeal.release.publicExportTreeSha256,
    },
    null,
    2,
  ),
);
console.log(`[local-dmg] ${dmgPath}`);
console.log(`[local-dmg] sha256 ${hash}`);
console.log(
  "[local-dmg] ad-hoc signed for local acceptance only; not notarized",
);
if (dirty) console.log("[local-dmg] warning: treeDirty=true at package time");
