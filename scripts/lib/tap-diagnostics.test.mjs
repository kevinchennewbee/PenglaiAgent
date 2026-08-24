import assert from "node:assert/strict";
import test from "node:test";
import { extractTapFailureDiagnostics } from "./tap-diagnostics.mjs";

test("clean-clone diagnostics retain each bounded TAP failure context", () => {
  const output = [
    "ok 1 - passes",
    "not ok 2 - first failure",
    "  ---",
    "  error: first detail",
    "  ...",
    ...Array.from({ length: 25 }, (_, index) => `padding ${index}`),
    "not ok 3 - second failure",
    "  ---",
    "  error: second detail",
    "  ...",
  ].join("\n");
  const excerpt = extractTapFailureDiagnostics(output);
  assert.match(excerpt, /not ok 2 - first failure/);
  assert.match(excerpt, /error: first detail/);
  assert.match(excerpt, /not ok 3 - second failure/);
  assert.match(excerpt, /error: second detail/);
  assert.doesNotMatch(excerpt, /padding 23/);
});

test("clean-clone diagnostics stay empty when TAP has no failures", () => {
  assert.equal(extractTapFailureDiagnostics("ok 1 - passes\n1..1"), "");
});
