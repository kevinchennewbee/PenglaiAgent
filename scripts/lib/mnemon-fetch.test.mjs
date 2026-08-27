import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafeArchiveEntry,
  extractZipContents,
  parseFetchArgs,
  publishArchive,
  selectAssets,
} from "./mnemon-fetch.mjs";

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

test("Windows zip extraction falls back to built-in tar before PowerShell", () => {
  const commands = [];
  const run = (command) => {
    commands.push(command);
    if (command === "unzip") throw new Error("unzip unavailable");
  };
  extractZipContents("mnemon.zip", "out", "win32", run);
  assert.deepEqual(commands, ["unzip", "tar"]);
});

test("verified archives publish through a destination-local atomic rename", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "mnemon-source-"));
  const destDir = mkdtempSync(join(tmpdir(), "mnemon-dest-"));
  const staged = join(sourceDir, "mnemon.zip");
  const dest = join(destDir, "cache", "mnemon.zip");
  const contents = Buffer.from("verified archive bytes");
  writeFileSync(staged, contents);
  const asset = {
    archiveFilename: "mnemon.zip",
    archiveBytes: contents.length,
    archiveSha256: createHash("sha256").update(contents).digest("hex"),
  };
  const published = publishArchive(staged, dest, asset);
  assert.deepEqual(readFileSync(dest), contents);
  assert.equal(published.sha256, asset.archiveSha256);
});
