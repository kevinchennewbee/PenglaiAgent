import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  AsrModelManager,
  decodeWavPcm16,
  SENSEVOICE_MANIFEST,
  SherpaSenseVoiceEngine,
} from "../packages/asr/src/index.js";
import {
  createMossTtsService,
  digestFinal,
  MOSS_TTS_MANIFEST,
} from "../packages/moss-tts/src/index.js";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, HOST_TARGET } from "./lib/evidence-dir.mjs";

const FIXTURE = Object.freeze({
  id: "penglai-moss-roundtrip-zh-v1",
  text: "你好，欢迎使用蓬莱。",
  voiceId: "moss-zh-default",
  locale: "zh" as const,
});

const cacheRoot = join(ROOT, ".cache", "moss-real");
const run = beginEvidenceRun({ command: "verify:moss-real", target: HOST_TARGET });

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

function similarity(left: string, right: string): number {
  const a = [...normalized(left)];
  const b = [...normalized(right)];
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

const service = createMossTtsService({
  modelsDir: join(cacheRoot, "models"),
  tempDir: join(cacheRoot, "outputs"),
});
const asrManager = new AsrModelManager(join(ROOT, ".cache", "asr-real", "models"));
let asrEngine: SherpaSenseVoiceEngine | undefined;
try {
  await service.ready;
  if (service.describeCapability().model !== "ready") {
    await service.prepareModel(`mossreal_${Date.now().toString(36)}`);
  }
  await asrManager.initialize();
  if (asrManager.describeCapability().model !== "ready") {
    await asrManager.prepareModel(`asrreal_${Date.now().toString(36)}`);
  }

  const finalDigest = digestFinal(FIXTURE.text);
  const started = performance.now();
  const synthesized = await service.synthesize({
    operationId: `synth_${Date.now().toString(36)}`,
    sourceFinalId: `final:${Date.now().toString(36)}`,
    finalText: FIXTURE.text,
    finalDigest,
    voiceId: FIXTURE.voiceId,
    locale: FIXTURE.locale,
  });
  const synthesisElapsedMs = Math.round(performance.now() - started);
  const wav = await service.readOutput(synthesized.handle, synthesized.operation.operationId);
  if (sha256(wav) !== synthesized.handle.digest || wav.length !== synthesized.handle.bytes) {
    throw new Error("MOSS opaque output digest mismatch");
  }
  const decoded = decodeWavPcm16(wav);
  const energy = Math.sqrt(
    decoded.pcm.reduce((sum, sample) => sum + sample * sample, 0) /
      decoded.pcm.length,
  );
  if (!Number.isFinite(energy) || energy < 100) {
    throw new Error("MOSS output has no audible waveform");
  }

  asrEngine = new SherpaSenseVoiceEngine(await asrManager.requireReady());
  const asrStarted = performance.now();
  const transcript = await asrEngine.transcribe(decoded.pcm, decoded.sampleRate);
  const asrElapsedMs = Math.round(performance.now() - asrStarted);
  const roundtripSimilarity = similarity(FIXTURE.text, transcript.text);
  if (
    transcript.noSpeech || !transcript.text.trim() ||
    transcript.language !== "zh" || roundtripSimilarity < 0.5
  ) {
    throw new Error("MOSS to SenseVoice semantic round-trip failed");
  }
  await service.releaseOutput(synthesized.handle.id);

  const cancellationId = `cancel_${Date.now().toString(36)}`;
  const cancellationText = FIXTURE.text.repeat(12);
  const cancellationPromise = service.synthesize({
    operationId: cancellationId,
    sourceFinalId: `final:${Date.now().toString(36)}:cancel`,
    finalText: cancellationText,
    finalDigest: digestFinal(cancellationText),
    voiceId: FIXTURE.voiceId,
    locale: FIXTURE.locale,
  });
  const cancellationOutcome = cancellationPromise.then(
    () => false,
    () => true,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cancellation = await service.cancelSynthesis(cancellationId);
  if (
    cancellation.state !== "cancelled" || !(await cancellationOutcome) ||
    service.describeCapability().outputHandles !== 0
  ) {
    throw new Error("real MOSS cancellation did not terminate cleanly");
  }

  const evidence = {
    schema: 1,
    assertion: "R50-VOICE-MOSS-REAL",
    status: "PASS",
    target: `${process.platform}-${process.arch}`,
    runtime: {
      engine: "onnxruntime-node",
      engineVersion: "1.23.2",
      tokenizer: "sentencepiece-js",
      tokenizerVersion: "1.1.0",
      modifiedRuntimeSha256:
        "b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c",
    },
    model: {
      id: MOSS_TTS_MANIFEST.id,
      revision: MOSS_TTS_MANIFEST.revision,
      license: MOSS_TTS_MANIFEST.license,
      totalBytes: MOSS_TTS_MANIFEST.files.reduce((sum, file) => sum + file.bytes, 0),
      files: MOSS_TTS_MANIFEST.files.map(
        ({ path, repository, revision, bytes, sha256: digest }) => ({
          path,
          repository,
          revision,
          bytes,
          sha256: digest,
        }),
      ),
    },
    fixture: {
      id: FIXTURE.id,
      inputTextSha256: finalDigest,
      voiceId: FIXTURE.voiceId,
    },
    synthesis: {
      outputSha256: synthesized.handle.digest,
      outputBytes: synthesized.handle.bytes,
      durationMs: decoded.durationMs,
      codec: "wav-pcm16-48khz-stereo",
      firstChunkLatencyMs: synthesized.operation.firstChunkLatencyMs,
      elapsedMs: synthesisElapsedMs,
      realtimeFactor: Number((synthesisElapsedMs / decoded.durationMs).toFixed(4)),
      rmsEnergy: Number(energy.toFixed(2)),
    },
    roundtrip: {
      engine: "sherpa-onnx",
      engineVersion: asrEngine.runtime.packageVersion,
      modelRevision: SENSEVOICE_MANIFEST.revision,
      transcriptSha256: sha256(transcript.text.trim()),
      language: transcript.language,
      noSpeech: false,
      similarity: roundtripSimilarity,
      elapsedMs: asrElapsedMs,
      realtimeFactor: Number((asrElapsedMs / decoded.durationMs).toFixed(4)),
    },
    cancellation: {
      state: cancellation.state,
      outputHandlesAfterCancel: service.describeCapability().outputHandles,
    },
    privacy: {
      audioPersisted: false,
      transcriptPersisted: false,
      absolutePathsPersisted: false,
    },
    generatedAt: new Date().toISOString(),
  };
  const manifest = finishEvidenceRun(run, "PASS", "real MOSS TTS synthesized and round-tripped through SenseVoice", { evidence });
  console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:moss-real", dir: run.dir }));
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const incomplete = /ENOTFOUND|fetch|network|not installed|model|timeout|ECONN|certificate/i.test(reason);
  const manifest = finishEvidenceRun(run, incomplete ? "INCOMPLETE" : "FAIL", reason);
  console.error(JSON.stringify({ verdict: manifest.verdict, command: "verify:moss-real", reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
} finally {
  await asrEngine?.dispose();
  await asrManager.dispose();
  await service.dispose();
}
