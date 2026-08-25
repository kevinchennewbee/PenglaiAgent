import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("assemble-release refuses a signing key that does not match the embedded updater identity", () => {
  const temp = mkdtempSync(join(tmpdir(), "penglai-assemble-release-"));
  try {
    const staging = join(temp, "staging");
    mkdirSync(staging);
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const names = [
      "Penglai_0.5.7_macos_aarch64.dmg",
      "Penglai_0.5.7_macos_x64.dmg",
      "Penglai_0.5.7_windows_x64_setup.exe",
    ];
    const assets = names.map((name, index) => {
      const bytes = Buffer.from(`native-fixture-${index}`);
      writeFileSync(join(staging, name), bytes);
      return { id: 1000 + index, name, size: bytes.length, digest: `sha256:${sha256(bytes)}` };
    });
    const publicExport = join(temp, "public-export-manifest.json");
    const publicExportEvidence = join(temp, "public-export.json");
    const tree = "e".repeat(64);
    writeFileSync(publicExport, JSON.stringify({ publicExportTreeSha256: tree, files: [] }));
    writeFileSync(
      publicExportEvidence,
      JSON.stringify({
        publicExportTreeSha256: tree,
        privateCandidateSourceSha: sourceSha,
        treeDirty: false,
        cleanRoom: { executed: true },
      }),
    );
    const sbom = join(temp, "sbom.json");
    const notices = join(temp, "notices.txt");
    writeFileSync(sbom, "{}\n");
    writeFileSync(notices, "fixture notices\n");
    const releaseJson = join(temp, "release.json");
    writeFileSync(
      releaseJson,
      JSON.stringify({ id: 77, tag_name: "v0.5.7", draft: true, prerelease: false, immutable: false, assets }),
    );
    const keyFile = join(temp, "private.pem");
    writeFileSync(
      keyFile,
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/assemble-release.mjs",
        "--staging",
        staging,
        "--source-sha",
        sourceSha,
        "--release-json",
        releaseJson,
        "--public-export",
        publicExport,
        "--public-export-evidence",
        publicExportEvidence,
        "--sbom",
        sbom,
        "--notices",
        notices,
        "--issued-at",
        "2026-08-24T00:00:00.000Z",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PENGLAI_UPDATER_PRIVATE_KEY_FILE: keyFile },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ed25519 signature mismatch/);
    assert.equal(statSync(join(staging, "update-manifest-v1.json.sig")).size, 64);
    const update = JSON.parse(readFileSync(join(staging, "update-manifest-v1.json"), "utf8"));
    assert.equal(update.sequence, 5);
    assert.equal(update.version, "0.5.7");
    assert.equal(update.releaseManifestSha256, sha256(readFileSync(join(staging, "release-manifest.json"))));
    assert.notEqual(update.releaseManifestSha256, sha256(readFileSync(join(staging, "update-manifest-v1.json"))));
    assert.equal(readdirSync(staging).includes("SHA256SUMS"), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
