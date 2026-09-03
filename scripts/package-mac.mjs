import { createHash } from "node:crypto";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  inspectClosureCredential,
  stagingForTarget,
} from "./lib/closure-credential.mjs";
import { ROOT } from "./lib/repo.mjs";
import { readReleaseIdentityPins } from "./lib/release-pins-source.mjs";

const releasePins = readReleaseIdentityPins();

const targetArg = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : process.env.PENGLAI_PACK_TARGET;
const TARGETS = {
  "darwin-arm64": {
    out: "dist/Penglai-v0.5.10-arm64",
    zip: "dist/Penglai-v0.5.10-arm64.zip",
    triple: "darwin-arm64",
    runtimeTarget: "darwin-aarch64",
  },
  "darwin-x64": {
    out: "dist/Penglai-v0.5.10-x64",
    zip: "dist/Penglai-v0.5.10-x64.zip",
    triple: "darwin-x64",
    runtimeTarget: "darwin-x86_64",
  },
};
if (!targetArg || !TARGETS[targetArg]) {
  console.error("package:mac requires --target darwin-arm64 or darwin-x64");
  process.exit(1);
}
const targetSpec = TARGETS[targetArg];
const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const origin = execSync("git rev-parse origin/main", {
  encoding: "utf8",
}).trim();
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
if (dirty.length) {
  console.error("package:mac refused: dirty tree");
  process.exit(1);
}
const publicExportPath = join(ROOT, "evidence/generated/public-export.json");
if (!existsSync(publicExportPath)) {
  console.error(
    "package:mac refused: current clean-room public export is missing",
  );
  process.exit(1);
}
const publicExport = JSON.parse(readFileSync(publicExportPath, "utf8"));
if (
  publicExport.privateCandidateSourceSha !== sha ||
  publicExport.treeDirty !== false ||
  publicExport.cleanRoom?.executed !== true ||
  publicExport.cleanRoom?.installStatus !== 0 ||
  publicExport.cleanRoom?.typecheckStatus !== 0 ||
  !/^[0-9a-f]{64}$/.test(String(publicExport.publicExportTreeSha256 ?? ""))
) {
  console.error(
    "package:mac refused: public export is missing, dirty, stale, or not clean-room verified",
  );
  process.exit(1);
}
const publicExportTreeSha256 = publicExport.publicExportTreeSha256;
const staleDmg = "dist/Penglai_0.2.0_macos_aarch64.dmg";
if (
  process.argv.includes("--reuse-stale") ||
  process.env.PENGLAI_REUSE_STALE_DMG === "1"
) {
  console.error("package:mac refused: stale artifact reuse");
  process.exit(1);
}
void staleDmg;
const bundle = spawnSync(process.execPath, ["scripts/bundle-desktop.mjs"], {
  stdio: "inherit",
});
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
const embed = spawnSync(
  process.execPath,
  ["scripts/embed-runtime.mjs", "--target", targetSpec.runtimeTarget],
  { stdio: "inherit" },
);
if (embed.status !== 0) process.exit(embed.status ?? 1);
const runtimeStaging = stagingForTarget(ROOT, targetSpec.runtimeTarget);
const closure = inspectClosureCredential({
  staging: runtimeStaging,
  candidateSha: sha,
  expectedTarget: targetSpec.runtimeTarget,
});
if (closure.verdict !== "PASS") {
  console.error(
    `package:mac refused: ${closure.verdict} runtime closure: ${closure.reason}`,
  );
  process.exit(1);
}
const ensure = spawnSync(
  process.execPath,
  ["scripts/ensure-electron.mjs", "--target", targetArg],
  {
    encoding: "utf8",
  },
);
if (ensure.status !== 0) {
  process.stderr.write(
    ensure.stderr || ensure.stdout || "ensure-electron failed\n",
  );
  process.exit(ensure.status ?? 1);
}
const electronApp = ensure.stdout.trim().split("\n").at(-1);
const outRoot = targetSpec.out;
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });
const appDir = join(outRoot, "Penglai.app");
execFileSync("ditto", [electronApp, appDir]);
const contents = join(appDir, "Contents");
const {
  rewriteElectronPlist,
  assertPenglaiAppIdentity,
  parseInfoPlistIdentity,
} = await import("../packages/runtime/src/packaging.ts");
let plist = rewriteElectronPlist(
  readFileSync(join(contents, "Info.plist"), "utf8"),
);
writeFileSync(join(contents, "Info.plist"), plist);
assertPenglaiAppIdentity(parseInfoPlistIdentity(plist));
const iconSrc = join("packaging", "penglai.icns");
if (!existsSync(iconSrc)) {
  console.error("Penglai icns missing");
  process.exit(1);
}
cpSync(iconSrc, join(contents, "Resources", "penglai.icns"));
const electronIcon = join(contents, "Resources", "electron.icns");
if (existsSync(electronIcon)) rmSync(electronIcon);
const macExec = join(contents, "MacOS", "Electron");
const penglaiExec = join(contents, "MacOS", "Penglai");
if (existsSync(macExec) && !existsSync(penglaiExec)) {
  execFileSync("mv", [macExec, penglaiExec]);
}
const fwRes = join(
  contents,
  "Frameworks/Electron Framework.framework/Versions/A/Resources",
);
const appRes = join(contents, "Resources");
if (!existsSync(fwRes)) {
  console.error("Electron Framework resources missing");
  process.exit(1);
}
for (const name of [
  "icudtl.dat",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "resources.pak",
]) {
  const from = join(fwRes, name);
  if (existsSync(from)) cpSync(from, join(appRes, name));
}

