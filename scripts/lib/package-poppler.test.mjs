import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_VC_RUNTIME_DLLS,
  copyPopplerTree,
  copyWindowsPopplerDatadirSibling,
  copyWindowsVcRuntimes,
} from "./package-poppler.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("Windows packaging copies VC runtimes next to pdftoppm and extra-stripped share/poppler", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-package-poppler-"));
  try {
    const tree = join(work, "tree");
    const payload = join(work, "payload");
    const dest = join(payload, "poppler");
    mkdirSync(join(tree, "share", "poppler", "cMap"), { recursive: true });
    writeFileSync(join(tree, "share", "poppler", "cMap", "Adobe-GB1-UCS2"), "cmap");
    writeFileSync(join(tree, "pdftoppm.exe"), "exe");
    mkdirSync(payload, { recursive: true });
    for (const name of WINDOWS_VC_RUNTIME_DLLS) writeFileSync(join(payload, name), `dll-${name}`);
    copyPopplerTree(tree, dest);
    copyWindowsPopplerDatadirSibling(dest, payload);
    copyWindowsVcRuntimes(payload, dest);
    assert.equal(readFileSync(join(payload, "share", "poppler", "cMap", "Adobe-GB1-UCS2"), "utf8"), "cmap");
    for (const name of WINDOWS_VC_RUNTIME_DLLS) {
      assert.equal(readFileSync(join(dest, name), "utf8"), `dll-${name}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("Windows VC runtime copy fails closed when Electron DLLs are absent", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-package-poppler-missing-"));
  try {
    mkdirSync(join(work, "poppler"), { recursive: true });
    assert.throws(() => copyWindowsVcRuntimes(work, join(work, "poppler")), /VC runtime missing/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("package-mac and package-windows-payload bind the shared Poppler helper", () => {
  const mac = readFileSync(join(ROOT, "scripts/package-mac.mjs"), "utf8");
  const win = readFileSync(join(ROOT, "scripts/package-windows-payload.mjs"), "utf8");
  assert.match(mac, /adHocSignDarwinPoppler/);
  assert.match(mac, /copyPopplerTree/);
  assert.match(win, /copyWindowsPopplerDatadirSibling/);
  assert.match(win, /copyWindowsVcRuntimes/);
  assert.match(win, /copyPopplerTree/);
});
