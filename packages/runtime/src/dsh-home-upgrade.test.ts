import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import {
  DSH_HOME_SOURCE_VERSION,
  DSH_HOME_ALPHA2_VERSION,
  DSH_HOME_PREVIOUS_VERSION,
  DSH_HOME_ALPHA13_VERSION,
  DSH_HOME_JSONL_COMPRESSION,
  DSH_HOME_TARGET_VERSION,
  isHistoricalSessionLogName,
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

test("0.5.11 rc.1 active generation upgrades to 0.1.5-rc.1 and restores its exact pointer on rollback", () => {
  const root = fixtureRoot();
  const previousHome = join(root, "dsh-homes", `dsh-v${DSH_HOME_PREVIOUS_VERSION}`);
  mkdirSync(previousHome, { recursive: true, mode: 0o700 });
  writeFileSync(join(previousHome, "settings.yaml"), "locale:\n  preference: en\n");
  const previous = {
    schema: 1,
    activeVersion: DSH_HOME_PREVIOUS_VERSION,
    homeRelative: `dsh-homes/dsh-v${DSH_HOME_PREVIOUS_VERSION}`,
    activationKind: "fresh",
    activatedAt: "2026-09-01T00:00:00.000Z",
    targetDigest: "a".repeat(64),
  };
  writeFileSync(join(previousHome, ".penglai-dsh-home.json"), JSON.stringify({
    schema: 1,
    kind: "fresh",
    dshVersion: DSH_HOME_PREVIOUS_VERSION,
    state: "active",
    preparedAt: previous.activatedAt,
    activatedAt: previous.activatedAt,
    targetDigest: previous.targetDigest,
  }));
  const pointer = join(root, "dsh-home-active.json");
  writeFileSync(pointer, JSON.stringify(previous));
  const plan = prepareDshHomeForBoot({ userRoot: root, reserveBytes: 0 });
  assert.equal(plan.kind, "migration-prepared");
  assert.equal(readFileSync(join(plan.dshHome, "settings.yaml"), "utf8"), "locale:\n  preference: en\n");
  assert.deepEqual(JSON.parse(readFileSync(pointer, "utf8")), previous);
  assert.deepEqual(prepareDshHomeForBoot({ userRoot: root }), plan, "prepared migration must resume with old pointer still active");
  activateDshHomeBootPlan({ userRoot: root, plan, validation: validProof() });
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_TARGET_VERSION);
  writeFileSync(join(plan.dshHome, "new-generation-only"), "0.1.5-rc.1 state");
  rollbackDshHomeUpgrade({ userRoot: root, operationId: plan.operationId!, reason: "restore previous version" });
  assert.deepEqual(JSON.parse(readFileSync(pointer, "utf8")), {
    ...previous,
    rollbackReason: "restore previous version",
  });
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_PREVIOUS_VERSION);
  assert.equal(existsSync(join(previousHome, "new-generation-only")), false);
  assert.equal(readFileSync(join(root, "dsh-home", "settings.yaml"), "utf8"), "locale:\n  preference: zh\n");
});

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
    legalSessionJsonl("fixture"),
    {
      mode: 0o600,
    },
  );
  return root;
}

function legalSessionJsonl(id: string): string {
  return [
    JSON.stringify({
      type: "session",
      version: 0,
      id,
      createdAt: 1,
      cwd: "/privacy-safe-workspace",
      delegationDepth: 0,
    }),
    JSON.stringify({ type: "turn/start", seq: 0, time: 2, data: { turn: 1 } }),
    JSON.stringify({
      type: "user/message",
      seq: 1,
      time: 3,
      data: { content: [{ type: "text", text: "privacy-safe v0 replay" }], source: { kind: "user" } },
      surfaceOp: "append",
    }),
    JSON.stringify({ type: "turn/end", seq: 2, time: 4, data: { turn: 1, reason: { kind: "completed" } } }),
  ].join("\n") + "\n";
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

test("P059-DATA-001 prepares an isolated 0.1.5-rc.1 working home and leaves 0.5.8 alpha.1 bytes untouched", () => {
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
    /previous DSH home changed during 0.1.5-rc.1 validation/,
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
  assert.equal(active.rollbackReason, "alpha health regression");
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

test("P059-DATA-004A migration activation recovers a crash before the active pointer write", () => {
  const root = fixtureRoot();
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade05a",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  const activated = activateDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade05a",
    validation: validProof(),
    now: new Date("2026-08-29T00:02:00.000Z"),
  });
  rmSync(paths.activeManifest);

  assert.deepEqual(prepareDshHomeForBoot({ userRoot: root }), {
    kind: "active",
    dshHome: paths.targetHome,
  });
  assert.deepEqual(readActiveDshHome(root), activated);
});

test("P059-DATA-013 fresh 0.5.12 installs boot and activate only the 0.1.5-rc.1 generation", () => {
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
  rmSync(paths.activeManifest);
  assert.deepEqual(prepareDshHomeForBoot({ userRoot: root }), {
    kind: "active",
    dshHome: paths.targetHome,
  });
  assert.equal(readActiveDshHome(root)?.activationKind, "fresh");
});

test("fresh activation digest excludes regenerated first-party profile runtime trees", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");
  const roots = [
    mkdtempSync(join(tmpdir(), "penglai-dsh-home-runtime-a-")),
    mkdtempSync(join(tmpdir(), "penglai-dsh-home-runtime-b-")),
  ];
  const plans = roots.map((userRoot) => prepareDshHomeForBoot({ userRoot, now }));
  for (const plan of plans) {
    mkdirSync(join(plan.dshHome, "profiles", "web", "node_modules"), { recursive: true });
  }
  const regenerated = join(plans[0].dshHome, "profiles", "web", "node_modules", "@penglai", "office");
  mkdirSync(regenerated, { recursive: true });
  writeFileSync(join(regenerated, "large-runtime.js"), "x".repeat(4 * 1024 * 1024));

  const activated = plans.map((plan, index) => activateDshHomeBootPlan({
    userRoot: roots[index],
    plan,
    validation: validProof(),
    now: new Date("2026-08-31T00:01:00.000Z"),
  }));
  assert.equal(activated[0].targetDigest, activated[1].targetDigest);
});

