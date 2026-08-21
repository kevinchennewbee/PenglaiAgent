import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createCenterRemote } from "./remotes.js";
import { R2_CATALOG } from "./index.js";
import type { PluginCatalogEntry } from "@penglai/runtime";

const TEST_CATALOG: PluginCatalogEntry[] = R2_CATALOG.map((entry) => ({
  ...entry,
  sha256: "a".repeat(64),
  target: "darwin-arm64",
  hasClient: ["@penglai/plugin-center", "@penglai/im", "@penglai/asr", "@penglai/moss-tts"].includes(entry.id),
}));

function remoteFor(userDataRoot: string) {
  return createCenterRemote({
    host: {
      reconcile: () => [],
      desired: () => Object.fromEntries(TEST_CATALOG.map((entry) => [entry.id, entry.defaultEnabled])),
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

test("DSH Center remote cannot open installers or plan filesystem deletion", () => {
  const trusted = "/tmp/penglai-center-lifecycle-boundary";
  const remote = remoteFor(trusted);
  assert.equal("openVerifiedInstaller" in remote, false);
  assert.equal("planUninstall" in remote, false);
  assert.deepEqual(Object.keys(remote).sort(), ["disable", "enable", "list", "refreshRegistry", "rollback", "update"]);
  assert.throws(() => remote.refreshRegistry({ url: "https://evil.example/catalog.json" }), /arbitrary/);
});
