import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
export const CONTRACT_PATH = path.join(HERE, "release-contract.json");
export const CANONICAL_REPOSITORY = "kevinchennewbee/PenglaiAgent";

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function assertReleaseContractIdentity(contract) {
  if (contract.schemaVersion !== 1) {
    throw new Error(`unsupported release contract schema: ${contract.schemaVersion}`);
  }
  if (contract.repository !== CANONICAL_REPOSITORY) {
    throw new Error(
      `release repository must remain ${CANONICAL_REPOSITORY}: ${String(contract.repository)}`,
    );
  }
  if (!/^0\.4\.(0|[1-9]\d*)$/.test(contract.version)) {
    throw new Error(`release contract version must be stable 0.4.x: ${contract.version}`);
  }
  if (contract.releaseLine !== "0.4" || contract.channelTag !== "desktop-v0.4") {
    throw new Error("release line and updater channel must remain bound to desktop-v0.4");
  }
  if (!Array.isArray(contract.platforms) || contract.platforms.length !== 3) {
    throw new Error("release contract must define exactly three desktop platforms");
  }
  const keys = new Set(contract.platforms.map((platform) => platform.key));
  for (const key of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    if (!keys.has(key)) throw new Error(`release contract is missing ${key}`);
  }
  return contract;
}

export function loadReleaseContract() {
  return assertReleaseContractIdentity(readJson(CONTRACT_PATH));
}

export function releaseTag(version) {
  return `v${version}`;
}

export function assertReleaseTag(tag, contract = loadReleaseContract()) {
  if (!/^v0\.4\.(0|[1-9]\d*)$/.test(tag ?? "")) {
    throw new Error(`release tag must be strict v0.4.x stable semver: ${tag ?? "<missing>"}`);
  }
  const expected = releaseTag(contract.version);
  if (tag !== expected) {
    throw new Error(`release tag/version mismatch: expected ${expected}, received ${tag}`);
  }
  return contract.version;
}

function cargoPackageVersion(file) {
  const text = fs.readFileSync(file, "utf8");
  const packageSection = text.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error(`cannot read Cargo package version from ${file}`);
  return version;
}

function cargoLockPackageVersion(file, packageName) {
  const text = fs.readFileSync(file, "utf8");
  const blocks = text.split("[[package]]");
  for (const block of blocks) {
    if (block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] === packageName) {
      const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
      if (version) return version;
    }
  }
  throw new Error(`cannot read ${packageName} version from ${file}`);
}

export function repositoryVersions(root = REPO_ROOT) {
  const packageLock = readJson(path.join(root, "package-lock.json"));
  return new Map([
    ["release contract", loadReleaseContract().version],
    ["Host package", readJson(path.join(root, "packages/host/package.json")).version],
    ["protocol package", readJson(path.join(root, "packages/protocol/package.json")).version],
    ["Desktop package", readJson(path.join(root, "packages/desktop/package.json")).version],
    ["Tauri config", readJson(path.join(root, "packages/desktop/src-tauri/tauri.conf.json")).version],
    ["Cargo package", cargoPackageVersion(path.join(root, "packages/desktop/src-tauri/Cargo.toml"))],
    [
      "Cargo lock root package",
      cargoLockPackageVersion(
        path.join(root, "packages/desktop/src-tauri/Cargo.lock"),
        "penglai-desktop-04",
      ),
    ],
    ["package-lock Desktop workspace", packageLock.packages?.["packages/desktop"]?.version],
    ["package-lock Host workspace", packageLock.packages?.["packages/host"]?.version],
    ["package-lock protocol workspace", packageLock.packages?.["packages/protocol"]?.version],
  ]);
}

export function assertRepositoryVersions(root = REPO_ROOT, contract = loadReleaseContract()) {
  const versions = repositoryVersions(root);
  const mismatches = [...versions].filter(([, version]) => version !== contract.version);
  if (mismatches.length > 0) {
    throw new Error(
      `release version drift (expected ${contract.version}): ${mismatches
        .map(([name, version]) => `${name}=${version ?? "<missing>"}`)
        .join(", ")}`,
    );
  }
  return versions;
}

export function updaterBundleName(platform, version) {
  return `Penglai_${version}_${platform.bundleSuffix}`;
}

export function installerName(platform, version) {
  return `Penglai_${version}_${platform.installerSuffix}`;
}

