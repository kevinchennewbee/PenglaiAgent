import assert from "node:assert/strict";
import test from "node:test";
import { formatSecretHits, FIXTURE_MARKER, isImmutablePublicationRecord, lineLooksLikeDetector, scanIdentityText, scanText } from "./secret-scan.mjs";

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

test("public-repo scanner covers modern provider and named credential forms", () => {
  const text = [
    ["const github = ", '"github_', `pat_${"a".repeat(32)}";`].join(""),
    ["const slack = ", '"xoxb-', `${"b".repeat(24)}";`].join(""),
    ["const telegram = ", '"123456789:', `${"c".repeat(32)}";`].join(""),
    ["REFRESH_", "TOKEN=rotating-secret-value"].join(""),
    ["Authorization: ", "Basic YWxpY2U6c2VjcmV0"].join(""),
    ["const modern = ", `"sk-proj_${"d".repeat(24)}";`].join(""),
  ].join("\n");
  const hits = scanText("packages/demo/src/provider.ts", text);
  assert.deepEqual(
    hits.map((hit) => hit.rule).sort(),
    ["api-key-sk", "github-token", "header-auth", "named-secret", "slack-token", "telegram-token"],
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
    "if (/BEGIN OPENSSH PRIVATE KEY|minisign sk/.test(source)) {", // penglai-test-fixture
  );
  assert.deepEqual(hits, []);
});

test("detector-line classification stays linear on backslash-dot noise", () => {
  const noise = "\\.".repeat(20_000);
  const started = Date.now();
  assert.equal(lineLooksLikeDetector(`if (/${noise}/.test(source)) {`), true);
  assert.equal(lineLooksLikeDetector("const live = true;"), false);
  assert.ok(Date.now() - started < 250);
});

test("URLs and unrelated detector calls cannot suppress concrete credentials", () => {
  const examples = [
    ["https://example.test/endpoint?bot_", "token=synthetic-token-value"].join(""),
    ["Authorization: Bearer ", "synthetic-token-value https://example.test/"].join(""),
    ['const x = {"client_', 'secret":"synthetic-value"}; other.test(x);'].join(""),
    `const key = "sk-${"a".repeat(20)}"; other.includes(key);`,
  ];
  for (const example of examples) assert.ok(scanText("config.ts", example).length > 0);
});

test("R56-SEC-007 owner absolute paths in tracked text are hits", () => {
  const hits = scanIdentityText(
    "docs/notes.md",
    [
      ["Repo lives at ", "/Users/fakeuser/repo", "."].join(""), // penglai-test-fixture
      ["Backup on ", "/Volumes/fakedrive/backup", "."].join(""), // penglai-test-fixture
      ["Windows copy ", "C:\\Users\\fakeuser\\secret", "."].join(""), // penglai-test-fixture
    ].join("\n"),
  );
  assert.deepEqual(
    hits.map((hit) => hit.rule),
    ["owner-absolute-path", "owner-absolute-path", "owner-absolute-path"],
  );
  assert.deepEqual(
    hits.map((hit) => hit.line),
    [1, 2, 3],
  );
});

test("R56-SEC-007 personal webmail addresses in tracked text are hits", () => {
  const hits = scanIdentityText(
    "docs/contact.md",
    [
      ["Owner contact ", "fakeuser@qq.com"].join(""), // penglai-test-fixture
      ["Backup ", "owner@gmail.com"].join(""), // penglai-test-fixture
    ].join("\n"),
  );
  assert.deepEqual(
    hits.map((hit) => hit.rule),
    ["personal-email", "personal-email"],
  );
});

test("R56-SEC-007 synthetic fixture identities are not owner leaks", () => {
  const text = [
    ["path ", "/Users/owner/project"].join(""),
    ["path ", "/Users/example/work"].join(""),
    ["volume ", "/Volumes/Penglai"].join(""),
    ["volume ", "/Volumes/private-owner-drive/x"].join(""),
    ["windows ", "C:\\Users\\runner\\work"].join(""),
    ["mail ", "owner@example.com"].join(""),
    ["mail ", "friend@example.com"].join(""),
    ["mail ", "275234764+kevinchennewbee@users.noreply.github.com"].join(""),
  ].join("\n");
  assert.deepEqual(scanIdentityText("packages/demo/src/demo.test.ts", text), []);
});

test("R56-SEC-008 identity scanner never echoes the leaked value", () => {
  const hits = scanIdentityText("notes.md", ["x ", "/Users/fakeuser/repo"].join("")); // penglai-test-fixture
  const report = formatSecretHits(hits);
  assert.match(report, /notes.md:1 rule=owner-absolute-path category=owner-path/);
  assert.equal(report.includes("fakeuser"), false);
});

test("R56-SEC-007 frozen publication records are exempt (release gate forbids editing them)", () => {
  const line = ["see ", "/Volumes/private-drive/repo", " for the historical checkout"].join(""); // penglai-test-fixture
  // A frozen record keeps its historical text; the release gate rejects any edit.
  assert.deepEqual(scanIdentityText("docs/0.6.0/PLAN.md", line), []);
  assert.deepEqual(scanIdentityText("docs/0.5.10/PLAN.md", line), []);
  assert.deepEqual(scanIdentityText("docs/RELEASE_NOTES_0.6.0.md", line), []);
  // Live documents are still fail-closed.
  assert.equal(scanIdentityText("docs/PRODUCT.md", line).length, 1);
  assert.equal(scanIdentityText("docs/0.6.2/ACCEPTANCE_DELTA.md", line).length, 1);
  assert.equal(scanIdentityText("README.md", line).length, 1);
});

test("immutable record classification matches the release-adaptation frozen set", () => {
  for (const rel of [
    "docs/0.5.8/SOMETHING.md",
    "docs/0.5.9/SOMETHING.md",
    "docs/0.5.10/SOMETHING.md",
    "docs/0.6.0/PLAN.md",
    "docs/PUBLICATION_MANIFEST_0.5.8.md",
    "docs/RELEASE_NOTES_0.5.10.md",
    "docs/PUBLICATION_MANIFEST_0.5.11.md",
    "docs/PUBLICATION_MANIFEST_0.6.0.md",
    "docs/RELEASE_NOTES_0.6.0.md",
    "docs/PUBLICATION_0.6.0.md",
  ]) {
    assert.equal(isImmutablePublicationRecord(rel), true, rel);
  }
  for (const rel of [
    "docs/PRODUCT.md",
    "docs/0.6.2/ACCEPTANCE_DELTA.md",
    "docs/0.5.12/ACTIVE.md",
    "docs/RELEASE_NOTES_0.6.2.md",
    "website/index.html",
  ]) {
    assert.equal(isImmutablePublicationRecord(rel), false, rel);
  }
});
