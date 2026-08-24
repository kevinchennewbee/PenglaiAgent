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
import { createCenterRemote, stageRegistryPackage } from "./remotes.js";
import { R2_CATALOG } from "./index.js";
import type { PluginCatalogEntry } from "@penglai/runtime";

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
  const start = remotes.indexOf("async installEnable(id: string, capabilityId?: string) {");
  const end = remotes.indexOf("disable(id: string) {\n      return transact(id, \"disable\")");
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

test("R56-CORE-005 Center remotes refuse disable of every required inventory id", async () => {
  const remote = remoteFor("/tmp/penglai-center-required-disable");
  for (const id of [
    "@penglai/plugin-center",
    "@penglai/office",
    "penglai-office",
    "@penglai/memory",
    "@deepseek-ai/dsh-credentials-local",
    "dsh-credentials-local",
  ]) {
    await assert.rejects(
      () => (remote.disable as (pluginId: string) => Promise<unknown>)(id),
      /required plugin cannot be disabled/,
    );
  }
});

test("signed remote package stages only in the app-private registry root", () => {
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
  symlinkSync(cached, linkedPackage);
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
