import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sanitizeEvidenceValue } from "./evidence-json.mjs";
import {
  MOSS_REAL_AUDIBLE_FAIL_REASON,
  MOSS_REAL_AUDIBLE_RMS_ENERGY_MIN,
  MOSS_REAL_REQUIRED_LANGUAGE,
  MOSS_REAL_SEMANTIC_FAIL_REASON,
  MOSS_REAL_SIMILARITY_MIN,
  MossRealPredicateError,
  assertMossRealPublicRecord,
  buildMossRealFailEvidence,
  evaluateMossRealAudiblePredicate,
  evaluateMossRealSemanticPredicates,
  mossRealCatchExtra,
  mossRealFailedPredicates,
  mossRealSha256,
  mossRealSimilarity,
  retainMossRealPredicateFailure,
  unevaluatedMossRealPredicate,
} from "./moss-real-observability.ts";

const FIXTURE_TEXT = "你好，欢迎使用蓬莱。";
const FIXTURE_ID = "penglai-moss-roundtrip-zh-v1";
const VOICE_ID = "moss-zh-default";
const INCOMPLETE_RE = /ENOTFOUND|fetch|network|not installed|model|timeout|ECONN|certificate/i;

const runtimeIdentity = {
  engine: "onnxruntime-node",
  engineVersion: "1.23.2",
  tokenizer: "sentencepiece-js",
  tokenizerVersion: "1.1.0",
  modifiedRuntimeSha256: "b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c",
};

const modelIdentity = {
  id: "moss-tts-nano-onnx",
  revision: "cd877ae87fed8f9d26c237c5038242e796e51389",
};

function catchLike(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  const incomplete = INCOMPLETE_RE.test(reason);
  const extra = mossRealCatchExtra(error);
  const manifest = sanitizeEvidenceValue({
    verdict: incomplete ? "INCOMPLETE" : "FAIL",
    reason,
    ...extra,
  });
  return { reason, incomplete, extra, manifest };
}

function synthesisStub() {
  return {
    outputSha256: "a".repeat(64),
    outputBytes: 537644,
    durationMs: 2800,
    codec: "wav-pcm16-48khz-stereo",
    firstChunkLatencyMs: 12,
    elapsedMs: 40,
    realtimeFactor: 0.0143,
    rmsEnergy: 3865.96,
  };
}

function retainSemantic(input: {
  text: string;
  language?: string;
  noSpeech?: boolean;
  outputSha256?: string;
}) {
  const similarity = mossRealSimilarity(FIXTURE_TEXT, input.text);
  const predicates = [
    evaluateMossRealAudiblePredicate(3865.96),
    ...evaluateMossRealSemanticPredicates({
      text: input.text,
      language: input.language,
      noSpeech: input.noSpeech,
      similarity,
    }),
  ];
  const evidence = buildMossRealFailEvidence({
    target: "darwin-arm64",
    runtime: runtimeIdentity,
    model: modelIdentity,
    fixture: {
      id: FIXTURE_ID,
      inputTextSha256: mossRealSha256(FIXTURE_TEXT),
      voiceId: VOICE_ID,
    },
    synthesis: synthesisStub(),
    roundtrip: {
      engine: "sherpa-onnx",
      engineVersion: "1.13.7",
      modelRevision: "2365baeacb507f821a0c8120fcee3d484dba7a07",
      transcriptSha256: mossRealSha256(input.text.trim()),
      language: input.language ?? null,
      noSpeech: Boolean(input.noSpeech),
      transcriptNonEmpty: Boolean(input.text.trim()),
      similarity,
      elapsedMs: 20,
      realtimeFactor: 0.0071,
    },
    predicates,
    generatedAt: "2026-09-11T00:00:00.000Z",
  });
  try {
    retainMossRealPredicateFailure(MOSS_REAL_SEMANTIC_FAIL_REASON, evidence);
  } catch (error) {
    return catchLike(error);
  }
}

test("predicate constants match the published gate", () => {
  assert.equal(MOSS_REAL_AUDIBLE_RMS_ENERGY_MIN, 100);
  assert.equal(MOSS_REAL_SIMILARITY_MIN, 0.5);
  assert.equal(MOSS_REAL_REQUIRED_LANGUAGE, "zh");
  assert.equal(MOSS_REAL_AUDIBLE_FAIL_REASON, "MOSS output has no audible waveform");
  assert.equal(MOSS_REAL_SEMANTIC_FAIL_REASON, "MOSS to SenseVoice semantic round-trip failed");
});

test("similarity of the public fixture and one extra character stays above 0.5", () => {
  assert.equal(mossRealSimilarity(FIXTURE_TEXT, FIXTURE_TEXT), 1);
  assert.equal(mossRealSimilarity(FIXTURE_TEXT, "你好，欢迎使用蓬莱。此。"), 0.8889);
  assert.equal(mossRealSimilarity(FIXTURE_TEXT, ""), 0);
  assert.ok(mossRealSimilarity(FIXTURE_TEXT, "你好，欢迎使用蓬莱。此。") >= MOSS_REAL_SIMILARITY_MIN);
});

