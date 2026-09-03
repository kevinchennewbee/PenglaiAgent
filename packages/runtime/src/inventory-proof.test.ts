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
} from "./inventory-proof.js";

function requiredRows(overrides: Record<string, object> = {}) {
  const defaults: Record<string, object> = {
    "@deepseek-ai/dsh-credentials-local": {
      moduleName: "@deepseek-ai/dsh-credentials-local",
      enabled: true,
      fiberPhase: "active",
      version: "0.1.2-rc.1",
    },
    "@penglai/plugin-center": {
      moduleName: "@penglai/plugin-center",
      enabled: true,
      fiberPhase: "active",
      version: "0.5.10",
    },
    "@penglai/office": {
      moduleName: "@penglai/office",
      enabled: true,
      fiberPhase: "active",
      version: "0.5.10",
    },
    "@penglai/memory": {
      moduleName: "@penglai/memory",
      enabled: true,
      fiberPhase: "active",
      version: "0.5.10",
    },
  };
  return REQUIRED_INVENTORY_IDS.map((id) => ({ ...defaults[id], ...(overrides[id] ?? {}) }));
}

test("R56-CORE-003 required inventory needs exact Office and Memory proofs", () => {
  const proof = evaluateInventory({ entries: requiredRows() });
  assert.equal(proof.ok, true);
  assert.equal(proof.credentials, true);
  assert.equal(proof.pluginCenter, true);
  assert.equal(proof.office, true);
  assert.equal(proof.memory, true);
  assert.equal(proof.im, false);
  assert.equal(proof.required.length, 4);
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
      { moduleName: "@penglai/im", enabled: true, fiberPhase: "active", version: "0.5.10" },
    ],
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.im, true);
});

test("R56-CORE-003 missing Office or Memory fails Runtime Ready", () => {
  const withoutOffice = evaluateInventory({
    entries: requiredRows().filter((row) => row.moduleName !== "@penglai/office"),
  });
  assert.equal(withoutOffice.ok, false);
  assert.equal(withoutOffice.office, false);
  const disabledMemory = evaluateInventory({
    entries: requiredRows({
      "@penglai/memory": { enabled: false, fiberPhase: "active" },
    }),
  });
  assert.equal(disabledMemory.ok, false);
  assert.equal(disabledMemory.memory, false);
  const inactiveOffice = evaluateInventory({
    entries: requiredRows({
      "@penglai/office": { fiberPhase: "starting" },
    }),
  });
  assert.equal(inactiveOffice.ok, false);
  assert.equal(inactiveOffice.office, false);
  const unhealthyOffice = evaluateInventory({
    entries: requiredRows({
      "@penglai/office": { healthy: false },
    }),
  });
  assert.equal(unhealthyOffice.ok, false);
  assert.equal(unhealthyOffice.required.find((row) => row.id === "@penglai/office")?.health, "failed");
});

test("R56-CORE-004 similar plugin ids cannot satisfy required proof", () => {
  const fuzzy = evaluateInventory({
    entries: [
      { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/plugin-center-extra", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/office-reader", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/memory-sources", enabled: true, fiberPhase: "active" },
      { name: "office", enabled: true, fiberPhase: "active" },
      { entryId: "fiber:penglai-office-reader", enabled: true, fiberPhase: "active" },
    ],
  });
  assert.equal(fuzzy.ok, false);
  assert.equal(fuzzy.pluginCenter, false);
  assert.equal(fuzzy.office, false);
  assert.equal(fuzzy.memory, false);
  assert.equal(exactPluginId({ moduleName: "@penglai/office-reader" }, "@penglai/office"), false);
  assert.equal(matchesPlugin({ moduleName: "@penglai/office-reader" }, ["@penglai/office", "office"]), false);
  assert.equal(exactPluginId({ entryId: "plugin:@penglai/office" }, "@penglai/office"), true);
  assert.equal(exactPluginId({ entryId: "fiber:penglai-office" }, "@penglai/office"), true);
});

test("R56-CORE-004 snapshot requiredProofs cannot upgrade a missing exact row", () => {
  const proof = evaluateInventory({
    entries: requiredRows().filter((row) => row.moduleName !== "@penglai/office"),
    requiredProofs: [
      {
        id: "@penglai/office",
        version: "0.5.10",
        source: "builtin",
        enabled: true,
        active: true,
        health: "ready",
      },
    ],
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.office, false);
  assert.equal(proof.required.find((row) => row.id === "@penglai/office")?.health, "failed");
});

test("R56-CORE-003 exact required ids can take version from the pinned catalog", () => {
  const proof = evaluateInventory({
    entries: [
      { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/plugin-center", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/office", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/memory", enabled: true, fiberPhase: "active" },
    ],
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.required.find((row) => row.id === "@penglai/office")?.version, "0.5.10");
  assert.equal(
    proof.required.find((row) => row.id === "@deepseek-ai/dsh-credentials-local")?.version,
    "0.1.2-rc.1",
  );
});

test("inventory snapshot document records Office and Memory without requiring IM", () => {
  const document = inventorySnapshotDocument(requiredRows());
  assert.equal(document.ok, true);
  assert.equal(document.required.office, true);
  assert.equal(document.required.memory, true);
  assert.equal(document.required.im, false);
  assert.equal(document.requiredProofs?.every((row) => row.id !== "@penglai/im"), true);
  assert.equal(EMPTY_INVENTORY_PROOF.ok, false);
  assert.equal(EMPTY_INVENTORY_PROOF.office, false);
});

test("R56-CORE-005 required inventory ids cannot be disabled by alias", () => {
  for (const id of REQUIRED_INVENTORY_IDS) {
    assert.throws(
      () => refuseRequiredPluginDisable(id),
      (error: unknown) => error instanceof PenglaiError && error.message === "required plugin cannot be disabled",
    );
  }
  assert.throws(() => refuseRequiredPluginDisable("penglai-office"));
  assert.throws(() => refuseRequiredPluginDisable("@penglai/plugin-center"));
  refuseRequiredPluginDisable("@penglai/im");
});
