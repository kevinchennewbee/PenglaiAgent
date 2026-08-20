import { PenglaiError } from "@penglai/contracts";
import { HARD_ID_RE, LEGACY_HARD_COUNT_STALE, REQUIRED_HARD_FAMILIES } from "./pins.js";
import type { AssertionRecord } from "./assertion.js";
import { assertNativeHonest, assertNoFanOut } from "./assertion.js";

export function parseAcceptanceIds(markdown: string): string[] {
  return parseAcceptanceRegistry(markdown).map((e) => e.id);
}

export interface AcceptanceEntry {
  id: string;
  requirement: string;
  runner: string;
  runnerClasses: string[];
  platforms: string[];
}

export function parseAcceptanceRegistry(markdown: string): AcceptanceEntry[] {
  const entries: AcceptanceEntry[] = [];
  const seen = new Set<string>();
  const row = /^\| `(R50-[A-Z0-9]+-\d+)` \| ?([^|\n]+?) \| ?([^|\n]+?) \| ?$/gm;
  let m: RegExpExecArray | null;
  while ((m = row.exec(markdown))) {
    const id = m[1];
    const requirement = (m[2] ?? "").trim();
    const runner = (m[3] ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) throw new PenglaiError("INVALID_INPUT", `duplicate acceptance id ${id}`);
    seen.add(id);
    const [classPart, platformPart] = splitRunner(runner);
    entries.push({
      id,
      requirement,
      runner,
      runnerClasses: classPart.split("+").map((s) => s.trim()).filter(Boolean),
      platforms: platformPart.split("+").map((s) => s.trim()).filter(Boolean),
    });
  }
  if (entries.length === 0) throw new PenglaiError("INVALID_INPUT", "no acceptance ids parsed");
  HARD_ID_RE.lastIndex = 0;
  const leftover = markdown.match(new RegExp(HARD_ID_RE.source, "g")) ?? [];
  if (leftover.length !== entries.length) {
    throw new PenglaiError("INVALID_INPUT", `acceptance id parse mismatch ${entries.length} vs ${leftover.length}`);
  }
  return entries;
}

function splitRunner(runner: string): [string, string] {
  const idx = runner.lastIndexOf("/");
  if (idx < 0) return [runner, "all"];
  return [runner.slice(0, idx), runner.slice(idx + 1) || "all"];
}

export function documentDeclaredHardCount(markdown: string): number {
  const m = String(markdown).match(/预期共 \*\*(\d+)\*\* 个唯一/);
  if (!m) throw new PenglaiError("INVALID_INPUT", "acceptance document does not declare a unique R50 Hard count");
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) {
    throw new PenglaiError("INVALID_INPUT", `illegal declared hard count ${m[1]}`);
  }
  if (n === LEGACY_HARD_COUNT_STALE) {
    throw new PenglaiError("INVALID_INPUT", `declared hard count ${n} is the stale 202-ID generation`);
  }
  return n;
}

export function familyId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function requiredFamilyIds(): string[] {
  const ids: string[] = [];
  for (const fam of REQUIRED_HARD_FAMILIES) {
    for (let n = fam.start; n <= fam.end; n += 1) ids.push(familyId(fam.prefix, n));
  }
  return ids;
}

export function assertRequiredFamilies(ids: readonly string[]): void {
  const set = new Set(ids);
  const missing = requiredFamilyIds().filter((id) => !set.has(id));
  if (missing.length) {
    throw new PenglaiError("INVALID_INPUT", `registry missing required families ${missing.join(",")}`);
  }
}

export function isStaleCompletionMap(count: number): boolean {
  return count === LEGACY_HARD_COUNT_STALE;
}

export function assertExpectedCount(ids: string[], expected: number): void {
  if (isStaleCompletionMap(expected)) {
    throw new PenglaiError("INVALID_INPUT", `hardcoded ${expected} completion map is STALE`);
  }
  if (ids.length !== expected) {
    throw new PenglaiError("INVALID_INPUT", `acceptance id count ${ids.length} != ${expected}`);
  }
}

export function assertRegistryConsistent(markdown: string): AcceptanceEntry[] {
  const entries = parseAcceptanceRegistry(markdown);
  const ids = entries.map((e) => e.id);
  const declared = documentDeclaredHardCount(markdown);
  assertExpectedCount(ids, declared);
  assertR50Only(ids);
  assertRequiredFamilies(ids);
  return entries;
}

export function assertR50Only(ids: readonly string[]): void {
  for (const id of ids) {
    if (!/^R50-[A-Z0-9]+-\d+$/.test(id)) {
      throw new PenglaiError("INVALID_INPUT", `illegal acceptance id ${id}`);
    }
    if (id.startsWith("R2I-")) {
      throw new PenglaiError("INVALID_INPUT", `stale R2I registry id ${id}`);
    }
  }
}

export type ResultStatus =
  | "PASS"
  | "FAIL"
  | "NOT_RUN"
  | "INCOMPLETE"
  | "WAIVED"
  | "SKIP"
  | "BLOCKED"
  | "UNKNOWN"
  | "STALE"
  | "MISSING";

