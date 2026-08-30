#!/usr/bin/env node
// Windows current-user NSIS Setup. Native PASS is only legal on win32/x64.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { stagingForTarget } from "./lib/closure-credential.mjs";

const contract = {
  installer: "Penglai_0.5.8_windows_x64_setup.exe",
  currentUser: true,
  languages: ["zh", "en"],
  refuseDowngrade: true,
  preserveUserDataDefault: true,
  upgradeCode: "8F3C1A62-0B77-4D2E-9C41-6A1F2E7B9D50",
  appId: "Penglai.DSH.0.5",
  host: { platform: process.platform, arch: process.arch },
  nativeEvidenceAllowed: process.platform === "win32" && process.arch === "x64",
  verdict: process.platform === "win32" && process.arch === "x64" ? "READY" : "BLOCKED",
};

if (contract.nativeEvidenceAllowed) {
  const payloadPrep = spawnSync(process.execPath, ["scripts/package-windows-payload.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  contract.payloadExit = payloadPrep.status ?? 1;
  if (payloadPrep.status !== 0) {
    console.error("package-windows-nsis payload builder failed");
    process.exit(payloadPrep.status === 4 ? 4 : 1);
  }
}

if (!contract.nativeEvidenceAllowed) {
  mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
  writeFileSync(join(ROOT, "evidence/generated/windows-nsis-preflight.json"), JSON.stringify(contract, null, 2));
  console.error("package-windows-nsis BLOCKED on this host; native evidence reserved");
  process.exit(4);
}

const staging = stagingForTarget(ROOT, "win32-x86_64");
const payload = join(staging, "payload");
const nsi = join(ROOT, "scripts", "nsis", "Penglai.nsi");
const license = join(ROOT, "scripts", "nsis", "license.rtf");
const icon = join(ROOT, "dist", "native-win32-x86_64", "Penglai.ico");
const makensis = spawnSync("makensis", ["/VERSION"], { encoding: "utf8" });
if (makensis.status !== 0) {
  console.error("package-windows-nsis BLOCKED: makensis missing on Windows x64 runner");
  process.exit(4);
}
if (!existsSync(payload) || !existsSync(nsi) || !existsSync(license) || !existsSync(icon)) {
  console.error("package-windows-nsis BLOCKED: payload, license, icon, or NSIS script missing");
  process.exit(4);
}
const out = join(ROOT, "dist", contract.installer);
const packed = spawnSync(
  "makensis",
  [
    "/INPUTCHARSET",
    "UTF8",
    `/DPENGLAI_OUTFILE=${out}`,
    `/DPENGLAI_PAYLOAD=${payload}`,
    `/DPENGLAI_LICENSE=${license}`,
    `/DPENGLAI_ICON=${icon}`,
    nsi,
  ],
  { cwd: join(ROOT, "scripts", "nsis"), encoding: "utf8", stdio: "inherit" },
);
if (packed.status !== 0) {
  console.error("package-windows-nsis FAIL: makensis");
  process.exit(1);
}
if (!existsSync(out)) {
  console.error("package-windows-nsis FAIL: setup missing after makensis");
  process.exit(1);
}
const installedRoot = resolve(ROOT, "dist", "Penglai-v0.5.8-win32-x64");
const installedApp = join(installedRoot, "Penglai");
const installedRelative = relative(resolve(ROOT, "dist"), installedRoot);
if (!installedRelative || installedRelative === ".." || installedRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(installedRelative)) {
  console.error("package-windows-nsis FAIL: from-installer target escaped dist");
  process.exit(1);
}
rmSync(installedRoot, { recursive: true, force: true });
mkdirSync(installedApp, { recursive: true });
const applied = spawnSync(out, ["/S", `/D=${installedApp}`], { cwd: ROOT, encoding: "utf8", windowsHide: true });
if (applied.status !== 0 || !existsSync(join(installedApp, "Penglai.exe"))) {
  console.error("package-windows-nsis FAIL: exact Setup did not reinstall into the verification tree");
  process.exit(1);
}
const releaseInfoPath = join(installedApp, "resources", "release-info.json");
if (!existsSync(releaseInfoPath)) {
  console.error("package-windows-nsis FAIL: installed payload is missing release-info.json");
  process.exit(1);
}
const releaseInfo = JSON.parse(readFileSync(releaseInfoPath, "utf8"));
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
mkdirSync(join(ROOT, "evidence", "generated"), { recursive: true });
writeFileSync(
  join(ROOT, "evidence", "generated", "local-installer-win32-x86_64.json"),
  JSON.stringify(
    {
      installer: contract.installer,
      setup: join("dist", contract.installer),
      sha256,
      sourceSha: releaseInfo.sourceSha,
      treeDirty: releaseInfo.treeDirty,
      signatureKind: "unsigned-nsis",
      authenticode: false,
      phase: "TARGET_BUILT",
      target: "win32-x86_64",
      publicExportTreeSha256: releaseInfo.publicExportTreeSha256,
      installedApp,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    verdict: "PASS",
    installer: out,
    sha256,
    installedApp,
    makensis: String(makensis.stdout || "").trim(),
  }),
);
