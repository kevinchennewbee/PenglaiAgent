import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { parseTargetArg } from "./lib/release-targets.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { currentNativeLifecycleScope } from "./lib/native-upgrade-set.mjs";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifiedPinnedBytes(directory, pinned) {
  const bytes = readFileSync(join(directory, pinned.name));
  if (bytes.length !== pinned.size || createHash("sha256").update(bytes).digest("hex") !== pinned.sha256) {
    throw new Error(`upgrade source download digest mismatch: ${pinned.name}`);
  }
  return bytes;
}

const pins = JSON.parse(readFileSync(join(ROOT, `docs/${PRODUCT_VERSION}/UPGRADE_SOURCES.json`), "utf8"));
const releaseContract = JSON.parse(readFileSync(join(ROOT, "release-contract.json"), "utf8"));
const updaterPublicKeyHex = String(releaseContract.updaterPublicKeyHex ?? "");
const updaterPublicKeyId = String(releaseContract.updaterPublicKeyId ?? "");
if (!/^[0-9a-f]{64}$/.test(updaterPublicKeyHex) || !updaterPublicKeyId) {
  throw new Error("release contract updater verification key is invalid");
}
const scope = currentNativeLifecycleScope(pins);
if (!scope.fetchPreviousInstallers && !process.argv.includes("--historical")) {
  const rec = {
    command: "fetch-upgrade-sources",
    verdict: "INCOMPLETE",
    reason: "current workflow does not fetch previous installers; older installed upgrade is OWNER_EXCLUDED",
    olderInstalledUpgradeStatus: scope.olderInstalledUpgradeStatus,
    requiredLifecycleGate: scope.requiredLifecycleGate,
    fetchPreviousInstallers: false,
  };
  console.error(JSON.stringify(rec));
  process.exit(2);
}
const target = parseTargetArg();
const suffix = { "darwin-aarch64": "macos_aarch64.dmg", "darwin-x86_64": "macos_x64.dmg", "win32-x86_64": "windows_x64_setup.exe" }[target];
if (!suffix) throw new Error("unsupported upgrade source target");
for (const source of pins.sources) {
  const name = `Penglai_${source.version}_${suffix}`;
  const pinned = source.assets.find((asset) => asset.name === name);
  if (!pinned) throw new Error(`missing pinned upgrade source ${name}`);
  const release = JSON.parse(execFileSync("gh", ["api", `repos/${pins.repository}/releases/tags/${source.tag}`], { encoding: "utf8" }));
  if (release.id !== source.releaseId || release.tag_name !== source.tag || release.target_commitish !== source.sourceSha || release.immutable !== true || release.draft) {
    throw new Error(`immutable upgrade source identity drift: ${name}`);
  }
  for (const expected of source.assets) {
    const asset = release.assets?.find((row) => row.name === expected.name);
    if (!asset || asset.id !== expected.id || asset.size !== expected.size || asset.digest !== `sha256:${expected.sha256}`) {
      throw new Error(`immutable upgrade source asset drift: ${expected.name}`);
    }
  }
  const directory = join(ROOT, ".previous", source.version);
  mkdirSync(directory, { recursive: true });
  const manifestPin = source.assets.find((asset) => asset.name === "update-manifest-v1.json");
  const signaturePin = source.assets.find((asset) => asset.name === "update-manifest-v1.json.sig");
  if (!manifestPin || !signaturePin || !Number.isSafeInteger(source.updateSequence)) {
    throw new Error(`previous release ${source.version} lacks signed update identity pins`);
  }
  for (const download of [pinned, manifestPin, signaturePin]) {
    execFileSync("gh", ["release", "download", source.tag, "--repo", pins.repository, "--pattern", download.name, "--dir", directory, "--clobber"], { stdio: "inherit" });
  }
  verifiedPinnedBytes(directory, pinned);
  const manifestBytes = verifiedPinnedBytes(directory, manifestPin);
  const signatureBytes = verifiedPinnedBytes(directory, signaturePin);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest.schema !== "penglai.app-update.v1" ||
    manifest.version !== source.version ||
    manifest.releaseTag !== source.tag ||
    manifest.sequence !== source.updateSequence ||
    manifest.signingKeyId !== updaterPublicKeyId
  ) {
    throw new Error(`previous release ${source.version} update manifest identity drift`);
  }
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(updaterPublicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
  if (signatureBytes.length !== 64 || !verifySignature(null, manifestBytes, publicKey, signatureBytes)) {
    throw new Error(`previous release ${source.version} update signature invalid`);
  }
  console.log(JSON.stringify({ version: source.version, target, installer: name, sha256: pinned.sha256, verified: true }));
}
