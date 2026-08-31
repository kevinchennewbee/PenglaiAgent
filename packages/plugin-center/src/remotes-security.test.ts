import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { createCenterRemote, stageRegistryPackage } from "./remotes.js";
import { R2_CATALOG } from "./index.js";
import { OwnerApprovalBroker, pluginPermissionDigest, type PluginCatalogEntry } from "@penglai/runtime";

const TEST_CATALOG: PluginCatalogEntry[] = R2_CATALOG.map((entry) => ({
  ...entry,
  sha256: "a".repeat(64),
  target: "darwin-arm64",
  hasClient: [
    "@penglai/plugin-center",
    "@penglai/im",
    "@penglai/asr",
    "@penglai/moss-tts",
  ].includes(entry.id),
}));

function remoteFor(userDataRoot: string) {
  return createCenterRemote({
    host: {
      reconcile: () => [],
      desired: () =>
        Object.fromEntries(
          TEST_CATALOG.map((entry) => [entry.id, entry.defaultEnabled]),
        ),
      setDesired: () => undefined,
      entries: () => TEST_CATALOG,
    },
    inventory: { list: () => [] },
    catalog: TEST_CATALOG,
    lifecycle: { apply: async () => undefined },
    resourceProbe: () => undefined,
    profileDir: join(userDataRoot, "profile"),
    txDir: join(userDataRoot, "transactions"),
    pluginsDir: join(userDataRoot, "plugins"),
    userDataRoot,
  });
}

test("Center list marks degraded when reconcile is swallowed", () => {
  const remote = createCenterRemote({
    host: {
      reconcile: () => {
        throw new Error("reconcile down");
      },
      desired: () => ({}),
      setDesired: () => undefined,
      entries: () => TEST_CATALOG,
    },
    inventory: { list: () => [{ id: "@penglai/im", loaded: true }] },
    catalog: TEST_CATALOG,
    lifecycle: { apply: async () => undefined },
    resourceProbe: () => undefined,
    profileDir: "/tmp/penglai-center-degraded/profile",
    txDir: "/tmp/penglai-center-degraded/transactions",
    pluginsDir: "/tmp/penglai-center-degraded/plugins",
    userDataRoot: "/tmp/penglai-center-degraded",
  });
  const snapshot = remote.list() as { degraded?: boolean; catalog: unknown[] };
  assert.equal(snapshot.degraded, true);
  assert.deepEqual(snapshot.catalog, []);
});

test("Center list never relays damaged preset errors or local paths", () => {
  const remote = createCenterRemote({
    host: {
      reconcile: () => [],
      desired: () => ({}),
      setDesired: () => undefined,
      entries: () => TEST_CATALOG,
    },
    inventory: {
      list: () => ({
        entries: [
          {
            moduleName: "@penglai/im",
            version: "0.5.9",
            enabled: true,
            fiberPhase: "failed",
            health: "failed",
            error: "C:\\Users\\private\\broken-preset.yml",
            stack: "/Users/private/broken-preset.yml:12",
          },
        ],
      }),
    },
    catalog: TEST_CATALOG,
    lifecycle: { apply: async () => undefined },
    resourceProbe: () => undefined,
    profileDir: "/tmp/penglai-center-redaction/profile",
    txDir: "/tmp/penglai-center-redaction/transactions",
    pluginsDir: "/tmp/penglai-center-redaction/plugins",
    userDataRoot: "/tmp/penglai-center-redaction",
  });
  const snapshot = remote.list();
  const serialized = JSON.stringify(snapshot.inventory);
  assert.match(serialized, /@penglai\/im/);
  assert.match(serialized, /failed/);
  assert.doesNotMatch(serialized, /Users|private|broken-preset|stack|error/);
});

