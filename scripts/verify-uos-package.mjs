#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { finish } from "./lib/exit-contract.mjs";
import {
  LINUX_LOONG64_TARGET,
  UOS_DEB_INSTALLER_NAME,
  assertUos20OldWorldElfBytes,
  parseDebControl,
  parseDebDataFiles,
} from "./lib/package-linux-deb.mjs";
import {
  PINNED_DSH,
  PINNED_NODE_LINUX_LOONG64,
  PRODUCT_VERSION,
} from "./lib/product.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { ROOT } from "./lib/repo.mjs";
import { mnemonAssetForPluginTarget } from "../packages/release-identity/src/mnemon-assets.js";

const command = "verify:uos-package";
const target = LINUX_LOONG64_TARGET;
const source = requireCleanCandidateSource();

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(reason, details = {}) {
  finish("FAIL", {
    command,
    target,
    sourceSha: source.git.head,
    reason,
    ...details,
  });
}

if (!source.ok) {
  finish("STALE", { command, target, reason: source.reason, ...source.git });
}

const installerPath = join(ROOT, "dist", UOS_DEB_INSTALLER_NAME);
const installerEvidencePath = join(
  ROOT,
  "evidence",
  "generated",
  "local-installer-linux-loong64.json",
);
if (!existsSync(installerPath) || !existsSync(installerEvidencePath)) {
  finish("INCOMPLETE", {
    command,
    target,
    sourceSha: source.git.head,
    reason: "exact UOS installer and its local packaging evidence are required",
  });
}

const installerBytes = readFileSync(installerPath);
const installerSha256 = sha256(installerBytes);
const installerEvidence = JSON.parse(readFileSync(installerEvidencePath, "utf8"));
if (
  installerEvidence.target !== target ||
  installerEvidence.installer !== UOS_DEB_INSTALLER_NAME ||
  installerEvidence.sourceSha !== source.git.head ||
  installerEvidence.sha256 !== installerSha256 ||
  installerEvidence.bytes !== installerBytes.length ||
  installerEvidence.treeDirty !== false ||
  installerEvidence.native !== false ||
  installerEvidence.ownerPostRelease !== true
) {
  fail("UOS installer evidence is stale or overclaims native acceptance");
}

let control;
let files;
try {
  control = parseDebControl(installerBytes);
  files = parseDebDataFiles(installerBytes);
} catch (error) {
  fail("UOS Debian archive is unreadable", {
    error: error instanceof Error ? error.message : String(error),
  });
}

if (
  control.Package !== "penglai" ||
  control.Version !== PRODUCT_VERSION ||
  control.Architecture !== "loongarch64" ||
  control["X-Penglai-Target"] !== target ||
  !String(control.Depends ?? "").split(/,\s*/u).includes("libatomic1") ||
  control.Recommends !== "bubblewrap"
) {
  fail("UOS Debian control metadata does not match the release contract", { control });
}

const prefix = "opt/Penglai/";
const get = (relative) => files.get(`${prefix}${relative}`);
const parseJson = (relative, label) => {
  const bytes = get(relative);
  if (!bytes) fail(`UOS installer is missing ${label}`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`UOS installer ${label} is unreadable`);
  }
};

