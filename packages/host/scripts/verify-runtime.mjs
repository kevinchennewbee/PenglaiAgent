#!/usr/bin/env node
/**
 * Fail-closed verification for a self-contained Penglai Host runtime.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_PKG = path.resolve(__dirname, "..");
const SCHEMA_VERSIONS_PATH = path.join(__dirname, "schema-versions.generated.json");

function loadSchemaVersions() {
  if (!fs.existsSync(SCHEMA_VERSIONS_PATH)) {
    throw new Error(
      `missing ${SCHEMA_VERSIONS_PATH}; run: node scripts/sync-schema-versions.mjs`,
    );
  }
  return JSON.parse(fs.readFileSync(SCHEMA_VERSIONS_PATH, "utf8"));
}

function parseArgs() {
  const args = {
    runtime: path.join(HOST_PKG, "dist-runtime"),
    port: 0,
    boot: true,
    doctor: true,
    timeout: 20_000,
    expectedVersion: process.env.PENGLAI_VERSION || null,
    expectedTarget: process.env.PENGLAI_RUNTIME_TARGET || null,
  };
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === "--runtime") args.runtime = path.resolve(process.argv[++index]);
    else if (value === "--port") args.port = Number(process.argv[++index]);
    else if (value === "--no-boot") args.boot = false;
    else if (value === "--no-doctor") args.doctor = false;
    else if (value === "--timeout") args.timeout = Number(process.argv[++index]);
    else if (value === "--version") args.expectedVersion = process.argv[++index];
    else if (value === "--target") args.expectedTarget = process.argv[++index];
    else if (value === "-h" || value === "--help") {
      console.error(`Usage: node packages/host/scripts/verify-runtime.mjs [options]

Options:
  --runtime <dir>  Runtime directory
  --port <n>       Boot smoke port (default: 0, automatic)
  --no-boot        Skip Host boot and compatibility handshake
  --no-doctor      Skip runtime doctor
  --timeout <ms>   Per-check timeout
  --version <ver>  Require this exact product/runtime version
  --target <triple> Require this exact runtime target`);
      process.exit(0);
    }
  }
  return args;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`runtime payload must not contain symlinks: ${full}`);
    }
    if (entry.isDirectory()) walkFiles(full, output);
    else if (entry.isFile()) output.push(full);
    else throw new Error(`runtime payload has unsupported file type: ${full}`);
  }
  return output;
}

function relativePosix(file, base) {
  return path.relative(base, file).split(path.sep).join("/");
}

function safePayloadPath(runtimeDirectory, relativePath) {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`unsafe manifest path: ${relativePath}`);
  }
  const resolved = path.resolve(runtimeDirectory, ...relativePath.split("/"));
  const root = `${path.resolve(runtimeDirectory)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error(`manifest path escapes runtime: ${relativePath}`);
  return resolved;
}

function verifyManifest(runtimeDirectory, expectedVersion = null, expectedTarget = null) {
  const manifestPath = path.join(runtimeDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("manifest.json is missing");
  if (fs.lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error("manifest.json must not be a symlink");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 2) {
    throw new Error(`unsupported runtime manifest schema: ${manifest.schemaVersion}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) {
    throw new Error("runtime manifest file count is inconsistent");
  }
  if (manifest.productVersion !== manifest.runtimeVersion) {
    throw new Error("runtime product and Host versions disagree");
  }
  if (expectedVersion && manifest.productVersion !== expectedVersion) {
    throw new Error(
      `runtime version mismatch: expected ${expectedVersion}, found ${manifest.productVersion}`,
    );
  }
  if (expectedTarget && manifest.target !== expectedTarget) {
    throw new Error(`runtime target mismatch: expected ${expectedTarget}, found ${manifest.target}`);
  }

  const expected = new Set();
  let totalSize = 0;
  for (const entry of manifest.files) {
    const file = safePayloadPath(runtimeDirectory, entry.path);
    if (expected.has(entry.path)) throw new Error(`duplicate runtime manifest path: ${entry.path}`);
    expected.add(entry.path);
    if (
      !fs.existsSync(file) ||
      fs.lstatSync(file).isSymbolicLink() ||
      !fs.statSync(file).isFile()
    ) {
      throw new Error(`runtime payload is missing: ${entry.path}`);
    }
    const size = fs.statSync(file).size;
    totalSize += size;
    if (size !== entry.size) throw new Error(`runtime payload size mismatch: ${entry.path}`);
    if (sha256File(file) !== entry.sha256) {
      throw new Error(`runtime payload hash mismatch: ${entry.path}`);
    }
  }

  const actual = walkFiles(runtimeDirectory)
    .map((file) => relativePosix(file, runtimeDirectory))
    .filter((file) => file !== "manifest.json");
  const unexpected = actual.filter((file) => !expected.has(file));
  const actualSet = new Set(actual);
  const missing = [...expected].filter((file) => !actualSet.has(file));
  if (unexpected.length > 0) {
    throw new Error(`untracked runtime payload: ${unexpected.slice(0, 5).join(", ")}`);
  }
  if (missing.length > 0) {
    throw new Error(`missing runtime payload: ${missing.slice(0, 5).join(", ")}`);
  }
  if (totalSize !== manifest.totalSize) throw new Error("runtime total size is inconsistent");

  for (const listName of ["requiredPackages", "requiredVoiceEngines"]) {
    const dependencies = manifest[listName];
    if (!Array.isArray(dependencies) || dependencies.length === 0) {
      throw new Error(`runtime manifest ${listName} must be a non-empty array`);
    }
    for (const dependency of dependencies) {
      if (typeof dependency !== "string" || !/^[a-z0-9@/_-]+$/.test(dependency)) {
        throw new Error(`invalid ${listName} dependency: ${dependency}`);
      }
      const packageJson = `node_modules/${dependency}/package.json`;
      if (!expected.has(packageJson)) {
        throw new Error(`required runtime package is missing: ${dependency}`);
      }
    }
  }

  const nodePath = safePayloadPath(runtimeDirectory, manifest.node?.path);
  const entryPath = safePayloadPath(runtimeDirectory, manifest.entry);
  if (!expected.has(manifest.node?.path) || !expected.has(manifest.entry)) {
    throw new Error("runtime node/entry must be tracked by the manifest");
  }
  if (sha256File(nodePath) !== manifest.node.sha256) {
    throw new Error("bundled Node hash does not match runtime metadata");
  }
  if (!fs.existsSync(entryPath)) throw new Error("Host entry is missing");

  const nodeCheck = spawnSync(nodePath, ["--version"], { encoding: "utf8" });
  if (nodeCheck.status !== 0) throw new Error("bundled Node cannot execute on this target");
  const actualNodeVersion = nodeCheck.stdout.trim().replace(/^v/, "");
  if (actualNodeVersion !== manifest.node.version) {
    throw new Error(
      `bundled Node version mismatch: manifest ${manifest.node.version}, executable ${actualNodeVersion}`,
    );
  }
  return { manifest, nodePath };
}

function getJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`invalid health JSON: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("health timeout")));
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 3_000),
    ),
  ]);
}

function bootHost(runtimeDirectory, nodePath, port, timeout) {
  return new Promise((resolve) => {
    const child = spawn(nodePath, ["src/cli.js", "serve", "--port", String(port)], {
      cwd: runtimeDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const deadline = setTimeout(() => finish({ ok: false, error: "Host boot timeout" }), timeout);

    async function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      await stopChild(child);
      resolve({ ...result, stderr: stderr.trim() });
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/serving on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match || settled) return;
      const actualPort = Number(match[1]);
      getJson(`http://127.0.0.1:${actualPort}/health`, timeout)
        .then((handshake) => {
          const schemaVersions = loadSchemaVersions();
          const compatible =
            handshake.ok === true &&
            handshake.product === "Penglai" &&
            handshake.runtime === "host" &&
            handshake.protocolSchemaVersion === schemaVersions.protocolSchemaVersion &&
            handshake.databaseSchemaVersion === schemaVersions.databaseSchemaVersion;
          return finish(
            compatible
              ? { ok: true, port: actualPort, handshake }
              : { ok: false, error: "Host compatibility handshake failed", handshake },
          );
        })
        .catch((error) => finish({ ok: false, error: error.message }));
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("exit", (code) => {
      if (!settled) finish({ ok: false, error: `Host exited early with ${code}` });
    });
  });
}

function runDoctor(runtimeDirectory, nodePath, timeout) {
  return new Promise((resolve) => {
    const script =
      'import { runDoctor } from "./src/doctor.js";\n' +
      "const results = await runDoctor({ port: 0 });\n" +
      "console.log(JSON.stringify(results));\n" +
      'process.exit(results.some((entry) => entry.status === "fail") ? 1 : 0);\n';
    const child = spawn(nodePath, ["--input-type=module", "-e", script], {
      cwd: runtimeDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "doctor timeout", stderr });
    }, timeout);
    child.on("exit", (code) => {
      clearTimeout(deadline);
      let results;
      try {
        results = JSON.parse(stdout.trim().split("\n").pop());
      } catch {
        results = null;
      }
      resolve({ ok: code === 0 && Array.isArray(results), results, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(deadline);
      resolve({ ok: false, error: error.message, stderr });
    });
  });
}

function report(name, result, detail) {
  console.log(`[verify] ${result ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

async function main() {
  const args = parseArgs();
  if (!fs.existsSync(args.runtime)) throw new Error(`runtime not found: ${args.runtime}`);

  const verified = verifyManifest(args.runtime, args.expectedVersion, args.expectedTarget);
  report(
    "manifest",
    true,
    `${verified.manifest.fileCount} files, Node ${verified.manifest.node.version}, ${verified.manifest.target}`,
  );

  if (args.boot) {
    const boot = await bootHost(args.runtime, verified.nodePath, args.port, args.timeout);
    report("boot", boot.ok, boot.ok ? `compatible Host on :${boot.port}` : boot.error);
    if (!boot.ok) throw new Error(boot.stderr || boot.error);
  }

  if (args.doctor) {
    const doctor = await runDoctor(args.runtime, verified.nodePath, args.timeout);
    report(
      "doctor",
      doctor.ok,
      doctor.ok ? `${doctor.results.length} checks, 0 failed` : doctor.error ?? "doctor failed",
    );
    if (!doctor.ok) throw new Error(doctor.stderr || doctor.error);
  }
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
