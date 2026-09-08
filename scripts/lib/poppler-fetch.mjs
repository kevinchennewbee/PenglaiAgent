import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { inflateRawSync, zstdDecompressSync } from "node:zlib";
import { ROOT } from "./repo.mjs";
import {
  POPPLER_ASSETS,
  POPPLER_UPSTREAM,
  popplerAllCondaPackages,
  popplerAssetForHost,
  popplerAssetForTarget,
} from "./poppler-assets.mjs";

const HOST_ALLOW = new Set(POPPLER_UPSTREAM.hostAllowlist);
const TRANSIENT_DOWNLOAD_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const OUT = join(ROOT, "third_party", "poppler");
const CACHE = join(OUT, "cache");
const LICENSE_DIR = join(OUT);
const POPPLER_DATA_LICENSE_DIR = join(OUT, "poppler-data");

const WINDOWS_SYSTEM = new Set(
  [
    "kernel32.dll",
    "shell32.dll",
    "advapi32.dll",
    "user32.dll",
    "gdi32.dll",
    "ole32.dll",
    "oleaut32.dll",
    "rpcrt4.dll",
    "ntdll.dll",
    "ws2_32.dll",
    "crypt32.dll",
    "secur32.dll",
    "bcrypt.dll",
    "bcryptprimitives.dll",
    "iphlpapi.dll",
    "wldap32.dll",
    "nsi.dll",
    "normaliz.dll",
    "shlwapi.dll",
    "comdlg32.dll",
    "winhttp.dll",
    "schannel.dll",
    "cryptbase.dll",
    "ncrypt.dll",
    "sechost.dll",
    "combbase.dll",
    "combase.dll",
    "winmm.dll",
    "dbghelp.dll",
  ].map((n) => n.toLowerCase()),
);

export function parseFetchArgs(argv) {
  const unknown = [];
  let hostOnly = false;
  let all = false;
  let target;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host-only") hostOnly = true;
    else if (arg === "--all") all = true;
    else if (arg === "--target") {
      target = argv[i + 1];
      i += 1;
      if (!target) unknown.push("--target");
    } else unknown.push(arg);
  }
  if (unknown.length) {
    const err = new Error(`unknown fetch-poppler argument: ${unknown.join(" ")}`);
    err.code = "UNKNOWN_ARG";
    throw err;
  }
  return { hostOnly, all, target };
}

export function hostTarget(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return "darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "darwin-x86_64";
  if (platform === "win32") return "win32-x86_64";
  return undefined;
}

export function selectAssets(parsed, platform = process.platform, arch = process.arch) {
  if (parsed.target) {
    const asset = popplerAssetForTarget(parsed.target);
    if (!asset) throw new Error(`unknown poppler target ${parsed.target}`);
    return [asset];
  }
  if (parsed.hostOnly || (!parsed.all && !parsed.target)) {
    const t = hostTarget(platform, arch);
    const asset = t ? popplerAssetForTarget(t) : undefined;
    if (!asset) throw new Error("host poppler target unsupported");
    return [asset];
  }
  return [...POPPLER_ASSETS];
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function assertSafeArchiveEntry(name) {
  const n = String(name).replace(/\\/g, "/");
  if (!n || n.startsWith("/") || n.includes("..") || n.includes("\0")) {
    throw new Error(`unsafe archive entry ${name}`);
  }
}

export function assertNoSpecialFiles(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink() || st.isFIFO() || st.isSocket() || st.isCharacterDevice() || st.isBlockDevice()) {
        throw new Error(`special file rejected ${relative(root, p)}`);
      }
      if (st.isDirectory()) stack.push(p);
    }
  }
}

export function isTransientPopplerDownloadStatus(status) {
  return TRANSIENT_DOWNLOAD_STATUS.has(Number(status));
}

function delay(ms, sleepImpl) {
  return sleepImpl(ms);
}

export async function downloadHttps(
  url,
  dest,
  {
    fetchImpl = fetch,
    maxBytes = POPPLER_UPSTREAM.maxDownloadBytes,
    maxAttempts = 5,
    sleepImpl = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
  } = {},
) {
  let current = url;
  let attempt = 1;
  for (let hop = 0; hop <= 5; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !HOST_ALLOW.has(parsed.hostname)) {
      throw new Error(`poppler download host rejected ${parsed.hostname}`);
    }
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: { "User-Agent": "Penglai/0.5.12 poppler-fetch" },
      });
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await delay(Math.min(1000 * 2 ** (attempt - 1), 8_000), sleepImpl);
      attempt += 1;
      hop -= 1;
      continue;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel?.().catch(() => undefined);
      if (!location) throw new Error("redirect without location");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel?.().catch(() => undefined);
      if (!isTransientPopplerDownloadStatus(response.status) || attempt >= maxAttempts) {
        throw new Error(`download failed ${response.status}`);
      }
      await delay(Math.min(1000 * 2 ** (attempt - 1), 8_000), sleepImpl);
      attempt += 1;
      hop -= 1;
      continue;
    }
    const tmp = `${dest}.${randomBytes(6).toString("hex")}.part`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp, { mode: 0o600, flags: "wx" }));
    const size = statSync(tmp).size;
    if (size <= 0 || size > maxBytes) {
      rmSync(tmp, { force: true });
      throw new Error("poppler archive size rejected");
    }
    renameSync(tmp, dest);
    return dest;
  }
  throw new Error("too many redirects");
}

