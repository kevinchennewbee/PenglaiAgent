import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, readJson } from "./lib/repo.mjs";
import { sha256File as closureSha256File, writeClosureCredential } from "./lib/closure-credential.mjs";
import { locateWorkspaceDsh, materializeDshClosure } from "./lib/dsh-closure.mjs";
import { validateCohortSnapshot, verifyCohortLock } from "./lib/dsh-npm-cohort.mjs";
import {
  PINNED_DSH,
  PINNED_DSH_CLOSURE_MANIFEST_SHA256,
  PINNED_DSH_CLOSURE_PACKAGE_COUNT,
  PINNED_DSH_TARBALL_SHA256,
  PINNED_ELECTRON,
  PINNED_NODE,
  PRODUCT_VERSION,
} from "./lib/product.mjs";
import { MNEMON_UPSTREAM, mnemonAssetForTarget } from "../packages/release-identity/src/mnemon-assets.js";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hostTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-aarch64";
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x86_64";
  if (process.platform === "win32") return "win32-x86_64";
  throw new Error(`unsupported host ${process.platform}/${process.arch}`);
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function assertSafeName(name) {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || n.includes("..")) throw new Error(`unsafe archive path ${name}`);
}

const target = argValue("--target", hostTarget());
const contract = readJson("release-contract.json");
const inputs = (contract.runtimeInputs ?? []).filter((i) => i.target === target);
const nodeInput = inputs.find((i) => i.kind === "node");
if (!nodeInput) {
  console.error("no node input for", target);
  process.exit(1);
}
if (/arm64|aarch64/.test(nodeInput.filename) && target.includes("x86_64")) {
  console.error("refusing arm64 node for x64 target");
  process.exit(1);
}
if (/x64|x86_64/.test(nodeInput.filename) && target.includes("aarch64") && !nodeInput.filename.includes("arm64")) {
  console.error("refusing x64 node for arm64 target");
  process.exit(1);
}

const host = hostTarget();
const staging =
  target === host ? join(ROOT, "dist", "runtime-staging") : join(ROOT, "dist", `runtime-staging-${target}`);
const cacheDir = join(ROOT, "dist", "runtime-cache", nodeInput.sha256);
const archivePath = join(cacheDir, nodeInput.filename);

rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(staging, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

if (!existsSync(archivePath) || sha256File(archivePath) !== nodeInput.sha256) {
  execFileSync("curl", ["-fL", "-o", archivePath, nodeInput.url], { stdio: "inherit" });
}
const got = sha256File(archivePath);
if (got !== nodeInput.sha256) {
  console.error("node archive hash mismatch", got);
  process.exit(1);
}

const extractDir = join(staging, "extract");
mkdirSync(extractDir, { recursive: true });
if (nodeInput.archive === "zip") {
  const unzip = spawnSync("unzip", ["-v"], { encoding: "utf8" });
  if (unzip.status === 0) {
    const names = execFileSync("unzip", ["-Z", "-1", archivePath], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const n of names) assertSafeName(n);
    execFileSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "inherit" });
  } else if (process.platform === "win32" && spawnSync("tar", ["-tf", archivePath], { encoding: "utf8" }).status === 0) {
    // Current Windows ships bsdtar, which reads ZIP archives without requiring
    // an optional PowerShell.Archive module.
    const names = execFileSync("tar", ["-tf", archivePath], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const n of names) assertSafeName(n);
    execFileSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "inherit" });
  } else if (process.platform === "win32") {
    const expanded = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${extractDir}'`],
      { stdio: "inherit" },
    );
    if (expanded.status !== 0) {
      console.error("embed-runtime BLOCKED: unzip and Expand-Archive both unavailable");
      process.exit(4);
    }
  } else {
    console.error("embed-runtime BLOCKED: unzip missing for zip runtime archive");
    process.exit(4);
  }
} else {
  const names = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const n of names) assertSafeName(n);
  execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "inherit" });
}

const extractedRoot = readdirSync(extractDir)
  .map((n) => join(extractDir, n))
  .find((p) => statSync(p).isDirectory()) ?? extractDir;
mkdirSync(join(staging, "runtime"), { recursive: true });
if (process.platform === "darwin") {
  execFileSync("ditto", [extractedRoot, join(staging, "runtime", "node")]);
} else {
  cpSync(extractedRoot, join(staging, "runtime", "node"), { recursive: true });
}
rmSync(extractDir, { recursive: true, force: true });