test("P059-DATA-014 0.5.8 alpha.1 upgrades boot a resumable isolated 0.1.5-rc.1 generation", () => {
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
  const original = legalSessionJsonl("fixture");
  assert.equal(
    readFileSync(join(paths.sourceHome, "storages", "sessions", "session.jsonl"), "utf8"),
    original,
  );
  assert.equal(
    readFileSync(join(paths.targetHome, "storages", "sessions", "session.jsonl"), "utf8"),
    original,
  );
});

test("0.5.9 alpha.2 active generation copies a legal session log into 0.1.5-rc.1", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-alpha2-"));
  const previousHome = join(root, "dsh-homes", `dsh-v${DSH_HOME_ALPHA2_VERSION}`);
  mkdirSync(join(previousHome, "storages", "sessions"), { recursive: true, mode: 0o700 });
  const session = legalSessionJsonl("alpha2-session");
  writeFileSync(join(previousHome, "settings.yaml"), "locale:\n  preference: en\n");
  writeFileSync(join(previousHome, "storages", "sessions", "session.jsonl"), session, { mode: 0o600 });
  writeFileSync(join(previousHome, ".penglai-dsh-home.json"), JSON.stringify({
    schema: 1,
    kind: "fresh",
    dshVersion: DSH_HOME_ALPHA2_VERSION,
    state: "active",
    preparedAt: "2026-08-20T00:00:00.000Z",
    activatedAt: "2026-08-20T00:00:00.000Z",
    targetDigest: "b".repeat(64),
  }));
  writeFileSync(join(root, "dsh-home-active.json"), JSON.stringify({
    schema: 1,
    activeVersion: DSH_HOME_ALPHA2_VERSION,
    homeRelative: `dsh-homes/dsh-v${DSH_HOME_ALPHA2_VERSION}`,
    activationKind: "fresh",
    activatedAt: "2026-08-20T00:00:00.000Z",
    targetDigest: "b".repeat(64),
  }));
  const plan = prepareDshHomeForBoot({ userRoot: root, reserveBytes: 0, availableBytes: 1024 * 1024 * 1024 });
  assert.equal(plan.kind, "migration-prepared");
  assert.equal(
    readFileSync(join(plan.dshHome, "storages", "sessions", "session.jsonl"), "utf8"),
    session,
  );
  assert.equal(readFileSync(join(previousHome, "storages", "sessions", "session.jsonl"), "utf8"), session);
});

const OFFICIAL_RC1_V0_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../testdata/dsh-v0-rc1",
);
const OFFICIAL_RC1_SESSION_ID = "penglai-u02-rc1-v0";
const OFFICIAL_RC1_LOG_REL = join(
  "sessions",
  "--privacy-safe-workspace--",
  OFFICIAL_RC1_SESSION_ID,
  "session.jsonl",
);

function officialRc1Provenance() {
  return JSON.parse(
    readFileSync(join(OFFICIAL_RC1_V0_DIR, "provenance.json"), "utf8"),
  ) as {
    sha256: string;
    bytes: number;
    writer: { session: string; formatVersion: number };
  };
}

function officialRc1FixtureLog(): Buffer {
  return readFileSync(
    join(
      OFFICIAL_RC1_V0_DIR,
      "sessions",
      "--privacy-safe-workspace--",
      OFFICIAL_RC1_SESSION_ID,
      "session.jsonl",
    ),
  );
}

