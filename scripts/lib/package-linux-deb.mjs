import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { deterministicGzip } from "./deterministic-gzip.mjs";
import { ROOT } from "./repo.mjs";
import { assertUos20OldWorldAddonFiles } from "./uos20-oldworld-addons.mjs";
import { mnemonAssetForPluginTarget } from "../../packages/release-identity/src/mnemon-assets.js";

// Penglai target key is linux-loong64. UOS dpkg Architecture is loongarch64.
// Confirmed client is UOS 20 Professional 1070 / kernel 4.19 (old-world).
// linux-loong64 is a RELEASE_TARGETS row. Native install/startup/function
// remain OWNER_POST_RELEASE. Office+Memory stay required-builtin; chrome-sandbox
// must remain in the payload. ELF payloads must use /lib64/ld.so.1, not
// new-world ld-linux-loongarch-lp64d.so.1. Never --no-sandbox.
export const LINUX_LOONG64_TARGET = "linux-loong64";
export const UOS_DEB_ARCHITECTURE = "loongarch64";
export const UOS_DEB_INSTALLER_NAME = "Penglai_0.6.0_uos_loong64.deb";
export const UOS_DEB_PACKAGE_NAME = "penglai";
export const UOS_DEB_VERSION = "0.6.0";
export const LINUX_INSTALL_PREFIX = "/opt/Penglai";
export const REQUIRED_BUILTIN_PLUGIN_IDS = Object.freeze([
  "@penglai/office",
  "@penglai/memory",
]);

const AR_MAGIC = "!<arch>\n";
const USTAR_BLOCK = 512;

export function uosDebInstallerName() {
  return UOS_DEB_INSTALLER_NAME;
}

export function assertLinuxLoong64PackTarget(target) {
  if (target !== LINUX_LOONG64_TARGET) {
    throw new Error(
      `package-linux-deb refused: target must be linux-loong64, got ${target ?? "missing"}`,
    );
  }
  return LINUX_LOONG64_TARGET;
}

export function parseDebianControl(text) {
  const fields = {};
  let current;
  for (const raw of String(text ?? "").split("\n")) {
    if (raw.startsWith(" ") && current) {
      fields[current] += `\n${raw.slice(1)}`;
      continue;
    }
    const idx = raw.indexOf(":");
    if (idx < 1) continue;
    current = raw.slice(0, idx);
    fields[current] = raw.slice(idx + 1).trim();
  }
  return fields;
}

export function renderDebControl({
  installedSizeKb,
  architecture = UOS_DEB_ARCHITECTURE,
} = {}) {
  if (architecture !== UOS_DEB_ARCHITECTURE) {
    throw new Error(
      `UOS control Architecture must be loongarch64, got ${architecture}`,
    );
  }
  const size =
    Number.isInteger(installedSizeKb) && installedSizeKb >= 0
      ? String(installedSizeKb)
      : "1";
  return [
    `Package: ${UOS_DEB_PACKAGE_NAME}`,
    `Version: ${UOS_DEB_VERSION}`,
    `Architecture: ${UOS_DEB_ARCHITECTURE}`,
    "Section: utils",
    "Priority: optional",
    "Maintainer: Penglai Agent <noreply@users.noreply.github.com>",
    `Installed-Size: ${size}`,
    "Depends: libgtk-3-0, libnss3, libxss1, libasound2, xdg-utils",
    "Homepage: https://github.com/kevinchennewbee/PenglaiAgent",
    `X-Penglai-Target: ${LINUX_LOONG64_TARGET}`,
    "Description: Penglai desktop (linux-loong64 / UOS loongarch64)",
    " Penglai product target key is linux-loong64. This package Architecture",
    " field is loongarch64 for UnionTech UOS metadata. Office and Memory are",
    " required-builtin and must remain in the payload. chrome-sandbox stays",
    " in /opt/Penglai. This artifact class is not native UOS PASS.",
    "",
  ].join("\n");
}

export function renderDesktopFile() {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Penglai",
    "Name[zh_CN]=蓬莱",
    "Comment=Penglai desktop agent",
    "Comment[zh_CN]=蓬莱桌面助手",
    `Exec=${LINUX_INSTALL_PREFIX}/Penglai %U`,
    "Icon=penglai",
    "Terminal=false",
    "Categories=Utility;Office;",
    "StartupWMClass=Penglai",
    `X-Penglai-Target=${LINUX_LOONG64_TARGET}`,
    "",
  ].join("\n");
}

