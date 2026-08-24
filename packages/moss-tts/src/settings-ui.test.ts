import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

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

test("MOSS-TTS settings client loopback registers the official tab and decodes preview WAV", async () => {
  const wav = Buffer.from("RIFF____WAVEfmt ");
  const played: string[] = [];
  const blobs: Array<{ type?: string; size: number }> = [];
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
  const remote = {
    describe: async () => ({ model: "ready" }),
    describeModels: async () => [{
      id: "moss",
      label: "MOSS",
      state: "downloading",
      operation: { operationId: "ttsdl_progress_01", state: "running", completedBytes: 25, totalBytes: 100 },
    }],
    listVoices: async () => [
      { id: "moss-zh-default", displayName: "中文", locale: "zh" },
    ],
    previewVoice: async () => ({
      wavBase64: wav.toString("base64"),
      bytes: wav.length,
    }),
  };
  const mounted: string[] = [];
  let ready = Promise.resolve<unknown>(undefined);
  const remoteContext = {
    penglaiMossTtsSettings: remote,
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
    Buffer,
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
                "remote.penglaiMossTtsSettings",
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
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    Uint8Array,
    Blob: class {
      type: string;
      size: number;
      constructor(parts: Array<Uint8Array>, opts?: { type?: string }) {
        this.type = opts?.type ?? "";
        this.size = parts.reduce((n, part) => n + part.byteLength, 0);
        blobs.push(this);
      }
    },
    URL: {
      createObjectURL: () => "blob:penglai-tts-preview",
      revokeObjectURL: () => undefined,
    },
    Audio: class {
      src: string;
      onended: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
    },
    console,
  };
  vm.runInNewContext(
    readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8"),
    sandbox,
  );
  await ready;
  assert.deepEqual(mounted, ["@penglai/moss-tts"]);
  assert.equal(registered[0]?.name, "settings.section");
  assert.equal(registered[0]?.id, "penglai-moss-tts");
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
  render();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const tree = render();
  let preview: { props: Record<string, unknown> } | undefined;
  let progress = false;
  walk(tree, (node) => {
    if (node.props["data-penglai-model-progress"] === "moss-tts") progress = true;
    if (
      typeof node.props.onClick === "function" &&
      node.props.children === "试听所选声音"
    )
      preview = node;
  });
  assert.equal(progress, true);
  assert.ok(preview);
  (preview!.props.onClick as () => void)();
  await Promise.resolve();
  await Promise.resolve();
  for (let i = 0; i < 8 && played.length === 0; i += 1) await Promise.resolve();
  assert.deepEqual(played, ["blob:penglai-tts-preview"]);
  assert.equal(blobs[0]?.type, "audio/wav");
  assert.equal(blobs[0]?.size, wav.length);
});

test("TTS assistant read-aloud plays shipped synthesize audio for the message text", async () => {
  const wav = Buffer.from("RIFF____WAVEfmt ");
  const played: string[] = [];
  const read: string[] = [];
  const hooks: unknown[] = [];
  let hookIndex = 0;
  const React = {
    useState(init: unknown) {
      const i = hookIndex++;
      if (hooks[i] === undefined)
        hooks[i] = typeof init === "function" ? (init as () => unknown)() : init;
      return [
        hooks[i],
        (next: unknown) => {
          hooks[i] =
            typeof next === "function" ? (next as (v: unknown) => unknown)(hooks[i]) : next;
        },
      ];
    },
  };
  function el(type: unknown, props: Record<string, unknown> | null) {
    return { type, props: props ?? {} };
  }
  const registered: Array<{
    id: string;
    name: string;
    props: { remote: unknown };
    Component: (props: Record<string, unknown>) => { props: Record<string, unknown> };
  }> = [];
  const remote = {
    describe: async () => ({ model: "ready" }),
    describeModels: async () => [],
    listVoices: async () => [{ id: "moss-zh-default", locale: "zh" }],
    previewVoice: async () => ({ wavBase64: wav.toString("base64"), bytes: wav.length }),
    readAloud: async (input: { text: string; operationId: string }) => {
      read.push(input.text);
      assert.match(input.operationId, /^ttsread_/);
      return { wavBase64: wav.toString("base64"), bytes: wav.length };
    },
  };
  let ready = Promise.resolve<unknown>(undefined);
  const sandbox = {
    Promise,
    Object,
    Array,
    String,
    Boolean,
    JSON,
    Error,
    Buffer,
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
            remote: {
              penglaiMossTtsSettings: remote,
              async $mount() {
                return () => undefined;
              },
            },
            inject(_deps: string[], callback: (ctx: unknown) => void) {
              callback({
                remote: { penglaiMossTtsSettings: remote },
                slots: {
                  inject(_name: string, fn: () => unknown) {
                    fn();
                  },
                  register(
                    meta: { id: string; name: string; inject: () => { remote: unknown } },
                    Component: (props: Record<string, unknown>) => { props: Record<string, unknown> },
                  ) {
                    registered.push({
                      id: meta.id,
                      name: meta.name,
                      props: meta.inject(),
                      Component,
                    });
                  },
                },
              });
              return Object.assign(Promise.resolve(), { dispose: async () => undefined });
            },
          });
        },
      },
    },
    document: { documentElement: { lang: "zh" } },
    setInterval: () => 1,
    clearInterval: () => undefined,
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    Uint8Array,
    Blob: class {
      type: string;
      size: number;
      constructor(parts: Array<Uint8Array>, opts?: { type?: string }) {
        this.type = opts?.type ?? "";
        this.size = parts.reduce((n, part) => n + part.byteLength, 0);
      }
    },
    URL: {
      createObjectURL: () => "blob:penglai-tts-read",
      revokeObjectURL: () => undefined,
    },
    Audio: class {
      src: string;
      onended: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
    },
    console,
  };
  vm.runInNewContext(
    readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8"),
    sandbox,
  );
  await ready;
  const action = registered.find((row) => row.id === "penglai-moss-tts-read");
  assert.ok(action);
  assert.equal(action?.name, "conversation.chat.assistant-actions");
  hookIndex = 0;
  const button = action!.Component({ ...action!.props, text: "助手已经记住了" });
  assert.equal(typeof button.props.onClick, "function");
  (button.props.onClick as () => void)();
  await Promise.resolve();
  await Promise.resolve();
  for (let i = 0; i < 8 && played.length === 0; i += 1) await Promise.resolve();
  assert.deepEqual(read, ["助手已经记住了"]);
  assert.deepEqual(played, ["blob:penglai-tts-read"]);
});

test("TTS preview and read-aloud share one playback controller", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /function createAudioPlaybackController/);
  assert.match(client, /const playback = createAudioPlaybackController\(\)/);
  assert.match(client, /await audio\.play\(\)/);
  assert.match(client, /TTS_PLAY_REJECTED/);
  assert.match(client, /readOriginal/);
  assert.equal((client.match(/new media\.Audio\(/g) ?? []).length, 1);
  assert.match(client, /onstalled/);
  assert.match(client, /onabort/);
});
