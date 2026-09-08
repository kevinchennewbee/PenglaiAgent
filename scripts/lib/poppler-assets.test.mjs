import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  POPPLER_ASSETS,
  POPPLER_UPSTREAM,
  popplerAllCondaPackages,
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
    assert.doesNotMatch(asset.url, /homebrew|oschwartz10612|github\.com\/oschwartz|ustc\.edu/i);
    assert.doesNotMatch(asset.filename, />=|</);
    assert.ok(asset.depends.length > 5);
    for (const dep of asset.depends) {
      assert.match(dep.url, /^https:\/\/conda\.anaconda\.org\/conda-forge\//);
      assert.equal(dep.sha256.length, 64);
      assert.equal(typeof dep.bytes, "number");
      assert.ok(dep.bytes > 0);
      assert.doesNotMatch(dep.filename, />=|</);
      assert.doesNotMatch(dep.url, /homebrew|oschwartz/i);
    }
    const pkgs = popplerAllCondaPackages(asset);
    assert.equal(pkgs[0].filename, asset.filename);
    assert.equal(pkgs.length, asset.depends.length + 1);
  }
  assert.equal(popplerAssetForTarget("win32-x86_64")?.binaryFilename, "pdftoppm.exe");
  assert.equal(popplerAssetForHost("darwin", "arm64")?.condaSubdir, "osx-arm64");
  assert.equal(popplerAssetForHost("darwin", "x64")?.condaSubdir, "osx-64");
  const copying = createHash("sha256").update(readFileSync(join(ROOT, "third_party/poppler/COPYING"))).digest("hex");
  const copying3 = createHash("sha256").update(readFileSync(join(ROOT, "third_party/poppler/COPYING3"))).digest("hex");
  assert.equal(copying, POPPLER_UPSTREAM.licenseFiles.COPYING);
  assert.equal(copying3, POPPLER_UPSTREAM.licenseFiles.COPYING3);
});

test("official poppler-data 0.4.12 is pinned with license hashes, not the conda noarch package", () => {
  assert.equal(POPPLER_UPSTREAM.popplerData.version, "0.4.12");
  assert.equal(POPPLER_UPSTREAM.popplerData.url, "https://poppler.freedesktop.org/poppler-data-0.4.12.tar.gz");
  assert.equal(POPPLER_UPSTREAM.popplerData.sha256, "c835b640a40ce357e1b83666aabd95edffa24ddddd49b8daff63adb851cdab74");
  assert.equal(POPPLER_UPSTREAM.popplerData.bytes, 4_504_754);
  for (const [name, sha] of Object.entries(POPPLER_UPSTREAM.popplerData.licenseFiles)) {
    const actual = createHash("sha256")
      .update(readFileSync(join(ROOT, "third_party/poppler/poppler-data", name)))
      .digest("hex");
    assert.equal(actual, sha, name);
  }
  assert.deepEqual(POPPLER_UPSTREAM.hostAllowlist, ["conda.anaconda.org", "poppler.freedesktop.org"]);
});

test("macOS 26.09.0 pins include harfbuzz/glib/nss and Windows pins include the PE curl closure", () => {
  const arm = popplerAssetForTarget("darwin-aarch64");
  const names = arm.depends.map((d) => d.filename);
  assert.ok(names.some((n) => n.startsWith("libharfbuzz-14.4.0-")));
  assert.ok(names.some((n) => n.startsWith("libglib-2.88.3-")));
  assert.ok(names.some((n) => n.startsWith("nss-3.118-")));
  assert.ok(names.some((n) => n.startsWith("libdeflate-1.25-")));
  assert.ok(names.every((n) => !n.startsWith("cairo-") && !n.startsWith("libcurl-")));
  const win = popplerAssetForTarget("win32-x86_64");
  const winNames = win.depends.map((d) => d.filename);
  assert.ok(winNames.some((n) => n.startsWith("libcurl-8.22.0-")));
  assert.ok(winNames.some((n) => n.startsWith("libssh2-")));
  assert.ok(winNames.some((n) => n.startsWith("libpsl-")));
  assert.ok(winNames.some((n) => n.startsWith("openssl-3.5.8-")));
  assert.ok(winNames.some((n) => n.startsWith("icu-78.3-")));
  assert.ok(winNames.every((n) => !n.startsWith("libharfbuzz-") && !n.startsWith("nss-")));
});
