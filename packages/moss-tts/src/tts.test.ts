import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  BUILTIN_VOICES,
  MOSS_SOURCE_COMMIT,
  MOSS_TTS_MANIFEST,
  TTS_CHANNELS,
  TTS_SAMPLE_RATE,
  TtsModelManager,
  TtsOutputRegistry,
  apply,
  assertAllowedTtsModelRedirect,
  assertCanonicalTtsModelUrl,
  createMossTtsService,
  digestFinal,
  encodeWav,
  refuseSystemTtsFallback,
  synthesizePcm,
  type TtsEngine,
  type TtsModelManifest,
} from "./index.js";
import { createMossTtsSettingsApi, TYPERT_REMOTE } from "./remote.js";

const TTS_DIR = "MOSS-TTS-Nano-100M-ONNX";
const CODEC_DIR = "MOSS-Audio-Tokenizer-Nano-ONNX";

function sha(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeFixture(): {
  manifest: TtsModelManifest;
  contents: Map<string, Buffer>;
} {
  const tts = Buffer.from("verified-tts-graph");
  const codec = Buffer.from("verified-codec-graph");
  const ttsRevision = "1".repeat(40);
  const codecRevision = "2".repeat(40);
  const contents = new Map([
    [TTS_DIR + "/graph.onnx", tts],
    [CODEC_DIR + "/codec.onnx", codec],
  ]);
  const manifest: TtsModelManifest = {
    id: "moss-fixture",
    label: "MOSS fixture",
    revision: "3".repeat(40),
    license: "Apache-2.0",
    licenseUrl:
      "https://raw.githubusercontent.com/OpenMOSS/MOSS-TTS-Nano/" +
      MOSS_SOURCE_COMMIT +
      "/LICENSE",
    licenseSha256: "4".repeat(64),
    attribution: "OpenMOSS fixture",
    files: [
      {
        path: TTS_DIR + "/graph.onnx",
        sourceName: "graph.onnx",
        repository: "OpenMOSS-Team/fixture-tts",
        revision: ttsRevision,
        url:
          "https://huggingface.co/OpenMOSS-Team/fixture-tts/resolve/" +
          ttsRevision +
          "/graph.onnx?download=true",
        sha256: sha(tts),
        bytes: tts.length,
      },
      {
        path: CODEC_DIR + "/codec.onnx",
        sourceName: "codec.onnx",
        repository: "OpenMOSS-Team/fixture-codec",
        revision: codecRevision,
        url:
          "https://huggingface.co/OpenMOSS-Team/fixture-codec/resolve/" +
          codecRevision +
          "/codec.onnx?download=true",
        sha256: sha(codec),
        bytes: codec.length,
      },
    ],
  };
  return { manifest, contents };
}

function writeImport(root: string, contents: Map<string, Buffer>): void {
  for (const [path, content] of contents) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "penglai-moss-tts-"));
}

test("MOSS manifest pins both immutable official repositories and every graph", () => {
  assert.equal(MOSS_TTS_MANIFEST.files.length, 16);
  assert.equal(
    MOSS_TTS_MANIFEST.files.reduce((sum, file) => sum + file.bytes, 0),
    763_191_513,
  );
  assert.deepEqual(
    [...new Set(MOSS_TTS_MANIFEST.files.map((file) => file.revision))],
    [
      "f52645cb467506d8e18e746ddd59482685b74e58",
      "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae",
    ],
  );
  for (const file of MOSS_TTS_MANIFEST.files) {
    assert.equal(
      assertCanonicalTtsModelUrl(file.url, file).hostname,
      "huggingface.co",
    );
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.ok(file.bytes > 0);
  }
  const file = MOSS_TTS_MANIFEST.files[0]!;
  assert.throws(
    () =>
      assertCanonicalTtsModelUrl(
        file.url.replace(file.revision, "main"),
        file,
      ),
    PenglaiError,
  );
  assert.equal(
    assertAllowedTtsModelRedirect(
      "https://cdn-lfs-us-1.hf.co/object",
    ).protocol,
    "https:",
  );
  assert.throws(
    () => assertAllowedTtsModelRedirect("https://example.com/object"),
    PenglaiError,
  );
});