function officialRc1V0Home(): string {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-rc1-v0-"));
  const previousHome = join(
    root,
    "dsh-homes",
    `dsh-v${DSH_HOME_PREVIOUS_VERSION}`,
  );
  mkdirSync(join(previousHome, "profiles", "web"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(join(previousHome, ".credentials.yaml"), FIXTURE_CREDENTIAL, {
    mode: 0o600,
  });
  writeFileSync(
    join(previousHome, "settings.yaml"),
    "locale:\n  preference: en\n",
    { mode: 0o600 },
  );
  cpSync(join(OFFICIAL_RC1_V0_DIR, "sessions"), join(previousHome, "sessions"), {
    recursive: true,
  });
  const activatedAt = "2026-09-01T00:00:00.000Z";
  const targetDigest = "a".repeat(64);
  writeFileSync(
    join(previousHome, ".penglai-dsh-home.json"),
    JSON.stringify({
      schema: 1,
      kind: "fresh",
      dshVersion: DSH_HOME_PREVIOUS_VERSION,
      state: "active",
      preparedAt: activatedAt,
      activatedAt,
      targetDigest,
    }),
  );
  writeFileSync(
    join(root, "dsh-home-active.json"),
    JSON.stringify({
      schema: 1,
      activeVersion: DSH_HOME_PREVIOUS_VERSION,
      homeRelative: `dsh-homes/dsh-v${DSH_HOME_PREVIOUS_VERSION}`,
      activationKind: "fresh",
      activatedAt,
      targetDigest,
    }),
  );
  return root;
}

function eventText(
  events: Array<{ type: string; data?: { content?: Array<{ text?: string }>; message?: { content?: Array<{ text?: string }> } } }>,
  type: string,
): string | undefined {
  const event = events.find((row) => row.type === type);
  return (
    event?.data?.content?.[0]?.text ??
    event?.data?.message?.content?.[0]?.text
  );
}

async function restoreOfficialRc1(
  persistRoot: string,
  mode: "read" | "write",
) {
  const ctx = new Context();
  const sessionFiber = await ctx.plugin(SessionStore);
  const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, {
    root: persistRoot,
    compression: DSH_HOME_JSONL_COMPRESSION,
    writeBatchMaxDelayMs: 1,
  });
  try {
    const listed = await ctx.sessionPersistence.list();
    const handle = await ctx.sessionPersistence.open(
      SessionId(OFFICIAL_RC1_SESSION_ID),
      mode,
    );
    try {
      const snapshot = await handle.read();
      return {
        listedIds: listed.map((row: { header: { id: string } }) => row.header.id),
        headerVersion: handle.header.version,
        eventTypes: snapshot.events.map((event: { type: string }) => event.type),
        userText: eventText(snapshot.events, "user/message"),
        assistantText: eventText(snapshot.events, "assistant/message"),
        events: snapshot.events.length,
      };
    } finally {
      await handle.close();
    }
  } finally {
    await persistenceFiber.dispose();
    await sessionFiber.dispose();
  }
}

test("U02 official rc.1 v0 JSONL checkout bytes match provenance and stay LF", () => {
  const provenance = officialRc1Provenance();
  const fixture = officialRc1FixtureLog();
  assert.equal(fixture.includes(0x0d), false);
  assert.equal(fixture.byteLength, provenance.bytes);
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    provenance.sha256,
  );
  const crlf = Buffer.from(
    [...fixture].flatMap((byte) => (byte === 0x0a ? [0x0d, 0x0a] : [byte])),
  );
  assert.notEqual(
    createHash("sha256").update(crlf).digest("hex"),
    provenance.sha256,
  );
});

function assertV3RefusesOfficialRc1Chronology(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "SessionFormatUnsupportedError");
  assert.match(error.message, /surface before first step cannot acquire a system head/);
  assert.match(error.message, /source v0 artifact remains unchanged/);
  return true;
}

