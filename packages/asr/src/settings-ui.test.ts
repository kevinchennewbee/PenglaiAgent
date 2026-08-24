import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createAsrSettingsApi } from "./remote.js";

function el(type: unknown, props: Record<string, unknown> | null) {
  return { type, props: props ?? {} };
}

function walk(
  node: unknown,
  visit: (n: { type: unknown; props: Record<string, unknown> }) => void,
): void {
  if (!node || typeof node !== "object") return;
  const rec = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in rec)) return;
  visit({ type: rec.type, props: rec.props ?? {} });
  const children = rec.props?.children;
  if (Array.isArray(children)) for (const child of children) walk(child, visit);
  else walk(children, visit);
}

function loadAsrClient(remote: Record<string, unknown>) {
  const hooks: unknown[] = [];
  let hookIndex = 0;
  const effects: Array<() => unknown> = [];
  const React = {
    useState(init: unknown) {
      const i = hookIndex++;
      if (hooks[i] === undefined)
        hooks[i] =
          typeof init === "function" ? (init as () => unknown)() : init;
      return [
        hooks[i],
        (next: unknown) => {
          hooks[i] =
            typeof next === "function"
              ? (next as (v: unknown) => unknown)(hooks[i])
              : next;
        },
      ];
    },
    useCallback(fn: unknown) {
      return fn;
    },
    useEffect(fn: () => unknown) {
      effects.push(fn);
    },
    useRef(init: unknown) {
      const i = hookIndex++;
      if (hooks[i] === undefined) hooks[i] = { current: init };
      return hooks[i] as { current: unknown };
    },
  };
  const registered: Array<{
    id: string;
    name: string;
    props: { remote: unknown };
    Component: (props: { remote: unknown }) => unknown;
  }> = [];
  const mounted: string[] = [];
  let ready = Promise.resolve<unknown>(undefined);
  const remoteContext = {
    penglaiAsrSettings: remote,
    async $mount(contribution: { package: string }) {
      mounted.push(contribution.package);
      return () => undefined;
    },
  };
  const slots = {
    inject(_name: string, fn: () => unknown) {
      fn();
    },
    register(
      meta: {
        id: string;
        name: string;
        inject: () => { remote: unknown };
      },
      Component: (props: { remote: unknown }) => unknown,
    ) {
      registered.push({
        id: meta.id,
        name: meta.name,
        props: meta.inject(),
        Component,
      });
    },
  };
  const sandbox = {
    Promise,
    Object,
    Array,
    String,
    Boolean,
    Number,
    Math,
    Date,
    JSON,
    Error,
    window: {
      penglai: {
        beginMicrophoneRequest: async () => ({ nonce: "mic_test" }),
      },
      AudioContext: class {
        decodeAudioData(buf: ArrayBuffer) {
          const header = Buffer.from(buf).subarray(0, 4);
          assert.notEqual(header.toString("ascii"), "RIFF");
          const samples = new Float32Array(4800);
          for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 12) * 0.2;
          return Promise.resolve({
            numberOfChannels: 1,
            length: samples.length,
            sampleRate: 48000,
            getChannelData: () => samples,
          });
        }
        close() {
          return Promise.resolve();
        }
      },
      __ModuleLoader__: {
        load(mod: {
          factory: (req: (name: string) => unknown) => {
            apply: (ctx: unknown) => Promise<unknown>;
          };
        }) {
          const exported = mod.factory((name) =>
            name === "react" ? React : { jsx: el, jsxs: el },
          );
          ready = exported.apply({
            remote: remoteContext,
            inject(dependencies: string[], callback: (ctx: unknown) => void) {
              assert.deepEqual(Array.from(dependencies), [
                "slots",
                "remote.penglaiAsrSettings",
              ]);
              callback({ remote: remoteContext, slots });
              return Object.assign(Promise.resolve(), {
                dispose: async () => undefined,
              });
            },
          });
        },
      },
    },
    document: { documentElement: { lang: "zh" } },
    setInterval: () => 1,
    clearInterval: () => undefined,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    Uint8Array,
    Int16Array,
    Float32Array,
    Event: class {
      type: string;
      bubbles: boolean;
      constructor(type: string, init?: { bubbles?: boolean }) {
        this.type = type;
        this.bubbles = Boolean(init?.bubbles);
      }
    },
    Blob: class {
      parts: Array<Uint8Array>;
      type: string;
      size: number;
      constructor(parts: Array<Uint8Array>, opts?: { type?: string }) {
        this.parts = parts;
        this.type = opts?.type ?? "";
        this.size = parts.reduce((n, part) => n + part.byteLength, 0);
      }
      arrayBuffer() {
        return Promise.resolve(Buffer.concat(this.parts.map((part) => Buffer.from(part))));
      }
    },
    MediaRecorder: class {
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { data: { size: number; arrayBuffer: () => Promise<Buffer> } }) => void) | null =
        null;
      onstop: (() => void) | null = null;
      state = "inactive";
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        const payload = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
        assert.notEqual(payload.subarray(0, 4).toString("ascii"), "RIFF");
        const chunk = Object.assign(new Uint8Array(payload), { size: payload.length });
        this.ondataavailable?.({ data: chunk });
        this.onstop?.();
      }
    },
    AudioContext: class {
      decodeAudioData(buf: ArrayBuffer) {
        const header = Buffer.from(buf).subarray(0, 4);
        assert.notEqual(header.toString("ascii"), "RIFF");
        const samples = new Float32Array(4800);
        for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 12) * 0.2;
        return Promise.resolve({
          numberOfChannels: 1,
          length: samples.length,
          sampleRate: 48000,
          getChannelData: () => samples,
        });
      }
      close() {
        return Promise.resolve();
      }
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    },
    console,
  };
  vm.runInNewContext(
    readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8"),
    sandbox,
  );
  const render = () => {
    hookIndex = 0;
    effects.length = 0;
    const section = registered[0]?.Component(registered[0].props);
    const child = section?.props?.children as
      | { type?: (props: unknown) => unknown; props?: unknown }
      | undefined;
    const tree =
      typeof child?.type === "function" ? child.type(child.props) : section;
    for (const effect of effects) effect();
    return tree;
  };
  const renderId = (id: string, extra: Record<string, unknown> = {}) => {
    hookIndex = 0;
    effects.length = 0;
    const row = registered.find((entry) => entry.id === id);
    assert.ok(row, id);
    const tree = row!.Component({ ...row!.props, ...extra } as never);
    for (const effect of effects) effect();
    return tree;
  };
  return { registered, render, renderId, hooks, mounted, ready };
}

