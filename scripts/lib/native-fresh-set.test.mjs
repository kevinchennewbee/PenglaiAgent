import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { PRODUCT_VERSION } from "./product.mjs";
import { NATIVE_INSTALLED_TARGETS } from "./release-targets.mjs";
import {
  CURRENT_DSH_HOME_RELATIVE,
  CURRENT_DSH_HOME_VERSION,
  PERSISTED_PROFILE_FILES,
  persistedProfileDigest,
} from "./native-lifecycle-proof.mjs";
import {
  evaluateFreshLifecycleSet,
  FRESH_LIFECYCLE_COMMAND,
  FRESH_LIFECYCLE_SCHEMA,
  FRESH_LIFECYCLE_SCOPE,
  freshInstallUninstallEvidenceMatches,
  freshInstallUninstallEvidenceProblems,
  worstFreshLifecycleVerdict,
} from "./native-fresh-set.mjs";

const sourceSha = "a".repeat(40);
const installerSha256 = "b".repeat(64);

function generationIdentity(launch, extra = {}) {
  const files = PERSISTED_PROFILE_FILES.map(({ relative }) => ({ relative, present: true, bytes: 1, sha256: "c".repeat(64) }));
  return {
    generation: {
      ok: true,
      activeVersion: CURRENT_DSH_HOME_VERSION,
      homeRelative: CURRENT_DSH_HOME_RELATIVE,
      homePresent: true,
      activationKind: "fresh",
      reason: "",
    },
    stable: { digest: "e".repeat(64), inventoryOk: true },
    persisted: { ok: true, digest: persistedProfileDigest(files), files },
    launch,
    onboardingCompleted: false,
    ok: true,
    reason: "",
    ...extra,
  };
}

const bootIdentity = generationIdentity({ launchNonce: "boot-nonce", dshPid: 11 });
const restartIdentity = generationIdentity({ launchNonce: "restart-nonce", dshPid: 22 });

function hostFor(target) {
  if (target === "win32-x86_64") return { platform: "win32", arch: "x64" };
  if (target === "darwin-x86_64") return { platform: "darwin", arch: "x64" };
  return { platform: "darwin", arch: "arm64" };
}

function gracefulShutdown(target) {
  return {
    graceful: true,
    forced: false,
    requestedClose: true,
    method: target === "win32-x86_64" ? "windows-wm-close" : "posix-sigterm",
    exitCode: 0,
    signal: null,
  };
}

function passingReceipt(target, extra = {}) {
  const method = target === "win32-x86_64" ? "nsis-uninstaller" : "dedicated-app-removal";
  const windowsPath = "C:\\Users\\runner\\AppData\\Local\\Penglai\\app\\0.5";
  return {
    schema: FRESH_LIFECYCLE_SCHEMA,
    command: FRESH_LIFECYCLE_COMMAND,
    kind: "installed-lifecycle",
    scope: FRESH_LIFECYCLE_SCOPE,
    verdict: "PASS",
    target,
    sourceSha,
    installer: `Penglai_${PRODUCT_VERSION}_${target}.bin`,
    installerSha256,
    host: hostFor(target),
    destination: target === "win32-x86_64" ? windowsPath : "/tmp/Penglai.app",
    windowsInstall: target === "win32-x86_64"
      ? { path: windowsPath, customDestination: false, payloadDeletedByHarness: false }
      : undefined,
    boot: { freshReadiness: true, shutdown: gracefulShutdown(target), profileIdentity: bootIdentity },
    restart: { freshReadiness: true, resumed: true, shutdown: gracefulShutdown(target), profileIdentity: restartIdentity },
    processCleanup: { afterBoot: true, afterRestart: true, afterUninstall: true, forced: false },
    onboardingCompleted: false,
    uninstall: {
      method,
      uninstallRemovedApp: true,
      leftover: target === "win32-x86_64" ? ["Uninstall.exe"] : [],
      wholeInstdirDeletedToManufacturePass: false,
    },
    ownerData: {
      sentinelPreservedAfterBoot: true,
      sentinelPreservedAfterRestart: true,
      sentinelPreservedAfterUninstall: true,
      sentinelUnchanged: true,
      sentinelSha256: "c".repeat(64),
      scope: target === "win32-x86_64" ? "localappdata-penglai-0.5-excluding-update-cache" : "task-created-user-data",
    },
    olderInstalledUpgrade: { status: "OWNER_EXCLUDED", claimedPass: false },
    nativeUos: { status: "OWNER_POST_RELEASE", claimedPass: false },
    deferred: false,
    fabricated: false,
    ...extra,
  };
}

