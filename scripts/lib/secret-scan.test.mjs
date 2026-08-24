import assert from "node:assert/strict";
import test from "node:test";
import { formatSecretHits, FIXTURE_MARKER, scanText } from "./secret-scan.mjs";

const SAMPLE_KEY = `sk-${"abcdefghijklmnopqrstuvwxyz012345"}`;

test("R56-SEC-007 test files are scanned unless the line carries a fixture marker", () => {
  const hits = scanText("packages/demo/src/demo.test.ts", [
    `const live = "${SAMPLE_KEY}";`,
    `const fake = "${SAMPLE_KEY}"; // penglai-test-fixture`,
  ].join("\n"));
  assert.deepEqual(hits, [{ rule: "api-key-sk", category: "api-key", file: "packages/demo/src/demo.test.ts", line: 1 }]);
  assert.equal(FIXTURE_MARKER.test("penglai-test-fixture-key-not-real"), true);
});

test("R56-SEC-007 colon JSON URL and header forms are in the rule set", () => {
  const text = [
    ["DEEPSEEK_API_KEY:", " leaked-value-here"].join(""),
    ["{\"client_", "secret\":\"leaked-secret-value\"}"].join(""),
    ["Authorization: ", "Bearer leaked-bearer-token"].join(""),
    ["query bot_", "token=leaked-bot-value"].join(""),
  ].join("\n");
  const hits = scanText("packages/demo/src/config.yaml", text);
  assert.deepEqual(
    hits.map((hit) => hit.rule).sort(),
    ["bot-token", "colon-secret", "header-auth", "json-secret"],
  );
});

test("R56-SEC-008 scanner evidence never echoes the secret value", () => {
  const hits = scanText("notes.md", `token ${SAMPLE_KEY}`);
  const report = formatSecretHits(hits);
  assert.match(report, /notes.md:1 rule=api-key-sk category=api-key/);
  assert.equal(report.includes(SAMPLE_KEY), false);
});

test("R56-SEC-007 detector regex lines without a concrete key are not hits", () => {
  const hits = scanText(
    "packages/runtime/src/update.ts",
    "if (/BEGIN OPENSSH PRIVATE KEY|minisign sk/.test(source)) {",
  );
  assert.deepEqual(hits, []);
});
