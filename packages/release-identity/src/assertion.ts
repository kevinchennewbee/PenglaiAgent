import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import type { ResultStatus } from "./registry.js";

/** Git HEAD only. Env vars including PENGLAI_CANDIDATE_SHA never override a runner SHA. */
export function declaredSourceSha(cwd = process.cwd()): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

export interface AssertionRecord {
  acceptanceId: string;
  runnerId: string;
  testId: string;
  assertionId: string;
  status: ResultStatus;
  candidateSourceSha: string;
  sourceTree?: string;
  publicExportTreeSha256?: string;
  candidateId?: string;
  target?: string;
  artifactSha256?: string;
  runnerNative?: boolean;
  translated?: boolean;
  emulated?: boolean;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  resultDigest: string;
  rawEvidencePointer?: string;
  details?: { safe?: string };
}

export function digestAssertion(rec: Omit<AssertionRecord, "resultDigest">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        acceptanceId: rec.acceptanceId,
        assertionId: rec.assertionId,
        status: rec.status,
        exitCode: rec.exitCode,
        candidateSourceSha: rec.candidateSourceSha,
      }),
    )
    .digest("hex");
}

export function assertNoFanOut(records: readonly AssertionRecord[]): void {
  const byAssertion = new Map<string, Set<string>>();
  for (const rec of records) {
    // A single test (runnerId + testId) may only attribute one acceptanceId.
    // Keying on assertionId as well made this check vacuous: one smoke test
    // could stamp dozens of IDs by giving each a different assertionId.
    const key = `${rec.runnerId}::${rec.testId}`;
    const ids = byAssertion.get(key) ?? new Set<string>();
    ids.add(rec.acceptanceId);
    byAssertion.set(key, ids);
  }
  for (const [assertion, ids] of byAssertion) {
    if (ids.size > 1) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `fan-out ${assertion} claimed ${[...ids].sort().join(",")}`,
      );
    }
  }
}

export function assertNativeHonest(rec: AssertionRecord): void {
  if (rec.runnerNative === true && (rec.translated === true || rec.emulated === true)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      `${rec.acceptanceId} translated/emulated result claimed native`,
    );
  }
}

const SECRETISH = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bwxp_[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /App Secret[:\s]+[A-Za-z0-9]/i,
];

const OWNER_PATH = /\/Users\/[^/\s]+|\/Volumes\/KevinSSD|C:\\Users\\[^\\\s]+/i;

export function assertEvidenceTextClean(text: string, label = "evidence"): void {
  for (const re of SECRETISH) {
    if (re.test(text)) throw new PenglaiError("SECURITY_POLICY", `${label} contains secret-like material`);
  }
  if (OWNER_PATH.test(text)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} contains owner absolute path`);
  }
}

export function recordAssertion(partial: Omit<AssertionRecord, "resultDigest" | "startedAt" | "endedAt"> & {
  startedAt?: string;
  endedAt?: string;
}): AssertionRecord {
  const now = new Date().toISOString();
  const candidateSourceSha = partial.candidateSourceSha;
  if (!candidateSourceSha) {
    throw new PenglaiError("INVALID_INPUT", "candidateSourceSha is required and must not come from env");
  }
  const rec: AssertionRecord = {
    ...partial,
    candidateSourceSha,
    startedAt: partial.startedAt ?? now,
    endedAt: partial.endedAt ?? now,
    resultDigest: "",
  };
  rec.resultDigest = digestAssertion(rec);
  assertNativeHonest(rec);
  if (rec.runnerId === "installed" && /contract/i.test(rec.testId)) {
    throw new PenglaiError("INVALID_INPUT", "contract tests cannot record installed-class assertions");
  }
  if (partial.details?.safe) assertEvidenceTextClean(partial.details.safe, rec.assertionId);
  const dir = process.env.PENGLAI_EVIDENCE_DIR;
  if (dir) {
    const file = dir.endsWith(".jsonl") ? dir : `${dir.replace(/\/$/, "")}/assertions.jsonl`;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(rec)}\n`);
  }
  return rec;
}
