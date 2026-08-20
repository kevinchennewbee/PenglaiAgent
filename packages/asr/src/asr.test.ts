import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  apply,
  createAsrService,
  decodeWavPcm16,
  parseSenseVoiceResult,
  resamplePcm16Mono,
  SENSEVOICE_MANIFEST,
  SherpaSenseVoiceEngine,
  type ModelManifest,
  type TranscribeEngine,
} from "./index.js";
import { FixtureAsrEngine } from "./test-fixture.js";

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureManifest(model: Buffer, tokens: Buffer): ModelManifest {
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const repository = "penglai-tests/sensevoice-fixture";
  return {
    id: "sensevoice-int8-test",
    label: "licensed SenseVoice test fixture",
    repository,
    revision,
    license: "CC0-1.0",
    licenseUrl:
      "https://raw.githubusercontent.com/penglai-tests/fixtures/0123456789abcdef0123456789abcdef01234567/LICENSE",
    licenseSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    attribution: "Penglai licensed test fixture",
    files: [
      {
        filename: "model.int8.onnx",
        url: `https://huggingface.co/${repository}/resolve/${revision}/model.int8.onnx`,
        sha256: digest(model),
        bytes: model.length,
      },
      {
        filename: "tokens.txt",
        url: `https://huggingface.co/${repository}/resolve/${revision}/tokens.txt`,
        sha256: digest(tokens),
        bytes: tokens.length,
      },
    ],
  };
}