test("empty transcript fails nonempty through the catch retention path", () => {
  const caught = retainSemantic({ text: "", language: "zh", noSpeech: false });
  assert.equal(caught.reason, MOSS_REAL_SEMANTIC_FAIL_REASON);
  assert.equal(caught.incomplete, false);
  assert.ok(caught.manifest.evidence.failedPredicates.includes("nonemptySpeech"));
  assert.equal(caught.manifest.evidence.roundtrip.transcriptNonEmpty, false);
  assert.equal(caught.manifest.evidence.roundtrip.language, "zh");
  assert.equal(caught.manifest.evidence.roundtrip.noSpeech, false);
  assert.equal(caught.manifest.evidence.roundtrip.similarity, 0);
  assert.equal(caught.manifest.evidence.predicates.nonemptySpeech.actual, false);
  assert.equal(caught.manifest.evidence.privacy.transcriptPersisted, false);
  assert.doesNotMatch(JSON.stringify(caught.manifest), /你好|欢迎使用蓬莱/);
});

test("noSpeech true fails only the noSpeech predicate through the catch path", () => {
  const caught = retainSemantic({ text: FIXTURE_TEXT, language: "zh", noSpeech: true });
  assert.equal(caught.reason, MOSS_REAL_SEMANTIC_FAIL_REASON);
  assert.equal(caught.incomplete, false);
  assert.deepEqual(caught.manifest.evidence.failedPredicates, ["noSpeech"]);
  assert.equal(caught.manifest.evidence.roundtrip.noSpeech, true);
  assert.equal(caught.manifest.evidence.roundtrip.transcriptNonEmpty, true);
  assert.equal(caught.manifest.evidence.roundtrip.language, "zh");
  assert.equal(caught.manifest.evidence.roundtrip.similarity, 1);
});

test("wrong language fails only the language predicate through the catch path", () => {
  const caught = retainSemantic({ text: FIXTURE_TEXT, language: "yue", noSpeech: false });
  assert.equal(caught.reason, MOSS_REAL_SEMANTIC_FAIL_REASON);
  assert.equal(caught.incomplete, false);
  assert.deepEqual(caught.manifest.evidence.failedPredicates, ["language"]);
  assert.equal(caught.manifest.evidence.roundtrip.language, "yue");
  assert.equal(caught.manifest.evidence.predicates.language.required, "zh");
  assert.equal(caught.manifest.evidence.predicates.language.actual, "yue");
});

test("low similarity fails only the similarity predicate through the catch path", () => {
  const caught = retainSemantic({ text: "hello world", language: "zh", noSpeech: false });
  assert.equal(caught.reason, MOSS_REAL_SEMANTIC_FAIL_REASON);
  assert.equal(caught.incomplete, false);
  assert.deepEqual(caught.manifest.evidence.failedPredicates, ["similarity"]);
  assert.ok(caught.manifest.evidence.roundtrip.similarity < MOSS_REAL_SIMILARITY_MIN);
  assert.equal(caught.manifest.evidence.roundtrip.transcriptNonEmpty, true);
  assert.equal(caught.manifest.evidence.roundtrip.language, "zh");
  assert.doesNotMatch(JSON.stringify(caught.manifest), /hello world/);
});

test("successful semantic outcomes produce no failed predicates and do not throw", () => {
  const similarity = mossRealSimilarity(FIXTURE_TEXT, FIXTURE_TEXT);
  const predicates = [
    evaluateMossRealAudiblePredicate(3865.96),
    ...evaluateMossRealSemanticPredicates({
      text: FIXTURE_TEXT,
      language: "zh",
      noSpeech: false,
      similarity,
    }),
  ];
  assert.deepEqual(mossRealFailedPredicates(predicates), []);
  assert.equal(evaluateMossRealAudiblePredicate(100).pass, true);
  assert.equal(evaluateMossRealAudiblePredicate(99.99).pass, false);
});

test("audible failure retains energy and leaves semantic predicates unevaluated", () => {
  const energy = 12.4;
  const predicates = [
    evaluateMossRealAudiblePredicate(energy),
    unevaluatedMossRealPredicate("nonemptySpeech", true),
    unevaluatedMossRealPredicate("noSpeech", false),
    unevaluatedMossRealPredicate("language", "zh"),
    unevaluatedMossRealPredicate("similarity", 0.5),
  ];
  const evidence = buildMossRealFailEvidence({
    runtime: runtimeIdentity,
    model: modelIdentity,
    fixture: {
      id: FIXTURE_ID,
      inputTextSha256: mossRealSha256(FIXTURE_TEXT),
      voiceId: VOICE_ID,
    },
    synthesis: { ...synthesisStub(), rmsEnergy: Number(energy.toFixed(2)) },
    predicates,
  });
  let caught;
  try {
    retainMossRealPredicateFailure(MOSS_REAL_AUDIBLE_FAIL_REASON, evidence);
  } catch (error) {
    caught = catchLike(error);
  }
  assert.ok(caught);
  assert.equal(caught.reason, MOSS_REAL_AUDIBLE_FAIL_REASON);
  assert.equal(caught.incomplete, false);
  assert.deepEqual(caught.manifest.evidence.failedPredicates, ["audibleRmsEnergy"]);
  assert.equal(caught.manifest.evidence.synthesis.rmsEnergy, 12.4);
  assert.equal(caught.manifest.evidence.predicates.language.evaluated, false);
  assert.equal(caught.manifest.evidence.predicates.language.pass, null);
  assert.equal(caught.manifest.evidence.roundtrip, undefined);
  assert.equal(caught.manifest.evidence.runtime.engine, "onnxruntime-node");
  assert.equal(caught.manifest.evidence.model.id, "moss-tts-nano-onnx");
});

