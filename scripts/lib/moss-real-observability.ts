import { createHash } from "node:crypto";

export const MOSS_REAL_AUDIBLE_RMS_ENERGY_MIN = 100;
export const MOSS_REAL_SIMILARITY_MIN = 0.5;
export const MOSS_REAL_REQUIRED_LANGUAGE = "zh";
export const MOSS_REAL_AUDIBLE_FAIL_REASON = "MOSS output has no audible waveform";
export const MOSS_REAL_SEMANTIC_FAIL_REASON = "MOSS to SenseVoice semantic round-trip failed";

export type MossRealPredicateName =
  | "audibleRmsEnergy"
  | "nonemptySpeech"
  | "noSpeech"
  | "language"
  | "similarity";

export interface MossRealPredicateOutcome {
  name: MossRealPredicateName;
  evaluated: boolean;
  pass: boolean | null;
  required: number | string | boolean;
  actual: number | string | boolean | null;
}

export interface MossRealFailEvidence {
  schema: 1;
  assertion: "R50-VOICE-MOSS-REAL";
  status: "FAIL";
  target?: string;
  runtime?: Record<string, unknown>;
  model?: Record<string, unknown>;
  fixture: {
    id: string;
    inputTextSha256: string;
    voiceId: string;
  };
  synthesis?: {
    outputSha256?: string;
    outputBytes?: number;
    durationMs?: number;
    codec?: string;
    firstChunkLatencyMs?: number;
    elapsedMs?: number;
    realtimeFactor?: number;
    rmsEnergy?: number;
  };
  roundtrip?: {
    engine?: string;
    engineVersion?: string;
    modelRevision?: string;
    transcriptSha256?: string;
    language?: string | null;
    noSpeech?: boolean;
    transcriptNonEmpty?: boolean;
    similarity?: number;
    elapsedMs?: number;
    realtimeFactor?: number;
  };
  predicates: Record<string, Omit<MossRealPredicateOutcome, "name">>;
  failedPredicates: MossRealPredicateName[];
  privacy: {
    audioPersisted: false;
    transcriptPersisted: false;
    absolutePathsPersisted: false;
  };
  generatedAt: string;
}

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "text",
  "transcript",
  "wav",
  "pcm",
  "audio",
  "inputText",
  "finalText",
  "pcmSamples",
]);

export function mossRealSha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function mossRealNormalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

export function mossRealSimilarity(left: string, right: string): number {
  const a = [...mossRealNormalized(left)];
  const b = [...mossRealNormalized(right)];
  if (!a.length || !b.length) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  const distance = previous[b.length] ?? Math.max(a.length, b.length);
  return Number((1 - distance / Math.max(a.length, b.length)).toFixed(4));
}

export function evaluateMossRealAudiblePredicate(energy: number): MossRealPredicateOutcome {
  const finite = Number.isFinite(energy);
  return {
    name: "audibleRmsEnergy",
    evaluated: true,
    pass: finite && energy >= MOSS_REAL_AUDIBLE_RMS_ENERGY_MIN,
    required: MOSS_REAL_AUDIBLE_RMS_ENERGY_MIN,
    actual: finite ? Number(energy.toFixed(2)) : null,
  };
}

export function evaluateMossRealSemanticPredicates(input: {
  text: string;
  language?: string;
  noSpeech?: boolean;
  similarity: number;
}): MossRealPredicateOutcome[] {
  const nonempty = Boolean(input.text.trim());
  return [
    {
      name: "nonemptySpeech",
      evaluated: true,
      pass: nonempty,
      required: true,
      actual: nonempty,
    },
    {
      name: "noSpeech",
      evaluated: true,
      pass: !input.noSpeech,
      required: false,
      actual: Boolean(input.noSpeech),
    },
    {
      name: "language",
      evaluated: true,
      pass: input.language === MOSS_REAL_REQUIRED_LANGUAGE,
      required: MOSS_REAL_REQUIRED_LANGUAGE,
      actual: input.language ?? null,
    },
    {
      name: "similarity",
      evaluated: true,
      pass: input.similarity >= MOSS_REAL_SIMILARITY_MIN,
      required: MOSS_REAL_SIMILARITY_MIN,
      actual: input.similarity,
    },
  ];
}

export function unevaluatedMossRealPredicate(
  name: MossRealPredicateName,
  required: number | string | boolean,
): MossRealPredicateOutcome {
  return {
    name,
    evaluated: false,
    pass: null,
    required,
    actual: null,
  };
}

export function mossRealFailedPredicates(
  outcomes: readonly MossRealPredicateOutcome[],
): MossRealPredicateName[] {
  return outcomes
    .filter((row) => row.evaluated && row.pass === false)
    .map((row) => row.name);
}

export function assertMossRealPublicRecord(value: unknown, path = "$"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMossRealPublicRecord(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key)) {
      throw new Error(`MOSS real fail evidence must not include ${path}.${key}`);
    }
    if (Buffer.isBuffer(entry) || ArrayBuffer.isView(entry) || entry instanceof ArrayBuffer) {
      throw new Error(`MOSS real fail evidence must not include raw bytes at ${path}.${key}`);
    }
    assertMossRealPublicRecord(entry, `${path}.${key}`);
  }
}

export function buildMossRealFailEvidence(input: {
  target?: string;
  runtime?: Record<string, unknown>;
  model?: Record<string, unknown>;
  fixture: { id: string; inputTextSha256: string; voiceId: string };
  synthesis?: MossRealFailEvidence["synthesis"];
  roundtrip?: MossRealFailEvidence["roundtrip"];
  predicates: readonly MossRealPredicateOutcome[];
  generatedAt?: string;
}): MossRealFailEvidence {
  const predicates: MossRealFailEvidence["predicates"] = {};
  for (const row of input.predicates) {
    predicates[row.name] = {
      evaluated: row.evaluated,
      pass: row.pass,
      required: row.required,
      actual: row.actual,
    };
  }
  const evidence: MossRealFailEvidence = {
    schema: 1,
    assertion: "R50-VOICE-MOSS-REAL",
    status: "FAIL",
    ...(input.target ? { target: input.target } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.model ? { model: input.model } : {}),
    fixture: {
      id: input.fixture.id,
      inputTextSha256: input.fixture.inputTextSha256,
      voiceId: input.fixture.voiceId,
    },
    ...(input.synthesis ? { synthesis: { ...input.synthesis } } : {}),
    ...(input.roundtrip ? { roundtrip: { ...input.roundtrip } } : {}),
    predicates,
    failedPredicates: mossRealFailedPredicates(input.predicates),
    privacy: {
      audioPersisted: false,
      transcriptPersisted: false,
      absolutePathsPersisted: false,
    },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  assertMossRealPublicRecord(evidence);
  return evidence;
}

export class MossRealPredicateError extends Error {
  readonly evidence: MossRealFailEvidence;

  constructor(message: string, evidence: MossRealFailEvidence) {
    super(message);
    this.name = "MossRealPredicateError";
    this.evidence = evidence;
  }
}

export function mossRealCatchExtra(error: unknown): { evidence?: MossRealFailEvidence } {
  if (error instanceof MossRealPredicateError) {
    return { evidence: error.evidence };
  }
  return {};
}

export function retainMossRealPredicateFailure(
  reason: string,
  evidence: MossRealFailEvidence,
): never {
  throw new MossRealPredicateError(reason, evidence);
}
