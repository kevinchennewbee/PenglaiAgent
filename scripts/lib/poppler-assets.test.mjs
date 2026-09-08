import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  POPPLER_ASSETS,
  POPPLER_UPSTREAM,
  popplerAssetForHost,
  popplerAssetForTarget,
} from "./poppler-assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("Poppler helper is a three-target conda 26.09.0 pin, not Homebrew or poppler-windows", () => {
  assert.equal(POPPLER_UPSTREAM.version, "26.09.0");
  assert.equal(POPPLER_UPSTREAM.license, "GPL-2.0-only OR GPL-3.0-only");
  assert.deepEqual(
    POPPLER_ASSETS.map((row) => row.target),
    ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"],
  );
  for (const asset of POPPLER_ASSETS) {
    assert.match(asset.url, /^https:\/\/conda\.anaconda\.org\/conda-forge\//);
    assert.equal(asset.archiveSha256.length, 64);
    assert.equal(asset.filename.includes("26.09.0"), true);
    assert.doesNotMatch(asset.url, /homebrew|oschwartz10612|github\.com\/oschwartz/i);
  }
  assert.equal(popplerAssetForTarget("win32-x86_64")?.binaryFilename, "pdftoppm.exe");
  assert.equal(popplerAssetForHost("darwin", "arm64")?.condaSubdir, "osx-arm64");
  const copying = createHash("sha256").update(readFileSync(join(ROOT, "third_party/poppler/COPYING"))).digest("hex");
  const copying3 = createHash("sha256").update(readFileSync(join(ROOT, "third_party/poppler/COPYING3"))).digest("hex");
  assert.equal(copying, POPPLER_UPSTREAM.licenseFiles.COPYING);
  assert.equal(copying3, POPPLER_UPSTREAM.licenseFiles.COPYING3);
});