const releaseInfo = parseJson("resources/release-info.json", "release-info.json");
const runtimeManifestBytes = get("resources/runtime-manifest.json");
if (!runtimeManifestBytes) fail("UOS installer is missing runtime-manifest.json");
const runtimeManifest = JSON.parse(runtimeManifestBytes.toString("utf8"));
const closure = parseJson("resources/closure-credential.json", "closure credential");
const contract = JSON.parse(readFileSync(join(ROOT, "release-contract.json"), "utf8"));
const runtimeInputs = contract.runtimeInputs.filter((row) => row.target === target);
const nodeInput = runtimeInputs.find((row) => row.kind === "node");
const electronInput = runtimeInputs.find((row) => row.kind === "electron");
const electronVersion = String(electronInput?.filename ?? "").match(/^electron-v([^/]+)-linux-loong64\.zip$/u)?.[1];
if (
  !nodeInput ||
  !electronVersion ||
  releaseInfo.productName !== "Penglai" ||
  releaseInfo.productVersion !== PRODUCT_VERSION ||
  releaseInfo.target !== target ||
  releaseInfo.dsh !== PINNED_DSH ||
  releaseInfo.node !== PINNED_NODE_LINUX_LOONG64 ||
  releaseInfo.electron !== electronVersion ||
  releaseInfo.sourceSha !== source.git.head ||
  releaseInfo.native !== false ||
  releaseInfo.ownerPostRelease !== true ||
  runtimeManifest.release !== PRODUCT_VERSION ||
  runtimeManifest.target !== target ||
  runtimeManifest.dsh !== PINNED_DSH ||
  runtimeManifest.node !== PINNED_NODE_LINUX_LOONG64 ||
  runtimeManifest.electron !== electronVersion ||
  closure.sourceSha !== source.git.head ||
  closure.target !== target ||
  closure.dsh !== PINNED_DSH ||
  closure.node !== PINNED_NODE_LINUX_LOONG64 ||
  closure.manifestSha256 !== sha256(runtimeManifestBytes)
) {
  fail("embedded UOS release, runtime, or closure identity drifted");
}

const manifestRows = Array.isArray(runtimeManifest.files) ? runtimeManifest.files : [];
if (!manifestRows.length) fail("UOS runtime manifest has no files");
const manifestByPath = new Map();
for (const row of manifestRows) {
  if (
    !row ||
    typeof row.path !== "string" ||
    row.path.startsWith("/") ||
    row.path.split("/").includes("..") ||
    !/^[0-9a-f]{64}$/u.test(String(row.sha256 ?? "")) ||
    !Number.isSafeInteger(row.size) ||
    row.size < 0
  ) {
    fail("UOS runtime manifest contains an unsafe row");
  }
  const bytes = get(`resources/${row.path}`);
  if (!bytes || bytes.length !== row.size || sha256(bytes) !== row.sha256) {
    fail("UOS runtime manifest does not bind every packaged byte", { relative: row.path });
  }
  if (manifestByPath.has(row.path)) {
    fail("UOS runtime manifest contains a duplicate path", { relative: row.path });
  }
  manifestByPath.set(row.path, row);
}

for (const [relative, label] of [
  ["Penglai", "Electron application executable"],
  ["resources/app/package.json", "desktop bundle manifest"],
  ["resources/app/electron-main.js", "desktop main process"],
  ["resources/app/preload-bridge.cjs", "desktop preload bridge"],
  ["resources/runtime/node/bin/node", "embedded Node runtime"],
  ["resources/runtime/dsh/lib/bin.js", "official DSH CLI"],
  ["resources/profile-seed/web/package.json", "official DSH profile"],
  ["resources/mnemon/mnemon", "Mnemon Memory engine"],
]) {
  if (!get(relative)) fail(`UOS installer is missing ${label}`);
}
for (const [path, label] of [
  ["usr/share/applications/penglai.desktop", "desktop launcher"],
  ["usr/bin/penglai", "command launcher"],
]) {
  if (!files.get(path)) fail(`UOS installer is missing ${label}`);
}
for (const relative of [
  "runtime/node/bin/node",
  "runtime/dsh/lib/bin.js",
  "profile-seed/web/package.json",
  "mnemon/mnemon",
]) {
  if (!manifestByPath.has(relative)) {
    fail("UOS runtime manifest does not bind a required runtime component", { relative });
  }
}

const profile = JSON.parse(readFileSync(join(ROOT, "profile-seed", "web", "package.json"), "utf8"));
const expectedPluginIds = Object.keys(profile.dependencies ?? {})
  .filter((id) => id.startsWith("@penglai/"))
  .sort();