export function verifyArchive(path, expectedSha256, expectedBytes) {
  const size = statSync(path).size;
  if (size !== expectedBytes) throw new Error(`archive size mismatch ${path}: ${size}`);
  const sha = sha256File(path);
  if (sha !== expectedSha256) throw new Error(`archive hash mismatch ${path}: ${sha}`);
  if (size > POPPLER_UPSTREAM.maxDownloadBytes) throw new Error(`archive exceeds size bound ${path}`);
  return { sha256: sha, bytes: size };
}

function findEocdOffset(buf) {
  const min = Math.max(0, buf.length - 22 - 65_535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("zip EOCD not found");
}

export function readZip64Sizes(extra, uncomp, comp, localOff) {
  let u = uncomp;
  let c = comp;
  let o = localOff;
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const sz = extra.readUInt16LE(i + 2);
    const data = extra.subarray(i + 4, Math.min(extra.length, i + 4 + sz));
    i += 4 + sz;
    if (id !== 1) continue;
    let p = 0;
    const read64 = () => {
      if (p + 8 > data.length) throw new Error("truncated zip64 extra");
      const value = data.readBigUInt64LE(p);
      p += 8;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("zip64 size exceeds safe integer");
      return Number(value);
    };
    if (uncomp === 0xffffffff) u = read64();
    if (comp === 0xffffffff) c = read64();
    if (localOff === 0xffffffff) o = read64();
  }
  if (u === 0xffffffff || c === 0xffffffff || o === 0xffffffff) {
    throw new Error("zip64 extra missing required 64-bit size");
  }
  return { uncomp: u, comp: c, localOff: o };
}

export function listZipEntriesFromBuffer(buf) {
  const eocd = findEocdOffset(buf);
  let n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (n === 0xffff || off === 0xffffffff) {
    throw new Error("zip64 EOCD not supported for conda archives");
  }
  const names = [];
  for (let i = 0; i < n; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(off + 10);
    const comp = buf.readUInt32LE(off + 20);
    const uncomp = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const extra = buf.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen);
    const sizes =
      uncomp === 0xffffffff || comp === 0xffffffff || localOff === 0xffffffff
        ? readZip64Sizes(extra, uncomp, comp, localOff)
        : { uncomp, comp, localOff };
    names.push({ name, method, comp: sizes.comp, uncomp: sizes.uncomp, localOff: sizes.localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function readZipFile(buf, entry) {
  const local = entry.localOff;
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad zip local header ${entry.name}`);
  const nameLen = buf.readUInt16LE(local + 26);
  const extraLen = buf.readUInt16LE(local + 28);
  const dataOff = local + 30 + nameLen + extraLen;
  const data = buf.subarray(dataOff, dataOff + entry.comp);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`);
}

export function extractCondaPkg(archivePath, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const zipBuf = readFileSync(archivePath);
  const entries = listZipEntriesFromBuffer(zipBuf);
  for (const entry of entries) assertSafeArchiveEntry(entry.name);
  const pkg = entries.filter((e) => /^pkg-.*\.tar\.zst$/.test(e.name.split("/").pop()));
  if (pkg.length !== 1) throw new Error(`conda pkg tarball missing in ${archivePath}`);
  const zst = readZipFile(zipBuf, pkg[0]);
  const tar = zstdDecompressSync(zst);
  const tarPath = join(dest, "pkg.tar");
  writeFileSync(tarPath, tar);
  const names = execFileSync("tar", ["-tf", tarPath], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const name of names) assertSafeArchiveEntry(name);
  const pkgDir = join(dest, "pkg");
  mkdirSync(pkgDir, { recursive: true, mode: 0o700 });
  execFileSync("tar", ["xf", tarPath, "-C", pkgDir, "--no-same-owner", "--no-same-permissions"], {
    stdio: "ignore",
  });
  return pkgDir;
}

function walkFiles(root, acc = []) {
  if (!existsSync(root)) return acc;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    const st = lstatSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function walkRegularFiles(root, acc = []) {
  if (!existsSync(root)) return acc;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    const st = lstatSync(p);
    if (st.isDirectory()) walkRegularFiles(p, acc);
    else if (st.isFile()) acc.push(p);
    else if (st.isSymbolicLink()) {
      try {
        const real = realpathSync(p);
        if (statSync(real).isFile()) acc.push(p);
      } catch {
        /* dangling */
      }
    }
  }
  return acc;
}

export function canonicalTreeListing(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      if (name === "manifest.json") continue;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) files.push(p);
    }
  }
  files.sort((a, b) => relative(root, a).split(sep).join("/").localeCompare(relative(root, b).split(sep).join("/")));
  return files
    .map((p) => {
      const rel = relative(root, p).split(sep).join("/");
      return `${rel}\t${sha256File(p)}\t${statSync(p).size}`;
    })
    .join("\n")
    .concat("\n");
}

