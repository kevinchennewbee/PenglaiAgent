import { createHash } from "node:crypto";
import { ROOT } from "./lib/repo.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { EXACT_RELEASE_ASSETS } from "../packages/release-identity/src/contract.ts";
import {
  EMBEDDED_UPDATER_PUBLIC_KEY,
  parseAppUpdateManifest,
  verifyBytes,
} from "../packages/plugin-registry/src/index.ts";

const repo = "kevinchennewbee/PenglaiAgent";
const tag = process.argv[2] || `v${PRODUCT_VERSION}`;
const api = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
const response = await fetch(api, {
  redirect: "manual",
  headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
});
if (response.status !== 200) {
  finish("INCOMPLETE", { command: "readback-release", reason: `GitHub ${response.status}`, tag });
}
const release = await response.json();
const assets = Array.isArray(release.assets) ? release.assets : [];
const expected = [...EXACT_RELEASE_ASSETS].sort();
const names = assets.map((asset) => String(asset.name)).sort();
if (
  release.tag_name !== tag ||
  release.draft !== false ||
  release.prerelease !== false ||
  release.immutable !== true ||
  JSON.stringify(names) !== JSON.stringify(expected)
) {
  finish("FAIL", {
    command: "readback-release",
    reason: "release is mutable, unpublished, prerelease, or has the wrong exact asset set",
    tag,
    immutable: release.immutable === true,
    draft: release.draft,
    prerelease: release.prerelease,
    expected,
    actual: names,
  });
}

const allowedDownloadHosts = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

async function downloadAsset(url, name) {
  let current = url;
  for (let hop = 0; hop <= 4; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !allowedDownloadHosts.has(parsed.hostname)) {
      finish("FAIL", { command: "readback-release", reason: `asset ${name} redirect host refused`, url: current });
    }
    const body = await fetch(current, { redirect: "manual" });
    if (body.status === 200) return Buffer.from(await body.arrayBuffer());
    if (body.status < 300 || body.status >= 400 || hop === 4) {
      finish("FAIL", { command: "readback-release", reason: `asset ${name} ${body.status}` });
    }
    const location = body.headers.get("location");
    await body.body?.cancel?.();
    if (!location) {
      finish("FAIL", { command: "readback-release", reason: `asset ${name} redirect missing location` });
    }
    current = new URL(location, current).href;
  }
  finish("FAIL", { command: "readback-release", reason: `asset ${name} redirect limit` });
}

const rows = [];
const bytesByName = new Map();
for (const asset of assets) {
  const bytes = await downloadAsset(asset.browser_download_url, asset.name);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const githubDigest = typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/, "") : "";
  if (bytes.length !== asset.size || (githubDigest && githubDigest !== sha256)) {
    finish("FAIL", {
      command: "readback-release",
      reason: `asset ${asset.name} size or GitHub digest mismatch`,
    });
  }
  bytesByName.set(asset.name, bytes);
  rows.push({
    name: asset.name,
    size: bytes.length,
    declared: asset.size,
    sha256,
  });
}

const sums = bytesByName.get("SHA256SUMS")?.toString("utf8").trim().split(/\r?\n/) ?? [];
const declaredSums = new Map(
  sums.map((line) => {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/.exec(line);
    if (!match) finish("FAIL", { command: "readback-release", reason: "SHA256SUMS line invalid", line });
    return [match[2], match[1]];
  }),
);
const sumNames = names.filter((name) => name !== "SHA256SUMS").sort();
if (JSON.stringify([...declaredSums.keys()].sort()) !== JSON.stringify(sumNames)) {
  finish("FAIL", { command: "readback-release", reason: "SHA256SUMS exact set mismatch" });
}
for (const row of rows.filter((asset) => asset.name !== "SHA256SUMS")) {
  if (declaredSums.get(row.name) !== row.sha256) {
    finish("FAIL", { command: "readback-release", reason: `SHA256SUMS mismatch for ${row.name}` });
  }
}

const updateBytes = bytesByName.get("update-manifest-v1.json");
const updateSignature = bytesByName.get("update-manifest-v1.json.sig");
const releaseManifestBytes = bytesByName.get("release-manifest.json");
if (!updateBytes || !updateSignature || !releaseManifestBytes) {
  finish("FAIL", { command: "readback-release", reason: "signed release metadata missing" });
}
verifyBytes(updateBytes, updateSignature, EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex);
const update = parseAppUpdateManifest(JSON.parse(updateBytes.toString("utf8")));
const releaseManifest = JSON.parse(releaseManifestBytes.toString("utf8"));
const sourceIdentity = createHash("sha256")
  .update(String(releaseManifest.privateCandidateSourceSha ?? ""))
  .digest("hex");
if (
  update.version !== PRODUCT_VERSION ||
  update.releaseTag !== tag ||
  update.signingKeyId !== EMBEDDED_UPDATER_PUBLIC_KEY.keyId ||
  update.publicExportTreeSha256 !== releaseManifest.publicExportTreeSha256 ||
  update.candidateSourceSha !== sourceIdentity
) {
  finish("FAIL", { command: "readback-release", reason: "update and release identity mismatch" });
}

for (const [target, platform] of Object.entries(update.platforms)) {
  const filename =
    target === "darwin-aarch64"
      ? `Penglai_${PRODUCT_VERSION}_macos_aarch64.dmg`
      : target === "darwin-x86_64"
        ? `Penglai_${PRODUCT_VERSION}_macos_x64.dmg`
        : target === "win32-x86_64"
          ? `Penglai_${PRODUCT_VERSION}_windows_x64_setup.exe`
          : "";
  const installer = bytesByName.get(filename);
  const githubAsset = assets.find((asset) => asset.name === filename);
  if (
    !filename ||
    !installer ||
    !githubAsset ||
    platform.assetId !== githubAsset.id ||
    platform.size !== installer.length ||
    platform.sha256 !== createHash("sha256").update(installer).digest("hex")
  ) {
    finish("FAIL", { command: "readback-release", reason: `update platform identity mismatch for ${target}` });
  }
  verifyBytes(installer, Buffer.from(platform.signature, "base64"), EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex);
}

if (Object.keys(update.platforms).sort().join(",") !== "darwin-aarch64,darwin-x86_64,win32-x86_64") {
  finish("FAIL", { command: "readback-release", reason: "update manifest does not cover exactly three targets" });
}

finish("PASS", {
  command: "readback-release",
  cwd: ROOT,
  tag,
  immutable: true,
  updateSignature: true,
  installerSignatures: true,
  assets: rows,
});
