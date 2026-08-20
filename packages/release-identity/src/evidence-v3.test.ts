import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { parseAcceptanceRegistry, readyBlocked } from "./registry.js";
import { EXIT_BY_VERDICT } from "./exit.js";
import {
  EVIDENCE_SCHEMA_V3,
  assertImportableEvidence,
  evaluateEvidenceV3,
  isFutureTimestamp,
  subgateInjectExit,
  type ImportableEvidence,
} from "./evidence-v3.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function base(over: Partial<ImportableEvidence> = {}): ImportableEvidence {
  return {
    acceptanceId: "R50-TRUTH-001",
    assertionId: "unit",
    candidateSourceSha: "a".repeat(40),
    resultDigest: "d".repeat(32),
    target: "source",
    startedAt: "2026-08-16T00:00:00.000Z",
    endedAt: "2026-08-16T00:00:01.000Z",
    ...over,
  };
}

test("evidence v3 import rejects wrong source/export/artifact/target, future time, duplicate, digest, heartbeat", () => {
  const seen = new Set<string>();
  const expected = { sourceSha: "a".repeat(40), exportTreeSha256: "e".repeat(64), artifactSha256: "1".repeat(64), target: "darwin-aarch64", seenKeys: seen };
  assert.throws(() => assertImportableEvidence(base({ resultDigest: "" }), expected), /digest/);
  assert.throws(() => assertImportableEvidence(base({ candidateSourceSha: "b".repeat(40) }), expected), /wrong-source/);
  assert.throws(
    () => assertImportableEvidence(base({ publicExportTreeSha256: "f".repeat(64), target: "darwin-aarch64", artifactSha256: "1".repeat(64) }), expected),
    /wrong-export/,
  );
  assert.throws(
    () => assertImportableEvidence(base({ target: "darwin-aarch64", artifactSha256: "2".repeat(64) }), expected),
    /wrong-artifact/,
  );
  assert.throws(() => assertImportableEvidence(base({ target: "windows-x86_64", artifactSha256: "1".repeat(64) }), expected), /wrong-target/);
  assert.throws(
    () => assertImportableEvidence(base({ runnerNative: true, translated: true, target: "darwin-aarch64", artifactSha256: "1".repeat(64) }), expected),
    /native/,
  );
  assert.equal(isFutureTimestamp(new Date(Date.now() + 60_000).toISOString()), true);
  assert.throws(() => assertImportableEvidence(base({ startedAt: new Date(Date.now() + 60_000).toISOString() }), { sourceSha: "a".repeat(40) }), /future/);
  assert.doesNotThrow(() =>
    assertImportableEvidence(base({ target: "darwin-aarch64", artifactSha256: "1".repeat(64), publicExportTreeSha256: "e".repeat(64) }), expected),
  );
  assert.throws(
    () => assertImportableEvidence(base({ target: "darwin-aarch64", artifactSha256: "1".repeat(64), publicExportTreeSha256: "e".repeat(64) }), expected),
    /duplicate/,
  );
  assert.throws(
    () =>
      assertImportableEvidence(
        base({
          sample: {
            at: new Date().toISOString(),
            heartbeatAgeMs: 120_000,
            process: { pid: 1, startedAt: "t", command: "a" },
            expectedProcess: { pid: 1, startedAt: "t", command: "a" },
            http: { status: 200, official: true },
            websocket: { opened: true },
            sourceSha: "a".repeat(40),
            artifactSha256: "1".repeat(64),
            target: "darwin-aarch64",
          },
        }),
        { sourceSha: "a".repeat(40), heartbeatMaxAgeMs: 1_000 },
      ),
    /stale-heartbeat/,
  );
});

test("evaluateEvidenceV3 stays blocked while Hard IDs are NOT_RUN", () => {
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const registry = parseAcceptanceRegistry(md);
  const manifest = evaluateEvidenceV3({
    registry,
    records: [],
    candidateSha: "a".repeat(40),
  });
  assert.equal(manifest.schemaVersion, EVIDENCE_SCHEMA_V3);
  assert.equal(manifest.engine, "v3");
  assert.equal(manifest.verdict, "INCOMPLETE");
  assert.equal(readyBlocked(manifest.totals), true);
  assert.equal(manifest.results.find((r) => r.id === "R50-VOICE-001")?.status, "NOT_RUN");
});

test("R50-SEC/VOICE evidence recompute stays honest and scans voice/context surfaces", () => {
  const md = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
  const registry = parseAcceptanceRegistry(md);
  assert.equal(registry.length, [...md.matchAll(/\| `(R50-[A-Z0-9-]+)`/g)].length);
  assert.ok(registry.some((e) => e.id.startsWith("R50-VOICE-")));
  const scanner = readFileSync(join(root, "packages/runtime/src/scanner.ts"), "utf8");
  assert.match(scanner, /transcript body/);
  assert.match(scanner, /voice reference/);
  assert.match(scanner, /context grant path/);
  const manifest = evaluateEvidenceV3({ registry, records: [], candidateSha: "a".repeat(40) });
  assert.equal(readyBlocked(manifest.totals), true);
  assert.notEqual(manifest.verdict, "PASS");
});

test("verify:release inject maps INCOMPLETE/STALE/BLOCKED to non-zero", () => {
  assert.equal(subgateInjectExit("PASS"), 0);
  assert.notEqual(subgateInjectExit("FAIL"), 0);
  assert.equal(subgateInjectExit("INCOMPLETE"), EXIT_BY_VERDICT.INCOMPLETE);
  assert.equal(subgateInjectExit("STALE"), EXIT_BY_VERDICT.STALE);
  assert.equal(subgateInjectExit("BLOCKED"), EXIT_BY_VERDICT.BLOCKED);
  assert.ok(subgateInjectExit("INCOMPLETE") > 0);
});