export function publishedTreeDigest(root) {
  return sha256Buffer(Buffer.from(canonicalTreeListing(root)));
}

export function rejectedShipName(name, target) {
  const base = name.split(/[\\/]/).pop();
  if (/poppler-glib|poppler-cpp/i.test(base)) return true;
  if (/^pdf(?!toppm)/i.test(base)) return true;
  if (/harfbuzz-(cairo|gobject|icu|gpu|raster|vector)/i.test(base)) return true;
  if (/(^|[^a-z])(lib)?cairo/i.test(base) && !/sharpyuv/i.test(base)) return true;
  if (/pixman/i.test(base)) return true;
  if (target.startsWith("darwin") && /icu/i.test(base)) return true;
  if (target.startsWith("win32") && /icu/i.test(base) && !/^icu(uc|dt)78\.dll$/i.test(base)) return true;
  if (/\.(a|lib|h|pc|exe)$/i.test(base) && !/^pdftoppm\.exe$/i.test(base)) return true;
  return false;
}

function dylibBasename(dep) {
  return dep.split("/").pop();
}

export function machOLoadDeps(path) {
  const otool = spawnSync("otool", ["-L", path], { encoding: "utf8" });
  if (otool.status !== 0) throw new Error(`otool -L failed ${path}: ${otool.stderr}`);
  return otool.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean);
}

export function machORpaths(path) {
  const otool = spawnSync("otool", ["-l", path], { encoding: "utf8" });
  if (otool.status !== 0) throw new Error(`otool -l failed ${path}`);
  const rpaths = [];
  const lines = otool.stdout.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes("LC_RPATH")) continue;
    const pathLine = lines[i + 2] || "";
    const match = pathLine.match(/path\s+(\S+)/);
    if (match) rpaths.push(match[1]);
  }
  return rpaths;
}

export function assertDarwinOtoolClean(path) {
  const text = `${spawnSync("otool", ["-L", path], { encoding: "utf8" }).stdout}\n${
    spawnSync("otool", ["-l", path], { encoding: "utf8" }).stdout
  }`;
  if (/\/opt\/homebrew/i.test(text)) throw new Error(`homebrew path in ${path}`);
  if (/miniforge|conda-bld|_h_env_placehold/i.test(text)) throw new Error(`conda prefix leftover in ${path}`);
  if (/@loader_path\/\.\.\/lib/.test(text)) throw new Error(`stale @loader_path/../lib in ${path}`);
}

function runInstallName(args, path) {
  const result = spawnSync("install_name_tool", [...args, path], { encoding: "utf8" });
  if (result.status !== 0) {
    const err = `${result.stderr || ""} ${result.stdout || ""}`;
    if (/no LC_RPATH|would duplicate|file not in an archive|does not fill the __LINKEDIT segment/i.test(err)) {
      return false;
    }
    throw new Error(`install_name_tool ${args.join(" ")} ${path}: ${err}`);
  }
  return true;
}

export function paddedPopplerDatadir(slotLength) {
  const needle = Buffer.from("share/poppler");
  if (slotLength < needle.length) throw new Error("POPPLER_DATADIR slot shorter than share/poppler");
  // conda-forge compiles `std::string{POPPLER_DATADIR}` as memcpy(269), not strlen.
  // Interior NULs make filesystem::path.c_str() truncate before "/cidToUnicode".
  const repl = Buffer.alloc(slotLength, 0x2f);
  needle.copy(repl);
  return repl;
}

export function patchPopplerDatadir(buf) {
  const needle = Buffer.from("share/poppler");
  let idx = 0;
  let count = 0;
  const copy = Buffer.from(buf);
  while ((idx = copy.indexOf(needle, idx)) !== -1) {
    let start = idx;
    while (start > 0 && copy[start - 1] !== 0) start -= 1;
    const end = copy.indexOf(0, idx);
    if (end < 0) break;
    const current = copy.slice(start, end).toString("utf8");
    if (current.endsWith("share/poppler") && current.length > needle.length) {
      paddedPopplerDatadir(end - start).copy(copy, start);
      count += 1;
    }
    idx = end + 1;
  }
  if (count < 1) throw new Error("POPPLER_DATADIR placeholder not found");
  return copy;
}

