// Target-aware Electron fetch. Native PASS is only legal when the requested
// target matches this host. Cross-arch zip download+hash is allowed as a
// packaging input; it is not native evidence.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  PINNED_ELECTRON,
  PINNED_ELECTRON_DARWIN_ARM64_SHA256,
  PINNED_ELECTRON_DARWIN_X64_SHA256,
  PINNED_ELECTRON_WIN32_X64_SHA256,
} from "../packages/release-identity/src/pins.ts";

const targetArg = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : process.env.PENGLAI_ELECTRON_TARGET;

const TARGETS = {
  "darwin-arm64": {
    zip: `electron-v${PINNED_ELECTRON}-darwin-arm64.zip`,
    sha: PINNED_ELECTRON_DARWIN_ARM64_SHA256,
    platform: "darwin",
    arch: "arm64",
    appName: "Electron.app",
  },
  "darwin-aarch64": {
    zip: `electron-v${PINNED_ELECTRON}-darwin-arm64.zip`,
    sha: PINNED_ELECTRON_DARWIN_ARM64_SHA256,
    platform: "darwin",
    arch: "arm64",
    appName: "Electron.app",
  },
  "darwin-x64": {
    zip: `electron-v${PINNED_ELECTRON}-darwin-x64.zip`,
    sha: PINNED_ELECTRON_DARWIN_X64_SHA256,
    platform: "darwin",
    arch: "x64",
    appName: "Electron.app",
  },
  "darwin-x86_64": {
    zip: `electron-v${PINNED_ELECTRON}-darwin-x64.zip`,
    sha: PINNED_ELECTRON_DARWIN_X64_SHA256,
    platform: "darwin",
    arch: "x64",
    appName: "Electron.app",
  },
  "win32-x64": {
    zip: `electron-v${PINNED_ELECTRON}-win32-x64.zip`,
    sha: PINNED_ELECTRON_WIN32_X64_SHA256,
    platform: "win32",
    arch: "x64",
    appName: "electron.exe",
  },
  "win32-x86_64": {
    zip: `electron-v${PINNED_ELECTRON}-win32-x64.zip`,
    sha: PINNED_ELECTRON_WIN32_X64_SHA256,
    platform: "win32",
    arch: "x64",
    appName: "electron.exe",
  },
};

const spec = TARGETS[targetArg];
if (!spec) {
  console.error("ensure-electron requires --target darwin-arm64|darwin-x64|win32-x64");
  process.exit(2);
}

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

const hostMatches = process.platform === spec.platform && process.arch === spec.arch;
const cacheDirs = [
  join(electronRoot, "dist"),
  process.env.ELECTRON_CACHE ?? "",
  join(process.env.HOME ?? "", "Library/Caches/electron"),
].filter(Boolean);
const cachedZip = cacheDirs.map((dir) => join(dir, spec.zip)).find((p) => existsSync(p));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function downloadZip(dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://github.com/electron/electron/releases/download/v${PINNED_ELECTRON}/${spec.zip}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    console.error("ensure-electron BLOCKED: electron zip download failed", res.status);
    process.exit(4);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

if (cachedZip) {
  const got = sha256(cachedZip);
  if (got !== spec.sha) {
    console.error("cached electron zip hash mismatch", cachedZip, got);
    process.exit(1);
  }
} else {
  const dest = join(electronRoot, "dist", spec.zip);
  try {
    await downloadZip(dest);
  } catch (error) {
    console.error("ensure-electron BLOCKED: electron zip download failed", error);
    process.exit(4);
  }
  if (sha256(dest) !== spec.sha) {
    console.error("downloaded electron zip hash mismatch", dest);
    process.exit(1);
  }
}

const outDir = join(electronRoot, "dist", `penglai-${spec.platform}-${spec.arch}`);
const hostApp = join(electronRoot, "dist", spec.appName);
if (hostMatches) {
  if (!existsSync(hostApp)) {
    const install = join(electronRoot, "install.js");
    console.log("downloading pinned electron binary via official install.js");
    const r = spawnSync(process.execPath, [install], { stdio: "inherit", env: { ...process.env } });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  if (!existsSync(hostApp)) {
    console.error("Electron binary still missing after install");
    process.exit(1);
  }
  console.log(hostApp);
  process.exit(0);
}

const zipPath = cacheDirs.map((dir) => join(dir, spec.zip)).find((p) => existsSync(p));
if (!zipPath) {
  console.error("ensure-electron BLOCKED: target zip missing after download");
  process.exit(4);
}
mkdirSync(outDir, { recursive: true });
const unzip = spec.platform === "win32"
  ? spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${outDir}'`], { stdio: "inherit" })
  : spawnSync("ditto", ["-x", "-k", zipPath, outDir], { stdio: "inherit" });
if (unzip.status !== 0) {
  console.error("ensure-electron BLOCKED: failed to extract target Electron zip");
  process.exit(4);
}
const extracted = spec.platform === "darwin" ? join(outDir, "Electron.app") : join(outDir, "electron.exe");
if (!existsSync(extracted)) {
  console.error("ensure-electron BLOCKED: extracted Electron binary missing");
  process.exit(4);
}
console.log(extracted);
