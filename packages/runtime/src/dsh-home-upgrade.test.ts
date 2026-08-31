import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DSH_HOME_SOURCE_VERSION,
  DSH_HOME_TARGET_VERSION,
  activateDshHomeBootPlan,
  activateDshHomeUpgrade,
  prepareDshHomeForBoot,
  prepareDshHomeUpgrade,
  readActiveDshHome,
  rejectPreparedDshHomeUpgrade,
  removeAbandonedDshHomeStaging,
  resolveDshHomeForVersion,
  resolveDshHomeUpgradePaths,
  rollbackDshHomeUpgrade,
} from "./dsh-home-upgrade.js";

const FIXTURE_CREDENTIAL =
  "DEEPSEEK_API_KEY: penglai-test-fixture-key-not-real\n";

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-upgrade-"));
  const home = join(root, "dsh-home");
  mkdirSync(join(home, "profiles", "web"), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, "storages", "sessions"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(join(home, ".credentials.yaml"), FIXTURE_CREDENTIAL, {
    mode: 0o600,
  });
  writeFileSync(join(home, "settings.yaml"), "locale:\n  preference: zh\n", {
    mode: 0o600,
  });
  writeFileSync(
    join(home, "storages", "sessions", "session.jsonl"),
    '{"version":0,"id":"fixture"}\n',
    {
      mode: 0o600,
    },
  );
  return root;
}

function validProof() {
  return {
    dshVersion: DSH_HOME_TARGET_VERSION,
    officialDocument: true as const,
    dshHealthy: true as const,
    profileReady: true as const,
    requiredPluginsActive: ["@penglai/office", "@penglai/memory"],
    validatedAt: "2026-08-29T00:01:00.000Z",
  };
}

test("P059-DATA-001 prepares an isolated alpha.2 working home and leaves 0.5.8 alpha.1 bytes untouched", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  const originalCredential = readFileSync(
    join(paths.sourceHome, ".credentials.yaml"),
  );
  const originalSession = readFileSync(
    join(paths.sourceHome, "storages", "sessions", "session.jsonl"),
  );

  const journal = prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade01",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
    now: new Date("2026-08-29T00:00:00.000Z"),
  });

  assert.equal(journal.state, "prepared");
  assert.equal(journal.sourceSnapshot.digest, journal.preparedSnapshot.digest);
  assert.equal(journal.credentialsCopiedToPrivateWorkingHome, true);
  assert.deepEqual(
    readFileSync(join(paths.targetHome, ".credentials.yaml")),
    originalCredential,
  );
  assert.deepEqual(
    readFileSync(
      join(paths.targetHome, "storages", "sessions", "session.jsonl"),
    ),
    originalSession,
  );
  assert.deepEqual(
    readFileSync(join(paths.sourceHome, ".credentials.yaml")),
    originalCredential,
  );
  assert.deepEqual(
    readFileSync(
      join(paths.sourceHome, "storages", "sessions", "session.jsonl"),
    ),
    originalSession,
  );
  if (process.platform !== "win32") {
    assert.equal(lstatSync(paths.targetHome).mode & 0o777, 0o700);
    assert.equal(
      lstatSync(join(paths.targetHome, ".credentials.yaml")).mode & 0o777,
      0o600,
    );
  }
  assert.equal(readActiveDshHome(root), undefined);
  assert.throws(
    () => resolveDshHomeForVersion(root, DSH_HOME_TARGET_VERSION),
    /has not passed activation/,
  );
  assert.equal(
    resolveDshHomeForVersion(root, DSH_HOME_SOURCE_VERSION),
    paths.sourceHome,
  );
});

test("P059-DATA-002 disk preflight fails before creating target or operation state", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  assert.throws(
    () =>
      prepareDshHomeUpgrade({
        userRoot: root,
        operationId: "upgrade02",
        availableBytes: 0,
        reserveBytes: 1,
      }),
    /insufficient disk space/,
  );
  assert.equal(existsSync(paths.targetHome), false);
  assert.equal(existsSync(join(paths.operationsRoot, "upgrade02.json")), false);
});