export function patchFontconfigXml(xml) {
  return xml.replace(/<cachedir>\/[^<]*<\/cachedir>/g, '<cachedir prefix="xdg">penglai-fontconfig</cachedir>');
}

function indexDylibPool(pkgRoots) {
  const map = new Map();
  for (const root of pkgRoots) {
    for (const p of walkFiles(join(root, "lib")).concat(walkFiles(join(root, "bin")))) {
      const base = p.split(sep).pop();
      if (!base.endsWith(".dylib") && base !== "pdftoppm") continue;
      let real = p;
      try {
        if (lstatSync(p).isSymbolicLink()) real = realpathSync(p);
      } catch {
        continue;
      }
      if (!existsSync(real) || !statSync(real).isFile()) continue;
      if (!map.has(base)) map.set(base, real);
      const sonameMatch = base.match(/^(lib.+?\.\d+)\.\d+.*\.dylib$/);
      if (sonameMatch && !map.has(`${sonameMatch[1]}.dylib`)) {
        map.set(`${sonameMatch[1]}.dylib`, real);
      }
    }
  }
  return map;
}

function resolveDylib(pool, name) {
  if (pool.has(name)) return pool.get(name);
  const prefix = name.replace(/\.dylib$/, "");
  for (const [base, path] of pool) {
    if (base === name || base.startsWith(`${prefix}.`)) return path;
  }
  return undefined;
}

function isDarwinSystemDep(dep) {
  if (dep.startsWith("/usr/lib") || dep.startsWith("/System/")) return true;
  const base = dylibBasename(dep);
  return Boolean(POPPLER_UPSTREAM.darwinSystemRewrites[base]);
}

function copyMode755(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
}

function copyMode644(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  chmodSync(dest, 0o644);
}

export function rewriteMacBinary(path, isDylib) {
  spawnSync("codesign", ["--remove-signature", path], { encoding: "utf8" });
  const self = path.split(sep).pop();
  const deps = machOLoadDeps(path);
  const loadDeps = isDylib ? deps.slice(1) : deps;
  for (const dep of loadDeps) {
    const base = dylibBasename(dep);
    if (base === self) continue;
    const system = POPPLER_UPSTREAM.darwinSystemRewrites[base];
    if (system) {
      if (dep !== system) runInstallName(["-change", dep, system], path);
      continue;
    }
    if (dep.startsWith("/usr/lib") || dep.startsWith("/System/")) continue;
    if (dep.startsWith("@loader_path/") && dep === `@loader_path/${base}`) continue;
    if (base && (dep.startsWith("@rpath/") || dep.startsWith("@loader_path/"))) {
      const changed = runInstallName(["-change", dep, `@loader_path/${base}`], path);
      if (!changed) throw new Error(`could not flatten ${dep} in ${path}`);
    }
  }
  if (isDylib) runInstallName(["-id", `@loader_path/${self}`], path);
  const rpaths = machORpaths(path);
  for (const rpath of rpaths) {
    if (rpath === "@loader_path/../lib/" || rpath === "@loader_path/../lib") {
      runInstallName(["-delete_rpath", rpath], path);
    }
  }
  const remainingRpath = machOLoadDeps(path).some((dep) => dep.startsWith("@rpath/"));
  const after = machORpaths(path);
  if (remainingRpath && !after.includes("@loader_path")) {
    const added = runInstallName(["-add_rpath", "@loader_path"], path);
    if (!added) throw new Error(`could not add @loader_path rpath to ${path}`);
  }
  // Leave Mach-Os unsigned. Ad-hoc codesign is not reproducible and is not the
  // Developer ID seal. Parent package-mac / notarization re-signs the tree.
  spawnSync("codesign", ["--remove-signature", path], { encoding: "utf8" });
}

function copyLicenses(dest) {
  copyMode644(join(LICENSE_DIR, "COPYING"), join(dest, "COPYING"));
  copyMode644(join(LICENSE_DIR, "COPYING3"), join(dest, "COPYING3"));
  if (existsSync(join(LICENSE_DIR, "NOTICE"))) copyMode644(join(LICENSE_DIR, "NOTICE"), join(dest, "NOTICE"));
}

