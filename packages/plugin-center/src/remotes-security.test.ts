import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  OwnerApprovalBroker,
  pluginPermissionDigest,
  type PluginCatalogEntry,
} from "@penglai/runtime";
import {
  PLUGIN_APPLICATIONS,
  createOfficialCenterRemote,
  isKnownPluginApplication,
} from "./official-manager.js";

const CATALOG: PluginCatalogEntry[] = FIRST_PARTY_PLUGIN_METADATA.map((entry) => ({
  ...entry,
  sha256: "a".repeat(64),
  target: "darwin-arm64",
  hasClient: entry.id !== "@penglai/plugin-reference",
}));

function host() {
  return {
    reconcile: () =>
      CATALOG.map((entry) => ({
        id: entry.id,
        desired: entry.defaultEnabled ? "enabled" : "disabled",
        installed: entry.version,
        loaded: entry.defaultEnabled,
        healthy: true,
      })),
  };
}

function manager() {
  let memoryEnabled = true;
  return {
    async listPlugins() {
      return [
        {
          entryId: "include:penglai-plugin-center",
          moduleName: "@penglai/plugin-center",
          enabled: true,
          fiberPhase: "active",
          readOnlyReason: "management-required",
        },
        {
          entryId: "include:penglai-memory",
          patchId: "penglai-memory",
          moduleName: "@penglai/memory",
          enabled: memoryEnabled,
          fiberPhase: memoryEnabled ? "active" : null,
        },
      ];
    },
    async setPluginEnabled(entryId: string, enabled: boolean) {
      assert.equal(entryId, "include:penglai-memory");
      memoryEnabled = enabled;
      return { application: "restart-required" as const, entryId, enabled };
    },
  };
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "penglai-official-center-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const mgr = manager();
  const inventoryRows = [
    {
      moduleName: "@deepseek-ai/dsh-credentials-local",
      version: "0.1.6-alpha.2",
      enabled: true,
      fiberPhase: "active",
      health: "ready",
      healthy: true,
    },
    {
      moduleName: "@penglai/plugin-center",
      version: "0.6.5",
      enabled: true,
      fiberPhase: "active",
      health: "ready",
      healthy: true,
    },
    {
      moduleName: "@penglai/memory",
      version: "0.6.5",
      enabled: true,
      fiberPhase: "active",
      health: "ready",
      healthy: true,
      error: "C:\\Users\\private\\memory.log",
      stack: "/Users/private/memory.ts:1",
    },
  ];
  const remote = createOfficialCenterRemote({
    manager: mgr as never,
    host: host(),
    inventory: { list: () => ({ entries: inventoryRows }) },
    catalog: CATALOG,
    userDataRoot: root,
    txDir: join(root, "center-tx"),
    resourceProbe: () => undefined,
    ownerBroker: owner,
  });
  return { root, owner, mgr, remote };
}