export interface AcceptanceResult {
  id: string;
  status: ResultStatus;
  candidateSha: string;
  sourceSha?: string;
  artifactSha?: string;
  artifactSha256?: string;
  runner?: string;
  runId: string;
  command?: string[];
  exitCode?: number;
  evidencePointer?: string;
  evidence?: string[];
  timestamp: string;
  startedAt?: string;
  finishedAt?: string;
  assertionId?: string;
  testId?: string;
  runnerId?: string;
  runnerNative?: boolean;
  translated?: boolean;
  emulated?: boolean;
  resultDigest?: string;
  details?: { safe?: string };
  hardcoded?: boolean;
}

export interface CompletenessTotals {
  hard: number;
  pass: number;
  fail: number;
  notRun: number;
  waived: number;
  missing: number;
  duplicate: number;
  unknown: number;
  stale: number;
}

export function resultsFromAssertions(
  registry: readonly string[],
  records: readonly AssertionRecord[],
  candidateSha: string,
): AcceptanceResult[] {
  assertNoFanOut(records);
  for (const rec of records) assertNativeHonest(rec);
  const byId = new Map<string, AssertionRecord[]>();
  for (const rec of records) {
    const list = byId.get(rec.acceptanceId) ?? [];
    list.push(rec);
    byId.set(rec.acceptanceId, list);
  }
  const out: AcceptanceResult[] = [];
  for (const id of registry) {
    const hits = byId.get(id) ?? [];
    if (hits.length === 0) {
      out.push({
        id,
        status: "NOT_RUN",
        candidateSha,
        runId: "verify-evidence",
        timestamp: new Date().toISOString(),
      });
      continue;
    }
    if (hits.length > 1) {
      out.push({
        id,
        status: "FAIL",
        candidateSha,
        runId: "verify-evidence",
        timestamp: new Date().toISOString(),
        details: { safe: `duplicate assertions ${hits.length}` },
      });
      continue;
    }
    const rec = hits[0]!;
    const row: AcceptanceResult = {
      id,
      status: rec.status,
      candidateSha: rec.candidateSourceSha,
      sourceSha: rec.candidateSourceSha,
      runner: rec.runnerId,
      runId: rec.runnerId,
      runnerId: rec.runnerId,
      testId: rec.testId,
      assertionId: rec.assertionId,
      resultDigest: rec.resultDigest,
      exitCode: rec.exitCode,
      timestamp: rec.endedAt,
      startedAt: rec.startedAt,
      finishedAt: rec.endedAt,
    };
    if (rec.artifactSha256) row.artifactSha256 = rec.artifactSha256;
    if (rec.rawEvidencePointer) row.evidencePointer = rec.rawEvidencePointer;
    if (rec.runnerNative !== undefined) row.runnerNative = rec.runnerNative;
    if (rec.translated !== undefined) row.translated = rec.translated;
    if (rec.emulated !== undefined) row.emulated = rec.emulated;
    out.push(row);
  }
  return out;
}

export function tally(registry: string[], results: AcceptanceResult[], candidateSha: string): CompletenessTotals {
  const byId = new Map<string, AcceptanceResult[]>();
  for (const r of results) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  const totals: CompletenessTotals = {
    hard: registry.length,
    pass: 0,
    fail: 0,
    notRun: 0,
    waived: 0,
    missing: 0,
    duplicate: 0,
    unknown: 0,
    stale: 0,
  };
  for (const id of registry) {
    const hits = byId.get(id) ?? [];
    if (hits.length === 0) totals.missing += 1;
    else if (hits.length > 1) totals.duplicate += 1;
    else {
      const r = hits[0];
      if (!r) {
        totals.missing += 1;
        continue;
      }
      if (r.hardcoded) totals.fail += 1;
      else if (r.candidateSha !== candidateSha) totals.stale += 1;
      else if (r.status === "PASS") totals.pass += 1;
      else if (r.status === "FAIL") totals.fail += 1;
      else if (r.status === "NOT_RUN" || r.status === "INCOMPLETE" || r.status === "MISSING") totals.notRun += 1;
      else if (r.status === "WAIVED" || r.status === "SKIP" || r.status === "BLOCKED") totals.waived += 1;
      else if (r.status === "STALE") totals.stale += 1;
      else totals.unknown += 1;
    }
  }
  for (const [id, hits] of byId) {
    if (!registry.includes(id)) totals.unknown += hits.length;
  }
  return totals;
}

export function assertCompleteness(totals: CompletenessTotals, opts: { allowIncomplete: boolean }): void {
  if (totals.missing !== 0) throw new PenglaiError("INVALID_INPUT", `missing ${totals.missing}`);
  if (totals.duplicate !== 0) throw new PenglaiError("INVALID_INPUT", `duplicate ${totals.duplicate}`);
  if (totals.unknown !== 0) throw new PenglaiError("INVALID_INPUT", `unknown ${totals.unknown}`);
  if (totals.stale !== 0) throw new PenglaiError("INVALID_INPUT", `stale ${totals.stale}`);
  if (totals.waived !== 0) throw new PenglaiError("SECURITY_POLICY", `waived ${totals.waived}`);
  if (!opts.allowIncomplete && (totals.fail !== 0 || totals.notRun !== 0)) {
    throw new PenglaiError("INVALID_INPUT", "incomplete hard results");
  }
}

export function readyBlocked(totals: CompletenessTotals): boolean {
  return (
    totals.fail !== 0 ||
    totals.notRun !== 0 ||
    totals.waived !== 0 ||
    totals.missing !== 0 ||
    totals.duplicate !== 0 ||
    totals.unknown !== 0 ||
    totals.stale !== 0 ||
    totals.pass !== totals.hard
  );
}