export function expectedReleaseAssetNames(contract = loadReleaseContract()) {
  const names = new Set();
  for (const platform of contract.platforms) {
    const bundle = updaterBundleName(platform, contract.version);
    names.add(bundle);
    names.add(`${bundle}.sig`);
    if (platform.os === "macos") {
      const installer = installerName(platform, contract.version);
      names.add(installer);
      names.add(`${installer}.sig`);
    }
  }
  for (const suffix of contract.standaloneRuntime.archiveSuffixes) {
    names.add(`penglai-host-runtime-${contract.version}-${suffix}`);
  }
  for (const name of [
    "latest.json",
    "SBOM.cdx.json",
    "THIRD_PARTY_NOTICES.txt",
    "SHA256SUMS",
    "SHA256SUMS.sig",
  ]) {
    names.add(name);
  }
  return [...names].sort();
}

export function unsignedReleaseAssetNames(contract = loadReleaseContract()) {
  return expectedReleaseAssetNames(contract).filter(
    (name) => name !== "SHA256SUMS" && name !== "SHA256SUMS.sig",
  );
}

export function readUpdaterPublicKey(root = REPO_ROOT) {
  const config = readJson(path.join(root, "packages/desktop/src-tauri/tauri.conf.json"));
  const encoded = config.plugins?.updater?.pubkey;
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("Tauri updater public key is missing");
  }
  return encoded;
}

function decodeOuterBase64(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) {
    throw new Error(`${label} is not base64 text`);
  }
  const compact = value.replace(/\s+/g, "");
  const decoded = Buffer.from(compact, "base64");
  if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) {
    throw new Error(`${label} has invalid base64 encoding`);
  }
  return decoded;
}

function ed25519PublicKey(raw) {
  if (raw.length !== 32) throw new Error("minisign public key payload must be 32 bytes");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([spkiPrefix, raw]), format: "der", type: "spki" });
}

/**
 * Verify the base64-wrapped minisign format emitted by `tauri signer sign`.
 * This mirrors tauri-plugin-updater: identifier equality, Ed25519/Blake2b payload
 * signature, and the global signature covering the trusted comment.
 */
export function verifyUpdaterSignature(data, encodedSignature, encodedPublicKey) {
  const publicText = decodeOuterBase64(encodedPublicKey.trim(), "updater public key").toString("utf8");
  const publicLines = publicText.trim().split(/\r?\n/);
  if (publicLines.length !== 2 || !publicLines[0].startsWith("untrusted comment:")) {
    throw new Error("updater public key has invalid minisign text");
  }
  const publicRecord = Buffer.from(publicLines[1], "base64");
  if (publicRecord.length !== 42 || !["Ed", "ED"].includes(publicRecord.subarray(0, 2).toString("ascii"))) {
    throw new Error("updater public key record is invalid");
  }

  const signatureText = decodeOuterBase64(encodedSignature.trim(), "updater signature").toString("utf8");
  const lines = signatureText.trim().split(/\r?\n/);
  if (lines.length !== 4 || !lines[0].startsWith("untrusted comment:") || !lines[2].startsWith("trusted comment: ")) {
    throw new Error("updater signature has invalid minisign text");
  }
  const signatureRecord = Buffer.from(lines[1], "base64");
  const globalSignature = Buffer.from(lines[3], "base64");
  if (signatureRecord.length !== 74 || globalSignature.length !== 64) {
    throw new Error("updater signature record has invalid length");
  }
  const algorithm = signatureRecord.subarray(0, 2).toString("ascii");
  if (!['Ed', 'ED'].includes(algorithm)) throw new Error(`unsupported minisign algorithm: ${algorithm}`);
  if (!crypto.timingSafeEqual(publicRecord.subarray(2, 10), signatureRecord.subarray(2, 10))) {
    throw new Error("updater signature key id does not match embedded public key");
  }

  const publicKey = ed25519PublicKey(publicRecord.subarray(10));
  const payload = algorithm === "ED" ? crypto.createHash("blake2b512").update(data).digest() : data;
  const signature = signatureRecord.subarray(10);
  if (!crypto.verify(null, payload, publicKey, signature)) {
    throw new Error("updater payload signature verification failed");
  }
  const trustedComment = Buffer.from(lines[2].slice("trusted comment: ".length), "utf8");
  if (!crypto.verify(null, Buffer.concat([signature, trustedComment]), publicKey, globalSignature)) {
    throw new Error("updater trusted-comment signature verification failed");
  }
  return true;
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function releaseMatrix(contract = loadReleaseContract()) {
  return { include: contract.platforms };
}
