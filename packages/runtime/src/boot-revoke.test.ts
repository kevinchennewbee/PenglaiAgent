import assert from "node:assert/strict";
import test from "node:test";
import type { SignedPluginCatalog } from "@penglai/plugin-registry";
import { shouldQuarantineInstalledPlugin } from "./boot-revoke.js";

const OLD_SHA = "d".repeat(64);

function catalog(overrides: Partial<SignedPluginCatalog> = {}): SignedPluginCatalog {
  return {
    schema: "penglai-plugin-catalog-v1",
    catalogId: "penglai-plugin-catalog",
    sequence: 6,
    issuedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2027-08-23T00:00:00.000Z",
    centerProtocol: "penglai-center-v1",
    signingKeyId: "penglai-plugin-43d002043969b706d3dee7bb",
    entries: [],
    revocations: [],
    ...overrides,
  };
}

test("removed Office Reader is quarantined by a revocation-only catalog", () => {
  const signed = catalog({
    revocations: [
      {
        id: "@penglai/office-reader",
        version: "0.1.3",
        sha256: OLD_SHA,
        severity: "critical",
        reason: "Replaced by built-in Penglai Office",
        advisory: "PENGLAI-2026-OFFICE-READER-RETIREMENT",
        replacement: "@penglai/office",
      },
    ],
  });
  assert.equal(
    shouldQuarantineInstalledPlugin(
      signed,
      "@penglai/office-reader",
      "0.1.3",
      "darwin-aarch64",
    ),
    true,
  );
});

test("a different version or non-critical advisory remains loadable", () => {
  const signed = catalog({
    revocations: [
      {
        id: "@penglai/office-reader",
        version: "0.1.3",
        sha256: OLD_SHA,
        severity: "superseded",
        reason: "Superseded",
        advisory: "PENGLAI-2026-OFFICE-READER-SUPERSEDED",
      },
    ],
  });
  assert.equal(
    shouldQuarantineInstalledPlugin(signed, "@penglai/office-reader", "0.1.3"),
    false,
  );
  assert.equal(
    shouldQuarantineInstalledPlugin(signed, "@penglai/office-reader", "0.1.2"),
    false,
  );
});
