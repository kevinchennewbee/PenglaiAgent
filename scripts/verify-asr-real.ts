import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  AsrModelManager,
  assertAllowedModelRedirect,
  assertCanonicalModelUrl,
  decodeWavPcm16,
  SENSEVOICE_MANIFEST,
  SherpaSenseVoiceEngine,
} from "../packages/asr/src/index.js";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, HOST_TARGET } from "./lib/evidence-dir.mjs";

const FIXTURE = Object.freeze({
  id: "sensevoice-upstream-zh-wav",
  license: "FunASR-Model-License-1.1",
  url: `https://huggingface.co/${SENSEVOICE_MANIFEST.repository}/resolve/${SENSEVOICE_MANIFEST.revision}/test_wavs/zh.wav?download=true`,
  bytes: 178_988,
  sha256: "b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373",
  sampleRate: 16_000,
  durationMs: 5_592,
});

const cacheDir = join(ROOT, ".cache", "asr-real", "models");
const run = beginEvidenceRun({ command: "verify:asr-real", target: HOST_TARGET });

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchFixture(): Promise<Buffer> {
  let url = assertCanonicalModelUrl(FIXTURE.url, SENSEVOICE_MANIFEST);
  for (let hop = 0; hop <= 5; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Penglai/0.5.5 ASR real verifier" },
      signal: AbortSignal.timeout(60_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || hop === 5) throw new Error("fixture redirect rejected");
      url = assertAllowedModelRedirect(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`fixture fetch failed status=${response.status}`);
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const raw of response.body as unknown as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(raw);
      bytes += chunk.length;
      if (bytes > FIXTURE.bytes) throw new Error("fixture exceeds pinned size");
      chunks.push(chunk);
    }
    const result = Buffer.concat(chunks);
    if (result.length !== FIXTURE.bytes || sha256(result) !== FIXTURE.sha256) {
      throw new Error("fixture size/hash mismatch");
    }
    return result;
  }
  throw new Error("fixture redirect loop");
}

const manager = new AsrModelManager(cacheDir);
let engine: SherpaSenseVoiceEngine | undefined;
try {
  await manager.initialize();
  if (manager.describeCapability().model !== "ready") {
    const operationId = `asrreal_${Date.now().toString(36)}`;
    await manager.prepareModel(operationId);
  }
  const fixture = await fetchFixture();
  const wav = decodeWavPcm16(fixture);
  if (wav.sampleRate !== FIXTURE.sampleRate || wav.durationMs !== FIXTURE.durationMs) {
    throw new Error("fixture decoded identity mismatch");
  }
  const model = await manager.requireReady();
  engine = new SherpaSenseVoiceEngine(model);
  const started = performance.now();
  const draft = await engine.transcribe(wav.pcm, wav.sampleRate);
  const elapsedMs = Math.round(performance.now() - started);
  if (draft.noSpeech || !draft.text.trim()) {
    throw new Error("real SenseVoice returned no speech");
  }
  if (draft.language !== "zh") {
    throw new Error(`real SenseVoice language mismatch: ${draft.language ?? "missing"}`);
  }
  const evidence = {
    schema: 1,
    assertion: "R50-VOICE-ASR-REAL",
    status: "PASS",
    target: `${process.platform}-${process.arch}`,
    engine: {
      package: "sherpa-onnx",
      packageVersion: engine.runtime.packageVersion,
      runtimeGitSha1: engine.runtime.gitSha1,
      onnxruntimeVersion: engine.runtime.onnxruntimeVersion,
    },
    model: {
      id: SENSEVOICE_MANIFEST.id,
      revision: SENSEVOICE_MANIFEST.revision,
      license: SENSEVOICE_MANIFEST.license,
      files: SENSEVOICE_MANIFEST.files.map(({ filename, bytes, sha256 }) => ({
        filename,
        bytes,
        sha256,
      })),
    },
    fixture: {
      id: FIXTURE.id,
      license: FIXTURE.license,
      bytes: FIXTURE.bytes,
      durationMs: FIXTURE.durationMs,
      sampleRate: FIXTURE.sampleRate,
      codec: "wav-pcm16",
      sha256: FIXTURE.sha256,
    },
    result: {
      transcriptNonEmpty: true,
      language: "zh",
      noSpeech: false,
      elapsedMs,
      realtimeFactor: Number((elapsedMs / FIXTURE.durationMs).toFixed(4)),
    },
    privacy: {
      audioPersisted: false,
      transcriptPersisted: false,
      absolutePathsPersisted: false,
    },
    generatedAt: new Date().toISOString(),
  };
  const manifest = finishEvidenceRun(run, "PASS", "real SenseVoice transcribed the licensed fixture", { evidence });
  console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:asr-real", dir: run.dir }));
  if (manifest.verdict !== "PASS") process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const incomplete = /ENOTFOUND|fetch|network|not installed|model|timeout|ECONN|certificate/i.test(reason);
  const safeReason = incomplete ? "ASR runtime or pinned model asset unavailable" : "real ASR verification failed";
  const manifest = finishEvidenceRun(run, incomplete ? "INCOMPLETE" : "FAIL", safeReason);
  console.error(JSON.stringify({ verdict: manifest.verdict, command: "verify:asr-real", reason: safeReason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
} finally {
  await engine?.dispose();
  await manager.dispose();
}
