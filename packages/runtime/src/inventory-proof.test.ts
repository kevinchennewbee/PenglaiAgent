import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  EMPTY_INVENTORY_PROOF,
  evaluateInventory,
  exactPluginId,
  inventorySnapshotDocument,
  matchesPlugin,
  refuseRequiredPluginDisable,
  REQUIRED_INVENTORY_IDS,
  type InventoryEntry,
} from "./inventory-proof.js";

function requiredRows(overrides: Record<string, Partial<InventoryEntry>> = {}): InventoryEntry[] {
  const defaults: Record<string, InventoryEntry> = {
    "@deepseek-ai/dsh-credentials-local": {
      moduleName: "@deepseek-ai/dsh-credentials-local",
      enabled: true,
      fiberPhase: "active",
      version: "0.1.6-alpha.2",
    },
    "@penglai/plugin-center": {
      moduleName: "@penglai/plugin-center",
      enabled: true,
      fiberPhase: "active",
      version: "0.5.12",
    },
    "@penglai/memory": {
      moduleName: "@penglai/memory",
      enabled: true,
      fiberPhase: "active",
      version: "0.5.12",
    },
  };
  return REQUIRED_INVENTORY_IDS.map((id) => ({ ...defaults[id], ...(overrides[id] ?? {}) }));
}

test("R63-CORE-003 required inventory needs exact Memory proof", () => {
  const proof = evaluateInventory({ entries: requiredRows() });
  assert.equal(proof.ok, true);
  assert.equal(proof.credentials, true);
  assert.equal(proof.pluginCenter, true);
  assert.equal(proof.memory, true);
  assert.equal(proof.im, false);
  assert.equal(proof.required.length, 3);
  assert.deepEqual(
    proof.required.map((row) => row.id),
    [...REQUIRED_INVENTORY_IDS],
  );
  assert.equal(
    proof.required.every((row) => row.enabled && row.active && row.health === "ready" && row.version.length > 0),
    true,
  );
});

test("R56-CORE-003 optional IM does not become required when it is loaded", () => {
  const proof = evaluateInventory({
    entries: [
      ...requiredRows(),
      { moduleName: "@penglai/im", enabled: true, fiberPhase: "active", version: "0.5.12" },
    ],
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.im, true);
});

test("R63-CORE-003 missing or unhealthy Memory fails Runtime Ready", () => {
  const disabledMemory = evaluateInventory({
    entries: requiredRows({
      "@penglai/memory": { enabled: false, fiberPhase: "active" },
    }),
  });
  assert.equal(disabledMemory.ok, false);
  assert.equal(disabledMemory.memory, false);
  const inactiveMemory = evaluateInventory({
    entries: requiredRows({
      "@penglai/memory": { fiberPhase: "starting" },
    }),
  });
  assert.equal(inactiveMemory.ok, false);
  assert.equal(inactiveMemory.memory, false);
  const unhealthyMemory = evaluateInventory({
    entries: requiredRows({
      "@penglai/memory": { healthy: false },
    }),
  });
  assert.equal(unhealthyMemory.ok, false);
  assert.equal(unhealthyMemory.required.find((row) => row.id === "@penglai/memory")?.health, "failed");
});

test("an intentionally disabled retained Memory permits startup without claiming active health", () => {
  const entries = requiredRows({ "@penglai/memory": { enabled: false, fiberPhase: null } });
  const proof = evaluateInventory({ entries });
  assert.equal(proof.ok, true);
  assert.equal(proof.memory, false);
  assert.equal(proof.required.find((row) => row.id === "@penglai/memory")?.health, "failed");
  assert.equal(evaluateInventory({ entries: entries.filter((row) => row.moduleName !== "@penglai/memory") }).ok, false);
  assert.equal(evaluateInventory({ entries: [...entries, entries[2]] }).ok, false);
});

test("R56-CORE-004 similar plugin ids cannot satisfy required proof", () => {
  const fuzzy = evaluateInventory({
    entries: [
      { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/plugin-center-extra", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/memory-sources", enabled: true, fiberPhase: "active" },
    ],
  });
  assert.equal(fuzzy.ok, false);
  assert.equal(fuzzy.pluginCenter, false);
  assert.equal(fuzzy.memory, false);
  assert.equal(exactPluginId({ moduleName: "@penglai/memory-sources" }, "@penglai/memory"), false);
  assert.equal(matchesPlugin({ moduleName: "@penglai/memory-sources" }, ["@penglai/memory", "memory"]), false);
  assert.equal(exactPluginId({ entryId: "plugin:@penglai/memory" }, "@penglai/memory"), true);
  assert.equal(exactPluginId({ entryId: "fiber:penglai-memory" }, "@penglai/memory"), true);
});

test("R56-CORE-004 snapshot requiredProofs cannot upgrade a missing exact row", () => {
  const proof = evaluateInventory({
    entries: requiredRows().filter((row) => row.moduleName !== "@penglai/memory"),
    requiredProofs: [
      {
        id: "@penglai/memory",
        version: "0.5.12",
        source: "builtin",
        enabled: true,
        active: true,
        health: "ready",
      },
    ],
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.memory, false);
  assert.equal(proof.required.find((row) => row.id === "@penglai/memory")?.health, "failed");
});

test("R56-CORE-003 exact required ids can take version from the pinned catalog", () => {
  const proof = evaluateInventory({
    entries: [
      { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/plugin-center", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/memory", enabled: true, fiberPhase: "active" },
    ],
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.required.find((row) => row.id === "@penglai/memory")?.version, "0.6.3");
  assert.equal(
    proof.required.find((row) => row.id === "@deepseek-ai/dsh-credentials-local")?.version,
    "0.1.6-alpha.2",
  );
});

test("inventory snapshot document records Memory without requiring IM", () => {
  const document = inventorySnapshotDocument(requiredRows());
  assert.equal(document.ok, true);
  assert.equal(document.required.memory, true);
  assert.equal(document.required.im, false);
  assert.equal(document.requiredProofs?.every((row) => row.id !== "@penglai/im"), true);
  assert.equal(EMPTY_INVENTORY_PROOF.ok, false);
  assert.equal(EMPTY_INVENTORY_PROOF.memory, false);
});

test("R56-CORE-005 required inventory ids cannot be disabled by alias", () => {
  for (const id of REQUIRED_INVENTORY_IDS.filter((id) => id !== "@penglai/memory")) {
    assert.throws(
      () => refuseRequiredPluginDisable(id),
      (error: unknown) => error instanceof PenglaiError && error.message === "required plugin cannot be disabled",
    );
  }
  refuseRequiredPluginDisable("penglai-office");
  assert.throws(() => refuseRequiredPluginDisable("@penglai/plugin-center"));
  refuseRequiredPluginDisable("@penglai/im");
  refuseRequiredPluginDisable("@penglai/memory");
  refuseRequiredPluginDisable("penglai-memory");
});
