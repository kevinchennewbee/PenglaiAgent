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

test("0.5.11 rc.1 active generation upgrades to 0.1.3-alpha.2 and restores its exact pointer on rollback", () => {
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
  writeFileSync(join(plan.dshHome, "new-generation-only"), "0.1.3-alpha.2 state");
  rollbackDshHomeUpgrade({ userRoot: root, operationId: plan.operationId!, reason: "restore previous version" });
  assert.deepEqual(JSON.parse(readFileSync(pointer, "utf8")), previous);
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

test("P059-DATA-001 prepares an isolated 0.1.3-alpha.2 working home and leaves 0.5.8 alpha.1 bytes untouched", () => {
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
    /previous DSH home changed during 0.1.3-alpha.2 validation/,
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

test("P059-DATA-013 fresh 0.5.12 installs boot and activate only the 0.1.3-alpha.2 generation", () => {
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

test("P059-DATA-014 0.5.8 alpha.1 upgrades boot a resumable isolated 0.1.3-alpha.2 generation", () => {
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

test("0.5.9 alpha.2 active generation copies a legal session log into 0.1.3-alpha.2", () => {
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
const OFFICIAL_RC1_USER =
  "privacy-safe v0 replay from official 0.1.2-rc.1";
const OFFICIAL_RC1_ASSISTANT = "restored-from-rc1";

function officialRc1Provenance() {
  return JSON.parse(
    readFileSync(join(OFFICIAL_RC1_V0_DIR, "provenance.json"), "utf8"),
  ) as { sha256: string; writer: { session: string; formatVersion: number } };
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
    compression: "none",
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

test("U02 official rc.1 v0 JSONL migrates through Home and restores with 0.1.3-alpha.2", async () => {
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

  const migrated = await restoreOfficialRc1(join(plan.dshHome, "sessions"), "read");
  assert.deepEqual(migrated.listedIds, [OFFICIAL_RC1_SESSION_ID]);
  assert.equal(migrated.userText, OFFICIAL_RC1_USER);
  assert.equal(migrated.assistantText, OFFICIAL_RC1_ASSISTANT);
  assert.ok(migrated.eventTypes.includes("user/message"));
  assert.ok(migrated.eventTypes.includes("assistant/message"));
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.deepEqual(readFileSync(join(plan.dshHome, OFFICIAL_RC1_LOG_REL)), original);

  activateDshHomeBootPlan({ userRoot: root, plan, validation: validProof() });
  assert.equal(readActiveDshHome(root)?.activeVersion, DSH_HOME_TARGET_VERSION);

  const written = await restoreOfficialRc1(join(plan.dshHome, "sessions"), "write");
  assert.equal(written.headerVersion, 2);
  assert.equal(written.userText, OFFICIAL_RC1_USER);
  assert.equal(written.assistantText, OFFICIAL_RC1_ASSISTANT);
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
  const targetNames = readdirSync(targetSessionDir).sort();
  // Official JSONL write-open takes a POSIX flock on session.lock and never
  // unlinks that file on release. Windows holds a named kernel semaphore
  // derived from the path and has no lock file. The kernel flock drops when
  // the write handle closes.
  assert.deepEqual(
    targetNames,
    process.platform === "win32"
      ? ["session.jsonl", "session.v2.jsonl"]
      : ["session.jsonl", "session.lock", "session.v2.jsonl"],
  );
  assert.equal(readdirSync(sourceSessionDir).includes("session.v2.jsonl"), false);
  assert.equal(readdirSync(sourceSessionDir).includes("session.lock"), false);
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.deepEqual(readFileSync(join(plan.dshHome, OFFICIAL_RC1_LOG_REL)), original);

  rollbackDshHomeUpgrade({
    userRoot: root,
    operationId: plan.operationId!,
    reason: "restore previous version",
  });
  assert.equal(
    readActiveDshHome(root)?.activeVersion,
    DSH_HOME_PREVIOUS_VERSION,
  );
  assert.deepEqual(readFileSync(join(previousHome, OFFICIAL_RC1_LOG_REL)), original);
  assert.deepEqual(readdirSync(sourceSessionDir).sort(), ["session.jsonl"]);

  const rolled = await restoreOfficialRc1(join(previousHome, "sessions"), "read");
  assert.equal(rolled.userText, OFFICIAL_RC1_USER);
  assert.equal(rolled.assistantText, OFFICIAL_RC1_ASSISTANT);

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
      assert.match(
        error.message,
        /JSON|corrupt|header|scan|invalid|unexpected|end of|truncated/i,
      );
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

  const source = await restoreOfficialRc1(join(previousHome, "sessions"), "read");
  assert.equal(source.userText, OFFICIAL_RC1_USER);
  assert.equal(source.assistantText, OFFICIAL_RC1_ASSISTANT);
});
