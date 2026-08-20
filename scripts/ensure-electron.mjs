// BLOCKED: this script has no --arch / target argument. It installs the host
// Electron binary only. darwin-x64 cross-build purity is deferred to the
// Owner's Intel native runner; this helper must not be treated as a
// cross-arch electron fetch.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { PINNED_ELECTRON, PINNED_ELECTRON_DARWIN_ARM64_SHA256 } from "../packages/release-identity/src/pins.ts";

const req = createRequire(join(process.cwd(), "apps/desktop/package.json"));
let electronRoot;
try {
  electronRoot = dirname(req.resolve("electron/package.json"));
} catch {
  console.error("electron package missing");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(electronRoot, "package.json"), "utf8"));
if (pkg.version !== PINNED_ELECTRON) {
  console.error("electron package version", pkg.version, "expected", PINNED_ELECTRON);
  process.exit(1);
}
const checksumsPath = join(electronRoot, "checksums.json");
if (!existsSync(checksumsPath)) {
  console.error("electron checksums.json missing");
  process.exit(1);
}
const checksums = JSON.parse(readFileSync(checksumsPath, "utf8"));
const zipName = `electron-v${PINNED_ELECTRON}-darwin-arm64.zip`;
if (checksums[zipName] !== PINNED_ELECTRON_DARWIN_ARM64_SHA256) {
  console.error("electron darwin-arm64 zip SHA pin mismatch", checksums[zipName]);
  process.exit(1);
}
const cachedZip = [
  join(electronRoot, "dist", zipName),
  join(process.env.ELECTRON_CACHE ?? "", zipName),
  join(process.env.HOME ?? "", "Library/Caches/electron", zipName),
].find((p) => p && existsSync(p));
if (cachedZip) {
  const got = createHash("sha256").update(readFileSync(cachedZip)).digest("hex");
  if (got !== PINNED_ELECTRON_DARWIN_ARM64_SHA256) {
    console.error("cached electron zip hash mismatch", cachedZip, got);
    process.exit(1);
  }
}
const distApp = join(electronRoot, "dist", "Electron.app");
if (!existsSync(distApp)) {
  const install = join(electronRoot, "install.js");
  console.log("downloading pinned electron binary via official install.js");
  const r = spawnSync(process.execPath, [install], { stdio: "inherit", env: { ...process.env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(distApp)) {
  console.error("Electron.app still missing after install");
  process.exit(1);
}
console.log(distApp);