const resources = join(contents, "Resources");
const resourcesApp = join(resources, "app");
rmSync(resourcesApp, { recursive: true, force: true });
mkdirSync(resourcesApp, { recursive: true });
if (!existsSync("dist/desktop-bundle/electron-main.js")) {
  console.error("desktop bundle missing");
  process.exit(1);
}
execFileSync("ditto", ["dist/desktop-bundle", resourcesApp]);
execFileSync("ditto", [
  join(runtimeStaging, "runtime"),
  join(resources, "runtime"),
]);
rmSync(join(resources, "runtime", "dsh", "node_modules", ".bin"), {
  recursive: true,
  force: true,
});
execFileSync("ditto", [
  join(runtimeStaging, "profile-seed"),
  join(resources, "profile-seed"),
]);
execFileSync("ditto", [
  join(runtimeStaging, "plugins"),
  join(resources, "plugins"),
]);
if (existsSync(join(runtimeStaging, "mnemon"))) {
  execFileSync("ditto", [
    join(runtimeStaging, "mnemon"),
    join(resources, "mnemon"),
  ]);
}
execFileSync("ditto", [
  join(runtimeStaging, "licenses"),
  join(resources, "licenses"),
]);
execFileSync("ditto", [
  join(runtimeStaging, "runtime-manifest.json"),
  join(resources, "runtime-manifest.json"),
]);
execFileSync("ditto", [
  join(runtimeStaging, "release-contract.json"),
  join(resources, "release-contract.json"),
]);
execFileSync("ditto", [
  join(runtimeStaging, "LGPL_SOURCE_OFFER.txt"),
  join(resources, "LGPL_SOURCE_OFFER.txt"),
]);
execFileSync("ditto", [
  join(runtimeStaging, ".closure-complete"),
  join(resources, "closure-credential.json"),
]);
const framework = join(
  contents,
  "Frameworks/Electron Framework.framework/Electron Framework",
);
if (existsSync(framework)) {
  const { writeRequiredFuses } = await import("./lib/electron-fuses.mjs");
  writeRequiredFuses(framework);
}
writeFileSync(
  join(outRoot, "README-UNSIGNED.txt"),
  "Penglai 0.5.10 community release. trustTier=community-verified. Ad-hoc signed, not notarized. Gatekeeper may warn; do not disable system security.\n",
);

const info = {
  productName: "Penglai",
  productVersion: "0.5.10",
  name: targetSpec.out.split("/").pop(),
  buildNumber: 0,
  candidateOrdinal: 0,
  candidateKind: "public-community-release",
  trustTier: "community-verified",
  generationId: "penglai-dsh-v0.5",
  phase: "TARGET_BUILT",
  sourceSha: sha,
  treeDirty: dirty.length > 0,
  targetPlatform: targetSpec.triple,
  minimumMacOS: "13.0",
  electron: "43.4.0",
  node: "22.22.2",
  embeddedNode: "22.22.2",
  dsh: "0.1.2-rc.1",
  dshSource: releasePins.dshSource,
  profileSchema: 3,
  catalogSchema: 3,
  imSchema: 4,
  schemaVersion: 2,
  signed: false,
  notarized: false,
  signatureKind: "unsigned-app-dir",
  developerIdSigned: false,
  publicExportTreeSha256,
};
writeFileSync(
  join(outRoot, "release-info.json"),
  JSON.stringify(info, null, 2),
);
writeFileSync(
  join(resources, "release-info.json"),
  JSON.stringify(info, null, 2),
);
const native = spawnSync(
  process.execPath,
  ["scripts/verify-native-arch.mjs", appDir, targetSpec.runtimeTarget],
  {
    encoding: "utf8",
  },
);
if (native.status !== 0) {
  process.stderr.write(
    native.stderr || native.stdout || "verify-native-arch failed\n",
  );
  process.exit(native.status ?? 1);
}
const zip = targetSpec.zip;
rmSync(zip, { force: true });
execSync(`ditto -c -k --sequesterRsrc "${outRoot}" "${zip}"`);
const sum = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync("dist/SHA256SUMS.txt", `${sum}  ${zip.split("/").pop()}\n`);
console.log(zip, sum);
