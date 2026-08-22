import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  validatePluginCatalog,
  type PluginCatalogDocument,
} from "./plugin-catalog.js";

function fixture(): PluginCatalogDocument {
  return {
    schema: 3,
    target: "darwin-arm64",
    entries: FIRST_PARTY_PLUGIN_METADATA.map((entry) => ({
      ...entry,
      sha256: "a".repeat(64),
      target: "darwin-arm64",
      hasClient: ["@penglai/plugin-center", "@penglai/im", "@penglai/asr", "@penglai/moss-tts", "@penglai/office", "@penglai/memory"].includes(entry.id),
    })),
  };
}

test("trusted plugin catalog binds exact metadata, checksum, and target", () => {
  const valid = fixture();
  assert.equal(validatePluginCatalog(valid, "darwin-arm64").entries.length, 10);
  assert.throws(
    () => validatePluginCatalog(valid, "darwin-x64"),
    /target mismatch/,
  );
  const noHash = structuredClone(valid);
  noHash.entries[0]!.sha256 = "";
  assert.throws(
    () => validatePluginCatalog(noHash, "darwin-arm64"),
    /checksum required/,
  );
  const permissionDrift = structuredClone(valid);
  permissionDrift.entries[1]!.permissions.push("arbitrary-root");
  assert.throws(
    () => validatePluginCatalog(permissionDrift, "darwin-arm64"),
    /permissions drift/,
  );
});
