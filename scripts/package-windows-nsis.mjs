#!/usr/bin/env node
// Windows current-user NSIS Setup. Native PASS is only legal on win32/x64.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";

const contract = {
  installer: "Penglai_0.5.1_windows_x64_setup.exe",
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

if (!contract.nativeEvidenceAllowed) {
  mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
  writeFileSync(join(ROOT, "evidence/generated/windows-nsis-preflight.json"), JSON.stringify(contract, null, 2));
  console.error("package-windows-nsis BLOCKED on this host; native evidence reserved");
  process.exit(4);
}

const staging = join(ROOT, "dist", "runtime-staging-win32-x86_64");
const payload = join(staging, "payload");
const nsi = join(ROOT, "scripts", "nsis", "Penglai.nsi");
const license = join(ROOT, "scripts", "nsis", "license.rtf");
const makensis = spawnSync("makensis", ["/VERSION"], { encoding: "utf8" });
if (makensis.status !== 0) {
  console.error("package-windows-nsis BLOCKED: makensis missing on Windows x64 runner");
  process.exit(4);
}
if (!existsSync(payload) || !existsSync(nsi) || !existsSync(license)) {
  console.error("package-windows-nsis BLOCKED: win32-x86_64 staging payload, license, or NSIS script missing");
  process.exit(4);
}
const out = join(ROOT, "dist", contract.installer);
const packed = spawnSync(
  "makensis",
  [`/DPENGLAI_OUTFILE=${out}`, `/DPENGLAI_PAYLOAD=${payload}`, `/DPENGLAI_LICENSE=${license}`, nsi],
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
console.log(JSON.stringify({ verdict: "PASS", installer: out, makensis: String(makensis.stdout || "").trim() }));