test("U02 official rc.1 v0 JSONL copies through Home; V3 refuses chronology without deleting originals", async () => {
  const provenance = officialRc1Provenance();
  assert.equal(provenance.writer.session, "0.1.2-rc.1");
  assert.equal(provenance.writer.formatVersion, 0);
  const root = officialRc1V0Home();
  const previousHome = join(
    root,
    "dsh-homes",
    `dsh-v${DSH_HOME_PREVIOUS_VERSION}`,
  );
  const original = readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL));
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    provenance.sha256,
  );
  assert.deepEqual(original, officialRc1FixtureLog());
  assert.match(original.toString("utf8"), /"version":0/);
  assert.equal(original.includes("isSeeded"), false);

  const plan = prepareDshHomeForBoot({
    userRoot: root,
    reserveBytes: 0,
    availableBytes: 1024 * 1024 * 1024,
  });
  assert.equal(plan.kind, "migration-prepared");
  assert.deepEqual(readFileSync(join(plan.dshHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);

  const targetSessionDir = join(
    plan.dshHome,
    "sessions",
    "--privacy-safe-workspace--",
    OFFICIAL_RC1_SESSION_ID,
  );
  const sourceSessionDir = join(
    previousHome,
    "sessions",
    "--privacy-safe-workspace--",
    OFFICIAL_RC1_SESSION_ID,
  );
  assert.deepEqual(
    readdirSync(targetSessionDir).filter((name) => isHistoricalSessionLogName(name)).sort(),
    ["session.jsonl"],
  );

  await assert.rejects(
    () => restoreOfficialRc1(join(plan.dshHome, "sessions"), "read"),
    assertV3RefusesOfficialRc1Chronology,
  );
  await assert.rejects(
    () => restoreOfficialRc1(join(plan.dshHome, "sessions"), "write"),
    assertV3RefusesOfficialRc1Chronology,
  );
  assert.deepEqual(
    readdirSync(targetSessionDir).filter((name) => isHistoricalSessionLogName(name)).sort(),
    ["session.jsonl"],
  );
  assert.deepEqual(readdirSync(sourceSessionDir).sort(), ["session.jsonl"]);
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.deepEqual(readFileSync(join(plan.dshHome, OFFICIAL_RC1_LOG_REL)), original);

  activateDshHomeBootPlan({ userRoot: root, plan, validation: validProof() });
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_TARGET_VERSION);
  assert.deepEqual(
    readdirSync(targetSessionDir).filter((name) => isHistoricalSessionLogName(name)).sort(),
    ["session.jsonl"],
  );

  rollbackDshHomeUpgrade({
    userRoot: root,
    operationId: plan.operationId!,
    reason: "restore previous version",
  });
  assert.equal(
    readActiveDshHome(root)?.activeVersion,
    DSH_HOME_PREVIOUS_VERSION,
  );
  assert.equal(readActiveDshHome(root)?.rollbackReason, "restore previous version");
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.deepEqual(readdirSync(sourceSessionDir).sort(), ["session.jsonl"]);

  await assert.rejects(
    () => restoreOfficialRc1(join(previousHome, "sessions"), "read"),
    assertV3RefusesOfficialRc1Chronology,
  );
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);

  assert.throws(
    () => prepareDshHomeForBoot({ userRoot: root, reserveBytes: 0 }),
    /cannot start after a Home rollback/,
  );
  rmSync(plan.dshHome, { recursive: true, force: true });
  assert.throws(
    () => prepareDshHomeForBoot({ userRoot: root, reserveBytes: 0 }),
    /cannot start after a Home rollback/,
  );
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)))
      .digest("hex"),
    provenance.sha256,
  );
});

test("U02 truncated migrated rc.1 log fails restore; rejection leaves original restorable", async () => {
  const provenance = officialRc1Provenance();
  const root = officialRc1V0Home();
  const previousHome = join(
    root,
    "dsh-homes",
    `dsh-v${DSH_HOME_PREVIOUS_VERSION}`,
  );
  const original = readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL));
  const paths = resolveDshHomeUpgradePaths(root);
  prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade-u02-reject",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  const targetLog = join(paths.targetHome, OFFICIAL_RC1_LOG_REL);
  writeFileSync(targetLog, original.subarray(0, 40), { mode: 0o600 });
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);

  await assert.rejects(
    () => restoreOfficialRc1(join(paths.targetHome, "sessions"), "read"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "SessionPersistenceCorruptionError");
      assert.match(error.message, /stored log is corrupt/);
      assert.match(error.message, /empty or header-less session log/);
      return true;
    },
  );

  rejectPreparedDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade-u02-reject",
    reason: "migrated session log is unreadable",
  });
  assert.equal(existsSync(paths.targetHome), false);
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)))
      .digest("hex"),
    provenance.sha256,
  );

  await assert.rejects(
    () => restoreOfficialRc1(join(previousHome, "sessions"), "read"),
    assertV3RefusesOfficialRc1Chronology,
  );
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)))
      .digest("hex"),
    provenance.sha256,
  );
});

test("historical session log names include v0 jsonl and every v2 generation suffix", () => {
  assert.equal(isHistoricalSessionLogName("session.jsonl"), true);
  assert.equal(isHistoricalSessionLogName("session.v2.jsonl"), true);
  assert.equal(isHistoricalSessionLogName("session.v2.jsonl.zstd"), true);
  assert.equal(isHistoricalSessionLogName("session.v3.jsonl"), true);
  assert.equal(isHistoricalSessionLogName("session.lock"), false);
  assert.equal(isHistoricalSessionLogName("session.v2.jsonl.bak"), false);
});

