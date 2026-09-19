import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT } from "./repo.mjs";

test("Windows closure probe uses an existing staging cwd and native system environment", () => {
  const source = readFileSync(join(ROOT, "scripts", "verify-closure.mjs"), "utf8");
  assert.doesNotMatch(source, /cwd:\s*["']\/tmp["']/);
  assert.match(source, /cwd:\s*staging/);
  assert.match(source, /SystemRoot/);
  assert.match(source, /join\(windowsRoot, "System32"\)/);
  assert.match(source, /NODE_PATH:\s*""/);
  assert.match(source, /probeError:\s*probe\.error\?\.code/);
});


test("Windows packaged-artifact probes use installed resources instead of POSIX cwd", () => {
  const source = readFileSync(join(ROOT, "scripts", "verify-artifact.mjs"), "utf8");
  assert.doesNotMatch(source, /cwd:\s*["']\/tmp["']/);
  assert.match(source, /cwd:\s*packaged\.resources/);
  assert.match(source, /SystemRoot/);
  assert.match(source, /join\(windowsRoot, "System32"\)/);
  assert.match(source, /spawnSync\(packaged\.nodeBin/);
  assert.match(source, /probeError:\s*nodeProbe\.error\?\.code/);
  assert.match(source, /probeError:\s*dshProbe\.error\?\.code/);
});
