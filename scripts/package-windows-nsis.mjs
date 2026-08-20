#!/usr/bin/env node
// Cross-build contract for the Windows current-user NSIS Setup.
// This host cannot emit native Windows evidence; the script records the
// pinned identity and refuses to claim a native PASS.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const contract = {
  installer: "Penglai_0.5.0_windows_x64_setup.exe",
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
  console.log("package-windows-nsis BLOCKED on this host; native evidence reserved");
  process.exit(0);
}

console.error("native Windows NSIS builder is reserved for the Windows x64 runner");
process.exit(2);
