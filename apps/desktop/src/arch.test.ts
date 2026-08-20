import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

test("R2-ARCH-004 electron main loads official web URL after health", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "electron-main.ts"), "utf8");
  assert.match(src, /loadURL/);
  assert.match(src, /startDshProxy/);
  assert.doesNotMatch(src, /getAgent:\s*\(\)\s*=>\s*undefined/);
});

test("R2-DIST-003 supervisor source has no PATH dsh fallback", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "supervisor.ts"), "utf8");
  assert.doesNotMatch(src, /"dsh"/);
  assert.match(src, /refusing PATH fallback/);
});