test("ASR settings client registers an official left-nav section and renders the state machine", async () => {
  const remote = {
    describe: async () => ({ model: "ready", enterTurn: false }),
    describeModels: async () => [
      {
        id: "sensevoice",
        label: "SenseVoice",
        state: "downloading",
        operation: { operationId: "asrdl_progress_01", state: "running", completedBytes: 50, totalBytes: 100 },
      },
    ],
    prepareModel: async () => ({}),
    testTranscribe: async (input: { wavBase64: string }) => {
      assert.ok(input.wavBase64.length > 0);
      return {
        text: "fixture",
        language: "zh",
        emotion: "neutral",
        charCount: 7,
        noSpeech: false,
      };
    },
  };
  const loaded = loadAsrClient(remote);
  await loaded.ready;
  assert.deepEqual(loaded.mounted, ["@penglai/asr"]);
  assert.equal(loaded.registered[0]?.name, "settings.section");
  assert.equal(loaded.registered[0]?.id, "penglai-asr");
  loaded.render();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const tree = loaded.render();
  const attrs: string[] = [];
  walk(tree, (node) => {
    for (const [key, value] of Object.entries(node.props)) {
      if (key.startsWith("data-penglai"))
        attrs.push(`${key}=${String(value)}`);
      if (key === "accept") attrs.push(`accept=${String(value)}`);
      if (key === "type" && value === "file") attrs.push("file-input");
    }
  });
  assert.ok(attrs.some((row) => row.includes("data-penglai-asr=1")));
  assert.ok(attrs.some((row) => row.includes("data-penglai-asr-status=ready")));
  assert.ok(attrs.includes("file-input"));
  assert.ok(attrs.some((row) => row.includes("audio/wav")));
  assert.ok(attrs.some((row) => row.includes("data-penglai-model-progress=asr")));
});

test("ASR conversation microphone records to the composer draft via shipped transcribe", async () => {
  const drafts: string[] = [];
  const remote = {
    describe: async () => ({ model: "ready" }),
    describeModels: async () => [],
    testTranscribe: async (input: { wavBase64: string; operationId: string }) => {
      const wav = Buffer.from(input.wavBase64, "base64");
      assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
      assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
      assert.equal(wav.readUInt16LE(20), 1);
      assert.equal(wav.readUInt16LE(22), 1);
      assert.equal(wav.readUInt32LE(24), 16000);
      assert.equal(wav.readUInt16LE(34), 16);
      assert.match(input.operationId, /^asrmic_/);
      return { text: "你好蓬莱", language: "zh", charCount: 4 };
    },
  };
  const loaded = loadAsrClient(remote);
  await loaded.ready;
  const mic = loaded.registered.find((row) => row.id === "penglai-asr-mic");
  assert.ok(mic);
  assert.equal(mic?.name, "conversation.input.right");
  const renderMic = () =>
    loaded.renderId("penglai-asr-mic", {
      inputActions: { setDraft: (text: string) => drafts.push(text) },
    }) as { props: Record<string, unknown> };
  let button = renderMic();
  assert.equal(button.props["data-penglai-asr-mic"], "1");
  assert.equal(typeof button.props.onClick, "function");
  (button.props.onClick as () => void)();
  for (let i = 0; i < 12 && button.props["data-penglai-asr-mic"] !== "recording"; i += 1) {
    await Promise.resolve();
    button = renderMic();
  }
  assert.equal(button.props["data-penglai-asr-mic"], "recording");
  (button.props.onClick as () => void)();
  for (let i = 0; i < 30 && drafts.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(drafts, ["你好蓬莱"]);
  button = renderMic();
  assert.equal(button.props["data-penglai-asr-draft"], "你好蓬莱");
});

test("ASR microphone click requires a native permission nonce before getUserMedia", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /beginMicrophoneRequest/);
  assert.match(client, /getUserMedia\(\{ audio: true \}\)/);
  assert.ok(client.indexOf("beginMicrophoneRequest") < client.indexOf("getUserMedia({ audio: true })"));
});

test("ASR settings testTranscribe rejects audio above 2MiB", async () => {
  const api = createAsrSettingsApi({
    describeCapability: () => ({
      plugin: "active",
      engine: "sherpa-onnx",
      model: "ready",
      enterTurn: false,
      queueDepth: 0,
      activeTranscriptions: 0,
    }),
    describeModels: () => [],
    prepareModel() {},
    pauseDownload() {},
    resumeDownload() {},
    cancelDownload() {},
    getOperation() {},
    async stageAudio() {
      throw new Error("should not stage oversized audio");
    },
    async transcribe() {
      throw new Error("should not transcribe oversized audio");
    },
  });
  const wavBase64 = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(
    () => api.testTranscribe({ wavBase64, operationId: "asrtest02" }),
    /size rejected/,
  );
});
