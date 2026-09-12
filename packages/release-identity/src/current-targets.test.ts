import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXACT_RELEASE_ASSETS, assertReleaseContract } from "./contract.js";
import {
  EXCLUDED_CURRENT_RELEASE_TARGET_KEY,
  NATIVE_INSTALLED_TARGET_KEYS,
  PRODUCT_VERSION,
  RELEASE_TARGETS,
  RUNTIME_INPUTS,
} from "./pins.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("current 0.6.2 exact set is three selected targets and ten assets", () => {
  const contract = assertReleaseContract(JSON.parse(readFileSync(join(root, "release-contract.json"), "utf8")));
  assert.equal(PRODUCT_VERSION, "0.6.2");
  assert.deepEqual(
    RELEASE_TARGETS.map((row) => row.key),
    ["darwin-aarch64", "win32-x86_64", "linux-loong64"],
  );
  assert.deepEqual([...NATIVE_INSTALLED_TARGET_KEYS], ["darwin-aarch64", "win32-x86_64"]);
  assert.equal(EXCLUDED_CURRENT_RELEASE_TARGET_KEY, "darwin-x86_64");
  assert.equal(RELEASE_TARGETS.some((row) => row.key === EXCLUDED_CURRENT_RELEASE_TARGET_KEY), false);
  assert.equal(NATIVE_INSTALLED_TARGET_KEYS.includes(EXCLUDED_CURRENT_RELEASE_TARGET_KEY), false);
  assert.equal(RUNTIME_INPUTS.some((row) => row.target === EXCLUDED_CURRENT_RELEASE_TARGET_KEY), false);
  assert.equal(EXACT_RELEASE_ASSETS.length, 10);
  assert.equal(EXACT_RELEASE_ASSETS.length, RELEASE_TARGETS.length + 7);
  assert.deepEqual(contract.targets.map((row) => row.key), RELEASE_TARGETS.map((row) => row.key));
  assert.equal(contract.exactAssets.includes("Penglai_0.6.2_macos_x64.dmg"), false);
});

test("historical 0.6.0 and 0.5.8 publication records keep their original Intel contracts", () => {
  const published060 = readFileSync(join(root, "docs/PUBLICATION_MANIFEST_0.6.0.md"), "utf8");
  assert.match(published060, /Penglai_0\.6\.0_macos_aarch64\.dmg/);
  assert.match(published060, /Penglai_0\.6\.0_macos_x64\.dmg/);
  assert.match(published060, /Penglai_0\.6\.0_windows_x64_setup\.exe/);
  assert.match(published060, /Penglai_0\.6\.0_uos_loong64\.deb/);
  const published058 = readFileSync(join(root, "docs/PUBLICATION_MANIFEST_0.5.8.md"), "utf8");
  assert.match(published058, /Penglai_0\.5\.8_macos_x64\.dmg/);
  const archived060 = readFileSync(join(root, "docs/0.6.0/ACCEPTANCE_DELTA.md"), "utf8");
  assert.match(archived060, /four-target|darwin-x86_64|macos_x64/i);
});

test("current 0.6.2 native workflow and release docs do not claim four targets or eleven assets", () => {
  const native = readFileSync(join(root, ".github/workflows/native-release-candidate.yml"), "utf8");
  const publish = readFileSync(join(root, ".github/workflows/publish-release.yml"), "utf8");
  const delta = readFileSync(join(root, "docs/0.6.2/ACCEPTANCE_DELTA.md"), "utf8");
  const product = readFileSync(join(root, "docs/PRODUCT.md"), "utf8");
  assert.doesNotMatch(native, /macos-15-intel/);
  assert.doesNotMatch(native, /darwin-x86_64/);
  assert.match(native, /Exact three-target evidence aggregate/);
  assert.match(publish, /Read back all ten draft assets/);
  assert.doesNotMatch(publish, /all eleven draft assets/);
  assert.doesNotMatch(delta, /exact four targets and eleven/);
  assert.doesNotMatch(delta, /Four targets remain `darwin-aarch64`, `darwin-x86_64`/);
  assert.doesNotMatch(product, /Penglai_0\.6\.1_macos_x64\.dmg/);
});
