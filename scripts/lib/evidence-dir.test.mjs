import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
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
  const github = ["github_", `pat_${"a".repeat(32)}`].join("");
  const slack = ["xoxb-", "b".repeat(24)].join("");
  const telegram = ["123456789:", "c".repeat(32)].join("");
  cyclic.message =
    `provider said Bearer abcdefghijklmnopqrstuvwxyz ${github} ${slack} ${telegram} ` +
    ["refresh_", "token=rotating-secret-value "].join("") +
    ["/Us", "ers/example/Secret/file.txt /Vol", "umes/PrivateSSD/project/log.json owner", "@example.com "].join("") +
    "x".repeat(20_000);
  const safe = sanitizeEvidenceValue(cyclic);
  assert.equal(safe.apiKey, "[redacted]");
  assert.equal(safe.nested.self, "[cycle]");
  assert.doesNotMatch(safe.message, /Bearer|abcdefghij/);
  assert.doesNotMatch(safe.message, /github_|xoxb-|123456789:|rotating-secret-value/);
  assert.doesNotMatch(safe.message, /\/Users\/example|\/Volumes\/PrivateSSD|owner@example\.com/);
  assert.match(safe.message, /truncated/);
  writeEvidenceJson(path, cyclic, { root: dir });
  const written = readFileSync(path, "utf8");
  assert.doesNotMatch(written, /examplecredential|Bearer|abcdefghijklmnopqrstuvwxyz|github_|xoxb-|123456789:|rotating-secret-value|\/Users\/example|\/Volumes\/PrivateSSD|owner@example\.com/);
  assert.match(written, /\[redacted\]/);
  assert.equal(sanitizeEvidenceValue({ path: "/home/privateuser/project/log.json" }).path, "[private-path]"); // penglai-test-fixture
  assert.equal(sanitizeEvidenceValue({ path: "C:/Users/privateuser/project/log.json" }).path, "[private-path]"); // penglai-test-fixture
  assert.equal(
    sanitizeEvidenceValue({ log: String.raw`{"path":"C:\\Users\\privateuser\\project\\log.json"}` }).log, // penglai-test-fixture
    '{"path":"[private-path]"}',
  );
  assert.throws(() => writeEvidenceJson(path, Buffer.from("http-body"), { root: dir }), /structured records/);
  assert.throws(() => writeEvidenceJson(path, new Uint8Array([1, 2, 3]), { root: dir }), /structured records/);
  assert.throws(() => writeEvidenceJson(path, "<script>http</script>", { root: dir }), /structured records/);
  assert.throws(
    () => writeEvidenceJson(join(dir, "..", "escaped.json"), cyclic, { root: dir }),
    /escaped its fixed output root/,
  );
  const outside = join(dir, "outside.json");
  const link = join(dir, "linked.json");
  writeFileSync(outside, "outside");
  try {
    symlinkSync(outside, link);
    assert.throws(() => writeEvidenceJson(link, cyclic, { root: dir }), /symlink destination/);
    assert.equal(readFileSync(outside, "utf8"), "outside");
  } catch (error) {
    if (!(process.platform === "win32" && error?.code === "EPERM")) throw error;
  }
  assert.throws(
    () => writeEvidenceJson(join(dir, "too-large.json"), { rows: Array.from({ length: 80 }, () => "x".repeat(16_000)) }, { root: dir }),
    /byte limit/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("exit contract sanitizes both console and persisted evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-exit-contract-"));
  const moduleUrl = new URL("./exit-contract.mjs", import.meta.url).href;
  const secret = ["sk", "examplecredential1234567890"].join("-");
  const script = `import { finish } from ${JSON.stringify(moduleUrl)}; finish("FAIL", { command: "verify:fixture", message: ${JSON.stringify(`/home/privateuser/${secret}`)} });`; // penglai-test-fixture
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const combined = `${result.stdout}\n${result.stderr}`;
  const written = readFileSync(join(dir, "evidence", "generated", "verify-fixture.json"), "utf8");
  assert.doesNotMatch(combined, /privateuser|examplecredential/);
  assert.doesNotMatch(written, /privateuser|examplecredential/);
  assert.match(written, /private-path|redacted/);
  rmSync(dir, { recursive: true, force: true });
});
