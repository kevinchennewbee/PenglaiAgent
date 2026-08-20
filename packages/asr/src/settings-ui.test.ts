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
  return { registered, render, hooks, mounted, ready };
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
