import assert from "node:assert/strict";
import test from "node:test";
import { selectCatalogArtifact } from "./catalog-artifact.js";

function arts(...targets: string[]) {
  return targets.map((target, i) => ({ target, sha256: String(i).repeat(64), url: `https://example/${target}` }));
}

test("exact target wins even when any is first", () => {
  const rows = arts("any", "win32-x64", "darwin-arm64");
  const shuffled = [rows[1]!, rows[2]!, rows[0]!];
  assert.equal(selectCatalogArtifact(shuffled, "darwin-arm64").sha256, "2".repeat(64));
  assert.equal(selectCatalogArtifact(rows, "win32-x64").sha256, "1".repeat(64));
});

test("artifact order is irrelevant: last exact still wins over first any", () => {
  const rows = arts("any", "darwin-x64", "win32-x64", "darwin-arm64");
  const reversed = [...rows].reverse();
  assert.equal(selectCatalogArtifact(reversed, "darwin-arm64").target, "darwin-arm64");
  assert.equal(selectCatalogArtifact(reversed, "linux-x64").target, "any");
});

test("any is used only when the host target has no exact artifact", () => {
  const rows = arts("darwin-x64", "any");
  assert.equal(selectCatalogArtifact(rows, "win32-x64").target, "any");
  assert.equal(selectCatalogArtifact(rows, "darwin-x64").target, "darwin-x64");
});

test("missing exact and any fail closed", () => {
  assert.throws(() => selectCatalogArtifact(arts("darwin-arm64"), "win32-x64"), /incompatible/);
  assert.throws(() => selectCatalogArtifact([], "darwin-arm64"), /missing/);
});
