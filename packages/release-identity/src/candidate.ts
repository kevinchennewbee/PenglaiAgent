import { PenglaiError } from "@penglai/contracts";
import {
  CANDIDATE_KIND,
  HARD_SUBGATES,
  REQUIRED_SUBGATE_KINDS,
} from "./pins.js";
import type { VerifierVerdict } from "./exit.js";
import { EXIT_BY_VERDICT } from "./exit.js";

export type NotaryEvidence = "absent" | "accepted" | "fake" | "claimed-pass" | "claimed-waived";

export interface GateRecord {
  name: string;
  exit: number;
  verdict?: string;
  kind?: string;
}

export interface ReleaseAggregation {
  verdict: VerifierVerdict;
  exitCode: number;
  failReasons: string[];
  missingGates: string[];
  listedKinds: string[];
  notarizedAttribute: false | true;
  authenticodeAttribute: false | true;
  notaryStatus: "NOT_RUN" | "ACCEPTED" | "REJECTED";
  notaryRecordedAs: "attribute" | "required-failure";
}

export function listedSubgateNames(): string[] {
  return HARD_SUBGATES.map((g) => g.name);
}

export function listedSubgateKinds(): string[] {
  return [...new Set(HARD_SUBGATES.map((g) => g.kind))];
}

export function assertRequiredKindsPresent(): void {
  const have = new Set(listedSubgateKinds());
  for (const kind of REQUIRED_SUBGATE_KINDS) {
    if (!have.has(kind)) {
      throw new PenglaiError("INVALID_INPUT", `release aggregator missing kind ${kind}`);
    }
  }
}

export const ARM64_AUTOMATED_GATES = [
  "format:check",
  "typecheck",
  "test:unit",
  "test:contract",
  "test:integration",
  "test:security",
  "test:chaos",
  "test:soak",
  "verify:versions",
  "verify:identity",
  "verify:contracts",
  "verify:dependencies",
  "verify:fuses",
  "verify:signing",
  "audit:secrets",
] as const;

export const ARM64_DEFERRED_GATES = [
  "verify:closure",
  "verify:profile",
  "verify:artifact",
  "verify:installed",
  "verify:public-export",
] as const;

export function evaluateApplicableDomain(opts: {
  records: GateRecord[];
  summaryVerdict?: string;
  summaryTotals?: { fail?: number; stale?: number };
  domain?: "arm64-automated";
}): { domain: "arm64-automated"; verdict: VerifierVerdict; deferred: string[]; failed: string[] } {
  const domain = opts.domain ?? "arm64-automated";
  const failed: string[] = [];
  const deferred: string[] = [];
  for (const name of ARM64_AUTOMATED_GATES) {
    const hit = opts.records.find((record) => record.name === name);
    if (!hit || hit.exit !== 0 || hit.verdict === "FAIL" || hit.verdict === "STALE" || hit.verdict === "INCOMPLETE" || hit.verdict === "NOT_RUN") {
      failed.push(name);
    }
  }
  for (const name of ARM64_DEFERRED_GATES) {
    const hit = opts.records.find((record) => record.name === name);
    if (!hit || hit.exit === 2 || hit.verdict === "INCOMPLETE" || hit.verdict === "NOT_RUN") {
      deferred.push(name);
      continue;
    }
    if (hit.verdict === "FAIL" || (hit.exit !== 0 && hit.exit !== 2 && hit.exit !== 3 && hit.exit !== 4)) {
      failed.push(name);
    } else if (hit.verdict === "STALE" || hit.exit === 3) {
      failed.push(`${name}:stale-with-current-artifact`);
    }
  }
  if ((opts.summaryTotals?.fail ?? 0) > 0) failed.push("evidence-fail");
  if ((opts.summaryTotals?.stale ?? 0) > 0) failed.push("evidence-stale");
  if (opts.summaryVerdict === "FAIL") failed.push("summary-fail");
  return {
    domain,
    verdict: failed.length ? "FAIL" : "PASS",
    deferred,
    failed,
  };
}

