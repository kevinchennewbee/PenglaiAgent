import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PenglaiError } from "@penglai/contracts";
import {
  assertPackedArtifactClean,
  assertProductionBundleClean,
  scanBundleBytes,
} from "./scanner.js";
import { writeTestTarGz } from "../../../scripts/lib/test-tar-fixture.mjs";

test("unpacking scanner fails when a packed tar contains loopback/probe/shortcut/alpha fixture", () => {
  const stage = mkdtempSync(join(tmpdir(), "penglai-scan-dirty-"));
  writeFileSync(join(stage, "index.js"), "export const provider = 'penglai-loopback';\nexport function proveCausalRoute() {}\n");
  writeFileSync(join(stage, "probe.js"), "process.env.PENGLAI_INSTALLED_PROBE\n");
  const tar = join(mkdtempSync(join(tmpdir(), "penglai-scan-tar-")), "plugin.tgz");
  writeTestTarGz(stage, tar);
  assert.throws(() => assertPackedArtifactClean(tar), /penglai-loopback|installed-probe|proveCausalRoute/);
});

test("unpacking scanner accepts a clean packed tar", () => {
  const stage = mkdtempSync(join(tmpdir(), "penglai-scan-clean-"));
  writeFileSync(join(stage, "index.js"), "export const name = '@penglai/im';\n");
  const tar = join(mkdtempSync(join(tmpdir(), "penglai-scan-clean-tar-")), "plugin.tgz");
  writeTestTarGz(stage, tar);
  assert.doesNotThrow(() => assertPackedArtifactClean(tar));
});

test("unpacking scanner accepts a clean plain tar without a host tar executable", () => {
  const stage = mkdtempSync(join(tmpdir(), "penglai-scan-clean-plain-"));
  writeFileSync(join(stage, "index.js"), "export const name = '@penglai/im';\n");
  const tgz = join(mkdtempSync(join(tmpdir(), "penglai-scan-clean-plain-tar-")), "plugin.tgz");
  writeTestTarGz(stage, tgz);
  const tar = tgz.replace(/\.tgz$/, ".tar");
  writeFileSync(tar, gunzipSync(readFileSync(tgz)));
  assert.doesNotThrow(() => assertPackedArtifactClean(tar));
});

test("text scanner also rejects loopback and proveCausalRoute in maps", () => {
  assert.throws(
    () => assertProductionBundleClean({ "dist/index.js": "ensureLoopbackFromLlm(); proveCausalRoute();" }),
    PenglaiError,
  );
});

test("native dependency scan accepts upstream builder paths but rejects local packager paths", () => {
  const vendor = Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0]),
    Buffer.from("/Users/cloudtest/vss/_work/onnxruntime.cc\0"),
  ]);
  assert.deepEqual(scanBundleBytes("vendor/runtime.dylib", vendor), []);
  const githubRunnerVendor = Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0]),
    Buffer.from("/Users/runner/work/1/s/onnxruntime.cc\0"),
    Buffer.from("/Users/runner/work/_temp/onnx/src/defs.cc\0"),
  ]);
  assert.deepEqual(scanBundleBytes("vendor/runtime.dylib", githubRunnerVendor), []);
  assert.deepEqual(
    scanBundleBytes("vendor/runtime.dylib", githubRunnerVendor, "/Users/runner"),
    [],
  );
  const unknownBuilder = Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0]),
    Buffer.from("/Users/random-builder/work/source.cc\0"),
  ]);
  assert.match(
    scanBundleBytes("vendor/runtime.dylib", unknownBuilder).join("\n"),
    /owner path/,
  );
  const local = Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0]),
    Buffer.from(`${homedir()}/private-build/source.cc\0`),
  ]);
  assert.match(
    scanBundleBytes("vendor/runtime.dylib", local).join("\n"),
    /local packager path/,
  );
  const runnerLocal = Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0]),
    Buffer.from("/Users/runner/private-build/source.cc\0"),
  ]);
  assert.match(
    scanBundleBytes("vendor/runtime.dylib", runnerLocal, "/Users/runner").join("\n"),
    /local packager path/,
  );
});

test("R50-SEC: production scanner rejects transcript, voice reference, and grant paths", () => {
  assert.throws(
    () => assertProductionBundleClean({ "diag.json": 'transcript: "user said a long private sentence"' }), // penglai-test-fixture
    /transcript body/,
  );
  assert.throws(
    () => assertProductionBundleClean({ "cache.txt": "local-voices/owner-ref.wav" }), // penglai-test-fixture
    /voice reference/,
  );
  assert.throws(
    () => assertProductionBundleClean({ "grant.json": 'grantedPath: "/Users/owner/Documents"' }),
    /context grant path|owner path/,
  );
  assert.throws(
    () => assertProductionBundleClean({ "memory.json": 'memoryCandidate: "keep this long private note"' }),
    /memory candidate body/,
  );
});