test("P059-DATA-003 symlink state and concurrent writers fail closed", (context) => {
  if (process.platform === "win32") {
    context.skip("ordinary Windows users cannot create this symlink fixture");
    return;
  }
  const linkedRoot = fixtureRoot();
  const outside = join(linkedRoot, "outside.txt");
  writeFileSync(outside, "outside\n", { mode: 0o600 });
  symlinkSync(outside, join(linkedRoot, "dsh-home", "linked.txt"));
  assert.throws(
    () =>
      prepareDshHomeUpgrade({
        userRoot: linkedRoot,
        operationId: "upgrade03",
        availableBytes: 1024 * 1024 * 1024,
        reserveBytes: 0,
      }),
    /refuses symlink state/,
  );
  assert.equal(readFileSync(outside, "utf8"), "outside\n");

  const lockedRoot = fixtureRoot();
  const lockedPaths = resolveDshHomeUpgradePaths(lockedRoot);
  mkdirSync(lockedPaths.lock, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(lockedPaths.lock, "owner.json"),
    JSON.stringify({
      schema: 1,
      pid: process.pid,
      nonce: "0123456789abcdef0123456789abcdef",
      createdAt: "2026-08-29T00:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      prepareDshHomeUpgrade({
        userRoot: lockedRoot,
        operationId: "upgrade04",
        availableBytes: 1024 * 1024 * 1024,
        reserveBytes: 0,
      }),
    /another DSH home migration writer/,
  );
  rmSync(lockedPaths.lock, { recursive: true });
});

