import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readJson } from "./lib/repo.mjs";

const { evaluateTargetPreflight } = await import(
  pathToFileURL(join(ROOT, "packages/release-identity/src/preflight.ts")).href
);

const rootPkg = readJson("package.json");
const desktop = readJson("apps/desktop/package.json");
const deps = {
  ...rootPkg.dependencies,
  ...rootPkg.devDependencies,
  ...desktop.dependencies,
  ...desktop.devDependencies,
};
const forbiddenMakers = ["electron-builder", "@electron-forge/cli", "electron-forge", "electron-winstaller"];
const present = forbiddenMakers.filter((n) => deps[n]);
if (present.length) {
  console.error("canonical tree must not depend on alternate makers", present);
  process.exit(1);
}

const host = { platform: process.platform, arch: process.arch, native: true };
const arm = evaluateTargetPreflight(host, "darwin-aarch64");

if (process.platform === "darwin" && process.arch === "arm64") {
  if (arm.verdict !== "READY") {
    console.error("apple silicon should be READY for darwin-aarch64", arm);
    process.exit(1);
  }
}

const adr = readFileSync(join(ROOT, "docs/adr/0024-canonical-packaging-maker.md"), "utf8");
if (!adr.includes("Penglai controlled pipeline") || !adr.includes("NSIS")) {
  console.error("ADR 0024 missing canonical decision");
  process.exit(1);
}

const rec = {
  command: "probe:makers",
  canonicalMaker: "penglai-controlled-pipeline",
  alternateMakersInTree: present,
  scripts: {
    packageMac: existsSync(join(ROOT, "scripts/package-mac.mjs")),
    embedRuntime: existsSync(join(ROOT, "scripts/embed-runtime.mjs")),
  },
  preflight: { host, arm },
  futureTargets: ["darwin-x86_64", "win32-x86_64"],
  squirrelIsUserInstaller: false,
};
mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
writeFileSync(join(ROOT, "evidence/generated/maker-probe.json"), JSON.stringify(rec, null, 2));
console.log("probe-makers", JSON.stringify({ canonical: rec.canonicalMaker, target: arm.target, verdict: arm.verdict }));