test("ASR production apply requires app-private userData and Cordis lifecycle", async () => {
  const previous = process.env.PENGLAI_USER_DATA;
  delete process.env.PENGLAI_USER_DATA;
  assert.throws(() => apply({}), /PENGLAI_USER_DATA/);
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-apply-"));
  process.env.PENGLAI_USER_DATA = root;
  let provided = "";
  let dispose: (() => Promise<void>) | undefined;
  try {
    const service = apply({
      provide(name) {
        provided = name;
      },
      effect(setup) {
        dispose = setup();
      },
    });
    await service.ready;
    assert.equal(provided, "penglaiAsr");
    const proxied = new Proxy(
      {
        provide(name: string) {
          provided = name;
        },
        effect(setup: () => () => Promise<void>) {
          dispose = setup();
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
    assert.equal(service.describeCapability().model, "not_installed");
    assert.equal("createAgent" in service, false);
    assert.equal("createSession" in service, false);
    const { createAsrSettingsApi } = await import("./remote.js");
    await assert.rejects(
      () => createAsrSettingsApi(service).testTranscribe({ wavBase64: "AA==", operationId: "asrtest01" }),
      /not installed/,
    );
    await dispose?.();
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: production SenseVoice manifest is immutable and exact", () => {
  assert.equal(
    SENSEVOICE_MANIFEST.revision,
    "2365baeacb507f821a0c8120fcee3d484dba7a07",
  );
  assert.deepEqual(
    SENSEVOICE_MANIFEST.files.map((file) => [file.filename, file.bytes, file.sha256]),
    [
      [
        "model.int8.onnx",
        239_233_841,
        "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
      ],
      [
        "tokens.txt",
        315_894,
        "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
      ],
    ],
  );
  for (const file of SENSEVOICE_MANIFEST.files) {
    assert.match(file.url, /^https:\/\/huggingface\.co\//);
    assert.ok(file.url.includes(SENSEVOICE_MANIFEST.revision));
    assert.doesNotMatch(file.url, /master|latest|hf-mirror/);
  }
});

test("R50-VOICE: verified model import is exact, opaque, atomic, and path-redacted", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-model-"));
  const source = join(root, "source");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(source);
  const model = Buffer.from("licensed-model-fixture");
  const tokens = Buffer.from("licensed-token-fixture");
  writeFileSync(join(source, "model.int8.onnx"), model);
  writeFileSync(join(source, "tokens.txt"), tokens);
  const manifest = fixtureManifest(model, tokens);
  const { AsrModelManager } = await import("./models.js");
  const manager = new AsrModelManager(join(root, "models"), manifest, {
    async resolveCapability(ref) {
      assert.equal(ref, "capability_model_1");
      return source;
    },
  });
  try {
    await manager.initialize();
    assert.equal(manager.describeCapability().model, "not_installed");
    const operation = await manager.importVerifiedModel(
      "import_op_1",
      "capability_model_1",
    );
    assert.equal(operation.state, "completed");
    assert.equal(manager.describeCapability().model, "ready");
    assert.doesNotMatch(JSON.stringify(manager.describeModels()), new RegExp(root));
    const resolved = await manager.requireReady();
    assert.equal(readFileSync(resolved.modelPath).toString(), model.toString());
    assert.equal(readFileSync(resolved.tokensPath).toString(), tokens.toString());
    await assert.rejects(
      manager.importVerifiedModel("import_op_2", source),
      /opaque capability/,
    );
    await manager.deleteModel(manifest.revision, {
      revision: manifest.revision,
      acknowledged: true,
    });
    assert.equal(manager.describeCapability().model, "not_installed");
  } finally {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: model manager rejects symlink import and hash mismatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-model-bad-"));
  const source = join(root, "source");
  const link = join(root, "source-link");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(source);
  const model = Buffer.from("model");
  const tokens = Buffer.from("tokens");
  writeFileSync(join(source, "model.int8.onnx"), Buffer.from("wrong"));
  writeFileSync(join(source, "tokens.txt"), tokens);
  symlinkSync(source, link);
  const manifest = fixtureManifest(model, tokens);
  const { AsrModelManager } = await import("./models.js");
  const manager = new AsrModelManager(join(root, "models"), manifest, {
    async resolveCapability(ref) {
      return ref === "capability_symlink" ? link : source;
    },
  });
  try {
    await assert.rejects(
      manager.importVerifiedModel("import_bad_1", "capability_symlink"),
      /real directory/,
    );
    await assert.rejects(
      manager.importVerifiedModel("import_bad_2", "capability_hash"),
      /size mismatch|hash mismatch/,
    );
  } finally {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: downloader resumes an exact Range and atomically verifies every file", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-download-"));
  const model = Buffer.from("0123456789-model");
  const tokens = Buffer.from("tokens-exact");
  const manifest = fixtureManifest(model, tokens);
  const revisionDir = join(root, "models", manifest.revision);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(revisionDir, { recursive: true });
  const operationId = "download_op_1";
  writeFileSync(
    join(revisionDir, `model.int8.onnx.${operationId}.part`),
    model.subarray(0, 5),
  );
  const seenRanges: string[] = [];
  const { AsrModelManager } = await import("./models.js");
  const manager = new AsrModelManager(join(root, "models"), manifest, {
    async fetchImpl(input, init) {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seenRanges.push(headers.get("range") ?? "");
      if (url.includes("model.int8.onnx")) {
        return new Response(model.subarray(5), {
          status: 206,
          headers: {
            "content-length": String(model.length - 5),
            "content-range": `bytes 5-${model.length - 1}/${model.length}`,
          },
        });
      }
      return new Response(tokens, {
        status: 200,
        headers: { "content-length": String(tokens.length) },
      });
    },
  });
  try {
    const operation = await manager.prepareModel(operationId);
    assert.equal(operation.state, "completed");
    assert.deepEqual(seenRanges, ["bytes=5-", ""]);
    assert.equal(manager.describeCapability().model, "ready");
    const resolved = await manager.requireReady();
    assert.equal(readFileSync(resolved.modelPath).toString(), model.toString());
    assert.equal(readFileSync(resolved.tokensPath).toString(), tokens.toString());
    assert.equal(
      existsSync(join(revisionDir, `model.int8.onnx.${operationId}.part`)),
      false,
    );
  } finally {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: downloader rejects an unallowlisted redirect before writing a model", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-redirect-"));
  const model = Buffer.from("model");
  const tokens = Buffer.from("tokens");
  const manifest = fixtureManifest(model, tokens);
  const { AsrModelManager } = await import("./models.js");
  const manager = new AsrModelManager(join(root, "models"), manifest, {
    async fetchImpl() {
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.invalid/model.onnx" },
      });
    },
  });
  try {
    await assert.rejects(manager.prepareModel("redirect_op_1"), /redirect host/);
    assert.equal(manager.describeCapability().model, "failed");
    assert.equal(
      existsSync(join(root, "models", manifest.revision, "model.int8.onnx")),
      false,
    );
  } finally {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: paused download remains resumable and cancel removes only its exact part", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-pause-"));
  const model = Buffer.from("model-long-enough");
  const tokens = Buffer.from("tokens");
  const manifest = fixtureManifest(model, tokens);
  let startedResolve: (() => void) | undefined;
  const started = new Promise<void>((resolvePromise) => {
    startedResolve = resolvePromise;
  });
  const { AsrModelManager } = await import("./models.js");
  const manager = new AsrModelManager(join(root, "models"), manifest, {
    async fetchImpl(_input, init) {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(model.subarray(0, 3));
          startedResolve?.();
          signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(model.length) },
      });
    },
  });
  const operationId = "download_pause_1";
  try {
    const running = manager.prepareModel(operationId);
    await started;
    assert.equal(manager.pauseDownload(operationId).state, "paused");
    assert.equal((await running).state, "paused");
    assert.equal((await manager.cancelDownload(operationId)).state, "cancelled");
    const part = join(
      root,
      "models",
      manifest.revision,
      `model.int8.onnx.${operationId}.part`,
    );
    assert.equal(existsSync(part), false);
  } finally {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: WAV parser, resampler, SenseVoice tags, and no-speech are bounded", () => {
  const wav = toneWav(48_000, 400);
  const decoded = decodeWavPcm16(wav);
  assert.equal(decoded.sampleRate, 48_000);
  assert.equal(resamplePcm16Mono(decoded.pcm, 48_000).length, 6_400);
  assert.deepEqual(
    parseSenseVoiceResult("<|HAPPY|><|Speech|><|zh|>蓬莱你好"),
    {
      text: "蓬莱你好",
      language: "zh",
      emotion: "HAPPY",
      noSpeech: false,
    },
  );
  assert.equal(parseSenseVoiceResult("<|NOSPEECH|><|zh|>").noSpeech, true);
  const malformed = Buffer.from(wav);
  malformed.writeUInt32LE(0x7fffffff, 40);
  assert.throws(() => decodeWavPcm16(malformed), /chunk exceeds/);
});