export function renderLauncherScript() {
  return `#!/bin/sh\nexec ${LINUX_INSTALL_PREFIX}/Penglai "$@"\n`;
}

export function renderPostinst() {
  return [
    "#!/bin/sh",
    "set -e",
    `SANDBOX=${LINUX_INSTALL_PREFIX}/chrome-sandbox`,
    'if [ -f "$SANDBOX" ]; then',
    "  chmod 4755 \"$SANDBOX\" || true",
    "fi",
    "command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true",
    "exit 0",
    "",
  ].join("\n");
}

export function renderPostrm() {
  return [
    "#!/bin/sh",
    "set -e",
    "# User data is XDG ~/.local/share/Penglai/0.5 plus cache/state.",
    "# remove/upgrade must not delete it. purge does not rm -rf HOME or Workspaces.",
    "exit 0",
    "",
  ].join("\n");
}

export function assertRequiredBuiltinPlugins(pluginsDir) {
  const catalogPath = join(pluginsDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    throw new Error("linux-loong64 payload missing plugins/catalog.json");
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch {
    throw new Error("linux-loong64 plugin catalog is unreadable");
  }
  if (catalog.target !== LINUX_LOONG64_TARGET) {
    throw new Error(
      `plugin catalog target must be linux-loong64, got ${catalog.target ?? "missing"}`,
    );
  }
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  for (const id of REQUIRED_BUILTIN_PLUGIN_IDS) {
    const entry = entries.find((row) => row?.id === id);
    if (!entry) {
      throw new Error(`linux-loong64 payload missing required-builtin ${id}`);
    }
    if (entry.installClass !== "required-builtin") {
      throw new Error(`${id} must remain required-builtin`);
    }
    if (entry.defaultEnabled !== true) {
      throw new Error(`${id} must stay enabled`);
    }
    if (!entry.packageFile || !existsSync(join(pluginsDir, entry.packageFile))) {
      throw new Error(`${id} package file missing from payload`);
    }
  }
}

export const UOS20_OLD_WORLD_INTERPRETER = "/lib64/ld.so.1";
export const UOS20_NEW_WORLD_INTERPRETER = "/lib64/ld-linux-loongarch-lp64d.so.1";
export const UOS20_NEW_WORLD_LOADER_SONAME = "ld-linux-loongarch-lp64d.so.1";
export const ELF_MACHINE_LOONGARCH = 258;
export const UOS20_FLOCK_SHA256 =
  "b065bcb1945dffa04a075578dff55a50604c3901716912714b81c24757167868";

export function readElfInterpreter(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64) return undefined;
  if (bytes.subarray(0, 4).toString("binary") !== "\u007fELF") return undefined;
  const little = bytes[5] === 1;
  const readU16 = (offset) =>
    little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const readU32 = (offset) =>
    little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const readU64 = (offset) => {
    const value = little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("ELF program header offset exceeds safe integer");
    }
    return Number(value);
  };
  if (bytes[4] !== 2) return undefined;
  const phoff = readU64(32);
  const phentsize = readU16(54);
  const phnum = readU16(56);
  for (let i = 0; i < phnum; i += 1) {
    const off = phoff + i * phentsize;
    if (off + 56 > bytes.length) break;
    const pType = readU32(off);
    if (pType !== 3) continue;
    const pOffset = readU64(off + 8);
    const pFilesz = readU64(off + 32);
    if (pOffset + pFilesz > bytes.length) {
      throw new Error("ELF PT_INTERP escapes the file");
    }
    const raw = bytes.subarray(pOffset, pOffset + pFilesz);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
  }
  return undefined;
}

export function readElfMachine(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20) return undefined;
  if (bytes.subarray(0, 4).toString("binary") !== "\u007fELF") return undefined;
  const little = bytes[5] === 1;
  return little ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
}

export function glibcVersionsNewerThan228(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("latin1") : "";
  const newer = [];
  for (const match of text.matchAll(/GLIBC_(\d+)\.(\d+)/g)) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major > 2 || (major === 2 && minor > 28)) {
      newer.push(`GLIBC_${major}.${minor}`);
    }
  }
  return [...new Set(newer)];
}

