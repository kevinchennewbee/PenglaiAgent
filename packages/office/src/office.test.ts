import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createOfficeRemoteApi } from "./remote.js";
import { commit, createDocument, createOfficeService, edit, inspect } from "./service.js";
import { readZip, writeZip } from "./zip.js";

const formats = ["docx", "xlsx", "pptx", "pdf"] as const;

test("office create/inspect/edit/commit round-trips four formats", () => {
  const svc = createOfficeService();
  assert.equal(svc.name, "@penglai/office");
  for (const format of formats) {
    const created = createDocument(format, `hello ${format}`);
    const seen = inspect(created.bytes);
    assert.equal(seen.format, format);
    assert.match(seen.text, new RegExp(format));
    const patched = edit(created.bytes, "世界");
    const after = inspect(commit(patched));
    assert.match(after.text, /世界/);
    assert.match(after.text, new RegExp(format));
  }
});

test("office partial-edit keeps unmodified document parts", () => {
  const extra = {
    docx: { name: "word/header1.xml", xml: "<w:hdr>UNMODIFIED_HEADER</w:hdr>" },
    xlsx: { name: "xl/worksheets/sheet2.xml", xml: "<worksheet>UNMODIFIED_SHEET</worksheet>" },
    pptx: { name: "ppt/slides/slide2.xml", xml: "<p:sld>UNMODIFIED_SLIDE</p:sld>" },
  } as const;
  for (const format of ["docx", "xlsx", "pptx"] as const) {
    const created = createDocument(format, `hello ${format}`);
    const entries = readZip(created.bytes);
    const mark = extra[format];
    entries.push({ name: mark.name, data: Buffer.from(mark.xml, "utf8") });
    const withExtra = writeZip(entries);
    const patched = edit(withExtra, "世界");
    const after = readZip(commit(patched));
    assert.equal(
      after.find((entry) => entry.name === mark.name)?.data.toString("utf8"),
      mark.xml,
    );
    const seen = inspect(commit(patched));
    assert.match(seen.text, /世界/);
    assert.match(seen.text, new RegExp(`hello ${format}`));
    assert.equal(after.some((entry) => entry.name === mark.name), true);
  }
  const pdf = createDocument("pdf", "hello pdf");
  const marked = Buffer.from(
    pdf.bytes.toString("latin1").replace("%%EOF", "%UNMODIFIED_PDF_OBJECT\n%%EOF"),
    "latin1",
  );
  const patchedPdf = edit(marked, "世界");
  const raw = commit(patchedPdf).toString("latin1");
  assert.match(raw, /UNMODIFIED_PDF_OBJECT/);
  assert.match(raw, /\/Prev \d+/);
  assert.equal((raw.match(/startxref/g) ?? []).length >= 2, true);
  const extraHex = Buffer.from([0xfe, 0xff, 0x4e, 0x16, 0x75, 0x4c]).toString("hex").toUpperCase();
  const streamBlock = raw.match(/stream\nBT \/F1 12 Tf 72 680 Td <([0-9A-F]+)>\sTj ET\nendstream/);
  assert.ok(streamBlock);
  assert.equal(streamBlock[1], extraHex);
  assert.match(inspect(commit(patchedPdf)).text, /世界/);
  assert.match(inspect(commit(patchedPdf)).text, /hello pdf/);
});

test("office remote inspect/create/edit drive the shipped service", () => {
  const api = createOfficeRemoteApi(createOfficeService());
  const created = api.create({ format: "docx", text: "hello docx" });
  const seen = api.inspect({ bytesBase64: created.bytesBase64 });
  assert.match(seen.text, /hello docx/);
  const extra = writeZip([
    ...readZip(Buffer.from(created.bytesBase64, "base64")),
    { name: "word/header1.xml", data: Buffer.from("<w:hdr>KEEP</w:hdr>") },
  ]);
  const patched = api.edit({
    bytesBase64: extra.toString("base64"),
    replacement: "世界",
  });
  assert.match(patched.text, /世界/);
  assert.equal(
    readZip(Buffer.from(patched.bytesBase64, "base64"))
      .find((entry) => entry.name === "word/header1.xml")
      ?.data.toString("utf8"),
    "<w:hdr>KEEP</w:hdr>",
  );
});

