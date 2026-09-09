import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  runtimePluginTarget,
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

test("runtimePluginTarget maps loongarch64 to linux-loong64", () => {
  assert.equal(runtimePluginTarget("linux", "loong64"), "linux-loong64");
  assert.equal(runtimePluginTarget("linux", "loongarch64"), "linux-loong64");
});

test("catalog v3 marks six user-visible products and office+memory as required-builtin", () => {
  const visible = FIRST_PARTY_PLUGIN_METADATA.filter((entry) => entry.userVisible).map(
    (entry) => entry.id,
  );
  assert.deepEqual(
    [...visible].sort(),
    [
      "@penglai/asr",
      "@penglai/companion",
      "@penglai/im",
      "@penglai/memory",
      "@penglai/moss-tts",
      "@penglai/office",
    ],
  );
  const office = FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/office");
  const memory = FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/memory");
  assert.equal(office?.installClass, "required-builtin");
  assert.equal(memory?.installClass, "required-builtin");
  assert.equal(office?.defaultEnabled, true);
  assert.equal(memory?.defaultEnabled, true);
  assert.equal(office?.provenanceClass, "penglai-builtin");
  assert.equal(memory?.provenanceClass, "penglai-builtin");
  assert.equal(
    FIRST_PARTY_PLUGIN_METADATA.some((entry) => entry.id === "@penglai/context"),
    false,
  );
  assert.ok(memory?.capabilities.includes("authorized-sources"));
  assert.ok(memory?.permissions.includes("authorized-files-read"));
  assert.deepEqual(memory?.platforms, [
    "darwin-arm64",
    "darwin-x64",
    "win32-x64",
    "linux-loong64",
  ]);
  const moss = FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/moss-tts");
  assert.deepEqual(moss?.platforms, ["darwin-arm64", "darwin-x64", "win32-x64"]);
  assert.equal(moss?.platforms.includes("linux-loong64"), false);
  assert.equal(
    FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/plugin-reference")
      ?.userVisible,
    false,
  );
  assert.equal(
    FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/plugin-center")
      ?.installClass,
    "infrastructure",
  );
});

test("linux-loong64 catalog keeps moss in the set without advertising the host", () => {
  const valid: PluginCatalogDocument = {
    schema: 3,
    target: "linux-loong64",
    entries: FIRST_PARTY_PLUGIN_METADATA.map((entry) => ({
      ...entry,
      sha256: "b".repeat(64),
      target: "linux-loong64",
      hasClient: [
        "@penglai/plugin-center",
        "@penglai/im",
        "@penglai/asr",
        "@penglai/moss-tts",
        "@penglai/office",
        "@penglai/memory",
      ].includes(entry.id),
    })),
  };
  const catalog = validatePluginCatalog(valid, "linux-loong64");
  const moss = catalog.entries.find((entry) => entry.id === "@penglai/moss-tts");
  const memory = catalog.entries.find((entry) => entry.id === "@penglai/memory");
  assert.equal(catalog.entries.length, FIRST_PARTY_PLUGIN_METADATA.length);
  assert.equal(moss?.platforms.includes("linux-loong64"), false);
  assert.equal(memory?.platforms.includes("linux-loong64"), true);
});

test("trusted plugin catalog binds exact metadata, checksum, and target", () => {
  const valid = fixture();
  assert.equal(validatePluginCatalog(valid, "darwin-arm64").entries.length, 9);
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
