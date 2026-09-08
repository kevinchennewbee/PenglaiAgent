#!/usr/bin/env node
/** Fetch and assemble the pinned conda-forge Poppler pdftoppm helper. */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import {
  POPPLER_ASSETS,
  POPPLER_UPSTREAM,
  popplerAssetForHost,
  popplerAssetForTarget,
} from "./lib/poppler-assets.mjs";

const OUT = join(ROOT, "third_party", "poppler");
const CACHE = join(OUT, "cache");
const HOST_ALLOW = new Set(POPPLER_UPSTREAM.hostAllowlist);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(argv) {
  let hostOnly = false;
  let all = false;
  let target;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host-only") hostOnly = true;
    else if (arg === "--all") all = true;
    else if (arg === "--target") {
      target = argv[++i];
      if (!target) throw new Error("fetch-poppler --target requires a value");
    } else throw new Error(`unknown fetch-poppler argument: ${arg}`);
  }
  return { hostOnly, all, target };
}

function selectedAssets(parsed) {
  if (parsed.target) {
    const asset = popplerAssetForTarget(parsed.target);
    if (!asset) throw new Error(`unknown poppler target ${parsed.target}`);
    return [asset];
  }
  if (parsed.hostOnly || (!parsed.all && !parsed.target)) {
    const asset = popplerAssetForHost();
    if (!asset) throw new Error("host poppler target unsupported");
    return [asset];
  }
  return [...POPPLER_ASSETS];
}

function download(url, dest, expectedSha256, expectedBytes) {
  const host = new URL(url).hostname;
  if (!HOST_ALLOW.has(host)) throw new Error(`poppler fetch host not allowlisted: ${host}`);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && sha256File(dest) === expectedSha256) {
    if (expectedBytes && readFileSync(dest).length !== expectedBytes) {
      throw new Error(`cached size mismatch ${url}`);
    }
    return dest;
  }
  const curl = spawnSync("curl", ["-fsSL", "--retry", "2", "-o", dest, url], { stdio: "inherit" });
  if (curl.status !== 0) throw new Error(`download failed ${url}`);
  const actual = sha256File(dest);
  if (actual !== expectedSha256) throw new Error(`digest mismatch ${url}: ${actual}`);
  if (expectedBytes && readFileSync(dest).length !== expectedBytes) {
    throw new Error(`size mismatch ${url}`);
  }
  return dest;
}

function requireZstd() {
  const probe = spawnSync("zstd", ["-V"], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error("fetch-poppler requires a host zstd decoder to unpack .conda pkg-*.tar.zst; do not use Homebrew Poppler bottles");
  }
}

function extractConda(archivePath, work) {
  requireZstd();
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const py = [
    "import zipfile, pathlib, subprocess, sys",
    `z=zipfile.ZipFile(${JSON.stringify(archivePath)})`,
    `root=pathlib.Path(${JSON.stringify(work)})`,
    "names=z.namelist()",
    "if any('..' in n or n.startswith('/') or '\\0' in n for n in names):",
    "    raise SystemExit('unsafe conda archive entry')",
    "pkg=[n for n in names if n.startswith('pkg-') and n.endswith('.tar.zst')]",
    "if len(pkg)!=1: raise SystemExit('conda pkg tarball missing')",
    "zst=root/'pkg.tar.zst'; zst.write_bytes(z.read(pkg[0]))",
    "subprocess.check_call(['zstd','-d','-f',str(zst),'-o',str(root/'pkg.tar')])",
    "subprocess.check_call(['tar','xf',str(root/'pkg.tar'),'-C',str(root)])",
  ].join("\n");
  execFileSync("python3", ["-c", py]);
}

function rewriteMacLoaderPath(binDir) {
  const names = readdirSync(binDir).filter((name) => !name.startsWith("."));
  for (const name of names) {
    const path = join(binDir, name);
    const otool = spawnSync("otool", ["-L", path], { encoding: "utf8" });
    if (otool.status !== 0) continue;
    spawnSync("install_name_tool", ["-delete_rpath", "@loader_path/../lib/", path]);
    spawnSync("install_name_tool", ["-add_rpath", "@loader_path", path]);
    for (const line of otool.stdout.split("\n").slice(1)) {
      const dep = line.trim().split(" ")[0];
      if (!dep) continue;
      if (dep.includes("libc++.1.dylib")) {
        spawnSync("install_name_tool", ["-change", dep, "/usr/lib/libc++.1.dylib", path]);
        continue;
      }
      if (dep.includes("libz.1.dylib")) {
        spawnSync("install_name_tool", ["-change", dep, "/usr/lib/libz.1.dylib", path]);
        continue;
      }
      if (dep.includes("libcurl.4.dylib")) {
        spawnSync("install_name_tool", ["-change", dep, "/usr/lib/libcurl.4.dylib", path]);
        continue;
      }
      if (dep.includes("libsqlite3.dylib")) {
        spawnSync("install_name_tool", ["-change", dep, "/usr/lib/libsqlite3.dylib", path]);
        continue;
      }
      if (dep.startsWith("/usr/lib") || dep.startsWith("/System/")) continue;
      const base = dep.split("/").pop();
      if (!names.includes(base)) continue;
      spawnSync("install_name_tool", ["-change", dep, `@loader_path/${base}`, path]);
    }
    if (name !== "pdftoppm") {
      spawnSync("install_name_tool", ["-id", `@loader_path/${name}`, path]);
    }
  }
}