test("office settings client inspect/create/edit go through penglaiOffice remote", async () => {
  const api = createOfficeRemoteApi(createOfficeService());
  const calls: string[] = [];
  const remote = {
    health: async () => api.health(),
    create: async (input: { format: "docx"; text: string }) => {
      calls.push("create");
      return api.create(input);
    },
    inspect: async (input: { bytesBase64: string }) => {
      calls.push("inspect");
      return api.inspect(input);
    },
    edit: async (input: { bytesBase64: string; replacement: string }) => {
      calls.push("edit");
      return api.edit(input);
    },
  };
  const hooks: unknown[] = [];
  let hookIndex = 0;
  const React = {
    useState(init: unknown) {
      const i = hookIndex++;
      if (hooks[i] === undefined) hooks[i] = typeof init === "function" ? (init as () => unknown)() : init;
      return [
        hooks[i],
        (next: unknown) => {
          hooks[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(hooks[i]) : next;
        },
      ];
    },
  };
  function el(type: unknown, props: Record<string, unknown> | null) {
    return { type, props: props ?? {} };
  }
  const registered: Array<{
    id: string;
    Component: (props: { remote: unknown }) => { props: Record<string, unknown> };
    props: { remote: unknown };
  }> = [];
  let ready = Promise.resolve<unknown>(undefined);
  const sandbox = {
    Promise,
    Object,
    Array,
    String,
    JSON,
    Error,
    TypeError,
    document: { documentElement: { lang: "zh" } },
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
              penglaiOffice: remote,
              async $mount() {
                return () => undefined;
              },
            },
            inject(_deps: string[], callback: (ctx: unknown) => void) {
              callback({
                remote: { penglaiOffice: remote },
                slots: {
                  inject(_name: string, fn: () => unknown) {
                    fn();
                  },
                  register(
                    meta: { id: string; inject: () => { remote: unknown } },
                    Component: (props: { remote: unknown }) => { props: Record<string, unknown> },
                  ) {
                    registered.push({ id: meta.id, Component, props: meta.inject() });
                  },
                },
              });
              return Object.assign(Promise.resolve(), { dispose: async () => undefined });
            },
          });
        },
      },
    },
  };
  vm.runInNewContext(readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8"), sandbox);
  await ready;
  assert.equal(registered[0]?.id, "penglai-office");
  const render = () => {
    hookIndex = 0;
    return registered[0]!.Component(registered[0]!.props);
  };
  const walk = (
    node: unknown,
    visit: (n: { props: Record<string, unknown> }) => void,
  ) => {
    if (!node || typeof node !== "object") return;
    const rec = node as { props?: Record<string, unknown> };
    if (rec.props) visit({ props: rec.props });
    const children = rec.props?.children;
    if (Array.isArray(children)) for (const child of children) walk(child, visit);
    else walk(children, visit);
  };
  let tree = render();
  walk(tree, (node) => {
    if (node.props["data-penglai-office-text"] === "1")
      (node.props.onChange as (e: { target: { value: string } }) => void)({
        target: { value: "hello docx" },
      });
  });
  tree = render();
  walk(tree, (node) => {
    if (node.props["data-penglai-office-create"] === "1")
      (node.props.onClick as () => void)();
  });
  await Promise.resolve();
  await Promise.resolve();
  tree = render();
  walk(tree, (node) => {
    if (node.props["data-penglai-office-replacement"] === "1")
      (node.props.onChange as (e: { target: { value: string } }) => void)({
        target: { value: "世界" },
      });
  });
  tree = render();
  walk(tree, (node) => {
    if (node.props["data-penglai-office-edit"] === "1")
      (node.props.onClick as () => void)();
  });
  await Promise.resolve();
  await Promise.resolve();
  tree = render();
  let result = "";
  walk(tree, (node) => {
    if (node.props["data-penglai-office-result"] === "1")
      result = String(node.props.children ?? "");
  });
  assert.deepEqual(calls, ["create", "edit"]);
  assert.match(result, /世界/);
  walk(tree, (node) => {
    if (node.props["data-penglai-office-inspect"] === "1")
      (node.props.onClick as () => void)();
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.includes("inspect"), true);
});

test("office rejects secrets and unknown bytes", () => {
  assert.throws(() => createDocument("docx", "api_key=sk-test"), /secret/);
  assert.throws(() => inspect(Buffer.from("not-a-document")), /unsupported/);
});