test("fresh lifecycle matcher accepts a complete Mac/Windows receipt", () => {
  for (const target of NATIVE_INSTALLED_TARGETS) {
    assert.equal(
      freshInstallUninstallEvidenceMatches(passingReceipt(target), { sourceSha, installerSha256, target }),
      true,
    );
  }
});

test("fresh lifecycle aggregation negatives: missing target, SHA, hash, proofs, fabricated PASS, shape", () => {
  const expected = { sourceSha, installerSha256, target: "darwin-aarch64" };
  assert.deepEqual(freshInstallUninstallEvidenceProblems(null, expected), ["incompatible receipt shape"]);
  assert.ok(freshInstallUninstallEvidenceProblems({ verdict: "PASS" }, expected).includes("incompatible receipt shape"));
  assert.ok(
    freshInstallUninstallEvidenceProblems(passingReceipt("darwin-x86_64"), expected).includes("missing target"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(passingReceipt("darwin-aarch64", { sourceSha: "c".repeat(40) }), expected)
      .includes("wrong source SHA"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { installerSha256: "d".repeat(64) }),
      expected,
    ).includes("wrong installer hash"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { boot: { freshReadiness: false } }),
      expected,
    ).includes("absent fresh boot/restart/uninstall proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { restart: { freshReadiness: true, resumed: false } }),
      expected,
    ).includes("absent fresh boot/restart/uninstall proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { uninstall: { method: "dedicated-app-removal", uninstallRemovedApp: false, wholeInstdirDeletedToManufacturePass: false } }),
      expected,
    ).includes("absent fresh boot/restart/uninstall proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { deferred: true }),
      expected,
    ).includes("fabricated/deferred native PASS"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", {
        uninstall: {
          method: "dedicated-app-removal",
          uninstallRemovedApp: true,
          wholeInstdirDeletedToManufacturePass: true,
        },
      }),
      expected,
    ).includes("fabricated/deferred native PASS"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("linux-loong64", {
        uninstall: { method: "dedicated-app-removal", uninstallRemovedApp: true, wholeInstdirDeletedToManufacturePass: false },
      }),
      { ...expected, target: "linux-loong64" },
    ).includes("fabricated/deferred native PASS"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { upgradePaths: [{ verdict: "PASS" }], previousVersions: ["0.5.12"] }),
      expected,
    ).includes("incompatible receipt shape"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { nativeUos: { status: "PASS", claimedPass: true } }),
      expected,
    ).includes("fabricated/deferred native PASS"),
  );
  assert.equal(worstFreshLifecycleVerdict(["incompatible receipt shape"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["fabricated/deferred native PASS"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["wrong source SHA"]), "STALE");
  assert.equal(worstFreshLifecycleVerdict(["wrong installer hash"]), "STALE");
  assert.equal(worstFreshLifecycleVerdict(["missing target"]), "INCOMPLETE");
  assert.equal(worstFreshLifecycleVerdict(["absent fresh boot/restart/uninstall proof"]), "INCOMPLETE");
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", {
        boot: {
          freshReadiness: true,
          profileIdentity: bootIdentity,
          shutdown: { graceful: true, forced: false, requestedClose: true, method: "posix-sigterm", exitCode: null, signal: "SIGKILL" },
        },
      }),
      expected,
    ).includes("forced or abnormal shutdown"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", {
        ownerData: {
          sentinelPreservedAfterBoot: true,
          sentinelPreservedAfterRestart: true,
          sentinelPreservedAfterUninstall: true,
          sentinelUnchanged: false,
          sentinelSha256: "c".repeat(64),
          scope: "task-created-user-data",
        },
      }),
      expected,
    ).includes("absent or changed owner-data proof"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", {
        restart: { freshReadiness: true, resumed: true, shutdown: gracefulShutdown("darwin-aarch64"), profileIdentity: generationIdentity({ launchNonce: "restart-nonce", dshPid: 22 }, { stable: { digest: "f".repeat(64), inventoryOk: true } }) },
      }),
      expected,
    ).includes("changed stable generation state"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", {
        restart: { freshReadiness: true, resumed: true, shutdown: gracefulShutdown("darwin-aarch64"), profileIdentity: bootIdentity },
      }),
      expected,
    ).includes("stale process-bound readiness"),
  );
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("darwin-aarch64", { processCleanup: { afterBoot: true, afterRestart: true, afterUninstall: true, forced: true } }),
      expected,
    ).includes("forced process cleanup"),
  );
  assert.equal(worstFreshLifecycleVerdict(["forced process cleanup"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["stale process-bound readiness"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["absent current generation identity"]), "FAIL");
  const missingProfile = structuredClone(passingReceipt("darwin-aarch64"));
  delete missingProfile.restart.profileIdentity.persisted;
  assert.equal(freshInstallUninstallEvidenceMatches(missingProfile, expected), false);
  assert.ok(freshInstallUninstallEvidenceProblems(missingProfile, expected).includes("absent persisted profile proof"));
  const unhealthyInventory = structuredClone(passingReceipt("darwin-aarch64"));
  unhealthyInventory.restart.profileIdentity.stable.inventoryOk = false;
  assert.equal(freshInstallUninstallEvidenceMatches(unhealthyInventory, expected), false);
  assert.ok(freshInstallUninstallEvidenceProblems(unhealthyInventory, expected).includes("required plugin inventory failed"));
  const inventedProfileHash = structuredClone(passingReceipt("darwin-aarch64"));
  inventedProfileHash.restart.profileIdentity.persisted.digest = "a".repeat(64);
  assert.ok(freshInstallUninstallEvidenceProblems(inventedProfileHash, expected).includes("absent persisted profile proof"));
  assert.equal(worstFreshLifecycleVerdict(["required plugin inventory failed"]), "FAIL");
  assert.equal(worstFreshLifecycleVerdict(["changed persisted profile state"]), "FAIL");
  assert.ok(
    freshInstallUninstallEvidenceProblems(
      passingReceipt("win32-x86_64", {
        destination: "C:\\repo\\.tmp\\fresh-install-uninstall\\app",
        windowsInstall: { path: "C:\\repo\\.tmp\\fresh-install-uninstall\\app", customDestination: true, payloadDeletedByHarness: false },
      }),
      { sourceSha, installerSha256, target: "win32-x86_64" },
    ).includes("incompatible receipt shape"),
  );
  assert.equal(worstFreshLifecycleVerdict(["forced or abnormal shutdown"]), "FAIL");
});