test("fail evidence schema, types, and privacy flags are JSON-safe", () => {
  const evidence = buildMossRealFailEvidence({
    target: "darwin-arm64",
    runtime: runtimeIdentity,
    model: modelIdentity,
    fixture: {
      id: FIXTURE_ID,
      inputTextSha256: mossRealSha256(FIXTURE_TEXT),
      voiceId: VOICE_ID,
    },
    synthesis: synthesisStub(),
    roundtrip: {
      engine: "sherpa-onnx",
      transcriptSha256: mossRealSha256("unit"),
      language: "en",
      noSpeech: false,
      transcriptNonEmpty: true,
      similarity: 0.1,
    },
    predicates: [
      evaluateMossRealAudiblePredicate(200),
      ...evaluateMossRealSemanticPredicates({
        text: "unit",
        language: "en",
        noSpeech: false,
        similarity: 0.1,
      }),
    ],
    generatedAt: "2026-09-11T00:00:00.000Z",
  });
  assert.equal(evidence.schema, 1);
  assert.equal(evidence.assertion, "R50-VOICE-MOSS-REAL");
  assert.equal(evidence.status, "FAIL");
  assert.equal(evidence.privacy.audioPersisted, false);
  assert.equal(evidence.privacy.transcriptPersisted, false);
  assert.equal(evidence.privacy.absolutePathsPersisted, false);
  assert.ok(Array.isArray(evidence.failedPredicates));
  assert.equal(typeof evidence.fixture.inputTextSha256, "string");
  assert.equal(evidence.fixture.inputTextSha256.length, 64);
  const json = JSON.stringify(evidence);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schema, 1);
  assert.equal(typeof parsed.predicates.similarity.actual, "number");
  assert.doesNotMatch(json, /"text"|"transcript"|"wav"|"pcm"/);
  assertMossRealPublicRecord(parsed);
  assert.throws(
    () => assertMossRealPublicRecord({ transcript: FIXTURE_TEXT }),
    /must not include/,
  );
});

test("generic errors keep the previous catch extra empty", () => {
  const caught = catchLike(new Error("MOSS opaque output digest mismatch"));
  assert.equal(caught.incomplete, false);
  assert.deepEqual(caught.extra, {});
  assert.equal(caught.manifest.evidence, undefined);
  const incomplete = catchLike(new Error("The operation was aborted due to timeout"));
  assert.equal(incomplete.incomplete, true);
  assert.deepEqual(incomplete.extra, {});
});

test("verify:moss-real still uses the published fixture, predicates, and catch extra", () => {
  const src = readFileSync(fileURLToPath(new URL("../verify-moss-real.ts", import.meta.url)), "utf8");
  assert.match(src, /你好，欢迎使用蓬莱。/);
  assert.match(src, /moss-zh-default/);
  assert.match(src, /penglai-moss-roundtrip-zh-v1/);
  assert.match(src, /energy < 100/);
  assert.match(src, /roundtripSimilarity < 0\.5/);
  assert.match(src, /transcript\.language !== "zh"/);
  assert.match(src, /transcript\.noSpeech/);
  assert.match(src, /!transcript\.text\.trim\(\)/);
  assert.doesNotMatch(src, /Math\.random\s*=/);
  assert.doesNotMatch(src, /sampleMode:\s*'greedy'/);
  const engine = readFileSync(fileURLToPath(new URL("../../packages/moss-tts/src/engine.ts", import.meta.url)), "utf8");
  assert.match(engine, /sampleMode: 'fixed'/);
  assert.doesNotMatch(engine, /Math\.random\s*=/);
  assert.match(src, /mossRealCatchExtra\(error\)/);
  assert.match(
    src,
    /finishEvidenceRun\(run, incomplete \? "INCOMPLETE" : "FAIL", reason, extra\)/,
  );
  assert.match(src, /manifest\.evidence \? \{ evidence: manifest\.evidence \}/);
  assert.match(src, /MOSS to SenseVoice semantic round-trip failed/);
  assert.match(src, /MOSS output has no audible waveform/);
  assert.match(src, /audioPersisted: false/);
  assert.match(src, /transcriptPersisted: false/);
});
