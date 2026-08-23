import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeArchiveEntry, parseFetchArgs, selectAssets } from "./mnemon-fetch.mjs";

test("fetch-mnemon rejects unknown arguments", () => {
  assert.throws(() => parseFetchArgs(["--weird"]), /unknown fetch-mnemon argument/);
});

test("fetch-mnemon --host-only selects one host target", () => {
  const parsed = parseFetchArgs(["--host-only"]);
  const assets = selectAssets(parsed, "darwin", "arm64");
  assert.equal(assets.length, 1);
  assert.equal(assets[0].target, "darwin-aarch64");
  assert.notEqual(assets[0].archiveSha256, assets[0].binarySha256);
});

test("fetch-mnemon archive entries reject traversal", () => {
  assert.throws(() => assertSafeArchiveEntry("../etc/passwd"), /unsafe/);
  assert.throws(() => assertSafeArchiveEntry("/abs"), /unsafe/);
  assert.doesNotThrow(() => assertSafeArchiveEntry("mnemon"));
});

test("unit tests do not require a pre-downloaded mnemon binary", () => {
  const dir = mkdtempSync(join(tmpdir(), "no-mnemon-"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "placeholder"), "not-mnemon");
  assert.equal(parseFetchArgs(["--all"]).all, true);
});