export function assertUos20OldWorldElfBytes(bytes, label, { requireInterp = false } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 4).toString("binary") !== "\u007fELF") {
    throw new Error(`${label} must be ELF for UOS 20`);
  }
  const machine = readElfMachine(bytes);
  if (machine !== ELF_MACHINE_LOONGARCH) {
    throw new Error(`${label} ELF machine ${machine ?? "missing"} is not LoongArch`);
  }
  const interpreter = readElfInterpreter(bytes);
  if (
    interpreter === UOS20_NEW_WORLD_INTERPRETER ||
    bytes.includes(Buffer.from(UOS20_NEW_WORLD_INTERPRETER)) ||
    bytes.includes(Buffer.from(UOS20_NEW_WORLD_LOADER_SONAME))
  ) {
    throw new Error(`${label} is new-world; UOS 20 requires old-world ${UOS20_OLD_WORLD_INTERPRETER}`);
  }
  if (requireInterp) {
    if (interpreter !== UOS20_OLD_WORLD_INTERPRETER) {
      throw new Error(
        `${label} dynamic loader ${interpreter ?? "missing"} is not the UOS 20 old-world interpreter ${UOS20_OLD_WORLD_INTERPRETER}`,
      );
    }
  } else if (interpreter && interpreter !== UOS20_OLD_WORLD_INTERPRETER) {
    throw new Error(`${label} dynamic loader ${interpreter} is not UOS 20 old-world`);
  }
  const newer = glibcVersionsNewerThan228(bytes);
  if (newer.length) {
    throw new Error(`${label} needs ${newer.join(", ")}; UOS 20 glibc is 2.28`);
  }
  return interpreter;
}

export function assertUos20OldWorldElf(path, label = path, opts = {}) {
  return assertUos20OldWorldElfBytes(readFileSync(path), label, opts);
}

export function assertSandboxNotStripped(payloadRoot) {
  const sandbox = join(payloadRoot, "chrome-sandbox");
  if (!existsSync(sandbox) || !lstatSync(sandbox).isFile()) {
    throw new Error(
      "linux-loong64 payload missing chrome-sandbox; sandbox must not be stripped",
    );
  }
  assertUos20OldWorldBinary(sandbox, "chrome-sandbox");
}

export function assertUos20OldWorldBinary(path, label = path) {
  const bytes = readFileSync(path);
  const interpreter = readElfInterpreter(bytes);
  if (interpreter === undefined) return undefined;
  if (interpreter === UOS20_NEW_WORLD_INTERPRETER) {
    throw new Error(
      `${label} is new-world (${interpreter}); UOS 20 / kernel 4.19 requires old-world ${UOS20_OLD_WORLD_INTERPRETER}`,
    );
  }
  if (interpreter !== UOS20_OLD_WORLD_INTERPRETER) {
    throw new Error(
      `${label} dynamic loader ${interpreter} is not the UOS 20 old-world interpreter ${UOS20_OLD_WORLD_INTERPRETER}`,
    );
  }
  return interpreter;
}

function writeLinuxInstallerEvidence({ digest, bytes }) {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  mkdirSync(join(ROOT, "evidence", "generated"), { recursive: true });
  writeFileSync(
    join(ROOT, "evidence", "generated", "local-installer-linux-loong64.json"),
    `${JSON.stringify(
      {
        target: LINUX_LOONG64_TARGET,
        installer: UOS_DEB_INSTALLER_NAME,
        sourceSha,
        sha256: digest,
        bytes,
        treeDirty: dirty.length > 0,
        native: false,
        ownerPostRelease: true,
      },
      null,
      2,
    )}\n`,
  );
}

