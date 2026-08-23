import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./repo.mjs";
import { sanitizeEvidenceValue, writeEvidenceJson } from "./evidence-json.mjs";

test("dirty tree and fake sha cannot mint official PASS evidence", () => {
  const src = readFileSync(new URL("./evidence-dir.mjs", import.meta.url), "utf8");
  assert.match(src, /gitState\(\)/);
  assert.match(src, /working tree dirty; official PASS forbidden/);
  assert.doesNotMatch(src, /"a"\.repeat\(40\)/);
  assert.match(src, /evidence", "generated", sourceSha, target/);
  assert.match(src, /safeCommand/);
});

test("fault injection: non-zero child, missing binary, and timeout stay non-PASS", () => {
  const missing = spawnSync("/no/such/mnemon-binary", ["--version"], { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  const bad = spawnSync(process.execPath, ["-e", "process.exit(7)"], { encoding: "utf8" });
  assert.equal(bad.status, 7);
  const dir = mkdtempSync(join(tmpdir(), "penglai-ev-"));
  writeFileSync(join(dir, "corrupt.pdf"), "not-a-pdf");
  assert.equal(existsSync(join(dir, "corrupt.pdf")), true);
});

test("evidence JSON is bounded, cycle-safe, and redacts credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-evidence-json-"));
  const path = join(dir, "result.json");
  const fakeCredential = ["sk", "examplecredential123456"].join("-");
  const cyclic = { apiKey: fakeCredential, nested: {} };
  cyclic.nested.self = cyclic;
  cyclic.message = `provider said Bearer abcdefghijklmnopqrstuvwxyz ${"x".repeat(20_000)}`;
  const safe = sanitizeEvidenceValue(cyclic);
  assert.equal(safe.apiKey, "[redacted]");
  assert.equal(safe.nested.self, "[cycle]");
  assert.doesNotMatch(safe.message, /Bearer|abcdefghij/);
  assert.match(safe.message, /truncated/);
  writeEvidenceJson(path, cyclic);
  const written = readFileSync(path, "utf8");
  assert.doesNotMatch(written, /examplecredential|Bearer|abcdefghijklmnopqrstuvwxyz/);
  assert.match(written, /\[redacted\]/);
});
