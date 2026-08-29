#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const failures = [];
const requireTokens = (label, source, tokens) => {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${label} lost ${token}`);
  }
};

const routing = read("packages/routing-core/src/index.ts");
const feishu = read("packages/channel-feishu/src/index.ts");
const tests = read("packages/channel-feishu/src/feishu.test.ts");

requireTokens("routing", routing, [
  '"resource-request"',
  '"resource-stream"',
  '"resource-validation"',
  '"media-admission"',
  '"transcription"',
  '"permission-missing"',
  '"resource-not-found"',
  '"resource-identity-rejected"',
  "closedInboundFailureDiagnostic",
  "phase: safeDiagnostic.phase",
  "reason: safeDiagnostic.reason",
]);
requireTokens("feishu", feishu, [
  "classifyFeishuResourceError",
  "status === 403",
  'reason: "permission-missing"',
  'reason: "resource-not-found"',
  'reason: "resource-identity-rejected"',
  'reason: "rate-limited"',
  'reason: "too-large"',
  'reason: "empty"',
  "failure.diagnostic",
]);
requireTokens("tests", tests, [
  "Feishu resource diagnostics classify closed causes",
  "private-scope",
  "assert.doesNotMatch",
]);

if (failures.length > 0) {
  console.error(JSON.stringify({ schema: 1, gate: "Penglai-Feishu-media-diagnostics", result: "FAIL", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema: 1,
  gate: "Penglai-Feishu-media-diagnostics",
  result: "PASS",
  evidenceClass: "source-only",
  phases: 5,
  reasons: 13,
  redaction: "closed-values-only",
}, null, 2));