// Package from the declared hoisted workspace root. Resolving from a child
// workspace can enter pnpm's virtual-store compatibility links, which do not
// preserve package-local version conflicts when copied into a standalone app.
const workspaceDsh = join(ROOT, "node_modules", "@deepseek-ai", "dsh");
const dshVersion = JSON.parse(readFileSync(join(workspaceDsh, "package.json"), "utf8")).version;
if (dshVersion !== PINNED_DSH) {
  console.error(`workspace DSH closure must be pinned to ${PINNED_DSH}, got ${dshVersion || "missing"}`);
  process.exit(1);
}
const cohortPath = join(ROOT, "docs", "0.5.9", "DSH_NPM_COHORT.json");
const cohortBytes = readFileSync(cohortPath);
const cohort = JSON.parse(cohortBytes.toString("utf8"));
try {
  const summary = validateCohortSnapshot(cohort);
  const cohortSha256 = createHash("sha256").update(cohortBytes).digest("hex");
  if (
    cohort.version !== PINNED_DSH ||
    cohort.rootTarballSha256 !== PINNED_DSH_TARBALL_SHA256 ||
    cohortSha256 !== PINNED_DSH_CLOSURE_MANIFEST_SHA256 ||
    summary.total !== PINNED_DSH_CLOSURE_PACKAGE_COUNT
  ) {
    throw new Error("npm cohort differs from release identity");
  }
  verifyCohortLock(cohort, readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"));
} catch (error) {
  console.error("pnpm lock is not bound to the official DSH npm cohort", error);
  process.exit(1);
}
const locatedDsh = locateWorkspaceDsh({
  root: ROOT,
  pinnedVersion: PINNED_DSH,
  resolvedPackageDir: workspaceDsh,
});
const dshPackageDir = locatedDsh?.dshPackageDir ?? "";
const dshPackageRoot = locatedDsh?.dshPackageRoot ?? "";
if (!existsSync(dshPackageDir) || !existsSync(join(dshPackageRoot, "node_modules"))) {
  console.error("workspace DSH pnpm closure missing");
  process.exit(1);
}
const dshDest = join(staging, "runtime", "dsh");
cpSync(dshPackageDir, dshDest, { recursive: true, dereference: true });
const flattened = materializeDshClosure(join(dshPackageDir, "package.json"), dshDest, target);
if (!existsSync(join(dshDest, "node_modules", "@deepseek-ai", "dsh-web-frontend"))) {
  console.error("workspace DSH node_modules closure missing dsh-web-frontend");
  process.exit(1);
}
rmSync(join(dshDest, "node_modules", ".bin"), { recursive: true, force: true });
console.log(
  "embed-runtime flattened",
  flattened.packages.length,
  "packages native",
  flattened.native,
  "nested conflicts",
  flattened.nestedConflicts.nestedConflictCount,
);

const nodeBin =
  target === "win32-x86_64"
    ? join(staging, "runtime", "node", "node.exe")
    : join(staging, "runtime", "node", "bin", "node");
const dshBin = join(dshDest, "lib", "bin.js");
let dshVersionProbe = `cross-staged ${target}`;
if (existsSync(nodeBin) && target !== "win32-x86_64") {
  const versionProbe = spawnSync(nodeBin, [dshBin, "--version"], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", NODE_PATH: "" },
    cwd: dirname(nodeBin),
  });
  if (versionProbe.status !== 0 || !String(versionProbe.stdout).includes(PINNED_DSH)) {
    console.error("embedded DSH --version failed", versionProbe.stdout, versionProbe.stderr);
    process.exit(1);
  }
  dshVersionProbe = String(versionProbe.stdout).trim();
}

// The 0.5.7 rc.2 overlay remains historical evidence only. Alpha.2 exposes
// official client slots, so Penglai branding and settings are composed by
// signed first-party plugins without modifying official DSH bytes.
console.log(JSON.stringify({ dsh: PINNED_DSH, overlay: "official-slots-no-source-patch" }));

const pluginTarget = target === "darwin-aarch64"
  ? "darwin-arm64"
  : target === "darwin-x86_64"
    ? "darwin-x64"
    : target === "win32-x86_64"
      ? "win32-x64"
      : null;