function copyPopplerData(dataRoot, destShare) {
  mkdirSync(destShare, { recursive: true });
  for (const dir of POPPLER_UPSTREAM.popplerData.dirs) {
    const src = join(dataRoot, dir);
    if (!existsSync(src)) throw new Error(`poppler-data missing ${dir}`);
    cpSync(src, join(destShare, dir), { recursive: true });
  }
  for (const name of Object.keys(POPPLER_UPSTREAM.popplerData.licenseFiles)) {
    const src = existsSync(join(dataRoot, name)) ? join(dataRoot, name) : join(POPPLER_DATA_LICENSE_DIR, name);
    if (!existsSync(src)) throw new Error(`poppler-data license missing ${name}`);
    copyMode644(src, join(destShare, name));
    const sha = sha256File(join(destShare, name));
    if (sha !== POPPLER_UPSTREAM.popplerData.licenseFiles[name]) {
      throw new Error(`poppler-data ${name} hash mismatch ${sha}`);
    }
  }
}

function copyFontconfig(pkgRoots, dest) {
  let fontsConf;
  let confd;
  for (const root of pkgRoots) {
    const candidate = join(root, "etc", "fonts", "fonts.conf");
    if (existsSync(candidate)) fontsConf = candidate;
    const d = join(root, "etc", "fonts", "conf.d");
    if (existsSync(d)) confd = d;
  }
  if (!fontsConf || !confd) throw new Error("fontconfig fonts.conf/conf.d missing");
  const fontsDir = join(dest, "fonts");
  mkdirSync(join(fontsDir, "conf.d"), { recursive: true });
  const patched = patchFontconfigXml(readFileSync(fontsConf, "utf8"));
  if (/miniforge|conda-bld|_h_env_placehold/i.test(patched)) {
    throw new Error("fontconfig cachedir placeholder survived rewrite");
  }
  writeFileSync(join(fontsDir, "fonts.conf"), patched, { mode: 0o644 });
  for (const name of readdirSync(confd)) {
    if (!name.endsWith(".conf")) continue;
    copyMode644(join(confd, name), join(fontsDir, "conf.d", name));
  }
}

export function classifyWindowsDll(name) {
  const n = String(name).split(/[\\/]/).pop().toLowerCase();
  if (n.startsWith("api-ms-win-") || n === "ucrtbase.dll") return "ucrt";
  if (n.startsWith("vcruntime140") || n.startsWith("msvcp140") || n === "concrt140.dll") return "vcruntime";
  if (WINDOWS_SYSTEM.has(n)) return "system";
  return "bundle";
}

function readU16(buf, off) {
  return buf.readUInt16LE(off);
}
function readU32(buf, off) {
  return buf.readUInt32LE(off);
}
function rvaToOff(buf, rva, sections) {
  for (const s of sections) {
    if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return s.rawOff + (rva - s.va);
  }
  return -1;
}
function cstr(buf, off) {
  if (off < 0 || off >= buf.length) return null;
  let end = off;
  while (end < buf.length && buf[end] !== 0) end += 1;
  return buf.toString("ascii", off, end);
}

export function parsePeImports(path) {
  const buf = readFileSync(path);
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error(`not MZ ${path}`);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error(`not PE ${path}`);
  const coff = pe + 4;
  const nsec = readU16(buf, coff + 2);
  const optSize = readU16(buf, coff + 16);
  const opt = coff + 20;
  const pe32plus = readU16(buf, opt) === 0x20b;
  const ddOff = opt + (pe32plus ? 112 : 96);
  const importRva = readU32(buf, ddOff + 8);
  const delayRva = readU32(buf, ddOff + 13 * 8);
  const sections = [];
  const secOff = opt + optSize;
  for (let i = 0; i < nsec; i += 1) {
    const o = secOff + i * 40;
    sections.push({
      vsize: readU32(buf, o + 8),
      va: readU32(buf, o + 12),
      rawSize: readU32(buf, o + 16),
      rawOff: readU32(buf, o + 20),
    });
  }
  const dlls = [];
  const parseDir = (rva, delay) => {
    if (!rva) return;
    let off = rvaToOff(buf, rva, sections);
    if (off < 0) return;
    for (;;) {
      let nameRva;
      let next;
      if (delay) {
        const allZero = [0, 1, 2, 3, 4, 5, 6, 7].every((i) => readU32(buf, off + i * 4) === 0);
        if (allZero) break;
        nameRva = readU32(buf, off + 4);
        next = off + 32;
      } else {
        const orig = readU32(buf, off);
        const name = readU32(buf, off + 12);
        const first = readU32(buf, off + 16);
        if (orig === 0 && name === 0 && first === 0) break;
        nameRva = name;
        next = off + 20;
      }
      const dll = cstr(buf, rvaToOff(buf, nameRva, sections));
      if (dll) dlls.push({ dll, delay: Boolean(delay) });
      off = next;
    }
  };
  parseDir(importRva, false);
  parseDir(delayRva, true);
  return { path, pe32plus, dlls };
}

