import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { MNEMON_ASSETS, MNEMON_UPSTREAM, mnemonAssetForTarget, mnemonReleaseUrl } from "../../packages/release-identity/src/mnemon-assets.js";

const HOST_ALLOW = new Set(MNEMON_UPSTREAM.hostAllowlist);

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
    const err = new Error(`unknown fetch-mnemon argument: ${unknown.join(" ")}`);
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
    const asset = mnemonAssetForTarget(parsed.target);
    if (!asset) throw new Error(`unknown mnemon target ${parsed.target}`);
    return [asset];
  }
  if (parsed.hostOnly) {
    const t = hostTarget(platform, arch);
    const asset = t ? mnemonAssetForTarget(t) : undefined;
    if (!asset) throw new Error("host mnemon target unsupported");
    return [asset];
  }
  return [...MNEMON_ASSETS];
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function assertSafeArchiveEntry(name) {
  const n = name.replace(/\\/g, "/");
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

export async function downloadHttps(url, dest, { fetchImpl = fetch, maxBytes = 40 * 1024 * 1024 } = {}) {
  let current = url;
  for (let hop = 0; hop <= 5; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !HOST_ALLOW.has(parsed.hostname)) {
      throw new Error(`mnemon download host rejected ${parsed.hostname}`);
    }
    const response = await fetchImpl(current, { redirect: "manual", headers: { "User-Agent": "Penglai/0.5.5 mnemon-fetch" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel?.().catch(() => undefined);
      if (!location) throw new Error("redirect without location");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`download failed ${response.status}`);
    const tmp = `${dest}.${randomBytes(6).toString("hex")}.part`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp, { mode: 0o600, flags: "wx" }));
    const size = statSync(tmp).size;
    if (size <= 0 || size > maxBytes) {
      rmSync(tmp, { force: true });
      throw new Error("mnemon archive size rejected");
    }
    renameSync(tmp, dest);
    return dest;
  }
  throw new Error("too many redirects");
}

export function extractArchive(archive, extractDir, asset) {
  mkdirSync(extractDir, { recursive: true, mode: 0o700 });
  if (asset.archiveFilename.endsWith(".zip")) {
    const names = execFileSync("unzip", ["-Z", "-1", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const name of names) assertSafeArchiveEntry(name);
    execFileSync("unzip", ["-q", "-o", archive, "-d", extractDir], { stdio: "ignore" });
  } else {
    const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const name of names) assertSafeArchiveEntry(name);
    execFileSync("tar", ["-xzf", archive, "-C", extractDir, "--no-same-owner", "--no-same-permissions"], {
      stdio: "ignore",
    });
  }
  assertNoSpecialFiles(extractDir);
}

export function findExtractedBinary(extractDir, binaryFilename) {
  const hits = [];
  const stack = [extractDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile() && name === binaryFilename) hits.push(p);
    }
  }
  if (hits.length !== 1) throw new Error(`expected one ${binaryFilename}, found ${hits.length}`);
  return hits[0];
}

export function publishBinary(extracted, destPath, asset) {
  const bytes = statSync(extracted).size;
  if (bytes !== asset.binaryBytes) throw new Error(`mnemon binary size mismatch ${bytes}`);
  const sha = sha256File(extracted);
  if (sha !== asset.binarySha256) throw new Error(`mnemon binary hash mismatch ${sha}`);
  mkdirSync(dirname(destPath), { recursive: true, mode: 0o755 });
  const tmp = `${destPath}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  cpSync(extracted, tmp);
  if (asset.executable && process.platform !== "win32") chmodSync(tmp, 0o755);
  const publishedHash = sha256File(tmp);
  if (publishedHash !== asset.binarySha256) throw new Error("mnemon publish TOCTOU");
  renameSync(tmp, destPath);
  if (asset.executable && process.platform !== "win32") chmodSync(destPath, 0o755);
  return { path: destPath, sha256: publishedHash, bytes };
}

export function publishArchive(staged, destPath, asset) {
  if (statSync(staged).size !== asset.archiveBytes) throw new Error(`archive size mismatch ${asset.archiveFilename}`);
  if (sha256File(staged) !== asset.archiveSha256) throw new Error(`archive hash mismatch ${asset.archiveFilename}`);
  mkdirSync(dirname(destPath), { recursive: true, mode: 0o755 });
  const tmp = `${destPath}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  cpSync(staged, tmp);
  if (statSync(tmp).size !== asset.archiveBytes || sha256File(tmp) !== asset.archiveSha256) {
    rmSync(tmp, { force: true });
    throw new Error(`archive publish mismatch ${asset.archiveFilename}`);
  }
  renameSync(tmp, destPath);
  return { path: destPath, sha256: asset.archiveSha256, bytes: asset.archiveBytes };
}

export { MNEMON_ASSETS, mnemonReleaseUrl };
