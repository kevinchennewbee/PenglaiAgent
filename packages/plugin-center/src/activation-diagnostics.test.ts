import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import {
  assertPluginServiceHealthy,
  inventoryActivationObservation,
  waitForInventory,
} from "./remotes.js";
import {
  pluginActionFailureCode,
  readPluginTransactionDiagnostic,
} from "./profile-tx.js";

test("activation diagnostics retain only closed official inventory phases", () => {
  const pending = inventoryActivationObservation(
    {
      list: () => [
        {
          moduleName: "@penglai/companion",
          enabled: true,
          fiberPhase: "pending",
        },
      ],
    },
    "@penglai/companion",
    "2026-08-29T00:00:00.000Z",
  );
  assert.deepEqual(pending, {
    source: "official-inventory",
    at: "2026-08-29T00:00:00.000Z",
    present: true,
    enabled: false,
    phase: "pending",
  });
  const unknown = inventoryActivationObservation(
    {
      list: () => [
        {
          moduleName: "@penglai/companion",
          enabled: true,
          fiberPhase: "private /Users/example stack detail",
        },
      ],
    },
    "@penglai/companion",
  );
  assert.equal(unknown.phase, "unknown");
  assert.doesNotMatch(JSON.stringify(unknown), /Users|stack detail/);
  const unloading = inventoryActivationObservation(
    {
      list: () => [
        {
          moduleName: "@penglai/companion",
          enabled: false,
          disabled: true,
          fiberPhase: "unloading",
        },
      ],
    },
    "@penglai/companion",
  );
  assert.equal(unloading.phase, "unloading");
});

test("activation convergence records pending to active and stops on actual state", async () => {
  let calls = 0;
  const observations: string[] = [];
  await waitForInventory(
    {
      list: () => {
        calls += 1;
        return [
          {
            moduleName: "@penglai/companion",
            enabled: true,
            fiberPhase: calls === 1 ? "pending" : "active",
          },
        ];
      },
    },
    "@penglai/companion",
    true,
    true,
    200,
    (observation) => observations.push(observation.phase),
  );
  assert.deepEqual(observations, ["pending", "active"]);
});

test("disable convergence waits through unloading for disabled readback", async () => {
  let calls = 0;
  const observations: string[] = [];
  await waitForInventory(
    {
      list: () => {
        calls += 1;
        return [
          {
            moduleName: "@penglai/companion",
            enabled: false,
            disabled: true,
            fiberPhase: calls === 1 ? "unloading" : "disabled",
          },
        ];
      },
    },
    "@penglai/companion",
    false,
    true,
    200,
    (observation) => observations.push(observation.phase),
  );
  assert.deepEqual(observations, ["unloading", "disabled"]);
});

test("activation refresh discards a stale failed snapshot before convergence", async () => {
  let phase = "failed";
  let refreshes = 0;
  const observations: string[] = [];
  await waitForInventory(
    {
      list: () => [{ moduleName: "@penglai/companion", enabled: true, fiberPhase: phase }],
      async refresh() {
        refreshes += 1;
        phase = refreshes === 1 ? "loading" : "active";
      },
    },
    "@penglai/companion",
    true,
    true,
    200,
    (observation) => observations.push(observation.phase),
  );
  assert.deepEqual(observations, ["loading", "active"]);
});

test("an active inventory row cannot pass when the plugin service is unhealthy", () => {
  assert.throws(
    () => assertPluginServiceHealthy(() => ({ healthy: false, error: "private local path" }), "@penglai/office"),
    (error: unknown) =>
      error instanceof PenglaiError &&
      error.message === "PLUGIN_SERVICE_UNHEALTHY" &&
      !error.message.includes("private local path"),
  );
});

test("activation timeout and transaction failures expose only closed codes", async () => {
  await assert.rejects(
    waitForInventory(
      {
        list: () => [
          {
            moduleName: "@penglai/companion",
            enabled: true,
            fiberPhase: "private loader exception",
          },
        ],
      },
      "@penglai/companion",
      true,
      true,
      0,
    ),
    (error: unknown) =>
      error instanceof PenglaiError &&
      error.message === "PLUGIN_ACTIVATION_TIMEOUT" &&
      !error.message.includes("private loader exception"),
  );
  assert.equal(
    pluginActionFailureCode(
      new PenglaiError("DSH_UNAVAILABLE", "PLUGIN_ACTIVATION_TIMEOUT"),
    ),
    "PLUGIN_ACTIVATION_TIMEOUT",
  );
  assert.equal(
    pluginActionFailureCode(new Error("private loader exception")),
    "PLUGIN_RUNTIME_UNAVAILABLE",
  );
  assert.equal(
    pluginActionFailureCode(new AggregateError([], "private rollback detail")),
    "PLUGIN_ROLLBACK_FAILED",
  );
});

test("latest transaction diagnostic strips private journal fields", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-activation-diagnostic-"));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "journal.json"),
      JSON.stringify({
        schema: 3,
        operationId: "private-operation-id",
        packageSha256: "a".repeat(64),
        loaderError: "private loader stack",
        id: "@penglai/companion",
        action: "enable",
        phase: "rolled_back",
        failureCode: "PLUGIN_ACTIVATION_TIMEOUT",
        activation: {
          expectedPresent: true,
          expectedEnabled: true,
          outcome: "timed_out",
          observations: [
            {
              source: "official-inventory",
              at: "2026-08-29T00:00:00.000Z",
              present: true,
              enabled: false,
              phase: "pending",
              rawError: "private observation detail",
            },
          ],
        },
        rollback: {
          expectedPresent: true,
          expectedEnabled: false,
          outcome: "verified",
          observations: [],
          finalReadback: {
            source: "official-inventory",
            at: "2026-08-29T00:00:01.000Z",
            present: true,
            enabled: false,
            phase: "disabled",
          },
        },
      }),
    );
    const diagnostic = readPluginTransactionDiagnostic(root);
    assert.equal(diagnostic?.schema, 2);
    assert.match(diagnostic?.referenceId ?? "", /^PC-[A-F0-9]{12}$/);
    assert.equal(diagnostic?.failureCode, "PLUGIN_ACTIVATION_TIMEOUT");
    assert.equal(diagnostic?.activation.observations[0]?.phase, "pending");
    assert.equal(diagnostic?.rollback?.finalReadback?.phase, "disabled");
    assert.doesNotMatch(
      JSON.stringify(diagnostic),
      /operation-id|packageSha256|loader stack|observation detail/,
    );
    assert.equal(
      readPluginTransactionDiagnostic(root)?.referenceId,
      diagnostic?.referenceId,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