function copyLicenses(dest) {
  copyFileSync(join(OUT, "COPYING"), join(dest, "COPYING"));
  copyFileSync(join(OUT, "COPYING3"), join(dest, "COPYING3"));
  chmodSync(join(dest, "COPYING"), 0o644);
  chmodSync(join(dest, "COPYING3"), 0o644);
}

function assembleDarwin(asset, archivePath) {
  const dest = join(OUT, asset.target);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const work = join(tmpdir(), `penglai-poppler-${asset.target}`);
  extractConda(archivePath, work);
  const pdftoppm = join(work, "bin", "pdftoppm");
  if (!existsSync(pdftoppm)) throw new Error(`conda ${asset.target} missing bin/pdftoppm`);
  copyFileSync(pdftoppm, join(dest, "pdftoppm"));
  chmodSync(join(dest, "pdftoppm"), 0o755);
  const lib = join(work, "lib");
  if (existsSync(lib)) {
    for (const name of readdirSync(lib)) {
      if (!name.endsWith(".dylib")) continue;
      if (name.includes("poppler-glib") || name.includes("poppler-cpp")) continue;
      copyFileSync(join(lib, name), join(dest, name));
      chmodSync(join(dest, name), 0o755);
    }
  }
  rewriteMacLoaderPath(dest);
  copyLicenses(dest);
  const files = readdirSync(dest)
    .filter((name) => name !== "manifest.json")
    .sort()
    .map((name) => ({ name, sha256: sha256File(join(dest, name)), bytes: readFileSync(join(dest, name)).length }));
  writeFileSync(
    join(dest, "manifest.json"),
    `${JSON.stringify({
      target: asset.target,
      engine: "pdftoppm",
      source: asset.url,
      archiveSha256: asset.archiveSha256,
      version: POPPLER_UPSTREAM.version,
      files,
    }, null, 2)}\n`,
  );
  return dest;
}

function assembleWindows(asset, archivePath) {
  const dest = join(OUT, asset.target);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const work = join(tmpdir(), `penglai-poppler-${asset.target}`);
  extractConda(archivePath, work);
  const bin = existsSync(join(work, "Library", "bin")) ? join(work, "Library", "bin") : join(work, "bin");
  const exe = join(bin, "pdftoppm.exe");
  if (!existsSync(exe)) throw new Error("conda win-64 missing pdftoppm.exe");
  for (const name of readdirSync(bin)) {
    if (!/\.(exe|dll)$/i.test(name)) continue;
    if (/^pdf(?!toppm)/i.test(name)) continue;
    if (/poppler-(cpp|glib)/i.test(name)) continue;
    copyFileSync(join(bin, name), join(dest, name));
  }
  copyLicenses(dest);
  const files = readdirSync(dest)
    .filter((name) => name !== "manifest.json")
    .sort()
    .map((name) => ({ name, sha256: sha256File(join(dest, name)), bytes: readFileSync(join(dest, name)).length }));
  writeFileSync(
    join(dest, "manifest.json"),
    `${JSON.stringify({
      target: asset.target,
      engine: "pdftoppm.exe",
      source: asset.url,
      archiveSha256: asset.archiveSha256,
      version: POPPLER_UPSTREAM.version,
      files,
    }, null, 2)}\n`,
  );
  return dest;
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

Packaged runtime looks next to \`Penglai\` / \`Penglai.exe\` at \`poppler/pdftoppm[.exe]\`.
It never uses system PATH. Published tree hashes are recorded after extract in each
target \`manifest.json\`. Closure dylibs/DLLs outside the poppler conda package are
still assembled at fetch time and are not native-install evidence by themselves.
`,
  );
}

const parsed = parseArgs(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });
const assets = selectedAssets(parsed);
for (const asset of assets) {
  const archive = download(asset.url, join(CACHE, asset.filename), asset.archiveSha256, asset.archiveBytes);
  if (asset.target.startsWith("darwin-")) assembleDarwin(asset, archive);
  else assembleWindows(asset, archive);
}
writeProvenance();
console.log(JSON.stringify({
  command: "fetch-poppler",
  out: OUT,
  license: POPPLER_UPSTREAM.license,
  targets: assets.map((row) => row.target),
}, null, 2));
