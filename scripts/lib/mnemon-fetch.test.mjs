import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  assertSafeArchiveEntry,
  downloadHttps,
  extractZipContents,
  isTransientMnemonDownloadStatus,
  parseFetchArgs,
  publishArchive,
  selectAssets,
} from "./mnemon-fetch.mjs";

test("fetch-mnemon rejects unknown arguments", () => {
  assert.throws(() => parseFetchArgs(["--weird"]), /unknown fetch-mnemon argument/);
});

test("linux-loong64 is a pinned architecture-built mnemon target", () => {
  const parsed = parseFetchArgs(["--target", "linux-loong64"]);
  const assets = selectAssets(parsed);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].target, "linux-loong64");
  assert.equal(assets[0].architectureBuild, true);
  assert.equal(
    assets[0].binarySha256,
    "a8bc5fc48cbbc60f572dcbb02bf065165837d2134174804820782d2db88bb5be",
  );
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

test("downloadHttps retries a transient 504 then writes the archive", async () => {
  let calls = 0;
  const sleeps = [];
  const dest = join(mkdtempSync(join(tmpdir(), "mnemon-dl-")), "mnemon.tar.gz");
  const payload = Buffer.from("mnemon-archive");
  const out = await downloadHttps("https://github.com/mnemon-dev/mnemon/releases/download/x", dest, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 504,
          headers: { get: () => null },
          body: { cancel: async () => undefined },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: Readable.toWeb(Readable.from(payload)),
      };
    },
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(readFileSync(out).toString(), "mnemon-archive");
  assert.equal(isTransientMnemonDownloadStatus(504), true);
});

test("downloadHttps does not retry a 404", async () => {
  let calls = 0;
  const dest = join(mkdtempSync(join(tmpdir(), "mnemon-404-")), "x");
  await assert.rejects(
    () =>
      downloadHttps("https://github.com/mnemon-dev/mnemon/releases/download/x", dest, {
        fetchImpl: async () => {
          calls += 1;
          return { ok: false, status: 404, headers: { get: () => null }, body: { cancel: async () => undefined } };
        },
        sleepImpl: async () => {
          throw new Error("404 must not sleep-retry");
        },
      }),
    /download failed 404/,
  );
  assert.equal(calls, 1);
  assert.equal(isTransientMnemonDownloadStatus(404), false);
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