export function overlayDesktopBundle(
  payloadRoot,
  bundleDir = join(ROOT, "dist", "desktop-bundle"),
) {
  const dest = join(payloadRoot, "resources", "app");
  const main = join(bundleDir, "electron-main.js");
  let fd;
  try {
    fd = openSync(main, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) {
      throw new Error(
        "linux-loong64 packager refused: rebuilt dist/desktop-bundle/electron-main.js missing",
      );
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        "linux-loong64 packager refused: rebuilt dist/desktop-bundle/electron-main.js missing",
      );
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  mkdirSync(dest, { recursive: true });
  cpSync(bundleDir, dest, { recursive: true });
}

export function assertPackagedDesktopSkip(payloadRoot) {
  const main = join(payloadRoot, "resources", "app", "electron-main.js");
  let fd;
  try {
    fd = openSync(main, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) {
      throw new Error("linux-loong64 payload missing resources/app/electron-main.js");
    }
    const text = readFileSync(fd, "utf8");
    if (
      !text.includes(".dsh-module-fallback") ||
      !text.includes('startsWith("profiles/node_modules/")')
    ) {
      throw new Error(
        "linux-loong64 payload electron-main.js is missing the rebuilt DSH home skip",
      );
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("linux-loong64 payload missing resources/app/electron-main.js");
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function assertPenglaiBinary(payloadRoot) {
  const binary = join(payloadRoot, "Penglai");
  if (!existsSync(binary) || !lstatSync(binary).isFile()) {
    throw new Error("linux-loong64 payload missing Penglai executable");
  }
  assertUos20OldWorldBinary(binary, "Penglai executable");
}

const FLOCK_ADDON_REL = join(
  "resources",
  "runtime",
  "dsh",
  "node_modules",
  "@deepseek-ai",
  "node-addon-system-linux-loong64",
  "bin",
  "glibc",
  "system.node",
);

function walkPayloadFiles(root, rel = "") {
  const files = [];
  for (const name of readdirSync(root).sort()) {
    const absolute = join(root, name);
    const nextRel = rel ? `${rel}/${name}` : name;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`linux-loong64 payload must not contain symlinks: ${nextRel}`);
    }
    if (stat.isDirectory()) {
      files.push(...walkPayloadFiles(absolute, nextRel));
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`unsupported payload entry ${nextRel}`);
    }
    files.push({ absolute, rel: nextRel });
  }
  return files;
}

export function assertUosRuntimeClosure(payloadRoot) {
  const nodeBin = join(payloadRoot, "resources", "runtime", "node", "bin", "node");
  if (!existsSync(nodeBin) || !lstatSync(nodeBin).isFile()) {
    throw new Error(
      "linux-loong64 payload missing old-world Node at resources/runtime/node/bin/node; package is not complete",
    );
  }
  assertUos20OldWorldElf(nodeBin, "embedded Node", { requireInterp: true });
  const dshBin = join(payloadRoot, "resources", "runtime", "dsh", "lib", "bin.js");
  if (!existsSync(dshBin) || !lstatSync(dshBin).isFile()) {
    throw new Error(
      "linux-loong64 payload missing pinned DSH CLI at resources/runtime/dsh/lib/bin.js; package is not complete",
    );
  }
  const flock = join(payloadRoot, FLOCK_ADDON_REL);
  let flockFd;
  try {
    flockFd = openSync(flock, "r");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        "linux-loong64 payload missing glibc flock addon node-addon-system-linux-loong64/bin/glibc/system.node; package is not complete",
      );
    }
    throw error;
  }
  try {
    if (!fstatSync(flockFd).isFile()) {
      throw new Error(
        "linux-loong64 flock addon is not a regular file; package is not complete",
      );
    }
    const flockBytes = readFileSync(flockFd);
    assertUos20OldWorldElfBytes(flockBytes, "linux-loong64 flock addon");
    const flockSha = createHash("sha256").update(flockBytes).digest("hex");
    if (flockSha !== UOS20_FLOCK_SHA256) {
      throw new Error(
        `linux-loong64 flock addon digest ${flockSha} is not the pinned old-world build ${UOS20_FLOCK_SHA256}`,
      );
    }
  } finally {
    closeSync(flockFd);
  }
  assertUos20OldWorldAddonFiles(
    join(payloadRoot, "resources", "runtime", "dsh", "node_modules"),
  );
  const mnemonPin = mnemonAssetForPluginTarget(LINUX_LOONG64_TARGET);
  if (!mnemonPin) {
    throw new Error("linux-loong64 payload missing pinned Mnemon identity");
  }
  const mnemonPath = join(
    payloadRoot,
    "resources",
    "mnemon",
    mnemonPin.binaryFilename,
  );
  let mnemonFd;
  try {
    mnemonFd = openSync(mnemonPath, "r");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        "linux-loong64 payload missing required Memory engine at resources/mnemon/mnemon",
      );
    }
    throw error;
  }
  try {
    if (!fstatSync(mnemonFd).isFile()) {
      throw new Error(
        "linux-loong64 Mnemon engine is not a regular file; package is not complete",
      );
    }
    const mnemonBytes = readFileSync(mnemonFd);
    const mnemonSha = createHash("sha256").update(mnemonBytes).digest("hex");
    if (mnemonSha !== mnemonPin.binarySha256) {
      throw new Error(
        `linux-loong64 Mnemon digest ${mnemonSha} is not the pinned architecture build ${mnemonPin.binarySha256}`,
      );
    }
    assertUos20OldWorldElfBytes(mnemonBytes, "linux-loong64 Mnemon engine");
  } finally {
    closeSync(mnemonFd);
  }
  for (const file of walkPayloadFiles(payloadRoot)) {
    if (file.rel.includes("darwin-arm64") || file.rel.includes("darwin-x64") || file.rel.endsWith(".dylib")) {
      throw new Error(`linux-loong64 payload contains darwin binary ${file.rel}`);
    }
    if (!file.rel.endsWith(".node") && !file.rel.endsWith(".so") && basename(file.rel) !== "node") {
      continue;
    }
    const bytes = readFileSync(file.absolute);
    if (bytes.subarray(0, 4).toString("binary") !== "\u007fELF") continue;
    assertUos20OldWorldElf(file.absolute, file.rel, { requireInterp: basename(file.rel) === "node" });
  }
}