test("0.5.12 0.1.3-alpha.2 homes upgrade to 0.1.5-rc.1 without deleting session.v2.jsonl*", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-alpha13-v2-"));
  const previousHome = join(root, "dsh-homes", `dsh-v${DSH_HOME_ALPHA13_VERSION}`);
  const sessionDir = join(
    previousHome,
    "sessions",
    "--privacy-safe-workspace--",
    "penglai-alpha13-v2",
  );
  const storageDir = join(previousHome, "storages", "sessions");
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  const v0 = legalSessionJsonl("penglai-alpha13-v2");
  const v2 = `${JSON.stringify({
    type: "session",
    version: 2,
    id: "penglai-alpha13-v2",
    createdAt: 1,
    cwd: "/privacy-safe-workspace",
    delegationDepth: 0,
  })}\n`;
  const v2zstd = Buffer.from("penglai-opaque-session.v2.jsonl.zstd");
  writeFileSync(join(previousHome, "settings.yaml"), "locale:\n  preference: en\n");
  writeFileSync(join(sessionDir, "session.jsonl"), v0, { mode: 0o600 });
  writeFileSync(join(sessionDir, "session.v2.jsonl"), v2, { mode: 0o600 });
  writeFileSync(join(sessionDir, "session.v2.jsonl.zstd"), v2zstd, { mode: 0o600 });
  writeFileSync(join(storageDir, "session.jsonl"), v0, { mode: 0o600 });
  writeFileSync(join(storageDir, "session.v2.jsonl"), v2, { mode: 0o600 });
  const activatedAt = "2026-09-07T00:00:00.000Z";
  const targetDigest = "c".repeat(64);
  writeFileSync(
    join(previousHome, ".penglai-dsh-home.json"),
    JSON.stringify({
      schema: 1,
      kind: "fresh",
      dshVersion: DSH_HOME_ALPHA13_VERSION,
      state: "active",
      preparedAt: activatedAt,
      activatedAt,
      targetDigest,
    }),
  );
  writeFileSync(
    join(root, "dsh-home-active.json"),
    JSON.stringify({
      schema: 1,
      activeVersion: DSH_HOME_ALPHA13_VERSION,
      homeRelative: `dsh-homes/dsh-v${DSH_HOME_ALPHA13_VERSION}`,
      activationKind: "fresh",
      activatedAt,
      targetDigest,
    }),
  );

  const paths = resolveDshHomeUpgradePaths(root);
  const journal = prepareDshHomeUpgrade({
    userRoot: root,
    operationId: "upgrade-alpha13-v2",
    availableBytes: 1024 * 1024 * 1024,
    reserveBytes: 0,
  });
  assert.equal(journal.fromVersion, DSH_HOME_ALPHA13_VERSION);
  assert.equal(journal.toVersion, DSH_HOME_TARGET_VERSION);
  assert.equal(journal.state, "prepared");

  const sourceSession = join(
    previousHome,
    "sessions",
    "--privacy-safe-workspace--",
    "penglai-alpha13-v2",
  );
  const targetSession = join(
    paths.targetHome,
    "sessions",
    "--privacy-safe-workspace--",
    "penglai-alpha13-v2",
  );
  const sourceStorage = join(previousHome, "storages", "sessions");
  const targetStorage = join(paths.targetHome, "storages", "sessions");
  const expectedSessionLogs = [
    "session.jsonl",
    "session.v2.jsonl",
    "session.v2.jsonl.zstd",
  ];
  assert.deepEqual(
    readdirSync(sourceSession).filter((name) => isHistoricalSessionLogName(name)).sort(),
    expectedSessionLogs,
  );
  assert.deepEqual(
    readdirSync(targetSession).filter((name) => isHistoricalSessionLogName(name)).sort(),
    expectedSessionLogs,
  );
  assert.deepEqual(
    readdirSync(sourceStorage).filter((name) => isHistoricalSessionLogName(name)).sort(),
    ["session.jsonl", "session.v2.jsonl"],
  );
  assert.deepEqual(
    readdirSync(targetStorage).filter((name) => isHistoricalSessionLogName(name)).sort(),
    ["session.jsonl", "session.v2.jsonl"],
  );
  assert.equal(readFileSync(join(sourceSession, "session.jsonl"), "utf8"), v0);
  assert.equal(readFileSync(join(targetSession, "session.jsonl"), "utf8"), v0);
  assert.equal(readFileSync(join(sourceSession, "session.v2.jsonl"), "utf8"), v2);
  assert.equal(readFileSync(join(targetSession, "session.v2.jsonl"), "utf8"), v2);
  assert.deepEqual(readFileSync(join(sourceSession, "session.v2.jsonl.zstd")), v2zstd);
  assert.deepEqual(readFileSync(join(targetSession, "session.v2.jsonl.zstd")), v2zstd);
  assert.equal(readFileSync(join(sourceStorage, "session.v2.jsonl"), "utf8"), v2);
  assert.equal(readFileSync(join(targetStorage, "session.v2.jsonl"), "utf8"), v2);

  const plan = prepareDshHomeForBoot({ userRoot: root, reserveBytes: 0 });
  assert.equal(plan.kind, "migration-prepared");
  activateDshHomeBootPlan({ userRoot: root, plan, validation: validProof() });
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_TARGET_VERSION);
  assert.deepEqual(
    readdirSync(targetSession).filter((name) => isHistoricalSessionLogName(name)).sort(),
    expectedSessionLogs,
  );
  assert.deepEqual(
    readdirSync(sourceSession).filter((name) => isHistoricalSessionLogName(name)).sort(),
    expectedSessionLogs,
  );

  rollbackDshHomeUpgrade({
    userRoot: root,
    operationId: plan.operationId!,
    reason: "restore previous version",
  });
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_ALPHA13_VERSION);
  assert.deepEqual(
    readdirSync(sourceSession).filter((name) => isHistoricalSessionLogName(name)).sort(),
    expectedSessionLogs,
  );
  assert.equal(readFileSync(join(sourceSession, "session.v2.jsonl"), "utf8"), v2);
  assert.deepEqual(readFileSync(join(sourceSession, "session.v2.jsonl.zstd")), v2zstd);
});

