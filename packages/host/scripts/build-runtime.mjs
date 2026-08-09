#!/usr/bin/env node
/**
 * Build the self-contained Penglai Host runtime consumed by the Tauri app.
 *
 * The artifact contains compiled Host code, the exact production dependency
 * closure from the repository lockfile, a target-matching Node executable,
 * licenses, and a SHA-256 manifest. It never copies the legacy Python runtime.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOST_PKG = path.join(REPO_ROOT, "packages", "host");
const PROTOCOL_PKG = path.join(REPO_ROOT, "packages", "protocol");
const SCHEMA_VERSIONS_PATH = path.join(__dirname, "schema-versions.generated.json");

function readRegularFile(file, encoding = null) {
  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(file);
    if (
      !stat.isFile() || pathStat.isSymbolicLink() || !pathStat.isFile() ||
      stat.dev !== pathStat.dev || stat.ino !== pathStat.ino
    ) {
      throw new Error(`expected stable regular file: ${file}`);
    }
    return fs.readFileSync(descriptor, encoding ?? undefined);
  } finally {
    fs.closeSync(descriptor);
  }
}

function loadSchemaVersions() {
  if (!fs.existsSync(SCHEMA_VERSIONS_PATH)) {
    die(
      `missing ${SCHEMA_VERSIONS_PATH}; run: node scripts/sync-schema-versions.mjs`,
    );
  }
  return JSON.parse(readRegularFile(SCHEMA_VERSIONS_PATH, "utf8"));
}
const ROOT_LOCK_PATH = path.join(REPO_ROOT, "package-lock.json");
const MINIMUM_NODE_VERSION = "22.19.0";
const BUNDLED_NODE_VERSION = "22.22.2";
const MAX_NODE_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 5;
const NODE_DISTRIBUTIONS = {
  "aarch64-apple-darwin": {
    archive: `node-v${BUNDLED_NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000",
    executable: `node-v${BUNDLED_NODE_VERSION}-darwin-arm64/bin/node`,
  },
  "x86_64-apple-darwin": {
    archive: `node-v${BUNDLED_NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba",
    executable: `node-v${BUNDLED_NODE_VERSION}-darwin-x64/bin/node`,
  },
  "x86_64-pc-windows-msvc": {
    archive: `node-v${BUNDLED_NODE_VERSION}-win-x64.zip`,
    sha256: "7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c",
    executable: `node-v${BUNDLED_NODE_VERSION}-win-x64/node.exe`,
  },
  // Linux targets: used by CI smoke builds (ubuntu runners) and the standalone
  // host-runtime artifact. Desktop bundling itself stays on the three
  // platforms above (each desktop runner rebuilds its own platform runtime).
  "linux-x64": {
    archive: `node-v${BUNDLED_NODE_VERSION}-linux-x64.tar.gz`,
    sha256: "978978a635eef872fa68beae09f0aad0bbbae6757e444da80b570964a97e62a3",
    executable: `node-v${BUNDLED_NODE_VERSION}-linux-x64/bin/node`,
  },
  "linux-arm64": {
    archive: `node-v${BUNDLED_NODE_VERSION}-linux-arm64.tar.gz`,
    sha256: "b2f3a96f31486bfc365192ad65ced14833ad2a3c2e1bcefec4846902f264fa28",
    executable: `node-v${BUNDLED_NODE_VERSION}-linux-arm64/bin/node`,
  },
};

function parseArgs() {
  const args = {
    out: path.join(HOST_PKG, "dist-runtime"),
    version: process.env.PENGLAI_VERSION || null,
    nodeBinary: process.env.PENGLAI_NODE_BINARY || null,
    target: process.env.PENGLAI_RUNTIME_TARGET || defaultTarget(),
  };
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === "--out") args.out = path.resolve(process.argv[++index]);
    else if (value === "--version") args.version = process.argv[++index];
    else if (value === "--node") args.nodeBinary = path.resolve(process.argv[++index]);
    else if (value === "--target") args.target = process.argv[++index];
    else if (value === "-h" || value === "--help") {
      console.error(`Usage: node packages/host/scripts/build-runtime.mjs [options]

Options:
  --out <dir>       Runtime output directory
  --version <ver>   Penglai runtime version
  --node <file>     Explicit target Node executable
  --target <triple> Runtime target triple (default: inferred)

Without --node, the pinned official Node distribution is downloaded and its
hard-coded SHA-256 is verified.`);
      process.exit(0);
    }
  }
  return args;
}

function defaultTarget() {
  const targets = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
  };
  return targets[`${process.platform}-${process.arch}`] ?? `${process.platform}-${process.arch}`;
}

function die(message) {
  console.error("error:", JSON.stringify(String(message)));
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readRegularFile(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertSafeOutputDirectory(directory) {
  const resolved = path.resolve(directory);
  const forbidden = new Set([
    path.parse(resolved).root,
    path.resolve(os.homedir()),
    REPO_ROOT,
    HOST_PKG,
    PROTOCOL_PKG,
  ]);
  if (forbidden.has(resolved)) die(`refusing unsafe runtime output directory: ${resolved}`);
  if (!fs.existsSync(resolved)) return;
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) die(`runtime output must be a real directory: ${resolved}`);
  const entries = fs.readdirSync(resolved);
  if (entries.length === 0) return;
  // Tauri validates resource globs during ordinary `cargo check`, before the
  // release runtime exists. The committed sentinel keeps that glob valid in a
  // clean checkout and is the only non-manifest directory we may replace.
  if (entries.length === 1 && entries[0] === ".gitkeep") return;
  const manifestPath = path.join(resolved, "manifest.json");
  try {
    const manifest = readJson(manifestPath);
    if (manifest.name !== "@penglai/host-runtime" || manifest.schemaVersion !== 2) throw new Error("marker mismatch");
  } catch {
    die(`refusing to replace non-Penglai non-empty output directory: ${resolved}`);
  }
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      reject(new Error(`refusing non-HTTPS download URL: ${url}`));
      return;
    }
    if (redirects > MAX_DOWNLOAD_REDIRECTS) {
      reject(new Error(`too many redirects while downloading ${url}`));
      return;
    }
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        download(
          new URL(response.headers.location, url).toString(),
          destination,
          redirects + 1,
        )
          .then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`download ${url} returned HTTP ${response.statusCode}`));
        return;
      }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > MAX_NODE_ARCHIVE_BYTES) {
        response.resume();
        reject(new Error(`download ${url} exceeds the archive size limit`));
        return;
      }
      const temporary = `${destination}.partial`;
      const output = fs.createWriteStream(temporary, { mode: 0o600 });
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_NODE_ARCHIVE_BYTES) {
          request.destroy(new Error(`download ${url} exceeds the archive size limit`));
        }
      });
      response.pipe(output);
      output.on("finish", () => {
        output.close(() => {
          fs.renameSync(temporary, destination);
          resolve();
        });
      });
      output.on("error", (error) => {
        fs.rmSync(temporary, { force: true });
        reject(error);
      });
    });
    request.on("error", (error) => {
      fs.rmSync(`${destination}.partial`, { force: true });
      reject(error);
    });
  });
}

async function officialNodeBinary(target) {
  const distribution = NODE_DISTRIBUTIONS[target];
  if (!distribution) {
    die(`no pinned official Node distribution for target ${target}; use --node explicitly.`);
  }
  const cacheRoot = path.join(
    REPO_ROOT,
    "packages",
    "desktop",
    ".runtime-cache",
    `node-v${BUNDLED_NODE_VERSION}-${target}`,
  );
  const executableName = target.includes("windows") ? "node.exe" : "node";
  const cachedExecutable = path.join(cacheRoot, "bin", executableName);
  if (fs.existsSync(cachedExecutable)) {
    try {
      if (inspectNode(cachedExecutable) === BUNDLED_NODE_VERSION) return cachedExecutable;
    } catch {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(cacheRoot, { recursive: true });
  const archive = path.join(cacheRoot, distribution.archive);
  const url = `https://nodejs.org/dist/v${BUNDLED_NODE_VERSION}/${distribution.archive}`;
  if (!fs.existsSync(archive) || sha256File(archive) !== distribution.sha256) {
    fs.rmSync(archive, { force: true });
    console.log(`[runtime] download official Node ${BUNDLED_NODE_VERSION} for ${target}`);
    await download(url, archive);
  }
  if (sha256File(archive) !== distribution.sha256) {
    fs.rmSync(archive, { force: true });
    die(`official Node archive checksum mismatch for ${distribution.archive}`);
  }

  // Extract only the one pinned executable. This avoids trusting archive paths,
  // links, permissions, or unrelated members even after checksum validation.
  const result = spawnSync("tar", ["-xOf", archive, distribution.executable], {
    encoding: null,
    maxBuffer: MAX_NODE_ARCHIVE_BYTES,
  });
  if (result.status !== 0) {
    die(`extract official Node executable failed: ${result.stderr || result.error}`);
  }
  if (!Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
    die(`official Node executable is empty in ${distribution.archive}`);
  }
  fs.mkdirSync(path.dirname(cachedExecutable), { recursive: true });
  const temporaryExecutable = `${cachedExecutable}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporaryExecutable,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)),
      0o700,
    );
    fs.writeFileSync(descriptor, result.stdout);
    fs.fsyncSync(descriptor);
    if (!target.includes("windows")) fs.fchmodSync(descriptor, 0o755);
    fs.closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(temporaryExecutable, { force: true });
    throw error;
  }
  let version;
  try {
    version = inspectNode(temporaryExecutable);
  } catch (error) {
    fs.rmSync(temporaryExecutable, { force: true });
    throw error;
  }
  if (version !== BUNDLED_NODE_VERSION) {
    fs.rmSync(temporaryExecutable, { force: true });
    die(`official Node cache reports ${version}, expected ${BUNDLED_NODE_VERSION}`);
  }
  fs.renameSync(temporaryExecutable, cachedExecutable);
  return cachedExecutable;
}

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      die(`runtime payload must not contain symlinks: ${full}`);
    }
    if (entry.isDirectory()) walkFiles(full, output);
    else if (entry.isFile()) output.push(full);
    else die(`runtime payload has unsupported file type: ${full}`);
  }
  return output;
}

function relativePosix(file, base) {
  return path.relative(base, file).split(path.sep).join("/");
}

function resolveTsc() {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("typescript/bin/tsc");
  } catch {
    return path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
  }
}

function compile(tsconfig, label) {
  const tsc = resolveTsc();
  if (!fs.existsSync(tsc)) die('TypeScript is missing; run "npm install".');
  console.log(`[runtime] compile ${label}`);
  const result = spawnSync(process.execPath, [tsc, "-p", tsconfig], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) die(`${label} compilation failed with exit ${result.status}.`);
}

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) die(`invalid semantic version: ${version}`);
  return match.slice(1).map(Number);
}

function atLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  for (let index = 0; index < 3; index++) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function inspectNode(binary) {
  if (!binary || !fs.existsSync(binary)) die(`Node executable not found: ${binary}`);
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) die(`target Node failed to execute: ${result.stderr || result.error}`);
  const version = result.stdout.trim().replace(/^v/, "");
  if (!atLeast(version, MINIMUM_NODE_VERSION)) {
    die(`Node ${version} is too old; Penglai requires >=${MINIMUM_NODE_VERSION}.`);
  }
  return version;
}

function dependencyCandidate(ownerPath, dependency) {
  return ownerPath
    ? `${ownerPath}/node_modules/${dependency}`
    : `node_modules/${dependency}`;
}

function parentPackagePath(packagePath) {
  const marker = "/node_modules/";
  const index = packagePath.lastIndexOf(marker);
  if (index >= 0) return packagePath.slice(0, index);
  return "";
}

function resolveLockedDependency(packages, ownerPath, dependency) {
  let cursor = ownerPath;
  while (true) {
    const candidate = dependencyCandidate(cursor, dependency);
    if (packages[candidate]) return candidate;
    if (!cursor) return null;
    cursor = parentPackagePath(cursor);
  }
}

function productionDependencyClosure() {
  const lock = readJson(ROOT_LOCK_PATH);
  const packages = lock.packages;
  if (!packages || !packages["packages/host"]) {
    die("package-lock.json does not contain the @penglai/host workspace.");
  }

  const pending = [];
  const visited = new Set();
  const hostDependencies = packages["packages/host"].dependencies ?? {};
  for (const dependency of Object.keys(hostDependencies)) {
    if (dependency !== "@penglai/protocol") {
      pending.push({ owner: "packages/host", dependency, optional: false });
    }
  }
  // Voice engines are optional for a source/CLI installation so Host can
  // degrade to text, but a Desktop release runtime must carry every optional
  // dependency that is installed for its native target.  Omitting this seed
  // used to let monorepo tests pass while the standalone DMG silently lost
  // either SenseVoice or MOSS-TTS.
  const hostOptionalDependencies = packages["packages/host"].optionalDependencies ?? {};
  for (const dependency of Object.keys(hostOptionalDependencies)) {
    pending.push({ owner: "packages/host", dependency, optional: true });
  }

  while (pending.length > 0) {
    const request = pending.pop();
    const lockPath = resolveLockedDependency(packages, request.owner, request.dependency);
    if (!lockPath) {
      if (request.optional) continue;
      die(`cannot resolve locked dependency ${request.dependency} from ${request.owner}`);
    }
    if (visited.has(lockPath)) continue;
    const source = path.join(REPO_ROOT, ...lockPath.split("/"));
    if (!fs.existsSync(source)) {
      if (request.optional) continue;
      die(`installed dependency is missing: ${lockPath}; run "npm ci".`);
    }
    visited.add(lockPath);

    const entry = packages[lockPath];
    for (const dependency of Object.keys(entry.dependencies ?? {})) {
      pending.push({ owner: lockPath, dependency, optional: false });
    }
    for (const dependency of Object.keys(entry.optionalDependencies ?? {})) {
      pending.push({ owner: lockPath, dependency, optional: true });
    }
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    for (const dependency of Object.keys(entry.peerDependencies ?? {})) {
      pending.push({
        owner: lockPath,
        dependency,
        optional: optionalPeers[dependency]?.optional === true,
      });
    }
  }

  return {
    lock,
    packages,
    lockPaths: [...visited].sort(),
  };
}

function runtimeDependencyPath(lockPath) {
  const hostPrefix = "packages/host/";
  return lockPath.startsWith(hostPrefix) ? lockPath.slice(hostPrefix.length) : lockPath;
}

function copyProductionDependencies(outDirectory) {
  const closure = productionDependencyClosure();
  const licenses = [];
  const destinations = new Map();

  for (const lockPath of closure.lockPaths) {
    const source = path.join(REPO_ROOT, ...lockPath.split("/"));
    // npm stores workspace-specific versions below packages/host/node_modules.
    // The standalone runtime replaces that workspace, so those packages must
    // be rooted at runtime/node_modules or Node cannot resolve them from src/.
    const runtimePath = runtimeDependencyPath(lockPath);
    const previous = destinations.get(runtimePath);
    if (previous && previous !== lockPath) {
      die(`dependency paths ${previous} and ${lockPath} collide at ${runtimePath}`);
    }
    destinations.set(runtimePath, lockPath);
    const destination = path.join(outDirectory, ...runtimePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) {
      die(`locked runtime dependency must not be a symlink: ${lockPath}`);
    }
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: false,
      filter: (entry) => !entry.split(path.sep).includes(".cache"),
    });

    const metadata = closure.packages[lockPath];
    licenses.push({
      name: metadata.name ?? path.basename(lockPath),
      version: metadata.version ?? "unknown",
      license: metadata.license ?? "UNKNOWN",
      integrity: metadata.integrity ?? null,
      path: runtimePath,
      lockPath,
    });
  }

  licenses.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
  writeJson(path.join(outDirectory, "THIRD_PARTY_LICENSES.json"), {
    schemaVersion: 1,
    generatedFrom: "package-lock.json",
    packages: licenses,
  });
  return licenses;
}

function copyProtocol(outDirectory, version) {
  const protocolDist = path.join(PROTOCOL_PKG, "dist");
  const destination = path.join(outDirectory, "node_modules", "@penglai", "protocol");
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(protocolDist, destination, {
    recursive: true,
    filter: (entry) => !entry.endsWith(".d.ts") && !entry.endsWith(".d.ts.map"),
  });
  writeJson(path.join(destination, "package.json"), {
    name: "@penglai/protocol",
    version,
    type: "module",
    main: "./index.js",
  });
}

function runtimeReadme() {
  return `# Penglai Host Runtime (generated resource)

This directory is an application resource. It is complete and immutable:

- \`bin/node\` (or \`bin/node.exe\`) is the target-matching Node runtime;
- \`src/cli.js\` is the compiled Penglai Host entry;
- \`node_modules/\` is the exact production dependency closure;
- \`manifest.json\` records compatibility and SHA-256 for every payload file.

Start it only through the Penglai Desktop shell. The generated manifest carries
the exact platform entry command used by verification and diagnostics.

Python, a system Node installation, npm, and a source checkout are not used.
`;
}

async function main() {
  const args = parseArgs();
  const hostPackage = readJson(path.join(HOST_PKG, "package.json"));
  const protocolPackage = readJson(path.join(PROTOCOL_PKG, "package.json"));
  const version = args.version ?? hostPackage.version;
  if (hostPackage.version !== version || protocolPackage.version !== version) {
    die(
      `version mismatch: requested ${version}, Host ${hostPackage.version}, protocol ${protocolPackage.version}`,
    );
  }
  const nodeBinary = args.nodeBinary
    ? path.resolve(args.nodeBinary)
    : await officialNodeBinary(args.target);
  const nodeVersion = inspectNode(nodeBinary);
  const outDirectory = args.out;
  assertSafeOutputDirectory(outDirectory);
  const nodeFilename = args.target.includes("windows") ? "node.exe" : "node";
  const nodeRelativePath = `bin/${nodeFilename}`;

  console.log(`[runtime] Penglai ${version} for ${args.target}`);
  console.log(`[runtime] Node ${nodeVersion}: ${nodeBinary}`);
  console.log(`[runtime] output: ${outDirectory}`);

  compile(path.join(PROTOCOL_PKG, "tsconfig.json"), "@penglai/protocol");
  compile(path.join(HOST_PKG, "tsconfig.json"), "@penglai/host");

  const hostDist = path.join(HOST_PKG, "dist", "src");
  if (!fs.existsSync(path.join(hostDist, "cli.js"))) {
    die("Host compilation did not emit dist/src/cli.js.");
  }

  fs.rmSync(outDirectory, { recursive: true, force: true });
  fs.mkdirSync(outDirectory, { recursive: true });

  fs.cpSync(hostDist, path.join(outDirectory, "src"), {
    recursive: true,
    filter: (entry) => !entry.endsWith(".d.ts") && !entry.endsWith(".d.ts.map"),
  });
  // TypeScript does not copy the Apache-2.0 MOSS runtime's .mjs payload.
  // Keep it adjacent to the compiled TypeScript adapter so the lazy import
  // used by voice.synthesize resolves in the self-contained Desktop runtime.
  fs.cpSync(
    path.join(HOST_PKG, "src", "voice", "third_party"),
    path.join(outDirectory, "src", "voice", "third_party"),
    { recursive: true, filter: (entry) => !entry.endsWith(".d.mts") },
  );
  copyProtocol(outDirectory, protocolPackage.version);
  const licenses = copyProductionDependencies(outDirectory);

  const nodeDestination = path.join(outDirectory, "bin", nodeFilename);
  fs.mkdirSync(path.dirname(nodeDestination), { recursive: true });
  fs.copyFileSync(nodeBinary, nodeDestination);
  if (process.platform !== "win32") fs.chmodSync(nodeDestination, 0o755);
  if (inspectNode(nodeDestination) !== nodeVersion) {
    die("copied Node runtime failed its post-copy execution check");
  }

  writeJson(path.join(outDirectory, "package.json"), {
    name: "@penglai/host-runtime",
    version,
    type: "module",
    private: true,
    description: "Self-contained Penglai Desktop Host runtime.",
    engines: { node: `>=${MINIMUM_NODE_VERSION}` },
  });
  fs.writeFileSync(
    path.join(outDirectory, "README.md"),
    runtimeReadme(),
  );

  const payloadFiles = walkFiles(outDirectory).sort();
  const files = payloadFiles.map((file) => ({
    path: relativePosix(file, outDirectory),
    sha256: sha256File(file),
    size: fs.statSync(file).size,
  }));
  const schemaVersions = loadSchemaVersions();
  const requiredPackages = [
    ...Object.keys(hostPackage.dependencies ?? {}).filter(
      (dependency) => dependency !== "@penglai/protocol",
    ),
    ...Object.keys(hostPackage.optionalDependencies ?? {}),
  ].sort();
  const manifest = {
    schemaVersion: 2,
    name: "@penglai/host-runtime",
    productVersion: version,
    runtimeVersion: version,
    target: args.target,
    builtAt: new Date().toISOString(),
    protocolSchemaVersion: schemaVersions.protocolSchemaVersion,
    databaseSchemaVersion: schemaVersions.databaseSchemaVersion,
    minimumDesktopVersion: schemaVersions.minimumDesktopVersion,
    entry: "src/cli.js",
    node: {
      path: nodeRelativePath,
      version: nodeVersion,
      sha256: sha256File(nodeDestination),
    },
    dependencyCount: licenses.length,
    requiredPackages,
    requiredVoiceEngines: ["onnxruntime-node", "sherpa-onnx"],
    fileCount: files.length,
    totalSize: files.reduce((total, entry) => total + entry.size, 0),
    files,
  };
  writeJson(path.join(outDirectory, "manifest.json"), manifest);

  console.log(
    `[runtime] complete: ${manifest.fileCount} files, ${manifest.dependencyCount} packages, ${manifest.totalSize} bytes`,
  );
  console.log(`[runtime] boot: ${nodeRelativePath} ${manifest.entry} serve`);
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
