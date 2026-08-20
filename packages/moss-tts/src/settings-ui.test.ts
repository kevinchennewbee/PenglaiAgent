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
  assert.deepEqual(played, ["blob:penglai-tts-preview"]);
  assert.equal(blobs[0]?.type, "audio/wav");
  assert.equal(blobs[0]?.size, wav.length);
});
