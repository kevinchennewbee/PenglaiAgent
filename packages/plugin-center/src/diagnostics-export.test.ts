import assert from "node:assert/strict";
import test from "node:test";
import { exportRedactedCenterDiagnostics } from "./diagnostics-export.js";

test("redacted Center diagnostics omit credentials, chat, QR and private paths", () => {
  const seen = exportRedactedCenterDiagnostics({
    catalog: [
      { id: "@penglai/im", desired: "0.5.12", installed: "0.5.12", loaded: true, healthy: true, actual: "active" },
      { id: "@penglai/office", desired: "0.5.12", installed: "0.5.12", loaded: false, healthy: false, actual: "failed" },
    ],
    now: () => Date.parse("2026-09-07T00:00:00Z"),
  });
  const json = JSON.stringify(seen);
  assert.equal(seen.schema, 1);
  assert.match(json, /reinstall-signed-catalog/);
  assert.doesNotMatch(json, /api[_-]?key|sk-|otpauth|\/Users\/|chat body/i);
  assert.throws(
    () => exportRedactedCenterDiagnostics({
      catalog: [{ id: "@penglai/im", error: "token=sk-live-secret /Users/agent/.penglai" }],
    }),
    /CENTER_DIAGNOSTIC_REDACTION/,
  );
});