test("P059-DATA-004 activation commits only after exact health and required-plugin proof", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade05",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });

  writeFileSync(
    join(paths.targetHome, ".credentials.yaml"),
    `${FIXTURE_CREDENTIAL}records: {}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      activateDshHomeUpgrade({
        userRoot: root,
        operationId: "upgrade05",
        validation: {
          ...validProof(),
          requiredPluginsActive: ["@penglai/office"],
        },
      }),
    /requires exact healthy alpha validation/,
  );
  assert.equal(readActiveDshHome(root), undefined);

  const active = activateDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade05",
    validation: validProof(),
    now: new Date("2026-08-29T00:02:00.000Z"),
  });
  assert.equal(active.activeVersion, DSH_HOME_TARGET_VERSION);
  assert.equal(
    resolveDshHomeForVersion(root, DSH_HOME_TARGET_VERSION),
    paths.targetHome,
  );
  assert.equal(
    readFileSync(join(paths.sourceHome, ".credentials.yaml"), "utf8"),
    FIXTURE_CREDENTIAL,
  );
});

test("P059-DATA-005 source mutation during validation blocks activation", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade06",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  writeFileSync(
    join(paths.sourceHome, "settings.yaml"),
    "locale:\n  preference: en\n",
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      activateDshHomeUpgrade({
        userRoot: root,
        operationId: "upgrade06",
        validation: validProof(),
      }),
    /0.5.8 alpha.1 DSH home changed/,
  );
  assert.equal(readActiveDshHome(root), undefined);
});

test("P059-DATA-006 rollback atomically selects the untouched 0.5.8 alpha.1 home", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade07",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  activateDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade07",
    validation: validProof(),
  });
  writeFileSync(join(paths.targetHome, "alpha-only.txt"), "alpha\n", {
    mode: 0o600,
  });

  const active = rollbackDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade07",
    reason: "alpha health regression",
    now: new Date("2026-08-29T00:03:00.000Z"),
  });

  assert.equal(active.activeVersion, DSH_HOME_SOURCE_VERSION);
  assert.equal(
    resolveDshHomeForVersion(root, DSH_HOME_SOURCE_VERSION),
    paths.sourceHome,
  );
  assert.throws(
    () => resolveDshHomeForVersion(root, DSH_HOME_TARGET_VERSION),
    /has not passed activation/,
  );
  assert.equal(
    existsSync(join(paths.targetHome, "alpha-only.txt")),
    true,
    "failed target remains for diagnosis",
  );
  assert.equal(
    readFileSync(join(paths.sourceHome, ".credentials.yaml"), "utf8"),
    FIXTURE_CREDENTIAL,
  );
});

test("P059-DATA-007 abandoned staging cleanup is bounded to recognized private directories", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  mkdirSync(paths.homesRoot, { recursive: true, mode: 0o700 });
  const abandoned = join(
    paths.homesRoot,
    ".upgrade08.0123456789abcdef.staging",
  );
  const unrelated = join(paths.homesRoot, ".keep-me");
  mkdirSync(abandoned, { mode: 0o700 });
  mkdirSync(unrelated, { mode: 0o700 });
  writeFileSync(join(abandoned, "partial.txt"), "partial\n", { mode: 0o600 });

  assert.equal(removeAbandonedDshHomeStaging(root), 1);
  assert.equal(existsSync(abandoned), false);
  assert.equal(existsSync(unrelated), true);
});

test("P059-DATA-008 an invalid active pointer never becomes runtime fallback", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  writeFileSync(
    paths.activeManifest,
    JSON.stringify({
      schema: 1,
      activeVersion: DSH_HOME_TARGET_VERSION,
      homeRelative: "../outside",
      activatedAt: "2026-08-29T00:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  assert.throws(() => readActiveDshHome(root), /invalid identity/);
});

test("P059-DATA-009 failed validation removes only the disposable alpha working home", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade09",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  const rejected = rejectPreparedDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade09",
    reason: "session replay rejected an unknown event",
    now: new Date("2026-08-29T00:04:00.000Z"),
  });
  assert.equal(rejected.state, "rejected");
  assert.equal(existsSync(paths.targetHome), false);
  assert.equal(readActiveDshHome(root), undefined);
  assert.equal(
    readFileSync(join(paths.sourceHome, ".credentials.yaml"), "utf8"),
    FIXTURE_CREDENTIAL,
  );
  assert.equal(existsSync(join(paths.operationsRoot, "upgrade09.json")), true);
});

test("P059-DATA-010 a forged alpha pointer without activation evidence is refused", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade10",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  writeFileSync(
    paths.activeManifest,
    JSON.stringify({
      schema: 1,
      activeVersion: DSH_HOME_TARGET_VERSION,
      homeRelative: `dsh-homes/dsh-v${DSH_HOME_TARGET_VERSION}`,
      activatedAt: "2026-08-29T00:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  assert.throws(() => readActiveDshHome(root), /lacks activation evidence/);
});

test("P059-DATA-011 rollback refuses a source Home changed after alpha activation", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade11",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  activateDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade11",
    validation: validProof(),
  });
  writeFileSync(join(paths.sourceHome, "unexpected.txt"), "unexpected\n", {
    mode: 0o600,
  });
  assert.throws(
    () =>
      rollbackDshHomeUpgrade({
        userRoot: root,
        operationId: "upgrade11",
        reason: "test rollback",
      }),
    /changed before rollback/,
  );
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_TARGET_VERSION);
});

test("P059-DATA-012 a verified dead writer lock is recovered without weakening live-writer exclusion", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  mkdirSync(paths.lock, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(paths.lock, "owner.json"),
    JSON.stringify({
      schema: 1,
      pid: 2_147_483_647,
      nonce: "abcdef0123456789abcdef0123456789",
      createdAt: "2026-08-29T00:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  const journal = prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade12",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  assert.equal(journal.state, "prepared");
  assert.equal(existsSync(paths.lock), false);
});

test("P059-DATA-013 fresh 0.5.9 installs boot and activate only the alpha.2 generation", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-fresh-"));
  const paths = resolveDshHomeUpgradePaths(root);
  const prepared = prepareDshHomeForBoot({
    userRoot: root,
    now: new Date("2026-08-31T00:00:00.000Z"),
  });
  assert.equal(prepared.kind, "fresh-prepared");
  assert.equal(prepared.dshHome, paths.targetHome);
  assert.equal(existsSync(paths.sourceHome), false);
  writeFileSync(join(paths.targetHome, "settings.yaml"), "locale:\n  preference: zh\n", { mode: 0o600 });
  const officialRuntime = mkdtempSync(join(tmpdir(), "penglai-official-runtime-"));
  const profileModules = join(paths.targetHome, "profiles", "web", "node_modules");
  mkdirSync(profileModules, { recursive: true });
  symlinkSync(
    officialRuntime,
    join(profileModules, "@deepseek-ai"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const profileRuntimeMirror = join(paths.targetHome, "profiles", "node_modules");
  mkdirSync(profileRuntimeMirror, { recursive: true });
  symlinkSync(
    officialRuntime,
    join(profileRuntimeMirror, "react"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const active = activateDshHomeBootPlan({
    userRoot: root,
    plan: prepared,
    validation: validProof(),
    now: new Date("2026-08-31T00:01:00.000Z"),
  });
  assert.equal(active.activeVersion, DSH_HOME_TARGET_VERSION);
  assert.equal(active.activationKind, "fresh");
  assert.equal(readActiveDshHome(root)?.activationKind, "fresh");
  assert.deepEqual(prepareDshHomeForBoot({ userRoot: root }), {
    kind: "active",
    dshHome: paths.targetHome,
  });
});

test("P059-DATA-014 0.5.8 alpha.1 upgrades boot a resumable isolated alpha.2 generation", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  const prepared = prepareDshHomeForBoot({
    userRoot: root,
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  assert.equal(prepared.kind, "migration-prepared");
  assert.equal(prepared.dshHome, paths.targetHome);
  assert.match(prepared.operationId ?? "", /^upgrade_[0-9a-f]{32}$/);
  const resumed = prepareDshHomeForBoot({ userRoot: root });
  assert.deepEqual(resumed, prepared);
  assert.equal(
    readFileSync(join(paths.sourceHome, "storages", "sessions", "session.jsonl"), "utf8"),
    '{"version":0,"id":"fixture"}\n',
  );
});