export function evaluateReleaseAggregation(opts: {
  candidateKind?: string;
  records: GateRecord[];
  notaryEvidence?: NotaryEvidence;
  authenticodeEvidence?: "absent" | "claimed-pass" | "present";
  summaryVerdict?: string;
  requiredForPass?: string[];
  requireAllSubgates?: boolean;
}): ReleaseAggregation {
  const failReasons: string[] = [];
  const missingGates: string[] = [];
  const requireAll = opts.requireAllSubgates !== false;
  if (requireAll) {
    for (const gate of HARD_SUBGATES) {
      if (!opts.records.some((r) => r.name === gate.name)) {
        missingGates.push(gate.name);
      }
    }
  }

  for (const r of opts.records) {
    if (r.verdict === "WAIVED" || r.verdict === "SKIP") {
      failReasons.push(`${r.name} illegal ${r.verdict}`);
    } else if (r.verdict === "FAIL" || (r.exit !== 0 && r.exit !== 2 && r.exit !== 3 && r.exit !== 4)) {
      failReasons.push(`${r.name} exit ${r.exit}`);
    }
  }

  const kind = opts.candidateKind ?? CANDIDATE_KIND;
  if (kind !== CANDIDATE_KIND) {
    failReasons.push(`illegal candidateKind ${kind}`);
  }
  const notaryEvidence = opts.notaryEvidence ?? "absent";
  if (notaryEvidence === "fake" || notaryEvidence === "claimed-pass" || notaryEvidence === "claimed-waived") {
    failReasons.push("notarization claimed PASS/Waived without Accepted evidence");
  }
  if (notaryEvidence === "accepted") {
    failReasons.push("community-verified cannot record notarization Accepted");
  }
  if (opts.authenticodeEvidence === "claimed-pass" || opts.authenticodeEvidence === "present") {
    failReasons.push("community-verified cannot claim Authenticode");
  }

  const notaryStatus: ReleaseAggregation["notaryStatus"] =
    notaryEvidence === "accepted" ? "ACCEPTED" : notaryEvidence === "fake" ? "REJECTED" : "NOT_RUN";

  if (opts.summaryVerdict === "PASS") {
    const required = opts.requiredForPass ?? listedSubgateNames();
    for (const name of required) {
      const hit = opts.records.find((r) => r.name === name);
      if (!hit || hit.exit !== 0 || hit.verdict === "INCOMPLETE" || hit.verdict === "NOT_RUN") {
        failReasons.push(`illegal PASS: ${name} not proven`);
      }
    }
  }

  const listedKinds = listedSubgateKinds();
  const incomplete = opts.records.some((r) => r.verdict === "INCOMPLETE" || r.verdict === "NOT_RUN" || r.exit === 2);
  const blocked = opts.records.some((r) => r.verdict === "BLOCKED" || r.exit === 4);
  const stale = opts.records.some((r) => r.verdict === "STALE" || r.exit === 3);
  const failed = opts.records.some((r) => r.verdict === "FAIL" || (r.exit !== 0 && r.exit !== 2 && r.exit !== 3 && r.exit !== 4));

  let verdict: VerifierVerdict = "PASS";
  if (failReasons.length || failed) verdict = "FAIL";
  else if (stale) verdict = "STALE";
  else if (blocked) verdict = "BLOCKED";
  else if (incomplete || missingGates.length || (opts.summaryVerdict !== undefined && opts.summaryVerdict !== "PASS")) verdict = "INCOMPLETE";

  return {
    verdict,
    exitCode: EXIT_BY_VERDICT[verdict],
    failReasons,
    missingGates,
    listedKinds,
    notarizedAttribute: false,
    authenticodeAttribute: false,
    notaryStatus,
    notaryRecordedAs: "attribute",
  };
}

export function assertCommunityTrustHonest(kind: string, notarized: boolean, signed: boolean, authenticode = false): void {
  if (kind === CANDIDATE_KIND) {
    if (notarized === true) throw new PenglaiError("SECURITY_POLICY", "community-verified cannot claim notarized=true");
    if (signed === true) throw new PenglaiError("SECURITY_POLICY", "community-verified cannot claim Developer ID signed=true");
    if (authenticode === true) throw new PenglaiError("SECURITY_POLICY", "community-verified cannot claim authenticode=true");
  }
}

/**
 * The release verdict is the full aggregation over every hard subgate. The
 * arm64 automated domain is only an informational subset: a PASS there must
 * never mask INCOMPLETE/STALE/BLOCKED deferred gates into a release PASS. It
 * may only escalate the release to FAIL when the domain itself failed.
 */
export function releaseVerdictFrom(
  applicable: { verdict: VerifierVerdict },
  agg: { verdict: VerifierVerdict; exitCode: number },
): { verdict: VerifierVerdict; exitCode: number } {
  if (applicable.verdict === "FAIL") return { verdict: "FAIL", exitCode: EXIT_BY_VERDICT.FAIL };
  return { verdict: agg.verdict, exitCode: agg.exitCode };
}

export function resultClassOf(runner: string): "mock" | "contract" | "installed" | "live" | "unknown" {
  const n = runner.toLowerCase();
  if (n.includes("live")) return "live";
  if (n.includes("installed") || n.includes("e2e:installed")) return "installed";
  if (n.includes("contract")) return "contract";
  if (n.includes("mock") || n.includes("unit") || n.includes("fixture")) return "mock";
  return "unknown";
}

export function assertResultClassNotSubstituted(
  id: string,
  required: "mock" | "contract" | "installed" | "live",
  runner: string,
): void {
  const got = resultClassOf(runner);
  if (got !== required) {
    throw new PenglaiError("INVALID_INPUT", `${id} requires ${required} runner, got ${got} (${runner})`);
  }
}
