import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCurrentReleaseTarget,
  assertReleaseTarget,
  extraReleaseTargets,
  missingNativeInstalledTargets,
  missingReleaseTargets,
  NATIVE_INSTALLED_TARGETS,
  RELEASE_TARGETS,
} from "./release-targets.mjs";

test("current release target helpers are contract-derived and exact", () => {
  assert.deepEqual([...RELEASE_TARGETS], ["darwin-aarch64", "win32-x86_64", "linux-loong64"]);
  assert.deepEqual([...NATIVE_INSTALLED_TARGETS], ["darwin-aarch64", "win32-x86_64"]);
  assert.deepEqual(missingReleaseTargets(["darwin-aarch64", "win32-x86_64"]), ["linux-loong64"]);
  assert.deepEqual(missingNativeInstalledTargets(["darwin-aarch64"]), ["win32-x86_64"]);
  assert.deepEqual(extraReleaseTargets(["darwin-aarch64", "win32-x86_64", "linux-loong64", "darwin-x86_64"]), [
    "darwin-x86_64",
  ]);
  assert.deepEqual(missingReleaseTargets(RELEASE_TARGETS), []);
  assert.deepEqual(extraReleaseTargets(RELEASE_TARGETS), []);
  assert.equal(assertReleaseTarget("darwin-x86_64"), "darwin-x86_64");
  assert.throws(() => assertCurrentReleaseTarget("darwin-x86_64"), /not a current release target/);
});