function putOctal(header, offset, length, value) {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function splitUstarName(path) {
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes === 0) throw new Error("tar path must not be empty");
  if (bytes <= 100) return { name: path, prefix: "" };
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const name = parts.slice(i).join("/");
    if (
      Buffer.byteLength(prefix, "utf8") <= 155 &&
      Buffer.byteLength(name, "utf8") <= 100 &&
      name.length > 0
    ) {
      return { name, prefix };
    }
  }
  throw new Error(`tar path exceeds ustar name/prefix: ${path}`);
}

function tarHeader(path, size, type, mode) {
  const { name, prefix } = splitUstarName(path);
  const header = Buffer.alloc(USTAR_BLOCK);
  header.write(name, 0, 100, "utf8");
  putOctal(header, 100, 8, mode & 0o7777);
  putOctal(header, 108, 8, 0);
  putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, size);
  putOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (prefix) header.write(prefix, 345, 155, "utf8");
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function tarPadding(size) {
  return Buffer.alloc((USTAR_BLOCK - (size % USTAR_BLOCK)) % USTAR_BLOCK);
}

function buildUstar(entries) {
  const chunks = [];
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const type = entry.type ?? "0";
    const data = entry.data ?? Buffer.alloc(0);
    const mode = entry.mode ?? (type === "5" ? 0o755 : 0o644);
    chunks.push(tarHeader(entry.path, data.length, type, mode));
    if (data.length) chunks.push(data, tarPadding(data.length));
  }
  chunks.push(Buffer.alloc(USTAR_BLOCK * 2));
  return Buffer.concat(chunks);
}

function arHeader(name, size, mode = 0o100644) {
  const header = Buffer.alloc(60, 0x20);
  const filename = name.endsWith("/") ? name : `${name}/`;
  if (Buffer.byteLength(filename, "ascii") > 16) {
    throw new Error(`ar member name too long: ${name}`);
  }
  header.write(filename, 0, 16, "ascii");
  header.write("0", 16, 12, "ascii");
  header.write("0", 28, 6, "ascii");
  header.write("0", 34, 6, "ascii");
  header.write(mode.toString(8), 40, 8, "ascii");
  header.write(String(size), 48, 10, "ascii");
  header.write("`\n", 58, 2, "ascii");
  return header;
}

export function buildDebArchive({ debianBinary, controlTarGz, dataTarGz }) {
  const members = [
    { name: "debian-binary", data: debianBinary, mode: 0o100644 },
    { name: "control.tar.gz", data: controlTarGz, mode: 0o100644 },
    { name: "data.tar.gz", data: dataTarGz, mode: 0o100644 },
  ];
  const chunks = [Buffer.from(AR_MAGIC, "ascii")];
  for (const member of members) {
    chunks.push(arHeader(member.name, member.data.length, member.mode));
    chunks.push(member.data);
    if (member.data.length % 2 === 1) chunks.push(Buffer.from("\n", "ascii"));
  }
  return Buffer.concat(chunks);
}

