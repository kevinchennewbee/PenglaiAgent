import assert from "node:assert/strict";
import test from "node:test";
import {
  UPDATE_TARGET_KEY_LIST,
  UPDATE_TARGET_KEYS,
  UPDATE_TARGETS,
  updateInstallerName,
  updateTargetFor,
  updateTargetKeyFor,
} from "./update-targets.js";

/**
 * These tests exist because the update target table was duplicated in three
 * packages and drifted in opposite directions from the release contract:
 * `linux-loong64` was a published release target that `releaseTarget()` resolved
 * to while the manifest schema rejected it, and `darwin-x86_64` stayed in the
 * schema a version after the release contract dropped it. The table is now the
 * only declaration; these assertions pin its shape so a future edit that
 * reintroduces a per-package copy fails loudly instead of silently.
 */

test("declared rows and declared keys are the same set, in the same order", () => {
  assert.deepEqual(
    UPDATE_TARGETS.map((target) => target.key),
    [...UPDATE_TARGET_KEYS],
    "UPDATE_TARGETS rows must match UPDATE_TARGET_KEYS exactly",
  );
  assert.deepEqual([...UPDATE_TARGET_KEY_LIST], [...UPDATE_TARGET_KEYS]);
});

test("every declared target has a distinct key, platform/arch pair and installer", () => {
  const keys = UPDATE_TARGETS.map((target) => target.key);
  assert.equal(new Set(keys).size, keys.length, "target keys must be unique");
  const pairs = UPDATE_TARGETS.map((target) => `${target.platform}/${target.arch}`);
  assert.equal(new Set(pairs).size, pairs.length, "platform/arch pairs must be unique");
  const installers = UPDATE_TARGETS.map((target) => target.installer);
  assert.equal(new Set(installers).size, installers.length, "installer templates must be unique");
});

test("installer templates carry exactly one version placeholder", () => {
  for (const target of UPDATE_TARGETS) {
    assert.equal(
      target.installer.split("{version}").length,
      2,
      `${target.key} must have exactly one {version} placeholder`,
    );
    assert.match(target.installer, /\.(dmg|exe|deb)$/, `${target.key} installer extension`);
  }
});

test("installer kind agrees with the installer extension", () => {
  const expected: Record<string, string> = { dmg: ".dmg", setup: ".exe", deb: ".deb" };
  for (const target of UPDATE_TARGETS) {
    assert.ok(
      target.installer.endsWith(expected[target.kind]!),
      `${target.key} declares kind ${target.kind} but installer is ${target.installer}`,
    );
  }
});

test("the UOS target the desktop resolves on LoongArch is carryable by the manifest schema", () => {
  // Regression pin for the shipped defect: releaseTarget() returned
  // "linux-loong64" on UOS while UPDATE_TARGET_KEYS did not contain it, so every
  // update check there failed with "unsupported update target".
  const resolved = updateTargetKeyFor("linux", "loong64");
  assert.equal(resolved, "linux-loong64");
  assert.ok(UPDATE_TARGET_KEY_LIST.includes(resolved!));
  assert.equal(updateInstallerName("linux-loong64", "9.9.9"), "Penglai_9.9.9_uos_loong64.deb");
});

test("arch aliases resolve to the declared arch", () => {
  assert.equal(updateTargetKeyFor("darwin", "arm64"), "darwin-aarch64");
  assert.equal(updateTargetKeyFor("darwin", "x86_64"), "darwin-x86_64");
  assert.equal(updateTargetKeyFor("win32", "x86_64"), "win32-x86_64");
  assert.equal(updateTargetKeyFor("linux", "loongarch64"), "linux-loong64");
});

test("unknown platforms resolve to undefined rather than a wrong target", () => {
  assert.equal(updateTargetKeyFor("linux", "x64"), undefined);
  assert.equal(updateTargetKeyFor("freebsd", "x64"), undefined);
  assert.equal(updateTargetFor("linux-arm64"), undefined);
  assert.equal(updateInstallerName("linux-arm64", "9.9.9"), undefined);
});