function indexDllPool(pkgRoots) {
  const map = new Map();
  for (const root of pkgRoots) {
    const bins = [join(root, "Library", "bin"), join(root, "bin")];
    for (const bin of bins) {
      if (!existsSync(bin)) continue;
      for (const name of readdirSync(bin)) {
        if (!/\.(dll|exe)$/i.test(name)) continue;
        const p = join(bin, name);
        const st = lstatSync(p);
        if (st.isSymbolicLink() || !st.isFile()) continue;
        const key = name.toLowerCase();
        if (!map.has(key)) map.set(key, p);
      }
    }
  }
  return map;
}

export function walkWindowsClosure(entryPath, pool, { allowMissingVc = true } = {}) {
  const needed = new Map();
  const unresolved = [];
  const vcRuntime = [];
  const queue = [entryPath];
  const seen = new Set();
  while (queue.length) {
    const current = queue.pop();
    const real = current.split(sep).pop().toLowerCase();
    if (seen.has(real)) continue;
    seen.add(real);
    const parsed = parsePeImports(current);
    for (const { dll } of parsed.dlls) {
      const kind = classifyWindowsDll(dll);
      const base = dll.split(/[\\/]/).pop();
      if (kind === "system" || kind === "ucrt") continue;
      if (kind === "vcruntime") {
        vcRuntime.push(base);
        continue;
      }
      if (rejectedShipName(base, "win32-x86_64")) {
        unresolved.push(base);
        continue;
      }
      const src = pool.get(base.toLowerCase());
      if (!src) {
        unresolved.push(base);
        continue;
      }
      needed.set(base.toLowerCase(), src);
      queue.push(src);
    }
  }
  if (unresolved.length) {
    throw new Error(`unresolved Windows DLL(s): ${[...new Set(unresolved)].join(", ")}`);
  }
  if (!allowMissingVc && vcRuntime.length) {
    throw new Error(`VC runtime required next to exe: ${[...new Set(vcRuntime)].join(", ")}`);
  }
  return { needed, vcRuntime: [...new Set(vcRuntime)] };
}

function extractPopplerData(archivePath, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const names = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const name of names) assertSafeArchiveEntry(name);
  execFileSync("tar", ["-xzf", archivePath, "-C", dest, "--no-same-owner", "--no-same-permissions"], {
    stdio: "ignore",
  });
  const root = join(dest, "poppler-data-0.4.12");
  if (!existsSync(root)) throw new Error("poppler-data tarball layout mismatch");
  assertNoSpecialFiles(root);
  return root;
}