export function parseArMembers(bytes) {
  if (bytes.subarray(0, 8).toString("ascii") !== AR_MAGIC) {
    throw new Error("not a debian ar archive");
  }
  const members = [];
  let offset = 8;
  while (offset + 60 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 60);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 16).toString("ascii").trim().replace(/\/$/, "");
    if (!name) break;
    const size = Number.parseInt(header.subarray(48, 58).toString("ascii").trim(), 10);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`invalid ar member ${name}`);
    }
    offset += 60;
    members.push({ name, data: Buffer.from(bytes.subarray(offset, offset + size)) });
    offset += size;
    if (size % 2 === 1) offset += 1;
  }
  return members;
}

export function parseUstarFiles(tarBytes) {
  const files = new Map();
  let offset = 0;
  while (offset + USTAR_BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + USTAR_BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0+$/u, "");
    const type = String.fromCharCode(header[156] || 48);
    const sizeField = header.subarray(124, 136).toString("ascii").replace(/\0/g, "").trim();
    const size = Number.parseInt(sizeField, 8);
    const path = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//u, "");
    offset += USTAR_BLOCK;
    const data = tarBytes.subarray(offset, offset + size);
    if (type === "0" || type === "\0") files.set(path, Buffer.from(data));
    offset += Math.ceil(size / USTAR_BLOCK) * USTAR_BLOCK;
  }
  return files;
}

export function parseDebControl(debBytes) {
  const members = parseArMembers(debBytes);
  const controlMember = members.find((row) => row.name.startsWith("control.tar"));
  if (!controlMember) throw new Error("deb missing control.tar.gz");
  const files = parseUstarFiles(gunzipSync(controlMember.data));
  const control = files.get("control") ?? files.get("./control");
  if (!control) throw new Error("control.tar missing control");
  return parseDebianControl(control.toString("utf8"));
}

export function parseDebDataFiles(debBytes) {
  const members = parseArMembers(debBytes);
  const dataMember = members.find((row) => row.name.startsWith("data.tar"));
  if (!dataMember) throw new Error("deb missing data.tar.gz");
  return parseUstarFiles(gunzipSync(dataMember.data));
}

function walkRegularFiles(root) {
  const files = [];
  const visit = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name);
      const nextRel = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`linux-loong64 payload must not contain symlinks: ${nextRel}`);
      }
      if (stat.isDirectory()) {
        visit(absolute, nextRel);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`unsupported payload entry ${nextRel}`);
      }
      files.push({ absolute, rel: nextRel, mode: stat.mode });
    }
  };
  visit(root, "");
  return files;
}

function directoryEntriesFor(paths) {
  const dirs = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return [...dirs].sort();
}

function payloadFileMode(rel, mode) {
  const base = basename(rel);
  if (base === "chrome-sandbox") return 0o4755;
  if (base === "Penglai" || base === "penglai" || base === "chrome_crashpad_handler") {
    return 0o755;
  }
  return mode & 0o777;
}

function writeFileMode(path, contents, mode) {
  writeFileSync(path, contents, { mode: mode & 0o777 });
  chmodSync(path, mode & 0o777);
}

function md5Hex(bytes) {
  return createHash("md5").update(bytes).digest("hex");
}