test("R50-VOICE: opaque AudioHandle runs one confirmed-safe draft and is deleted", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-asr-service-"));
  const source = join(root, "source");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(source);
  const model = Buffer.from("model-fixture");
  const tokens = Buffer.from("token-fixture");
  writeFileSync(join(source, "model.int8.onnx"), model);
  writeFileSync(join(source, "tokens.txt"), tokens);
  const engine = new FixtureAsrEngine("licensed integration transcript");
  const service = createAsrService({
    modelsDir: join(root, "models"),
    tempDir: join(root, "temp"),
    manifest: fixtureManifest(model, tokens),
    async resolveCapability() {
      return source;
    },
    engineFactory() {
      return engine;
    },
  });
  try {
    await service.ready;
    await service.importVerifiedModel("import_real_1", "capability_model_1");
    const operationId = "transcribe_op_1";
    const handle = await service.stageAudio(toneWav(16_000, 400), {
      source: "attachment",
      ownerOperation: operationId,
    });
    assert.equal("path" in handle, false);
    const result = await service.transcribe(
      handle,
      { authorized: true, claimed: true, privateChat: true },
      operationId,
    );
    assert.equal(result.draft.text, "licensed integration transcript");
    assert.equal(result.draft.confirmed, false);
    assert.equal(service.audio.describe().active, 0);
    const operation = service.getOperation(operationId);
    assert.equal(operation?.state, "completed");
    assert.doesNotMatch(JSON.stringify(operation), /integration transcript/);
    assert.throws(
      () => service.confirmTranscript(operationId, "0".repeat(64), result.draft.text),
      /confirmation mismatch/,
    );
    assert.deepEqual(
      service.confirmTranscript(
        operationId,
        result.draftDigest,
        ` ${result.draft.text} edited `,
      ),
      { enterTurn: true, text: `${result.draft.text} edited` },
    );
    assert.throws(
      () =>
        service.confirmTranscript(
          operationId,
          result.draftDigest,
          result.draft.text,
        ),
      /confirmation mismatch/,
    );
  } finally {
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("R50-VOICE: sherpa runtime is the pinned real package and worker owner is lazy", async () => {
  const engine = new SherpaSenseVoiceEngine({
    revision: SENSEVOICE_MANIFEST.revision,
    modelPath: "/not-loaded-until-transcription/model.int8.onnx",
    tokensPath: "/not-loaded-until-transcription/tokens.txt",
  });
  assert.equal(engine.runtime.packageVersion, "1.13.5");
  assert.equal(engine.runtime.gitSha1, "3dc7c569");
  assert.equal(engine.runtime.onnxruntimeVersion, "1.27.1");
  await engine.dispose();
});

test("ASR deterministic input gates remain fail-closed", async () => {
  const { confirmBeforeTurn, gateAudio } = await import("./service.js");
  assert.throws(
    () =>
      gateAudio({
        authorized: false,
        claimed: true,
        privateChat: true,
        magic: "RIFF",
        bytes: 10,
        durationMs: 10,
      }),
    PenglaiError,
  );
  assert.throws(
    () =>
      gateAudio({
        authorized: true,
        claimed: false,
        privateChat: true,
        magic: "RIFF",
        bytes: 10,
        durationMs: 10,
      }),
    /claim/,
  );
  assert.throws(
    () => confirmBeforeTurn({ text: "hi", confirmed: false }),
    /not confirmed/,
  );
  assert.deepEqual(confirmBeforeTurn({ text: " hi ", confirmed: true }), {
    enterTurn: true,
    text: "hi",
  });
});

function toneWav(sampleRate: number, durationMs: number): Buffer {
  const frames = Math.round((sampleRate * durationMs) / 1000);
  const data = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    const sample = Math.round(
      8_000 * Math.sin((2 * Math.PI * 440 * index) / sampleRate),
    );
    data.writeInt16LE(sample, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("ASR settings client registers the Penglai page slot and Typert remote", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /settings\.section/);
  assert.match(client, /data-penglai-asr/);
  assert.match(client, /penglaiAsr/);
  assert.match(client, /testTranscribe/);
  assert.doesNotMatch(client, /fetch\("\/penglai\/asr"/);
  const remote = readFileSync(new URL("./remote.ts", import.meta.url), "utf8");
  assert.match(remote, /TypertRemoteService/);
  assert.match(remote, /@Remote/);
});