if (!pluginTarget) {
  console.error("no plugin target mapping for", target);
  process.exit(1);
}
const pack = spawnSync(
  process.execPath,
  [join(ROOT, "scripts/pack-plugins.mjs"), "--target", pluginTarget],
  { cwd: ROOT, stdio: "inherit" },
);
if (pack.status !== 0) process.exit(pack.status ?? 1);
const packedPlugins = join(ROOT, "dist", "runtime-staging", "plugins");
const stagedPlugins = join(staging, "plugins");
if (packedPlugins !== stagedPlugins) {
  rmSync(stagedPlugins, { recursive: true, force: true });
  cpSync(packedPlugins, stagedPlugins, { recursive: true });
}
const mnemonAsset = mnemonAssetForTarget(target);
if (!mnemonAsset) {
  console.error("embed-runtime missing mnemon pin for", target);
  process.exit(1);
}
const mnemonSrc = join(ROOT, "third_party", "mnemon", "bin", mnemonAsset.target, mnemonAsset.binaryFilename);
if (!existsSync(mnemonSrc) || sha256File(mnemonSrc) !== mnemonAsset.binarySha256) {
  console.error("embed-runtime mnemon binary missing or hash mismatch; fetch the target asset first");
  process.exit(1);
}
mkdirSync(join(staging, "mnemon"), { recursive: true });
cpSync(mnemonSrc, join(staging, "mnemon", mnemonAsset.binaryFilename));
const mnemonLicense = join(
  ROOT,
  "packages/moss-tts/third_party/sentencepiece-js-Apache-2.0.txt",
);
if (!existsSync(mnemonLicense) || sha256File(mnemonLicense) !== MNEMON_UPSTREAM.licenseSha256) {
  console.error("embed-runtime Mnemon Apache-2.0 license missing or hash mismatch");
  process.exit(1);
}
cpSync(mnemonLicense, join(staging, "mnemon", "LICENSE"));
if (mnemonAsset.executable) {
  const { chmodSync } = await import("node:fs");
  chmodSync(join(staging, "mnemon", mnemonAsset.binaryFilename), 0o755);
}
cpSync(join(ROOT, "profile-seed"), join(staging, "profile-seed"), { recursive: true });
cpSync(join(ROOT, "release-contract.json"), join(staging, "release-contract.json"));
const lgplSourceOffer = join(ROOT, "docs", "0.5.9", "LGPL_SOURCE_OFFER.md");
if (!existsSync(lgplSourceOffer)) {
  console.error("0.5.9 LGPL corresponding-source offer is missing");
  process.exit(1);
}
cpSync(lgplSourceOffer, join(staging, "LGPL_SOURCE_OFFER.txt"));

// A native Windows build must carry its ACL/job/uninstall helper inside the
// hashed runtime manifest. Cross-staging may omit it and remains structurally
// incomplete until the matching Windows runner compiles the helper.
if (target === "win32-x86_64") {
  const helper = join(ROOT, "dist", "native-win32-x86_64", "penglai-windows-host.exe");
  if (existsSync(helper)) {
    const helperDir = join(staging, "runtime", "helpers");
    mkdirSync(helperDir, { recursive: true });
    cpSync(helper, join(helperDir, "penglai-windows-host.exe"));
  }
}

const files = walk(join(staging, "runtime"))
  .concat(walk(join(staging, "profile-seed")))
  .concat(existsSync(join(staging, "plugins")) ? walk(join(staging, "plugins")) : [])
  .concat(existsSync(join(staging, "mnemon")) ? walk(join(staging, "mnemon")) : [])
  .concat([join(staging, "release-contract.json"), join(staging, "LGPL_SOURCE_OFFER.txt")])
  .map((abs) => ({
    path: abs.slice(staging.length + 1),
    sha256: sha256File(abs),
    size: statSync(abs).size,
  }));
writeFileSync(
  join(staging, "runtime-manifest.json"),
  JSON.stringify(
    {
      release: PRODUCT_VERSION,
      target,
      dsh: PINNED_DSH,
      node: PINNED_NODE,
      electron: PINNED_ELECTRON,
      files,
    },
    null,
    2,
  ),
);
const manifestPath = join(staging, "runtime-manifest.json");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
writeClosureCredential(staging, {
  sourceSha,
  target,
  manifestSha256: closureSha256File(manifestPath),
  dsh: PINNED_DSH,
  node: PINNED_NODE,
  probe: dshVersionProbe,
  nativeProbed: target === host,
  completedAt: new Date().toISOString(),
});
console.log("embed-runtime", target, staging, "files", files.length);