function stageDebTree({ payloadRoot, stageRoot, iconPath }) {
  const dataRoot = join(stageRoot, "data");
  const optRoot = join(dataRoot, "opt", "Penglai");
  mkdirSync(optRoot, { recursive: true });
  cpSync(payloadRoot, optRoot, { recursive: true, dereference: false });
  const desktopDir = join(dataRoot, "usr", "share", "applications");
  const iconDir = join(dataRoot, "usr", "share", "icons", "hicolor", "256x256", "apps");
  const binDir = join(dataRoot, "usr", "bin");
  mkdirSync(desktopDir, { recursive: true });
  mkdirSync(iconDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileMode(join(desktopDir, "penglai.desktop"), renderDesktopFile(), 0o644);
  writeFileMode(join(binDir, "penglai"), renderLauncherScript(), 0o755);
  if (!iconPath || !existsSync(iconPath)) {
    throw new Error("linux-loong64 packager missing PNG icon");
  }
  cpSync(iconPath, join(iconDir, "penglai.png"));
  cpSync(iconPath, join(optRoot, "penglai.png"));
  return dataRoot;
}

function buildDataTarGz(dataRoot) {
  const files = walkRegularFiles(dataRoot);
  const tarPaths = files.map((file) => file.rel);
  const entries = [
    ...directoryEntriesFor(tarPaths).map((path) => ({
      path,
      type: "5",
      mode: 0o755,
      data: Buffer.alloc(0),
    })),
    ...files.map((file) => ({
      path: file.rel,
      type: "0",
      mode: payloadFileMode(file.rel, file.mode),
      data: readFileSync(file.absolute),
    })),
  ];
  const tar = buildUstar(entries);
  const md5sums = files
    .map((file) => `${md5Hex(readFileSync(file.absolute))}  ${file.rel}`)
    .join("\n")
    .concat("\n");
  const installedSizeKb = Math.max(
    1,
    Math.ceil(files.reduce((sum, file) => sum + lstatSync(file.absolute).size, 0) / 1024),
  );
  return { dataTarGz: deterministicGzip(tar), md5sums, installedSizeKb };
}

function buildControlTarGz({ installedSizeKb, md5sums }) {
  const control = renderDebControl({ installedSizeKb });
  const parsed = parseDebianControl(control);
  if (parsed.Architecture !== UOS_DEB_ARCHITECTURE) {
    throw new Error("control Architecture field escaped loongarch64");
  }
  const entries = [
    { path: "control", type: "0", mode: 0o644, data: Buffer.from(control, "utf8") },
    { path: "md5sums", type: "0", mode: 0o644, data: Buffer.from(md5sums, "utf8") },
    { path: "postinst", type: "0", mode: 0o755, data: Buffer.from(renderPostinst(), "utf8") },
    { path: "postrm", type: "0", mode: 0o755, data: Buffer.from(renderPostrm(), "utf8") },
  ];
  return deterministicGzip(buildUstar(entries));
}

export function packageLinuxDeb({
  target,
  payloadRoot,
  outDir,
  iconPath,
  requireRuntimeClosure = true,
} = {}) {
  assertLinuxLoong64PackTarget(target);
  if (!payloadRoot || !existsSync(payloadRoot)) {
    throw new Error("linux-loong64 payload root missing");
  }
  if (!outDir) throw new Error("linux-loong64 packager outDir missing");
  assertPenglaiBinary(payloadRoot);
  assertSandboxNotStripped(payloadRoot);
  assertRequiredBuiltinPlugins(join(payloadRoot, "resources", "plugins"));
  if (requireRuntimeClosure) assertUosRuntimeClosure(payloadRoot);
  mkdirSync(outDir, { recursive: true });
  // Exclusive stage next to the installer output. The shared OS temp directory
  // is world-writable and is not a legal place to assemble a release payload.
  const stageRoot = mkdtempSync(join(outDir, ".penglai-deb-stage-"));
  try {
    const dataRoot = stageDebTree({ payloadRoot, stageRoot, iconPath });
    const optRoot = join(dataRoot, "opt", "Penglai");
    if (requireRuntimeClosure) {
      overlayDesktopBundle(optRoot);
      assertPackagedDesktopSkip(optRoot);
    }
    const { dataTarGz, md5sums, installedSizeKb } = buildDataTarGz(dataRoot);
    const controlTarGz = buildControlTarGz({ installedSizeKb, md5sums });
    const deb = buildDebArchive({
      debianBinary: Buffer.from("2.0\n", "ascii"),
      controlTarGz,
      dataTarGz,
    });
    const outPath = join(outDir, UOS_DEB_INSTALLER_NAME);
    writeFileSync(outPath, deb);
    const digest = createHash("sha256").update(deb).digest("hex");
    if (!process.env.NODE_TEST_CONTEXT) writeLinuxInstallerEvidence({ digest, bytes: deb.length });
    return {
      target: LINUX_LOONG64_TARGET,
      architecture: UOS_DEB_ARCHITECTURE,
      installerName: UOS_DEB_INSTALLER_NAME,
      outPath,
      bytes: deb.length,
      sha256: digest,
      native: false,
    };
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}