const catalog = parseJson("resources/plugins/catalog.json", "first-party plugin catalog");
const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
const actualPluginIds = entries.map((row) => row?.id).sort();
if (
  catalog.schema !== 3 ||
  catalog.target !== target ||
  JSON.stringify(actualPluginIds) !== JSON.stringify(expectedPluginIds)
) {
  fail("UOS installer does not contain the exact first-party plugin set", {
    expectedPluginIds,
    actualPluginIds,
  });
}
for (const entry of entries) {
  if (
    entry.target !== target ||
    entry.version !== PRODUCT_VERSION ||
    entry.dsh?.exact !== PINNED_DSH ||
    typeof entry.packageFile !== "string" ||
    !/^[A-Za-z0-9._-]+\.tgz$/u.test(entry.packageFile) ||
    !/^[0-9a-f]{64}$/u.test(String(entry.sha256 ?? ""))
  ) {
    fail("UOS first-party plugin identity drifted", { pluginId: entry?.id });
  }
  const bytes = get(`resources/plugins/${entry.packageFile}`);
  if (!bytes || sha256(bytes) !== entry.sha256) {
    fail("UOS first-party plugin package digest mismatch", { pluginId: entry.id });
  }
  if (!manifestByPath.has(`plugins/${entry.packageFile}`)) {
    fail("UOS runtime manifest does not bind a first-party plugin", { pluginId: entry.id });
  }
}
for (const id of ["@penglai/office", "@penglai/memory"]) {
  const entry = entries.find((row) => row.id === id);
  if (entry?.installClass !== "required-builtin" || entry.defaultEnabled !== true) {
    fail(`${id} is not required and enabled in the UOS installer`);
  }
}
const moss = entries.find((row) => row.id === "@penglai/moss-tts");
if (!moss || moss.defaultEnabled !== false) {
  fail("MOSS must remain optional and disabled on UOS LoongArch");
}

const mnemonPin = mnemonAssetForPluginTarget(target);
const mnemonBytes = get("resources/mnemon/mnemon");
if (!mnemonPin || !mnemonBytes || sha256(mnemonBytes) !== mnemonPin.binarySha256) {
  fail("UOS installer does not contain the pinned LoongArch Mnemon engine");
}

const forbiddenPath = /(?:^|\/)(?:darwin-(?:arm64|x64)|win32-x64)(?:\/|$)|\.dylib$|\.exe$|\.dll$/iu;
let elfCount = 0;
for (const [path, bytes] of files) {
  if (!path.startsWith(prefix)) continue;
  if (forbiddenPath.test(path)) fail("UOS installer contains a foreign-architecture path", { relative: path });
  if (bytes.subarray(0, 4).toString("binary") !== "\u007fELF") continue;
  const requireInterp = path === `${prefix}Penglai` || path.endsWith("/runtime/node/bin/node");
  try {
    assertUos20OldWorldElfBytes(bytes, path.slice(prefix.length), { requireInterp });
  } catch (error) {
    fail("UOS installer contains an incompatible ELF", {
      relative: path.slice(prefix.length),
      error: error instanceof Error ? error.message : String(error),
    });
  }
  elfCount += 1;
}
if (elfCount < 3) fail("UOS installer contains too few verified LoongArch ELF files", { elfCount });

finish("PASS", {
  command,
  target,
  sourceSha: source.git.head,
  installer: UOS_DEB_INSTALLER_NAME,
  installerSha256,
  bytes: installerBytes.length,
  architecture: "loongarch64",
  abi: "UOS 20 old-world; glibc <= 2.28",
  dependencies: { required: ["libatomic1"], recommended: ["bubblewrap"] },
  runtime: {
    electron: electronVersion,
    node: PINNED_NODE_LINUX_LOONG64,
    dsh: PINNED_DSH,
    manifestFiles: manifestRows.length,
    verifiedElfFiles: elfCount,
  },
  plugins: {
    exactFirstPartyIds: expectedPluginIds,
    requiredBuiltin: ["@penglai/office", "@penglai/memory"],
    mnemonBundled: true,
    mossLoongArchAvailable: false,
  },
  nativeUos: {
    status: "OWNER_POST_RELEASE",
    claimedPass: false,
    pending: ["install", "startup", "ui", "file-picker", "sleep-resume", "function"],
  },
});
