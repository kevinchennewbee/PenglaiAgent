import { PenglaiError } from "@penglai/contracts";
import type { AcceptanceResult } from "./registry.js";
import { tally, assertCompleteness, readyBlocked, type CompletenessTotals } from "./registry.js";
import type { AssertionRecord } from "./assertion.js";
import { assertNoFanOut } from "./assertion.js";
import { PRODUCT_VERSION } from "./pins.js";

export interface EvidenceManifest {
  schemaVersion: 3;
  release: string;
  runId: string;
  candidateSha: string;
  generatedFromRunner: true;
  hardcodedPass: false;
  totals: CompletenessTotals;
  results: AcceptanceResult[];
  verdict: "PASS" | "INCOMPLETE" | "FAIL";
}

export function buildEvidenceManifest(opts: {
  release: string;
  runId: string;
  candidateSha: string;
  registry: string[];
  results: AcceptanceResult[];
}): EvidenceManifest {
  if (opts.results.some((r) => r.hardcoded)) {
    throw new PenglaiError("SECURITY_POLICY", "hardcoded result rejected");
  }
  const attributed = opts.results.filter((r) => r.status === "PASS");
  const missingAssertion = attributed.filter((r) => !r.assertionId);
  if (missingAssertion.length) {
    throw new PenglaiError("SECURITY_POLICY", `PASS without assertionId: ${missingAssertion.map((r) => r.id).join(",")}`);
  }
  const assertionLike: AssertionRecord[] = attributed.map((r) => {
    const rec: AssertionRecord = {
      acceptanceId: r.id,
      runnerId: r.runnerId ?? r.runner ?? "unknown",
      testId: r.testId ?? r.runId,
      assertionId: r.assertionId ?? "",
      status: r.status,
      candidateSourceSha: r.candidateSha,
      startedAt: r.startedAt ?? r.timestamp,
      endedAt: r.finishedAt ?? r.timestamp,
      exitCode: r.exitCode ?? 0,
      resultDigest: r.resultDigest ?? "",
    };
    if (r.runnerNative !== undefined) rec.runnerNative = r.runnerNative;
    if (r.translated !== undefined) rec.translated = r.translated;
    if (r.emulated !== undefined) rec.emulated = r.emulated;
    return rec;
  });
  assertNoFanOut(assertionLike);
  const totals = tally(opts.registry, opts.results, opts.candidateSha);
  assertCompleteness(totals, { allowIncomplete: true });
  const verdict = totals.fail > 0 ? "FAIL" : readyBlocked(totals) ? "INCOMPLETE" : "PASS";
  return {
    schemaVersion: 3,
    release: opts.release,
    runId: opts.runId,
    candidateSha: opts.candidateSha,
    generatedFromRunner: true,
    hardcodedPass: false,
    totals,
    results: opts.results,
    verdict,
  };
}

export function negativeSelfTest(registry: string[], candidateSha: string): void {
  const base: AcceptanceResult[] = registry.map((id) => ({
    id,
    status: "NOT_RUN",
    candidateSha,
    runId: "neg",
    timestamp: "1970-01-01T00:00:00.000Z",
  }));
  const ok = tally(registry, base, candidateSha);
  if (ok.missing !== 0 || ok.duplicate !== 0) {
    throw new PenglaiError("SECURITY_POLICY", "baseline tally broken");
  }

  const missing = tally(registry, base.slice(1), candidateSha);
  if (missing.missing !== 1) throw new PenglaiError("SECURITY_POLICY", "missing gate inert");

  const dup = tally(registry, [...base, { ...base[0]!, id: base[0]!.id }], candidateSha);
  if (dup.duplicate !== 1) throw new PenglaiError("SECURITY_POLICY", "duplicate gate inert");

  const unknown = tally(registry, [...base, { ...base[0]!, id: "R50-FAKE-999" }], candidateSha);
  if (unknown.unknown < 1) throw new PenglaiError("SECURITY_POLICY", "unknown gate inert");

  const stale = tally(
    registry,
    base.map((r, i) => (i === 0 ? { ...r, candidateSha: "0".repeat(40) } : r)),
    candidateSha,
  );
  if (stale.stale !== 1) throw new PenglaiError("SECURITY_POLICY", "stale gate inert");

  try {
    buildEvidenceManifest({
      release: PRODUCT_VERSION,
      runId: "neg-hard",
      candidateSha,
      registry,
      results: base.map((r, i) => (i === 0 ? { ...r, status: "PASS", hardcoded: true, assertionId: "hard" } : r)),
    });
  } catch (err) {
    if (err instanceof PenglaiError) return;
    throw err;
  }
  throw new PenglaiError("SECURITY_POLICY", "hardcoded PASS was accepted");
}