test("model manager imports only an exact capability-scoped file tree and deletes exactly it", async () => {
  const root = workspace();
  try {
    const source = join(root, "source");
    const models = join(root, "models");
    const { manifest, contents } = makeFixture();
    writeImport(source, contents);
    const manager = new TtsModelManager(models, manifest, {
      resolveCapability: async (ref) => {
        assert.equal(ref, "capability01");
        return source;
      },
    });
    await manager.initialize();
    assert.equal(manager.describeModels()[0]?.state, "not_installed");
    const operation = await manager.importVerifiedModel(
      "modelimp01",
      "capability01",
    );
    assert.equal(operation.state, "completed");
    assert.equal(manager.describeModels()[0]?.state, "ready");
    const resolved = await manager.requireReady();
    assert.equal(resolved.revision, manifest.revision);
    assert.equal(
      readFileSync(
        join(resolved.modelRoot, TTS_DIR + "/graph.onnx"),
        "utf8",
      ),
      "verified-tts-graph",
    );
    await manager.deleteModel(manifest.revision, {
      revision: manifest.revision,
      acknowledged: true,
    });
    assert.equal(manager.describeModels()[0]?.state, "not_installed");
    await manager.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model import rejects extra files before activation", async () => {
  const root = workspace();
  try {
    const source = join(root, "source");
    const { manifest, contents } = makeFixture();
    writeImport(source, contents);
    writeFileSync(join(source, TTS_DIR, "extra.bin"), "unexpected");
    const manager = new TtsModelManager(join(root, "models"), manifest, {
      resolveCapability: async () => source,
    });
    await assert.rejects(
      manager.importVerifiedModel("badimport1", "capability02"),
      /exact pinned file set/,
    );
    assert.notEqual(manager.describeModels()[0]?.state, "ready");
    await manager.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model downloader verifies immutable bytes and persists a crash-safe ready manifest", async () => {
  const root = workspace();
  try {
    const { manifest, contents } = makeFixture();
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const file = manifest.files.find((candidate) =>
        url.pathname.endsWith("/" + candidate.sourceName),
      );
      assert.ok(file);
      const body = contents.get(file.path);
      assert.ok(body);
      return new Response(body, {
        status: 200,
        headers: {
          "content-length": String(body.length),
          etag: '"' + file.sha256 + '"',
        },
      });
    };
    const models = join(root, "models");
    const manager = new TtsModelManager(models, manifest, { fetchImpl });
    const operation = await manager.prepareModel("download01");
    assert.equal(operation.state, "completed");
    assert.equal(manager.describeModels()[0]?.state, "ready");
    await manager.dispose();

    const restored = new TtsModelManager(models, manifest);
    await restored.initialize();
    assert.equal(restored.describeModels()[0]?.state, "ready");
    await restored.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model downloader never marks a same-size hash mismatch ready", async () => {
  const root = workspace();
  try {
    const { manifest, contents } = makeFixture();
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = new URL(String(input));
      const file = manifest.files.find((candidate) =>
        url.pathname.endsWith("/" + candidate.sourceName),
      )!;
      const expected = contents.get(file.path)!;
      const body =
        calls === 1 ? Buffer.alloc(expected.length, 0x78) : expected;
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) },
      });
    };
    const manager = new TtsModelManager(
      join(root, "models"),
      manifest,
      { fetchImpl },
    );
    await assert.rejects(
      manager.prepareModel("download02"),
      /hash mismatch/,
    );
    assert.equal(manager.describeModels()[0]?.state, "failed");
    await manager.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("output registry exposes only opaque verified WAV handles and cleans explicit dispose", async () => {
  const root = workspace();
  try {
    const registry = new TtsOutputRegistry(join(root, "outputs"));
    await registry.initialize();
    const pcm = new Int16Array(
      (TTS_SAMPLE_RATE * TTS_CHANNELS) / 10,
    );
    pcm[10] = 1_024;
    const wav = encodeWav(pcm);
    const finalDigest = digestFinal("durable final");
    const handle = await registry.stage(wav, {
      durationMs: 100,
      voiceId: "moss-zh-default",
      sourceFinalDigest: finalDigest,
      ownerOperation: "output001",
    });
    assert.equal("path" in handle, false);
    assert.equal("wav" in handle, false);
    assert.deepEqual(
      await registry.resolve(handle, "output001"),
      wav,
    );
    await assert.rejects(
      registry.resolve(handle, "different01"),
      PenglaiError,
    );
    await registry.dispose();
    assert.deepEqual(registry.describe(), { active: 0, bytes: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function readyService(root: string, engine: TtsEngine) {
  const source = join(root, "source");
  const { manifest, contents } = makeFixture();
  writeImport(source, contents);
  const service = createMossTtsService({
    modelsDir: join(root, "models"),
    tempDir: join(root, "outputs"),
    manifest,
    resolveCapability: async () => source,
    engineFactory: async () => engine,
  });
  await service.ready;
  await service.importVerifiedModel("modelimp02", "capability03");
  return service;
}

test("typed service binds exact durable final to engine PCM and an opaque output", async () => {
  const root = workspace();
  try {
    let streamed = 0;
    const engine: TtsEngine = {
      async synthesize(_text, voiceId, _signal, onChunk) {
        const pcm = new Int16Array(4_800 * TTS_CHANNELS);
        pcm[100] = 2_048;
        await onChunk?.({
          pcm: new Int16Array(pcm),
          sampleRate: TTS_SAMPLE_RATE,
          channels: TTS_CHANNELS,
          pause: false,
        });
        streamed += 1;
        return {
          pcm,
          sampleRate: TTS_SAMPLE_RATE,
          channels: TTS_CHANNELS,
          voiceId,
          textChunks: 1,
        };
      },
    };
    const service = await readyService(root, engine);
    const finalText = "蓬莱真实语音。";
    const result = await service.synthesize({
      operationId: "synth001",
      sourceFinalId: "final:001",
      finalText,
      finalDigest: digestFinal(finalText),
      voiceId: "moss-zh-default",
      locale: "zh",
    });
    assert.equal(streamed, 1);
    assert.equal(result.operation.state, "completed");
    assert.equal(result.operation.durationMs, 100);
    const wav = await service.readOutput(
      result.handle,
      "synth001",
    );
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wav.readUInt32LE(24), TTS_SAMPLE_RATE);
    assert.equal(wav.readUInt16LE(22), TTS_CHANNELS);
    await service.releaseOutput(result.handle.id);
    assert.equal(service.describeCapability().outputHandles, 0);

    const remoteResult = await createMossTtsSettingsApi(service).readAloud({
      text: finalText,
      voiceId: "moss-zh-default",
      locale: "zh",
      operationId: "readapi01",
    });
    assert.equal(typeof remoteResult.firstChunkLatencyMs, "number");
    assert.equal(typeof remoteResult.synthesisElapsedMs, "number");
    assert.equal(
      Buffer.from(remoteResult.wavBase64, "base64").subarray(0, 4).toString("ascii"),
      "RIFF",
    );
    assert.equal(service.describeCapability().outputHandles, 0);

    await assert.rejects(
      service.synthesize({
        operationId: "synth002",
        sourceFinalId: "final:002",
        finalText,
        finalDigest: "0".repeat(64),
        voiceId: "moss-zh-default",
        locale: "zh",
      }),
      /exact durable final/,
    );
    await service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model activation prewarms once before the first synthesis", async () => {
  const root = workspace();
  try {
    const lifecycle: string[] = [];
    const engine: TtsEngine = {
      async prewarm() {
        lifecycle.push("prewarm");
      },
      async synthesize(_text, voiceId) {
        lifecycle.push("synthesize");
        return {
          pcm: new Int16Array(4_800 * TTS_CHANNELS),
          sampleRate: TTS_SAMPLE_RATE,
          channels: TTS_CHANNELS,
          voiceId,
          textChunks: 1,
        };
      },
    };
    const service = await readyService(root, engine);
    assert.deepEqual(lifecycle, ["prewarm"]);
    const text = "模型预热顺序测试。";
    const result = await service.synthesize({
      operationId: "prewarm01",
      sourceFinalId: "final:prewarm:01",
      finalText: text,
      finalDigest: digestFinal(text),
      voiceId: "moss-zh-default",
      locale: "zh",
    });
    assert.deepEqual(lifecycle, ["prewarm", "synthesize"]);
    await service.releaseOutput(result.handle.id);
    await service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed prewarm releases the engine so synthesis can retry cleanly", async () => {
  const root = workspace();
  let engines = 0;
  try {
    const source = join(root, "source");
    const { manifest, contents } = makeFixture();
    writeImport(source, contents);
    const service = createMossTtsService({
      modelsDir: join(root, "models"),
      tempDir: join(root, "outputs"),
      manifest,
      resolveCapability: async () => source,
      engineFactory: async () => {
        engines += 1;
        if (engines === 1) {
          return {
            async prewarm() {
              throw new PenglaiError("DSH_UNAVAILABLE", "fixture warmup failed");
            },
            async synthesize() {
              throw new Error("failed engine must not synthesize");
            },
          };
        }
        return {
          async prewarm() {},
          async synthesize(_text, voiceId) {
            return {
              pcm: new Int16Array(4_800 * TTS_CHANNELS),
              sampleRate: TTS_SAMPLE_RATE,
              channels: TTS_CHANNELS,
              voiceId,
              textChunks: 1,
            };
          },
        };
      },
    });
    await service.ready;
    await assert.rejects(
      service.importVerifiedModel("prewarm_fail_01", "capability_prewarm_01"),
      /warmup failed/,
    );
    assert.equal(service.describeCapability().model, "ready");
    assert.equal(service.resourceSnapshot().modelSessions, 0);

    const text = "预热失败后的干净重试。";
    const result = await service.synthesize({
      operationId: "prewarm_retry_01",
      sourceFinalId: "final:prewarm:retry:01",
      finalText: text,
      finalDigest: digestFinal(text),
      voiceId: "moss-zh-default",
      locale: "zh",
    });
    assert.equal(engines, 2);
    await service.releaseOutput(result.handle.id);
    await service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("TTS shared budget admits one active and three queued syntheses", async () => {
  const root = workspace();
  let releaseEngine = (): void => undefined;
  const engineGate = new Promise<void>((resolve) => {
    releaseEngine = resolve;
  });
  try {
    const engine: TtsEngine = {
      async synthesize(_text, voiceId) {
        await engineGate;
        return {
          pcm: new Int16Array(4_800 * TTS_CHANNELS),
          sampleRate: TTS_SAMPLE_RATE,
          channels: TTS_CHANNELS,
          voiceId,
          textChunks: 1,
        };
      },
    };
    const service = await readyService(root, engine);
    try {
      const pending: Array<ReturnType<typeof service.synthesize>> = [];
      for (let index = 0; index < 5; index += 1) {
        const finalText = `资源预算测试 ${index}`;
        const synthesis = service.synthesize({
          operationId: `tts_budget_${index}`,
          sourceFinalId: `final:budget:${index}`,
          finalText,
          finalDigest: digestFinal(finalText),
          voiceId: "moss-zh-default",
          locale: "zh",
        });
        if (index < 4) pending.push(synthesis);
        else await assert.rejects(synthesis, /backpressure/);
      }
      assert.equal(service.describeCapability().activeSyntheses, 1);
      assert.equal(service.describeCapability().queueDepth, 3);
      releaseEngine();
      const completed = await Promise.all(pending);
      await Promise.all(
        completed.map(({ handle }) => service.releaseOutput(handle.id)),
      );
    } finally {
      releaseEngine();
      await service.dispose();
    }
  } finally {
    releaseEngine();
    rmSync(root, { recursive: true, force: true });
  }
});

test("active synthesis cancellation reaches the engine and leaves no output handle", async () => {
  const root = workspace();
  try {
    const engine: TtsEngine = {
      synthesize(_text, _voice, signal) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                new PenglaiError(
                  "DELIVERY_TRANSIENT",
                  "fixture cancelled",
                ),
              ),
            { once: true },
          );
        });
      },
    };
    const service = await readyService(root, engine);
    const text = "取消测试。";
    const pending = service.synthesize({
      operationId: "cancel001",
      sourceFinalId: "final:003",
      finalText: text,
      finalDigest: digestFinal(text),
      voiceId: "moss-zh-default",
      locale: "zh",
    });
    await new Promise((resolve) => setImmediate(resolve));
    const api = createMossTtsSettingsApi(service);
    await api.cancelSynthesis("cancel001");
    await assert.rejects(pending, /cancelled/);
    assert.equal(
      service.getOperation("cancel001")?.state,
      "cancelled",
    );
    assert.equal(service.describeCapability().outputHandles, 0);
    assert.equal(TYPERT_REMOTE.descriptors.includes("cancelSynthesis"), true);
    await service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Cordis plugin provides one app-private service and disposes by effect", async () => {
  const root = workspace();
  const previous = process.env.PENGLAI_USER_DATA;
  try {
    process.env.PENGLAI_USER_DATA = root;
    let providedName = "";
    let cleanup: (() => Promise<void>) | undefined;
    const service = apply({
      provide(name) {
        providedName = name;
      },
      effect(setup) {
        cleanup = setup();
      },
    });
    await service.ready;
    assert.equal(providedName, "penglaiMossTts");
    assert.equal(service.listVoices().length, BUILTIN_VOICES.length);
    assert.equal("createAgent" in service, false);
    const proxied = new Proxy(
      {
        provide(name: string) {
          providedName = name;
        },
        effect(setup: () => () => Promise<void>) {
          cleanup = setup();
        },
      },
      {
        get(target, prop, receiver) {
          if (prop === "penglaiFileCapabilities") {
            throw new Error("cannot get property \"penglaiFileCapabilities\" without inject");
          }
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    assert.doesNotThrow(() => apply(proxied));
    await cleanup?.();
  } finally {
    if (previous === undefined) {
      delete process.env.PENGLAI_USER_DATA;
    } else {
      process.env.PENGLAI_USER_DATA = previous;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("production source contains attributed ONNX pipeline and no tone/system fallback", () => {
  const runtime = readFileSync(
    new URL("./third_party/moss_tts/runtime.mjs", import.meta.url),
    "utf8",
  );
  const synth = readFileSync(
    new URL("./synth.ts", import.meta.url),
    "utf8",
  );
  const engine = readFileSync(
    new URL("./engine.ts", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /onnxruntime-node/);
  assert.match(runtime, /sessions\.prefill/);
  assert.match(runtime, /codecDecode/);
  assert.match(runtime, /readFile\(resolveLocalAssetPath/);
  assert.match(runtime, /resolveLocalAssetPath\(this\.localPathRoot, relativePath\)/);
  assert.match(runtime, /resolveLocalAssetPath\(this\.localPathRoot, tokenizerRelativePath\)/);
  assert.match(runtime, /escaped the verified model root/);
  assert.doesNotMatch(runtime, /fetch\(fileUrl/);
  assert.match(engine, /await next\.warmup\(\)/);
  assert.match(engine, /message\.type === 'prewarm'/);
  assert.doesNotMatch(synth, /renderTone|Math\.sin|say\s|Siri/i);
  assert.throws(
    () =>
      synthesizePcm({
        model: "ready",
        finalText: "no fake",
        finalDigest: digestFinal("no fake"),
        voiceId: "moss-zh-default",
      }),
    /verified penglaiMossTts service/,
  );
  assert.throws(() => refuseSystemTtsFallback(), PenglaiError);
});

test("MOSS-TTS settings client registers the Penglai page slot and Typert remote", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /settings\.section/);
  assert.match(client, /conversation\.chat\.assistant-actions/);
  assert.match(client, /data-penglai-tts-read/);
  assert.match(client, /data-penglai-tts/);
  assert.match(client, /penglaiMossTts/);
  assert.match(client, /previewVoice/);
  assert.match(client, /readAloud/);
  assert.match(client, /cancelSynthesis/);
  assert.match(client, /data-penglai-tts-first-chunk-ms/);
  assert.match(client, /conversation\.chat\.assistant-actions/);
  assert.doesNotMatch(client, /fetch\("\/penglai\/tts"/);
  const remote = readFileSync(new URL("./remote.ts", import.meta.url), "utf8");
  assert.match(remote, /TypertRemoteService/);
  assert.match(remote, /settings-preview:/);
  assert.match(remote, /cancelSynthesis/);
  assert.match(remote, /firstChunkLatencyMs/);
});
