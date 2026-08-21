#!/usr/bin/env node
// Walk a packaged app and refuse the wrong Mach-O / PE machine.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.argv[2];
const target = process.argv[3];
if (!root || !target) {
  console.error("verify-native-arch <app-root> <darwin-aarch64|darwin-x86_64|win32-x86_64>");
  process.exit(2);
}
if (!existsSync(root)) {
  console.error("verify-native-arch BLOCKED: app root missing", root);
  process.exit(4);
}

const MACHO_64 = 0xfeedfacf;
const MACHO_64_SWAPPED = 0xcffaedfe;
const FAT = 0xcafebabe;
const FAT_64 = 0xcafebabf;
const CPU_ARM64 = 0x0100000c;
const CPU_X86_64 = 0x01000007;
const PE_AMD64 = 0x8664;

function u32(buf, off, le = false) {
  return le ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function inspectMachO(buf) {
  if (buf.length < 8) return undefined;
  const magic = u32(buf, 0);
  if (magic === MACHO_64) return { arch: u32(buf, 4) === CPU_ARM64 ? "arm64" : u32(buf, 4) === CPU_X86_64 ? "x86_64" : "other" };
  if (magic === MACHO_64_SWAPPED) {
    const cpu = buf.readUInt32LE(4);
    return { arch: cpu === CPU_ARM64 ? "arm64" : cpu === CPU_X86_64 ? "x86_64" : "other" };
  }
  if (magic === FAT || magic === FAT_64) return { arch: "fat" };
  return undefined;
}

function inspectPe(buf) {
  if (buf.length < 64 || buf[0] !== 0x4d || buf[1] !== 0x5a) return undefined;
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 6 > buf.length) return undefined;
  if (buf.toString("ascii", peOff, peOff + 4) !== "PE\0\0") return undefined;
  const machine = buf.readUInt16LE(peOff + 4);
  return { arch: machine === PE_AMD64 ? "x86_64" : `pe-${machine.toString(16)}` };
}

const expected =
  target === "darwin-aarch64" ? "arm64" : target === "darwin-x86_64" ? "x86_64" : target === "win32-x86_64" ? "x86_64" : undefined;
if (!expected) {
  console.error("verify-native-arch FAIL: unsupported target", target);
  process.exit(1);
}

const files = walk(root);
const hits = [];
for (const path of files) {
  const ext = extname(path).toLowerCase();
  const base = path.split("/").at(-1) ?? "";
  const interesting =
    ext === ".dylib" ||
    ext === ".so" ||
    ext === ".node" ||
    ext === ".exe" ||
    ext === ".dll" ||
    base === "Penglai" ||
    base === "Electron" ||
    base === "electron" ||
    base.endsWith(" Helper") ||
    path.includes("Frameworks") && !ext;
  if (!interesting) continue;
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    continue;
  }
  const macho = inspectMachO(buf);
  const pe = inspectPe(buf);
  const found = macho ?? pe;
  if (!found) continue;
  hits.push({ path, arch: found.arch });
  if (found.arch !== expected && found.arch !== "fat") {
    console.error("verify-native-arch FAIL:", path, "arch", found.arch, "expected", expected);
    process.exit(1);
  }
}

if (!hits.length) {
  console.error("verify-native-arch BLOCKED: no native binaries found under", root);
  process.exit(4);
}
console.log(JSON.stringify({ verdict: "PASS", target, files: hits.length }));