function livedInAlpha13Home(options: { userStateSymlink?: boolean } = {}): {
  root: string;
  previousHome: string;
  appRuntime: string;
} {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-lived-in-"));
  const previousHome = join(root, "dsh-homes", `dsh-v${DSH_HOME_ALPHA13_VERSION}`);
  const appRuntime = mkdtempSync(join(tmpdir(), "penglai-embedded-dsh-runtime-"));
  mkdirSync(join(previousHome, "storages", "sessions"), { recursive: true, mode: 0o700 });
  mkdirSync(join(previousHome, "profiles", "web", "node_modules", ".bin"), { recursive: true, mode: 0o700 });
  mkdirSync(join(previousHome, "profiles", "web", ".dsh-module-fallback", "node_modules"), {
    recursive: true,
    mode: 0o700,
  });
  mkdirSync(join(previousHome, "profiles", "node_modules"), { recursive: true, mode: 0o700 });
  mkdirSync(join(previousHome, "profiles", "web", "node_modules", "@penglai", "office"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(join(appRuntime, "index.js"), "export {};\n");
  writeFileSync(join(previousHome, "settings.yaml"), "locale:\n  preference: zh\n", { mode: 0o600 });
  writeFileSync(join(previousHome, ".credentials.yaml"), FIXTURE_CREDENTIAL, { mode: 0o600 });
  writeFileSync(
    join(previousHome, "storages", "sessions", "session.jsonl"),
    legalSessionJsonl("lived-in-0512"),
    { mode: 0o600 },
  );
  writeFileSync(
    join(previousHome, "profiles", "web", "package.json"),
    JSON.stringify({ name: "web", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-web-app"] } } }, null, 2),
    { mode: 0o600 },
  );
  writeFileSync(join(previousHome, "profiles", "web", "cordis.patch.yml"), "[]\n", { mode: 0o600 });
  writeFileSync(
    join(previousHome, "profiles", "web", "node_modules", "@penglai", "office", "package.json"),
    JSON.stringify({ name: "@penglai/office", version: "0.5.12" }),
    { mode: 0o600 },
  );
  const activatedAt = "2026-09-07T00:00:00.000Z";
  const targetDigest = "c".repeat(64);
  writeFileSync(
    join(previousHome, ".penglai-dsh-home.json"),
    JSON.stringify({
      schema: 1,
      kind: "fresh",
      dshVersion: DSH_HOME_ALPHA13_VERSION,
      state: "active",
      preparedAt: activatedAt,
      activatedAt,
      targetDigest,
    }),
  );
  writeFileSync(
    join(root, "dsh-home-active.json"),
    JSON.stringify({
      schema: 1,
      activeVersion: DSH_HOME_ALPHA13_VERSION,
      homeRelative: `dsh-homes/dsh-v${DSH_HOME_ALPHA13_VERSION}`,
      activationKind: "fresh",
      activatedAt,
      targetDigest,
    }),
  );
  const linkType = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(appRuntime, join(previousHome, "profiles", "node_modules", "cordis"), linkType);
  symlinkSync(
    appRuntime,
    join(previousHome, "profiles", "web", ".dsh-module-fallback", "node_modules", "cordis"),
    linkType,
  );
  symlinkSync(
    join(previousHome, "profiles", "web", ".dsh-module-fallback", "node_modules", "cordis"),
    join(previousHome, "profiles", "web", "node_modules", "cordis"),
    linkType,
  );
  symlinkSync(
    join(appRuntime, "index.js"),
    join(previousHome, "profiles", "web", "node_modules", ".bin", "dsh"),
  );
  if (options.userStateSymlink) {
    symlinkSync(join(appRuntime, "index.js"), join(previousHome, "linked.txt"));
  }
  return { root, previousHome, appRuntime };
}

test("lived-in 0.5.12 DSH module-fallback and profile node_modules runtime links do not block 0.1.5-rc.1 copy", (context) => {
  if (process.platform === "win32") {
    context.skip("ordinary Windows users cannot create this symlink fixture");
    return;
  }
  const { root, previousHome } = livedInAlpha13Home();
  const plan = prepareDshHomeForBoot({
    userRoot: root,
    reserveBytes: 0,
    availableBytes: 1024 * 1024 * 1024,
  });
  assert.equal(plan.kind, "migration-prepared");
  assert.equal(
    readFileSync(join(plan.dshHome, "settings.yaml"), "utf8"),
    "locale:\n  preference: zh\n",
  );
  assert.equal(readFileSync(join(plan.dshHome, ".credentials.yaml"), "utf8"), FIXTURE_CREDENTIAL);
  assert.equal(
    readFileSync(join(plan.dshHome, "storages", "sessions", "session.jsonl"), "utf8"),
    legalSessionJsonl("lived-in-0512"),
  );
  assert.match(
    readFileSync(join(plan.dshHome, "profiles", "web", "package.json"), "utf8"),
    /dsh-web-app/,
  );
  assert.equal(readFileSync(join(plan.dshHome, "profiles", "web", "cordis.patch.yml"), "utf8"), "[]\n");
  assert.equal(existsSync(join(plan.dshHome, "profiles", "node_modules")), false);
  assert.equal(existsSync(join(plan.dshHome, "profiles", "web", "node_modules")), false);
  assert.equal(existsSync(join(plan.dshHome, "profiles", "web", ".dsh-module-fallback")), false);
  assert.equal(
    lstatSync(join(previousHome, "profiles", "web", "node_modules", "cordis")).isSymbolicLink(),
    true,
  );
  const active = activateDshHomeBootPlan({
    userRoot: root,
    plan,
    validation: validProof(),
  });
  assert.equal(active.activeVersion, DSH_HOME_TARGET_VERSION);
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_TARGET_VERSION);
});

test("user-state symlink in a lived-in 0.5.12 home still fails closed", (context) => {
  if (process.platform === "win32") {
    context.skip("ordinary Windows users cannot create this symlink fixture");
    return;
  }
  const { root } = livedInAlpha13Home({ userStateSymlink: true });
  assert.throws(
    () =>
      prepareDshHomeForBoot({
        userRoot: root,
        reserveBytes: 0,
        availableBytes: 1024 * 1024 * 1024,
      }),
    /refuses symlink state/,
  );
});

test("home-root node_modules symlink is not treated as a regenerated DSH graph", (context) => {
  if (process.platform === "win32") {
    context.skip("ordinary Windows users cannot create this symlink fixture");
    return;
  }
  const { root, previousHome, appRuntime } = livedInAlpha13Home();
  mkdirSync(join(previousHome, "node_modules"), { recursive: true, mode: 0o700 });
  symlinkSync(appRuntime, join(previousHome, "node_modules", "cordis"), "dir");
  assert.throws(
    () =>
      prepareDshHomeForBoot({
        userRoot: root,
        reserveBytes: 0,
        availableBytes: 1024 * 1024 * 1024,
      }),
    /refuses symlink state/,
  );
});

test("activation of a lived-in 0.5.12 copy still requires Office and Memory", (context) => {
  if (process.platform === "win32") {
    context.skip("ordinary Windows users cannot create this symlink fixture");
    return;
  }
  const { root } = livedInAlpha13Home();
  const plan = prepareDshHomeForBoot({
    userRoot: root,
    reserveBytes: 0,
    availableBytes: 1024 * 1024 * 1024,
  });
  assert.throws(
    () =>
      activateDshHomeBootPlan({
        userRoot: root,
        plan,
        validation: {
          ...validProof(),
          requiredPluginsActive: ["@penglai/office"],
        },
      }),
    /requires exact healthy alpha validation/,
  );
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_ALPHA13_VERSION);
});

const PM_RUNTIME_LINKS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../testdata/pm-old-profile-runtime-links.json",
);

test("collectHistoricalSessionLogs skips managed runtime trees before lstat", () => {
  const src = readFileSync(new URL("./dsh-home-upgrade.ts", import.meta.url), "utf8");
  const collect = src.slice(
    src.indexOf("function collectHistoricalSessionLogs"),
    src.indexOf("function assertHistoricalSessionLogsCopied"),
  );
  assert.match(collect, /isManagedProfileRuntimeTree/);
  assert.ok(
    collect.indexOf("isManagedProfileRuntimeTree") < collect.indexOf("isSymbolicLink"),
    "session-log walk must skip regenerated runtime trees before lstat",
  );
});

test("bundle-desktop rebuilds runtime dist before packing the DSH home skip", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/bundle-desktop.mjs"),
    "utf8",
  );
  assert.match(src, /tsc.*-b/);
  assert.match(src, /dsh-module-fallback/);
  assert.match(src, /startsWith\("profiles\/node_modules\/"\)/);
});