async function ensureCached(pkg, cacheDir) {
  const dest = join(cacheDir, pkg.filename);
  if (existsSync(dest)) {
    try {
      verifyArchive(dest, pkg.sha256, pkg.bytes);
      return dest;
    } catch {
      rmSync(dest, { force: true });
    }
  }
  const stage = mkdtempSync(join(tmpdir(), "penglai-poppler-dl-"));
  try {
    const staged = join(stage, pkg.filename);
    await downloadHttps(pkg.url, staged, { maxBytes: Math.max(pkg.bytes, POPPLER_UPSTREAM.maxDownloadBytes) });
    verifyArchive(staged, pkg.sha256, pkg.bytes);
    mkdirSync(cacheDir, { recursive: true, mode: 0o755 });
    const tmp = `${dest}.${process.pid}.tmp`;
    rmSync(tmp, { force: true });
    cpSync(staged, tmp);
    verifyArchive(tmp, pkg.sha256, pkg.bytes);
    renameSync(tmp, dest);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return dest;
}

function writeManifest(dest, asset, extra) {
  const listing = canonicalTreeListing(dest);
  const digest = sha256Buffer(Buffer.from(listing));
  const files = listing
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha256, bytes] = line.split("\t");
      return { name, sha256, bytes: Number(bytes) };
    });
  writeFileSync(
    join(dest, "manifest.json"),
    `${JSON.stringify(
      {
        target: asset.target,
        engine: asset.binaryFilename,
        version: POPPLER_UPSTREAM.version,
        source: asset.url,
        archiveSha256: asset.archiveSha256,
        publishedTreeSha256: digest,
        files,
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
  return digest;
}

function finalizeDest(tmpDest, dest, asset, extra) {
  assertNoSpecialFiles(tmpDest);
  const digest = writeManifest(tmpDest, asset, extra);
  if (asset.publishedTreeSha256 && digest !== asset.publishedTreeSha256) {
    throw new Error(`published tree hash mismatch ${asset.target}: ${digest}`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(tmpDest, dest);
  return digest;
}

function assembleDarwin(asset, pkgRoots, dataRoot, dest) {
  const tmpDest = `${dest}.${process.pid}.tmp`;
  rmSync(tmpDest, { recursive: true, force: true });
  mkdirSync(tmpDest, { recursive: true, mode: 0o755 });
  const pool = indexDylibPool(pkgRoots);
  const pdftoppmSrc = resolveDylib(pool, "pdftoppm");
  if (!pdftoppmSrc) throw new Error(`conda ${asset.target} missing bin/pdftoppm`);
  copyMode755(pdftoppmSrc, join(tmpDest, "pdftoppm"));
  const copied = new Set(["pdftoppm"]);
  const queue = [join(tmpDest, "pdftoppm")];
  for (const extra of POPPLER_UPSTREAM.darwinDlopenLibs) {
    const src = resolveDylib(pool, extra);
    if (src) {
      copyMode755(src, join(tmpDest, extra));
      copied.add(extra);
      queue.push(join(tmpDest, extra));
    }
  }
  while (queue.length) {
    const current = queue.pop();
    let deps;
    try {
      deps = machOLoadDeps(current);
    } catch {
      continue;
    }
    for (const dep of deps) {
      const base = dylibBasename(dep);
      if (!base || isDarwinSystemDep(dep)) continue;
      if (copied.has(base)) continue;
      if (rejectedShipName(base, asset.target)) {
        throw new Error(`refusing to ship ${base} for ${asset.target}`);
      }
      const src = resolveDylib(pool, base);
      if (!src) throw new Error(`unresolved dylib ${base} (from ${current.split(sep).pop()})`);
      copyMode755(src, join(tmpDest, base));
      copied.add(base);
      queue.push(join(tmpDest, base));
    }
  }
  for (const name of readdirSync(tmpDest)) {
    const p = join(tmpDest, name);
    if (!statSync(p).isFile()) continue;
    if (name === "pdftoppm" || name.endsWith(".dylib")) {
      rewriteMacBinary(p, name.endsWith(".dylib"));
    }
  }
  const libpoppler = readdirSync(tmpDest).find((n) => /^libpoppler\.\d/.test(n) && n.endsWith(".dylib"));
  if (!libpoppler) throw new Error("libpoppler dylib missing after flatten");
  const patched = patchPopplerDatadir(readFileSync(join(tmpDest, libpoppler)));
  writeFileSync(join(tmpDest, libpoppler), patched);
  chmodSync(join(tmpDest, libpoppler), 0o755);
  spawnSync("codesign", ["--remove-signature", join(tmpDest, libpoppler)], { encoding: "utf8" });
  copyLicenses(tmpDest);
  copyPopplerData(dataRoot, join(tmpDest, "share", "poppler"));
  copyFontconfig(pkgRoots, tmpDest);
  for (const name of readdirSync(tmpDest)) {
    const p = join(tmpDest, name);
    if (name === "pdftoppm" || name.endsWith(".dylib")) assertDarwinOtoolClean(p);
  }
  return finalizeDest(tmpDest, dest, asset, { fontconfig: "fonts", datadir: "share/poppler" });
}

function assembleWindows(asset, pkgRoots, dataRoot, dest) {
  const tmpDest = `${dest}.${process.pid}.tmp`;
  rmSync(tmpDest, { recursive: true, force: true });
  mkdirSync(tmpDest, { recursive: true, mode: 0o755 });
  const pool = indexDllPool(pkgRoots);
  const exeSrc = pool.get("pdftoppm.exe");
  if (!exeSrc) throw new Error("conda win-64 missing pdftoppm.exe");
  copyFileSync(exeSrc, join(tmpDest, "pdftoppm.exe"));
  const { needed, vcRuntime } = walkWindowsClosure(join(tmpDest, "pdftoppm.exe"), pool);
  for (const [name, src] of needed) {
    if (rejectedShipName(name, asset.target)) throw new Error(`refusing to ship ${name}`);
    copyFileSync(src, join(tmpDest, src.split(sep).pop()));
  }
  copyLicenses(tmpDest);
  copyPopplerData(dataRoot, join(tmpDest, "share", "poppler"));
  return finalizeDest(tmpDest, dest, asset, {
    vcRuntime,
    vcRuntimeNote:
      "Electron payload carries VCRUNTIME140*.dll / MSVCP140.dll next to Penglai.exe; copy them next to pdftoppm.exe at package-windows time. A child exe does not search the parent folder.",
    windowsDatadirNote:
      "conda-forge windows-data.patch extra-strips one directory after the DLL folder, so GetModuleFileName of poppler.dll at <payload>/poppler/poppler.dll looks for <payload>/share/poppler, not <payload>/poppler/share/poppler. package-windows must also copy share/poppler to join(payload, 'share', 'poppler'). Latin splash can work without CMaps; CJK requires that sibling path.",
  });
}

function writeProvenance() {
  writeFileSync(
    join(OUT, "PROVENANCE.md"),
    `# Poppler pdftoppm provenance

Penglai Office page preview ships a target-specific \`pdftoppm\` helper and its
dynamic-library closure. The helper is a separate executable (mere aggregation),
not linked into Electron or DSH.

- Upstream: ${POPPLER_UPSTREAM.project}
- Version: ${POPPLER_UPSTREAM.version}
- License: ${POPPLER_UPSTREAM.license} (\`COPYING\` + \`COPYING3\` next to the binary)
- Source tarball: \`${POPPLER_UPSTREAM.sourceSha256}\`
- poppler-data ${POPPLER_UPSTREAM.popplerData.version}: \`${POPPLER_UPSTREAM.popplerData.sha256}\`
- conda-forge feedstock commit: \`${POPPLER_UPSTREAM.feedstockCommit}\`
- Targets: conda-forge osx-arm64, osx-64, and win-64 poppler ${POPPLER_UPSTREAM.version}
- Homebrew bottles and poppler-windows zip archives are not pins
- \`.conda\` pkg tarballs are decoded with Node's \`zstdDecompressSync\` (no Homebrew zstd)

macOS published layout flattens \`pdftoppm\` and load-time dylibs next to each other,
rewrites rpath to \`@loader_path\`, maps libc++/libz/libcurl/libsqlite3 to \`/usr/lib\`,
and patches the compiled-in \`POPPLER_DATADIR\` slot to \`share/poppler\` slash-padded
to the original 269-byte memcpy length (no interior NUL). Spawn must use
\`cwd = dirname(pdftoppm)\` and \`FONTCONFIG_PATH = <poppler>/fonts\`.

Windows published layout is a PE-walked DLL closure next to \`pdftoppm.exe\`, with
poppler-data at \`share/poppler\` inside the helper dir (copy source). conda-forge
\`windows-data.patch\` extra-strips one directory, so the running helper looks for
\`<payload>/share/poppler\`. package-windows must copy that tree to the payload
sibling and must copy Electron's \`VCRUNTIME140*.dll\` / \`MSVCP140.dll\` next to
the helper. Darwin published Mach-Os are left unsigned so tree hashes are
reproducible; package-mac/notarization re-signs.

Packaged runtime looks next to \`Penglai\` / \`Penglai.exe\` at \`poppler/pdftoppm[.exe]\`.
It never uses system PATH. Published tree hashes are recorded after extract in each
target \`manifest.json\`.
`,
  );
}