test("official Center list exposes only the bounded public inventory projection", () => {
  const fixture = createFixture();
  try {
    const snapshot = fixture.remote.list();
    const serialized = JSON.stringify(snapshot.inventory);
    assert.match(serialized, /@penglai\/memory/);
    assert.match(serialized, /"fiberPhase":"active"/);
    assert.doesNotMatch(serialized, /Users|private|memory\.log|stack|error/);
    assert.equal(snapshot.degraded, false);
    assert.deepEqual(snapshot.remote, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("official Center keeps management infrastructure required and Memory owner-toggleable", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      () => fixture.remote.disable("@penglai/plugin-center"),
      /required plugin cannot be disabled/,
    );
    await assert.rejects(
      () => fixture.remote.disable("@penglai/memory"),
      /native owner capability is required/,
    );

    const entry = CATALOG.find((row) => row.id === "@penglai/memory")!;
    const permissionDigest = pluginPermissionDigest({
      permissions: entry.permissions,
      ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
      ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
      nativeCode: entry.nativeCode === true,
    });
    const proposal = fixture.owner.createProposal({
      action: "plugin.disable",
      pluginId: entry.id,
      objectId: entry.id,
      sourceDigest: entry.sha256,
      permissionDigest,
    });
    const decision = await fixture.owner.requestOwnerApproval(proposal.actionId);
    assert.equal(decision.decision, "approved");
    if (decision.decision !== "approved") throw new Error("approval fixture failed");

    const changed = (await fixture.remote.disable(entry.id, {
      actionId: proposal.actionId,
      receipt: decision.receipt,
    })) as { application?: string; restartRequired?: boolean };
    assert.equal(changed.application, "restart-required");
    assert.equal(changed.restartRequired, true);
    assert.equal(fixture.owner.inspect(proposal.actionId).state, "committed");
    assert.equal(
      (await fixture.mgr.listPlugins()).find(
        (row) => row.moduleName === "@penglai/memory",
      )?.enabled,
      false,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("legacy Center package actions cannot become a second package manager", async () => {
  const fixture = createFixture();
  try {
    for (const action of [
      () => fixture.remote.update("@penglai/memory"),
      () => fixture.remote.rollback("@penglai/memory"),
      () => fixture.remote.download("@penglai/memory"),
      () => fixture.remote.installDisabled("@penglai/memory"),
    ]) {
      await assert.rejects(action, /official Plugins panel/);
    }
    assert.deepEqual(await fixture.remote.refreshRegistry(), {
      source: "official-dsh-plugin-manager",
      sandbox: false,
    });
    assert.equal("openVerifiedInstaller" in fixture.remote, false);
    assert.equal("planUninstall" in fixture.remote, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("failed official toggle consumes the approved action without claiming success", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-official-center-failure-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const entry = CATALOG.find((row) => row.id === "@penglai/memory")!;
  const permissionDigest = pluginPermissionDigest({
    permissions: entry.permissions,
    ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
    ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
    nativeCode: entry.nativeCode === true,
  });
  const remote = createOfficialCenterRemote({
    manager: {
      listPlugins: async () => [
        {
          entryId: "include:penglai-memory",
          patchId: "penglai-memory",
          moduleName: "@penglai/memory",
        },
      ],
      setPluginEnabled: async () => ({ application: "failed" as const }),
    } as never,
    host: host(),
    inventory: { list: () => [] },
    catalog: CATALOG,
    userDataRoot: root,
    txDir: join(root, "center-tx"),
    resourceProbe: () => undefined,
    ownerBroker: owner,
  });
  try {
    const proposal = owner.createProposal({
      action: "plugin.disable",
      pluginId: entry.id,
      objectId: entry.id,
      sourceDigest: entry.sha256,
      permissionDigest,
    });
    const decision = await owner.requestOwnerApproval(proposal.actionId);
    assert.equal(decision.decision, "approved");
    if (decision.decision !== "approved") throw new Error("approval fixture failed");
    await assert.rejects(
      () =>
        remote.disable(entry.id, {
          actionId: proposal.actionId,
          receipt: decision.receipt,
        }),
      (error: unknown) =>
        error instanceof PenglaiError &&
        // The specific outcome is carried through, so diagnostics can tell a
        // cancellation from a refusal. It used to be collapsed into one string.
        error.message === "official plugin change was not applied: failed",
    );
    assert.equal(owner.inspect(proposal.actionId).state, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-PLUGIN an unrecognised plugin manager outcome fails closed instead of reading as success", async () => {
  // Upstream owns the `application` union in @deepseek-ai/dsh-plugin-manager and
  // has already extended it once, with `overridden`. The previous check tested
  // for the three known failure values and treated everything else as success,
  // so a value upstream added later would have completed the owner approval for
  // a change whose state was unknown. Verified against the pinned upstream type:
  //   application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  const root = mkdtempSync(join(tmpdir(), "penglai-official-center-unknown-"));
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const entry = CATALOG.find((row) => row.id === "@penglai/memory")!;
  const permissionDigest = pluginPermissionDigest({
    permissions: entry.permissions,
    ...(entry.networkOrigins ? { networkOrigins: entry.networkOrigins } : {}),
    ...(entry.dataPaths ? { dataPaths: entry.dataPaths } : {}),
    nativeCode: entry.nativeCode === true,
  });
  const remote = createOfficialCenterRemote({
    manager: {
      listPlugins: async () => [
        {
          entryId: "include:penglai-memory",
          patchId: "penglai-memory",
          moduleName: "@penglai/memory",
        },
      ],
      // A value this build does not know. It must not be read as applied.
      setPluginEnabled: async () => ({ application: "partially-applied" as never }),
    } as never,
    host: host(),
    inventory: { list: () => [] },
    catalog: CATALOG,
    userDataRoot: root,
    txDir: join(root, "center-tx"),
    resourceProbe: () => undefined,
    ownerBroker: owner,
  });
  try {
    const proposal = owner.createProposal({
      action: "plugin.disable",
      pluginId: entry.id,
      objectId: entry.id,
      sourceDigest: entry.sha256,
      permissionDigest,
    });
    const decision = await owner.requestOwnerApproval(proposal.actionId);
    if (decision.decision !== "approved") throw new Error("approval fixture failed");
    await assert.rejects(
      () =>
        remote.disable(entry.id, {
          actionId: proposal.actionId,
          receipt: decision.receipt,
        }),
      (error: unknown) =>
        error instanceof PenglaiError &&
        error.message === "official plugin manager returned an unrecognised outcome",
    );
    // The approval must be consumed as a failure, not completed as a success.
    assert.equal(owner.inspect(proposal.actionId).state, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PLUGIN_APPLICATIONS matches the pinned upstream union", () => {
  // Guards the closed enum against silent drift from the upstream contract.
  assert.deepEqual(
    [...PLUGIN_APPLICATIONS].sort(),
    ["applied", "cancelled", "failed", "overridden", "restart-required"].sort(),
  );
  assert.equal(isKnownPluginApplication("partially-applied"), false);
  assert.equal(isKnownPluginApplication(undefined), false);
  assert.equal(isKnownPluginApplication(3), false);
  assert.equal(isKnownPluginApplication("applied"), true);
});
