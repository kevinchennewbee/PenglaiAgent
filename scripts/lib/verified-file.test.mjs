import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readVerifiedRegularFile, updateVerifiedRegularFile } from "./verified-file.mjs";

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
