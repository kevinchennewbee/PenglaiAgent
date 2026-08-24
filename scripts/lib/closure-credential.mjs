import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CLOSURE_CREDENTIAL_SCHEMA = 1;

export function hostTarget(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return "darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "darwin-x86_64";
  if (platform === "win32" && arch === "x64") return "win32-x86_64";
  throw new Error(`unsupported host ${platform}/${arch}`);
}

export function stagingForTarget(root, target, host = hostTarget()) {
  return target === host ? join(root, "dist", "runtime-staging") : join(root, "dist", `runtime-staging-${target}`);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function writeClosureCredential(staging, record) {
  const dest = join(staging, ".closure-complete");
  const tmp = join(staging, `.closure-complete.${process.pid}.${Date.now().toString(36)}.tmp`);
  writeFileSync(tmp, `${JSON.stringify({ schemaVersion: CLOSURE_CREDENTIAL_SCHEMA, ...record }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, dest);
  return dest;
}

export function inspectClosureCredential({ staging, candidateSha, expectedTarget }) {
  const markerPath = join(staging, ".closure-complete");
  const manifestPath = join(staging, "runtime-manifest.json");
  if (!existsSync(markerPath)) {
    return { verdict: "INCOMPLETE", reason: "production closure credential missing" };
  }
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return { verdict: "STALE", reason: "legacy or malformed closure credential" };
  }
  if (marker.schemaVersion !== CLOSURE_CREDENTIAL_SCHEMA) {
    return { verdict: "STALE", reason: "closure credential schema mismatch" };
  }
  if (marker.sourceSha !== candidateSha) {
    return { verdict: "STALE", reason: `closure source ${marker.sourceSha ?? "missing"} != candidate ${candidateSha}` };
  }
  if (marker.target !== expectedTarget) {
    return { verdict: "FAIL", reason: `closure target ${marker.target ?? "missing"} != ${expectedTarget}` };
  }
  if (!existsSync(manifestPath)) {
    return { verdict: "FAIL", reason: "closure credential exists but runtime manifest is missing" };
  }
  const manifestSha256 = sha256File(manifestPath);
  if (marker.manifestSha256 !== manifestSha256) {
    return { verdict: "STALE", reason: "runtime manifest changed after closure completion" };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { verdict: "FAIL", reason: "runtime manifest is malformed" };
  }
  if (manifest.target !== expectedTarget || manifest.release !== "0.5.6" || manifest.dsh !== "0.1.1-rc.2") {
    return { verdict: "FAIL", reason: "runtime manifest identity mismatch" };
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { verdict: "FAIL", reason: "runtime manifest has no closure files" };
  }
  return { verdict: "PASS", marker, manifest, manifestSha256 };
}
