import { execFileSync } from "node:child_process";
import type { AssertionRecord } from "./assertion.js";
import { assertNativeHonest, assertNoFanOut } from "./assertion.js";
import { EXIT_BY_VERDICT, type VerifierVerdict } from "./exit.js";
import { RELEASE_TARGETS } from "./pins.js";
import type { AcceptanceEntry, AcceptanceResult, CompletenessTotals, ResultStatus } from "./registry.js";
import { isStaleCompletionMap, readyBlocked } from "./registry.js";

export const EVIDENCE_SCHEMA_V2 = 4 as const;

export const DESKTOP_TARGETS = RELEASE_TARGETS.map((t) => t.key);

export const PLATFORM_TOKEN_TO_TARGET: Record<string, string> = {
  "mac-arm": "darwin-aarch64",
  "mac-x64": "darwin-x86_64",
  "win-x64": "win32-x86_64",
  live: "live",
  aggregate: "aggregate",
};

export const PLATFORM_SCOPED_RUNNER_CLASSES = new Set([
  "artifact",
  "build",
  "closure",
  "installed",
  "signing",
  "soak",
  "live",
  "visual",
  "parity",
]);

export const UNIT_OR_CONTRACT_CLASSES = new Set(["unit", "contract"]);

// Upgrade and uninstall are destructive lifecycle gates with their own native
// verifier. The two-hour soak owns only sustained IM/offline/sleep recovery.
export const SOAK_REQUIRED_SAMPLES = ["im", "offline", "sleep"] as const;

export type CollectionClass = "unit-suite" | "contract-suite" | "installed-runner" | "soak-runner" | "live-runner" | "export-runner" | "artifact-runner";

export interface EvidenceSlot {
  acceptanceId: string;
  runnerFamily: string;
  target: string;
}

export interface EvidenceV2Record extends AssertionRecord {
  runnerClass: string;
  target: string;
  collectionClass?: CollectionClass;
  command?: string[];
  sourceTree?: string;
  publicExportTreeSha256?: string;
}

export interface SlotEvaluation {
  slot: EvidenceSlot;
  status: ResultStatus;
  reason: string;
  assertionId?: string;
}

export interface IdEvaluation {
  id: string;
  status: ResultStatus;
  slots: SlotEvaluation[];
  missingTargets: string[];
}

export type EvidenceSchemaVersion = typeof EVIDENCE_SCHEMA_V2 | 5;

export interface EvidenceV2Manifest {
  schemaVersion: EvidenceSchemaVersion;
  engine?: "v2" | "v3";
  candidateSha: string;
  totals: CompletenessTotals;
  results: AcceptanceResult[];
  ids: IdEvaluation[];
  verdict: "PASS" | "INCOMPLETE" | "FAIL" | "STALE";
}

