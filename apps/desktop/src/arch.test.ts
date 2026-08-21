import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

test("R2-ARCH-004 electron main loads official web URL after health", () => {
  const src = readFileSync(join(here, "electron-main.ts"), "utf8");
  assert.match(src, /loadURL/);
  assert.match(src, /startDshProxy/);
  assert.doesNotMatch(src, /getAgent:\s*\(\)\s*=>\s*undefined/);
});

test("R2-DIST-003 supervisor source has no PATH dsh fallback", () => {
  const src = readFileSync(join(here, "supervisor.ts"), "utf8");
  assert.doesNotMatch(src, /"dsh"/);
  assert.match(src, /refusing PATH fallback/);
});

test("native architecture verifier accepts one exact PE executable", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-pe-arch-"));
  try {
    const executable = join(dir, "penglai-windows-host.exe");
    const pe = Buffer.alloc(128);
    pe.write("MZ", 0, "ascii");
    pe.writeUInt32LE(64, 0x3c);
    pe.write("PE\0\0", 64, "ascii");
    pe.writeUInt16LE(0x8664, 68);
    writeFileSync(executable, pe);

    const output = execFileSync(
      process.execPath,
      [join(root, "scripts/verify-native-arch.mjs"), executable, "win32-x86_64"],
      { encoding: "utf8" },
    );
    assert.match(output, /"verdict":"PASS"/);
    assert.match(output, /"files":1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
