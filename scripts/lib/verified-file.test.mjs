import assert from "node:assert/strict";
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readVerifiedRegularFile, updateVerifiedRegularFile, writeAllVerified } from "./verified-file.mjs";

test("verified file reads bind bytes and metadata to one regular-file handle", (t) => {
  const root = mkdtempSync(join(tmpdir(), "penglai-verified-file-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "payload.bin");
  writeFileSync(file, "verified bytes");
  const result = readVerifiedRegularFile(file);
  assert.equal(result.bytes.toString("utf8"), "verified bytes");
  assert.equal(result.stat.isFile(), true);
  updateVerifiedRegularFile(file, (bytes) => Buffer.concat([bytes, Buffer.from(" updated")]));
  assert.equal(readFileSync(file, "utf8"), "verified bytes updated");

  const link = join(root, "payload-link.bin");
  try {
    symlinkSync(file, link);
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      t.skip("Windows account cannot create symlinks without Developer Mode or elevated privilege");
      return;
    }
    throw error;
  }
  assert.throws(() => readVerifiedRegularFile(link));
  assert.throws(() => updateVerifiedRegularFile(link, () => "rejected"));
});

test("verified writes loop across short writes and reject no-progress writers", () => {
  const payload = Buffer.from("short-write-proof");
  const seen = [];
  writeAllVerified(7, payload, (_descriptor, bytes, offset, length) => {
    const count = Math.min(2, length);
    seen.push(bytes.subarray(offset, offset + count).toString("utf8"));
    return count;
  });
  assert.equal(seen.join(""), payload.toString("utf8"));
  assert.throws(() => writeAllVerified(7, payload, () => 0), /made no progress/);
});

test("verified updates refuse writable hardlinks without changing either name", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-verified-hardlink-"));
  const file = join(root, "settings.yaml");
  const alias = join(root, "outside-alias.yaml");
  writeFileSync(file, "original");
  linkSync(file, alias);
  assert.throws(() => updateVerifiedRegularFile(file, () => "changed"), /hardlink/);
  assert.equal(readFileSync(file, "utf8"), "original");
  assert.equal(readFileSync(alias, "utf8"), "original");
  rmSync(root, { recursive: true, force: true });
});
