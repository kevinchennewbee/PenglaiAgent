import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readVerifiedRegularFile } from "./verified-file.mjs";

test("verified file reads bind bytes and metadata to one regular-file handle", (t) => {
  const root = mkdtempSync(join(tmpdir(), "penglai-verified-file-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "payload.bin");
  writeFileSync(file, "verified bytes");
  const result = readVerifiedRegularFile(file);
  assert.equal(result.bytes.toString("utf8"), "verified bytes");
  assert.equal(result.stat.isFile(), true);

  const link = join(root, "payload-link.bin");
  symlinkSync(file, link);
  assert.throws(() => readVerifiedRegularFile(link));
});