test("fresh lifecycle set requires every Mac/Windows target and rejects a UOS native PASS", () => {
  const installerByTarget = Object.fromEntries(NATIVE_INSTALLED_TARGETS.map((target) => [target, installerSha256]));
  const complete = NATIVE_INSTALLED_TARGETS.map((target) => passingReceipt(target));
  assert.equal(evaluateFreshLifecycleSet({ records: complete, sourceSha, installerByTarget }).ok, true);
  const missing = evaluateFreshLifecycleSet({
    records: complete.filter((row) => row.target !== "win32-x86_64"),
    sourceSha,
    installerByTarget,
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.failReasons.includes("missing target"));
  assert.deepEqual(missing.missingTargets, ["win32-x86_64"]);
  const withUos = evaluateFreshLifecycleSet({
    records: [...complete, { ...passingReceipt("linux-loong64"), target: "linux-loong64", verdict: "PASS" }],
    sourceSha,
    installerByTarget,
  });
  assert.equal(withUos.ok, false);
  assert.ok(withUos.failReasons.includes("fabricated/deferred native PASS"));
});

test("current 0.6.1 native workflow does not fetch previous installers", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/native-release-candidate.yml"), "utf8");
  assert.match(workflow, /verify:fresh-install-uninstall/);
  assert.doesNotMatch(workflow, /fetch-upgrade-sources/);
  assert.doesNotMatch(workflow, /previous: Penglai_/);
  assert.doesNotMatch(workflow, /Penglai_0\.5\.12_macos/);
  assert.doesNotMatch(workflow, /pnpm verify:upgrade-uninstall/);
  const fetch = spawnSync(process.execPath, [join(ROOT, "scripts/fetch-upgrade-sources.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(fetch.status, 2);
  assert.match(fetch.stderr, /OWNER_EXCLUDED/);
  assert.doesNotMatch(fetch.stderr, /"verdict":"PASS"/);
});