export function gitSourceSha(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

export function evidenceKey(rec: Pick<EvidenceV2Record, "acceptanceId" | "runnerClass" | "target" | "assertionId">): string {
  return `${rec.acceptanceId}+${rec.runnerClass}+${rec.target}+${rec.assertionId}`;
}

export function isPlatformScopedRunner(runnerClass: string): boolean {
  return PLATFORM_SCOPED_RUNNER_CLASSES.has(runnerClass);
}

export function expandPlatforms(platforms: readonly string[], runnerClasses: readonly string[]): string[] {
  const tokens = platforms.length ? [...platforms] : ["all"];
  if (tokens.includes("all")) {
    if (runnerClasses.some(isPlatformScopedRunner)) return [...DESKTOP_TARGETS];
    return ["source"];
  }
  const out: string[] = [];
  for (const token of tokens) {
    const mapped = PLATFORM_TOKEN_TO_TARGET[token] ?? token;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function requiredSlots(entry: AcceptanceEntry): EvidenceSlot[] {
  const classes = entry.runnerClasses.length ? entry.runnerClasses : ["unit"];
  const platformClasses = classes.filter(isPlatformScopedRunner);
  const sourceClasses = classes.filter((c) => !isPlatformScopedRunner(c));
  const slots: EvidenceSlot[] = [];
  if (sourceClasses.length) {
    slots.push({
      acceptanceId: entry.id,
      runnerFamily: sourceClasses[0]!,
      target: entry.platforms.includes("aggregate") && !sourceClasses.some(isPlatformScopedRunner) && !entry.platforms.includes("all")
        ? "aggregate"
        : entry.platforms.includes("live") && platformClasses.length === 0
          ? "live"
          : "source",
    });
  }
  if (platformClasses.length) {
    const targets = expandPlatforms(entry.platforms, classes);
    for (const target of targets) {
      if (target === "source") continue;
      slots.push({
        acceptanceId: entry.id,
        runnerFamily: platformClasses[0]!,
        target,
      });
    }
  }
  if (slots.length === 0) {
    slots.push({ acceptanceId: entry.id, runnerFamily: classes[0]!, target: "source" });
  }
  return slots;
}

export function normalizeRunnerClass(raw: string | undefined, collectionClass?: CollectionClass): string {
  if (collectionClass === "unit-suite") return "unit";
  if (collectionClass === "contract-suite") return "contract";
  const n = (raw ?? "").trim();
  if (!n) return "unit";
  return n.split("+")[0]!.trim();
}

export function recordFillsSlot(rec: EvidenceV2Record, slot: EvidenceSlot): boolean {
  if (rec.acceptanceId !== slot.acceptanceId) return false;
  if (rec.target !== slot.target) return false;
  const cls = normalizeRunnerClass(rec.runnerClass, rec.collectionClass);
  if (slot.runnerFamily === "installed" || slot.runnerFamily === "soak" || slot.runnerFamily === "live") {
    if (UNIT_OR_CONTRACT_CLASSES.has(cls)) return false;
    if (rec.collectionClass === "unit-suite" || rec.collectionClass === "contract-suite") return false;
    if (cls !== slot.runnerFamily && rec.collectionClass !== `${slot.runnerFamily}-runner`) return false;
    return cls === slot.runnerFamily || rec.collectionClass === `${slot.runnerFamily}-runner`;
  }
  if (UNIT_OR_CONTRACT_CLASSES.has(cls) || rec.collectionClass === "unit-suite" || rec.collectionClass === "contract-suite") {
    return slot.target === "source" || slot.target === "aggregate";
  }
  return cls === slot.runnerFamily || rec.runnerId === slot.runnerFamily;
}

export function assertPassRecordComplete(rec: EvidenceV2Record): string | undefined {
  if (!rec.acceptanceId) return "missing acceptanceId";
  if (!rec.assertionId) return "missing assertionId";
  if (!rec.runnerClass && !rec.runnerId) return "missing runnerClass";
  if (!rec.target) return "missing target";
  if (!rec.candidateSourceSha) return "missing candidateSourceSha";
  if (!rec.startedAt || !rec.endedAt) return "missing time";
  if (!rec.resultDigest) return "missing digest";
  const cls = normalizeRunnerClass(rec.runnerClass, rec.collectionClass);
  if (cls === "installed" || cls === "soak" || cls === "live") {
    if (!rec.artifactSha256) return "missing artifactSha256";
    if (rec.runnerNative === undefined) return "missing native/translated/emulated";
    if (!rec.rawEvidencePointer) return "missing raw pointer";
  }
  return undefined;
}

export function tagCollection(records: readonly AssertionRecord[], collectionClass: CollectionClass): EvidenceV2Record[] {
  return records.map((rec) => ({
    ...rec,
    runnerClass: normalizeRunnerClass(rec.runnerId, collectionClass),
    target: rec.target || (collectionClass === "unit-suite" || collectionClass === "contract-suite" ? "source" : rec.target || ""),
    collectionClass,
  }));
}

export function legacyEvidenceGeneration(opts: {
  claimedHardCount?: number;
  claimedIds?: readonly string[];
}): "STALE" | "CURRENT" {
  if (opts.claimedHardCount !== undefined && isStaleCompletionMap(opts.claimedHardCount)) return "STALE";
  if (
    opts.claimedIds &&
    isStaleCompletionMap(opts.claimedIds.length) &&
    !opts.claimedIds.some((id) => id.startsWith("R50-VOICE-") || id.startsWith("R50-CTXMEM-"))
  ) {
    return "STALE";
  }
  return "CURRENT";
}

export function evaluateEvidenceV2(opts: {
  registry: readonly AcceptanceEntry[];
  records: readonly EvidenceV2Record[];
  candidateSha: string;
  currentArtifactByTarget?: Record<string, string>;
  publicExport?: { treeSha256?: string; sourceSha?: string; treeDirty?: boolean };
}): EvidenceV2Manifest {
  if (isStaleCompletionMap(opts.registry.length) || legacyEvidenceGeneration({ claimedHardCount: opts.registry.length }) === "STALE") {
    const totals: CompletenessTotals = {
      hard: opts.registry.length,
      pass: 0,
      fail: 0,
      notRun: 0,
      waived: 0,
      missing: 0,
      duplicate: 0,
      unknown: 0,
      stale: opts.registry.length,
    };
    return {
      schemaVersion: EVIDENCE_SCHEMA_V2,
      candidateSha: opts.candidateSha,
      totals,
      results: opts.registry.map((entry) => ({
        id: entry.id,
        status: "STALE",
        candidateSha: opts.candidateSha,
        runId: "verify-evidence-v2",
        timestamp: new Date().toISOString(),
        details: { safe: "legacy-202-registry" },
      })),
      ids: opts.registry.map((entry) => ({
        id: entry.id,
        status: "STALE",
        slots: [],
        missingTargets: [],
      })),
      verdict: "STALE",
    };
  }
  assertNoFanOut(opts.records);
  for (const rec of opts.records) assertNativeHonest(rec);

  const ids: IdEvaluation[] = [];
  const results: AcceptanceResult[] = [];
  const totals: CompletenessTotals = {
    hard: opts.registry.length,
    pass: 0,
    fail: 0,
    notRun: 0,
    waived: 0,
    missing: 0,
    duplicate: 0,
    unknown: 0,
    stale: 0,
  };

  for (const entry of opts.registry) {
    const slots = requiredSlots(entry);
    const slotEvals: SlotEvaluation[] = [];
    let stale = false;
    let fail = false;
    for (const slot of slots) {
      const hits = opts.records.filter((rec) => recordFillsSlot(rec, slot));
      if (hits.length === 0) {
        slotEvals.push({ slot, status: "NOT_RUN", reason: `missing ${slot.runnerFamily}/${slot.target}` });
        continue;
      }
      const usable = hits.filter((rec) => rec.candidateSourceSha === opts.candidateSha);
      const staleHits = hits.filter((rec) => rec.candidateSourceSha !== opts.candidateSha);
      const rec = usable[0];
      if (!rec) {
        const fromRunner = staleHits.some(
          (hit) => hit.collectionClass === "installed-runner" || hit.collectionClass === "soak-runner" || hit.collectionClass === "live-runner" || hit.collectionClass === "export-runner",
        );
        const currentArtifact = opts.currentArtifactByTarget?.[slot.target];
        if (fromRunner && currentArtifact) {
          const staleId = staleHits[0]?.assertionId;
          slotEvals.push({
            slot,
            status: "STALE",
            reason: `source ${staleHits[0]?.candidateSourceSha} != candidate ${opts.candidateSha}`,
            ...(staleId ? { assertionId: staleId } : {}),
          });
          stale = true;
        } else {
          slotEvals.push({
            slot,
            status: "NOT_RUN",
            reason: fromRunner
              ? `leftover ${slot.runnerFamily} evidence is not bound to a current ${slot.target} artifact`
              : `no current-candidate record for ${slot.runnerFamily}/${slot.target}`,
          });
        }
        continue;
      }
      // A runner that reports FAIL for this slot must surface as FAIL, not be
      // silently dropped to NOT_RUN (which would hide the failure).
      if (rec.status === "FAIL") {
        slotEvals.push({ slot, status: "FAIL", reason: "runner reported FAIL", assertionId: rec.assertionId });
        fail = true;
        continue;
      }
      if (rec.status !== "PASS") {
        slotEvals.push({ slot, status: "NOT_RUN", reason: `runner reported ${rec.status}`, assertionId: rec.assertionId });
        continue;
      }
      const incomplete = assertPassRecordComplete(rec);
      if (incomplete) {
        slotEvals.push({ slot, status: "FAIL", reason: incomplete, assertionId: rec.assertionId });
        fail = true;
        continue;
      }
      if (rec.artifactSha256 && opts.currentArtifactByTarget?.[slot.target] && rec.artifactSha256 !== opts.currentArtifactByTarget[slot.target]) {
        slotEvals.push({ slot, status: "STALE", reason: `artifact ${rec.artifactSha256} != current ${opts.currentArtifactByTarget[slot.target]}`, assertionId: rec.assertionId });
        stale = true;
        continue;
      }
      slotEvals.push({ slot, status: "PASS", reason: "attributed", assertionId: rec.assertionId });
    }
    const missingTargets = slotEvals.filter((s) => s.status === "NOT_RUN").map((s) => s.slot.target);
    let status: ResultStatus = "PASS";
    if (fail) status = "FAIL";
    else if (stale) status = "STALE";
    else if (missingTargets.length) status = "NOT_RUN";
    ids.push({ id: entry.id, status, slots: slotEvals, missingTargets });
    const firstPass = slotEvals.find((s) => s.status === "PASS");
    results.push({
      id: entry.id,
      status,
      candidateSha: opts.candidateSha,
      runId: "verify-evidence-v2",
      timestamp: new Date().toISOString(),
      ...(firstPass?.assertionId ? { assertionId: firstPass.assertionId } : {}),
      details: { safe: slotEvals.map((s) => `${s.slot.target}:${s.status}`).join(",") },
    });
    if (status === "PASS") totals.pass += 1;
    else if (status === "FAIL") totals.fail += 1;
    else if (status === "STALE") totals.stale += 1;
    else totals.notRun += 1;
  }

  let verdict: EvidenceV2Manifest["verdict"] = "PASS";
  if (totals.fail > 0) verdict = "FAIL";
  else if (totals.stale > 0) verdict = "STALE";
  else if (readyBlocked(totals)) verdict = "INCOMPLETE";

  return {
    schemaVersion: EVIDENCE_SCHEMA_V2,
    candidateSha: opts.candidateSha,
    totals,
    results,
    ids,
    verdict,
  };
}

export function soakSampleSetAccepted(samples: readonly string[] | undefined): boolean {
  if (!samples?.length) return false;
  const lower = new Set(samples.map((s) => s.toLowerCase()));
  return SOAK_REQUIRED_SAMPLES.every((need) => lower.has(need));
}

export function bindArtifactFreshness(opts: {
  candidateSha: string;
  evidenceSourceSha?: string;
  evidenceArtifactSha256?: string;
  currentArtifactSha256?: string;
  exportSourceSha?: string;
  exportDirty?: boolean;
  soakArtifactSha256?: string;
  soakSamples?: readonly string[];
}): { ok: boolean; verdict: VerifierVerdict; reason: string } {
  if (opts.evidenceSourceSha && opts.evidenceSourceSha !== opts.candidateSha) {
    return { ok: false, verdict: "STALE", reason: `evidence source ${opts.evidenceSourceSha} != candidate ${opts.candidateSha}` };
  }
  if (opts.exportSourceSha && opts.exportSourceSha !== opts.candidateSha) {
    return { ok: false, verdict: "STALE", reason: `public-export source ${opts.exportSourceSha} != candidate ${opts.candidateSha}` };
  }
  if (opts.exportDirty === true) {
    return { ok: false, verdict: "STALE", reason: "public-export treeDirty=true" };
  }
  if (opts.currentArtifactSha256 && opts.evidenceArtifactSha256 && opts.evidenceArtifactSha256 !== opts.currentArtifactSha256) {
    return { ok: false, verdict: "STALE", reason: "installed artifact is not the artifact under test" };
  }
  if (opts.currentArtifactSha256 && opts.soakArtifactSha256 && opts.soakArtifactSha256 !== opts.currentArtifactSha256) {
    return { ok: false, verdict: "STALE", reason: "soak artifact is not the artifact under test" };
  }
  if (opts.soakArtifactSha256 && !soakSampleSetAccepted(opts.soakSamples)) {
    return { ok: false, verdict: "FAIL", reason: "soak sample set missing IM/offline/sleep/update/uninstall" };
  }
  return { ok: true, verdict: "PASS", reason: "fresh" };
}

export function resolveSubgateVerdict(opts: {
  processExit: number;
  processVerdict?: string;
  json?: { verdict?: string } | null;
}): { verdict: VerifierVerdict; exit: number } {
  const jsonVerdict = opts.json?.verdict;
  const ranked = (v: string | undefined): VerifierVerdict | undefined => {
    if (!v) return undefined;
    if (v === "FAIL" || v === "INCOMPLETE" || v === "STALE" || v === "BLOCKED" || v === "PASS") return v;
    return undefined;
  };
  const fromJson = ranked(jsonVerdict);
  const fromProcess = ranked(opts.processVerdict) ?? (opts.processExit === 0 ? "PASS" : opts.processExit === 2 ? "INCOMPLETE" : opts.processExit === 3 ? "STALE" : opts.processExit === 4 ? "BLOCKED" : "FAIL");
  const order: VerifierVerdict[] = ["FAIL", "STALE", "BLOCKED", "INCOMPLETE", "PASS"];
  const worst = [fromJson, fromProcess].filter((v): v is VerifierVerdict => Boolean(v)).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "FAIL";
  return { verdict: worst, exit: EXIT_BY_VERDICT[worst] };
}

export const SUBGATE_JSON_FILES: Record<string, string> = {
  "verify:evidence": "evidence/generated/evidence-summary.json",
  "verify:closure": "evidence/generated/verify-closure.json",
  "verify:installed": "evidence/generated/verify-installed.json",
  "verify:live": "evidence/generated/verify-live.json",
  "verify:soak": "evidence/generated/verify-soak.json",
  "verify:public-export": "evidence/generated/verify-public-export.json",
  "verify:profile": "evidence/generated/verify-profile.json",
  "verify:identity": "evidence/generated/identity.json",
  "verify:release": "evidence/generated/verify-release.json",
};
