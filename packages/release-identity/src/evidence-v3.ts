import { PenglaiError } from "@penglai/contracts";
import { EXIT_BY_VERDICT, type VerifierVerdict } from "./exit.js";
import { RELEASE_TARGETS } from "./pins.js";
import { evaluateEvidenceV2, type EvidenceV2Manifest, type EvidenceV2Record } from "./evidence-v2.js";
import type { AcceptanceEntry } from "./registry.js";

export const EVIDENCE_SCHEMA_V3 = 5 as const;

export const DESKTOP_TARGET_KEYS = RELEASE_TARGETS.map((t) => t.key);

export interface ProcessStartIdentity {
  pid: number;
  startedAt: string;
  command: string;
}

export interface LiveSampleRecord {
  at: string;
  generationId?: string;
  heartbeatAgeMs: number;
  process: ProcessStartIdentity;
  expectedProcess: ProcessStartIdentity;
  http: { status: number; official: boolean };
  websocket: { opened: boolean };
  inventoryOk?: boolean;
  rssBytes?: number;
  handleCount?: number;
  sourceSha: string;
  artifactSha256: string;
  target: string;
  runnerNative?: boolean;
  translated?: boolean;
  emulated?: boolean;
  resultDigest?: string;
}

export interface ImportableEvidence {
  acceptanceId?: string | undefined;
  assertionId?: string | undefined;
  candidateSourceSha?: string | undefined;
  publicExportTreeSha256?: string | undefined;
  artifactSha256?: string | undefined;
  target?: string | undefined;
  runnerNative?: boolean | undefined;
  translated?: boolean | undefined;
  emulated?: boolean | undefined;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  resultDigest?: string | undefined;
  sample?: LiveSampleRecord;
}

export function isFutureTimestamp(iso: string | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return true;
  return ts > now + 5_000;
}

export function assertImportableEvidence(
  rec: ImportableEvidence,
  expected: {
    sourceSha: string;
    exportTreeSha256?: string | undefined;
    artifactSha256?: string | undefined;
    target?: string | undefined;
    now?: number | undefined;
    seenKeys?: Set<string> | undefined;
    heartbeatMaxAgeMs?: number | undefined;
  },
): void {
  if (!rec.assertionId) throw new PenglaiError("INVALID_INPUT", "missing assertionId");
  if (!rec.resultDigest) throw new PenglaiError("INVALID_INPUT", "missing raw digest");
  if (!rec.candidateSourceSha || rec.candidateSourceSha !== expected.sourceSha) {
    throw new PenglaiError("INVALID_INPUT", `wrong-source ${rec.candidateSourceSha}`);
  }
  if (expected.exportTreeSha256 && rec.publicExportTreeSha256 && rec.publicExportTreeSha256 !== expected.exportTreeSha256) {
    throw new PenglaiError("INVALID_INPUT", `wrong-export ${rec.publicExportTreeSha256}`);
  }
  if (expected.artifactSha256 && rec.artifactSha256 && rec.artifactSha256 !== expected.artifactSha256) {
    throw new PenglaiError("INVALID_INPUT", `wrong-artifact ${rec.artifactSha256}`);
  }
  if (expected.target && rec.target && rec.target !== expected.target) {
    throw new PenglaiError("INVALID_INPUT", `wrong-target ${rec.target}`);
  }
  if (rec.target && !["source", "aggregate", "live", ...DESKTOP_TARGET_KEYS].includes(rec.target)) {
    throw new PenglaiError("INVALID_INPUT", `unknown-target ${rec.target}`);
  }
  if (rec.runnerNative === true && (rec.translated === true || rec.emulated === true)) {
    throw new PenglaiError("SECURITY_POLICY", "translated/emulated result claimed native");
  }
  const now = expected.now ?? Date.now();
  if (isFutureTimestamp(rec.startedAt, now) || isFutureTimestamp(rec.endedAt, now) || isFutureTimestamp(rec.sample?.at, now)) {
    throw new PenglaiError("INVALID_INPUT", "future timestamp");
  }
  const key = `${rec.acceptanceId ?? ""}+${rec.assertionId}+${rec.target ?? ""}`;
  if (expected.seenKeys?.has(key)) throw new PenglaiError("INVALID_INPUT", `duplicate ${key}`);
  expected.seenKeys?.add(key);
  if (rec.sample) {
    const maxAge = expected.heartbeatMaxAgeMs ?? 20_000;
    if (rec.sample.heartbeatAgeMs > maxAge) throw new PenglaiError("INVALID_INPUT", "stale-heartbeat");
    if (rec.sample.http.official !== true || rec.sample.http.status !== 200) {
      throw new PenglaiError("INVALID_INPUT", "http-down");
    }
    if (rec.sample.websocket.opened !== true) throw new PenglaiError("INVALID_INPUT", "ws-down");
    if (
      rec.sample.process.pid !== rec.sample.expectedProcess.pid ||
      rec.sample.process.startedAt !== rec.sample.expectedProcess.startedAt ||
      rec.sample.process.command !== rec.sample.expectedProcess.command
    ) {
      throw new PenglaiError("INVALID_INPUT", "pid-reuse");
    }
    if (rec.sample.sourceSha !== expected.sourceSha) throw new PenglaiError("INVALID_INPUT", "wrong-source");
    if (expected.artifactSha256 && rec.sample.artifactSha256 !== expected.artifactSha256) {
      throw new PenglaiError("INVALID_INPUT", "wrong-artifact");
    }
    if (expected.target && rec.sample.target !== expected.target) throw new PenglaiError("INVALID_INPUT", "wrong-target");
  }
}

export function evaluateEvidenceV3(opts: {
  registry: readonly AcceptanceEntry[];
  records: readonly EvidenceV2Record[];
  candidateSha: string;
  currentArtifactByTarget?: Record<string, string>;
  publicExport?: { treeSha256?: string; sourceSha?: string; treeDirty?: boolean };
}): EvidenceV2Manifest & { schemaVersion: typeof EVIDENCE_SCHEMA_V3; engine: "v3" } {
  const seen = new Set<string>();
  const platform = new Set(["installed-runner", "soak-runner", "live-runner", "export-runner"]);
  for (const rec of opts.records) {
    if (rec.status !== "PASS") continue;
    if (!platform.has(String(rec.collectionClass ?? "")) && rec.runnerClass !== "installed" && rec.runnerClass !== "soak" && rec.runnerClass !== "live") {
      continue;
    }
    assertImportableEvidence(
      {
        acceptanceId: rec.acceptanceId,
        assertionId: rec.assertionId,
        candidateSourceSha: rec.candidateSourceSha,
        publicExportTreeSha256: rec.publicExportTreeSha256,
        artifactSha256: rec.artifactSha256,
        target: rec.target,
        runnerNative: rec.runnerNative,
        translated: rec.translated,
        emulated: rec.emulated,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        resultDigest: rec.resultDigest,
      },
      {
        sourceSha: opts.candidateSha,
        exportTreeSha256: opts.publicExport?.treeSha256,
        seenKeys: seen,
      },
    );
  }
  const inner = evaluateEvidenceV2(opts);
  return { ...inner, schemaVersion: EVIDENCE_SCHEMA_V3, engine: "v3" };
}

export function subgateInjectExit(verdict: VerifierVerdict): number {
  return EXIT_BY_VERDICT[verdict] ?? 1;
}
