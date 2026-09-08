import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executablePathUnderRoot,
  nsisScopedStopContract,
  selectProcessesForInstance,
  selectProcessesUnderInstallRoot,
} from "./windows-process-scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("Windows process stop matches ExecutablePath under the target root only", () => {
  const a = "C:\\Users\\runner\\AppData\\Local\\Penglai\\app\\0.5";
  const b = "C:\\Users\\runner\\AppData\\Local\\Penglai-other\\app\\0.5";
  assert.equal(executablePathUnderRoot(`${a}\\Penglai.exe`, a), true);
  assert.equal(executablePathUnderRoot(`${a}\\Penglai Helper.exe`, a), true);
  assert.equal(executablePathUnderRoot(`${b}\\Penglai.exe`, a), false);
  const rows = [
    { pid: 11, name: "Penglai.exe", executablePath: `${a}\\Penglai.exe` },
    { pid: 12, name: "Penglai.exe", executablePath: `${b}\\Penglai.exe` },
    { pid: 13, name: "Penglai Helper.exe", executablePath: `${a}\\Penglai Helper.exe` },
    { pid: 14, name: "Penglai.exe", executablePath: "" },
  ];
  assert.deepEqual(
    selectProcessesUnderInstallRoot(rows, a).map((row) => row.pid),
    [11, 13],
  );
  const neighbor = "C:\\Users\\runner\\AppData\\Local\\Penglai\\app\\0.50";
  assert.equal(executablePathUnderRoot(`${neighbor}\\Penglai.exe`, a), false);
  const dataRoot = "C:\\Users\\runner\\AppData\\Local\\Penglai\\0.5";
  const foreignData = "C:\\Users\\runner\\AppData\\Local\\Penglai\\0.50";
  const mixed = [
    ...rows,
    { pid: 15, name: "node.exe", executablePath: "C:\\Windows\\node.exe", commandLine: `node.exe --dsh-home ${dataRoot}` },
    { pid: 16, name: "node.exe", executablePath: "C:\\Windows\\node.exe", commandLine: `node.exe --dsh-home ${foreignData}` },
    { pid: 17, name: "Penglai.exe", executablePath: `${neighbor}\\Penglai.exe`, commandLine: `${neighbor}\\Penglai.exe` },
  ];
  assert.deepEqual(
    selectProcessesForInstance(mixed, { installRoot: a, dataRoot }).map((row) => row.pid).sort((x, y) => x - y),
    [11, 13, 15],
  );
});

test("NSIS and upgrade verifier must not kill every Penglai.exe by image name", () => {
  const nsis = readFileSync(join(root, "scripts/nsis/Penglai.nsi"), "utf8");
  const upgrade = readFileSync(join(root, "scripts/verify-upgrade-uninstall.mjs"), "utf8");
  const helper = readFileSync(join(root, "scripts/lib/installed-app.mjs"), "utf8");
  assert.deepEqual(nsisScopedStopContract(nsis), []);
  for (const [label, text] of [
    ["upgrade", upgrade],
    ["helper", helper],
  ]) {
    assert.doesNotMatch(text, /\/IM\s+Penglai\.exe/i, label);
    assert.doesNotMatch(text, /\/IM", "Penglai\.exe"/, label);
    assert.doesNotMatch(text, /\/IM", "Penglai Helper\.exe"/, label);
    assert.match(text, /windows-process-scope|windows-uninstall-residue/, label);
  }
  assert.match(nsis, /ExecutablePath/);
  assert.match(nsis, /StartsWith/);
  assert.doesNotMatch(upgrade, /DisableRealtimeMonitoring \$true/);
  assert.doesNotMatch(upgrade, /Add-MpPreference -ExclusionPath/);
});