export async function fetchPopplerAssets(parsed, { root = ROOT } = {}) {
  const out = join(root, "third_party", "poppler");
  const cache = join(out, "cache");
  mkdirSync(out, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const assets = selectAssets(parsed);
  const dataPkg = {
    filename: "poppler-data-0.4.12.tar.gz",
    url: POPPLER_UPSTREAM.popplerData.url,
    sha256: POPPLER_UPSTREAM.popplerData.sha256,
    bytes: POPPLER_UPSTREAM.popplerData.bytes,
  };
  const dataArchive = await ensureCached(dataPkg, cache);
  const dataExtract = mkdtempSync(join(tmpdir(), "penglai-poppler-data-"));
  const fetched = [];
  try {
    const dataRoot = extractPopplerData(dataArchive, dataExtract);
    for (const asset of assets) {
      const pkgs = popplerAllCondaPackages(asset);
      const pkgRoots = [];
      const extracts = [];
      try {
        for (const pkg of pkgs) {
          const archive = await ensureCached(pkg, cache);
          const extract = mkdtempSync(join(tmpdir(), `penglai-poppler-x-${asset.target}-`));
          extracts.push(extract);
          pkgRoots.push(extractCondaPkg(archive, extract));
        }
        const dest = join(out, asset.target);
        const digest =
          asset.target.startsWith("darwin-")
            ? assembleDarwin(asset, pkgRoots, dataRoot, dest)
            : assembleWindows(asset, pkgRoots, dataRoot, dest);
        fetched.push({ target: asset.target, publishedTreeSha256: digest });
      } finally {
        for (const extract of extracts) rmSync(extract, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(dataExtract, { recursive: true, force: true });
  }
  writeProvenance();
  return { command: "fetch-poppler-assets", out, license: POPPLER_UPSTREAM.license, fetched };
}

export async function main(argv) {
  const parsed = parseFetchArgs(argv);
  const result = await fetchPopplerAssets(parsed);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

export { POPPLER_ASSETS, POPPLER_UPSTREAM, HOST_ALLOW, OUT, CACHE };