test("PM 498-link 0.1.3-alpha.2 descriptor copies through Home without SECURITY_POLICY", (context) => {
  if (process.platform === "win32") {
    context.skip("ordinary Windows users cannot create this symlink fixture");
    return;
  }
  const descriptor = JSON.parse(readFileSync(PM_RUNTIME_LINKS, "utf8")) as {
    links: Array<{ path: string; target: string }>;
  };
  assert.equal(descriptor.links.length, 498);
  assert.equal(
    descriptor.links.filter((row) => row.path === "profiles/web/node_modules/@deepseek-ai").length,
    1,
  );
  assert.equal(
    descriptor.links.filter((row) => row.path.startsWith("profiles/node_modules/")).length,
    497,
  );

  const appRuntime = mkdtempSync(join(tmpdir(), "penglai-packaged-app-root-"));
  const appRoot = join(appRuntime, "Penglai.app");
  mkdirSync(join(appRoot, "Contents", "Resources", "runtime", "dsh", "node_modules"), { recursive: true });
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-home-498-"));
  const previousHome = join(root, "dsh-homes", `dsh-v${DSH_HOME_ALPHA13_VERSION}`);
  mkdirSync(join(previousHome, "storages", "sessions"), { recursive: true, mode: 0o700 });
  mkdirSync(join(previousHome, "profiles", "web"), { recursive: true, mode: 0o700 });
  writeFileSync(join(previousHome, "settings.yaml"), "locale:\n  preference: zh\n", { mode: 0o600 });
  writeFileSync(join(previousHome, ".credentials.yaml"), FIXTURE_CREDENTIAL, { mode: 0o600 });
  writeFileSync(
    join(previousHome, "storages", "sessions", "session.jsonl"),
    legalSessionJsonl("pm-498"),
    { mode: 0o600 },
  );
  writeFileSync(
    join(previousHome, "profiles", "web", "package.json"),
    JSON.stringify({ name: "web", private: true }),
    { mode: 0o600 },
  );
  const activatedAt = "2026-09-07T00:00:00.000Z";
  const targetDigest = "c".repeat(64);
  writeFileSync(
    join(previousHome, ".penglai-dsh-home.json"),
    JSON.stringify({
      schema: 1,
      kind: "fresh",
      dshVersion: DSH_HOME_ALPHA13_VERSION,
      state: "active",
      preparedAt: activatedAt,
      activatedAt,
      targetDigest,
    }),
  );
  writeFileSync(
    join(root, "dsh-home-active.json"),
    JSON.stringify({
      schema: 1,
      activeVersion: DSH_HOME_ALPHA13_VERSION,
      homeRelative: `dsh-homes/dsh-v${DSH_HOME_ALPHA13_VERSION}`,
      activationKind: "fresh",
      activatedAt,
      targetDigest,
    }),
  );
  for (const row of descriptor.links) {
    const linkPath = join(previousHome, row.path);
    mkdirSync(dirname(linkPath), { recursive: true, mode: 0o700 });
    symlinkSync(row.target.replaceAll("${APP_ROOT}", appRoot), linkPath);
  }

  const plan = prepareDshHomeForBoot({
    userRoot: root,
    reserveBytes: 0,
    availableBytes: 1024 * 1024 * 1024,
  });
  assert.equal(plan.kind, "migration-prepared");
  assert.equal(existsSync(join(plan.dshHome, "settings.yaml")), true);
  assert.equal(readFileSync(join(plan.dshHome, ".credentials.yaml"), "utf8"), FIXTURE_CREDENTIAL);
  assert.equal(
    readFileSync(join(plan.dshHome, "storages", "sessions", "session.jsonl"), "utf8"),
    legalSessionJsonl("pm-498"),
  );
  assert.equal(existsSync(join(plan.dshHome, "profiles", "node_modules")), false);
  assert.equal(existsSync(join(plan.dshHome, "profiles", "web", "node_modules")), false);
  assert.equal(existsSync(join(root, "dsh-home-migrations", `${plan.operationId}.json`)), true);
});