test("DSH Center remote cannot open installers or plan filesystem deletion", async () => {
  const trusted = "/tmp/penglai-center-lifecycle-boundary";
  const remote = remoteFor(trusted);
  assert.equal("openVerifiedInstaller" in remote, false);
  assert.equal("planUninstall" in remote, false);
  assert.deepEqual(Object.keys(remote).sort(), [
    "disable",
    "download",
    "enable",
    "installDisabled",
    "installEnable",
    "list",
    "refreshRegistry",
    "rollback",
    "update",
  ]);
  const remotes = readFileSync(new URL("./remotes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = remotes.indexOf("async installEnable(id: string, proof?: CenterOwnerProof | string) {");
  const end = remotes.indexOf("disable(id: string, proof?: CenterOwnerProof | string) {\n      refuseRequiredPluginDisable(id);");
  const installEnable = remotes.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(installEnable, /requireOwner\(id, "plugin-enable"/);
  assert.equal(installEnable.includes("this.installDisabled"), false);
  assert.equal((installEnable.match(/requireOwner\(/g) ?? []).length, 1);
  await assert.rejects(
    () =>
      (remote.refreshRegistry as (input?: unknown) => Promise<unknown>)({
        url: "https://evil.example/catalog.json",
      }),
    /renderer URL|public key|signingKeyId|arbitrary/,
  );
});

test("R56-OWN-003 optional plugin disable and rollback require a native owner grant", async () => {
  const remote = remoteFor("/tmp/penglai-center-optional-owner");
  assert.throws(
    () => (remote.disable as (pluginId: string) => unknown)("@penglai/im"),
    /native owner capability is required/,
  );
  await assert.rejects(
    () => (remote.rollback as (pluginId: string) => Promise<unknown>)("@penglai/im"),
    /native owner capability is required/,
  );
});

test("R56-OWN-003 plugin approval binds permissions and commits only after the transaction", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-center-owner-state-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const entry = TEST_CATALOG.find((candidate) => candidate.id === "@penglai/im")!;
  const remote = createCenterRemote({
    host: {
      reconcile: () => [],
      desired: () => ({ [entry.id]: false }),
      setDesired: () => undefined,
      entries: () => TEST_CATALOG,
    },
    inventory: { list: () => [] },
    catalog: TEST_CATALOG,
    lifecycle: { apply: async () => undefined },
    resourceProbe: () => undefined,
    profileDir: join(root, "missing-profile"),
    txDir: join(root, "transactions"),
    pluginsDir: join(root, "plugins"),
    userDataRoot: root,
    ownerBroker: owner,
  });
  const wrong = owner.createProposal({
    action: "plugin.enable",
    pluginId: entry.id,
    objectId: entry.id,
    sourceDigest: entry.sha256,
    permissionDigest: "c".repeat(64),
  });
  const wrongDecision = await owner.requestOwnerApproval(wrong.actionId);
  assert.equal(wrongDecision.decision, "approved");
  assert.throws(
    () =>
      remote.enable(entry.id, {
        actionId: wrong.actionId,
        receipt: wrongDecision.decision === "approved" ? wrongDecision.receipt : "",
      }),
    /intent mismatch/,
  );
  assert.equal(owner.inspect(wrong.actionId).state, "approved");

  const permissionDigest = pluginPermissionDigest({
    permissions: entry.permissions,
    ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
    ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
    nativeCode: entry.nativeCode === true,
  });
  const proposal = owner.createProposal({
    action: "plugin.enable",
    pluginId: entry.id,
    objectId: entry.id,
    sourceDigest: entry.sha256,
    permissionDigest,
  });
  const decision = await owner.requestOwnerApproval(proposal.actionId);
  assert.equal(decision.decision, "approved");
  await assert.rejects(
    () =>
      remote.enable(entry.id, {
        actionId: proposal.actionId,
        receipt: decision.decision === "approved" ? decision.receipt : "",
      }),
    (error: unknown) =>
      error instanceof PenglaiError &&
      error.message === "PLUGIN_PROFILE_INVALID" &&
      !error.message.includes("profile directory missing"),
  );
  assert.equal(owner.inspect(proposal.actionId).state, "reserved");
});

test("R56-CORE-005 Center remotes refuse disable of every required inventory id", () => {
  const remote = remoteFor("/tmp/penglai-center-required-disable");
  for (const id of [
    "@penglai/plugin-center",
    "@penglai/office",
    "penglai-office",
    "@penglai/memory",
    "@deepseek-ai/dsh-credentials-local",
    "dsh-credentials-local",
  ]) {
    assert.throws(
      () => (remote.disable as (pluginId: string) => unknown)(id),
      /required plugin cannot be disabled/,
    );
  }
});

test("signed remote package stages only in the app-private registry root", (context) => {
  const root = mkdtempSync(join(tmpdir(), "penglai-registry-stage-"));
  const cached = join(root, "cache.tgz");
  const bytes = Buffer.from("signed-registry-package");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(cached, bytes, { mode: 0o600 });
  const entry = {
    ...TEST_CATALOG[0]!,
    id: "@penglai/office-reader",
    version: "0.1.0",
    packageFile: "penglai-office-reader-0.1.0.tgz",
    source: "penglai-plugin-registry" as const,
    sha256,
  };
  const pkg = {
    id: entry.id,
    version: entry.version,
    sha256,
    size: bytes.length,
    path: cached,
  } as never;
  const destination = stageRegistryPackage({ pkg, entry, userDataRoot: root });
  assert.equal(
    destination,
    join(root, "plugins", "packages", entry.packageFile),
  );
  assert.deepEqual(readFileSync(destination), bytes);
  assert.equal(
    existsSync(join(root, "bundled-read-only", entry.packageFile)),
    false,
  );
  const linkedPackage = join(root, "linked-package.tgz");
  try {
    symlinkSync(cached, linkedPackage);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    context.skip("Windows account cannot create file symlinks without Developer Mode or elevation");
    return;
  }
  assert.throws(
    () =>
      stageRegistryPackage({
        pkg: { ...pkg, path: linkedPackage },
        entry,
        userDataRoot: root,
      }),
    /regular cached file/,
  );
  assert.throws(
    () =>
      stageRegistryPackage({
        pkg,
        entry,
        userDataRoot: root,
        registryPackagesDir: join(root, "..", "escaped"),
      }),
    /escaped userData/,
  );
  const linkedRoot = mkdtempSync(join(tmpdir(), "penglai-registry-linked-"));
  mkdirSync(join(root, "linked"), { recursive: true });
  symlinkSync(linkedRoot, join(root, "linked", "packages"));
  assert.throws(
    () =>
      stageRegistryPackage({
        pkg,
        entry,
        userDataRoot: root,
        registryPackagesDir: join(root, "linked", "packages"),
      }),
    /symlink|outside userData/,
  );
});
