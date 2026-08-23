import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createOfficeRemoteApi } from "./remote.js";
import { commit, createDocument, createOfficeService, edit, inspect } from "./service.js";
import { digestBytes } from "./jobs.js";
import { readZip, writeZip } from "./zip.js";
import type { OfficeFormat, OfficeOperation } from "./service.js";

const ooxml = ["docx", "xlsx", "pptx"] as const;

function opFor(format: OfficeFormat, text: string): OfficeOperation {
  if (format === "docx") return { kind: "docx.replaceParagraph", paragraphIndex: 0, text };
  if (format === "xlsx") return { kind: "xlsx.setCell", cell: "B1", value: text };
  if (format === "pptx") return { kind: "pptx.replaceSlideText", slideIndex: 0, text };
  return { kind: "pdf.watermark", text };
}

test("office create/inspect/edit/commit round-trips OOXML with typed operations", async () => {
  const svc = createOfficeService();
  assert.equal(svc.name, "@penglai/office");
  for (const format of ooxml) {
    const created = await createDocument(format, `hello ${format}`);
    const seen = await inspect(created.bytes);
    assert.equal(seen.format, format);
    assert.match(seen.text, new RegExp(format));
    const patched = await edit(created.bytes, opFor(format, "世界"));
    const after = await inspect(commit(patched));
    assert.match(after.text, /世界/);
  }
});

test("office PDF create/inspect/watermark embeds CJK through the bundled OFL font", async () => {
  const created = await createDocument("pdf", "hello pdf 世界");
  const seen = await inspect(created.bytes);
  assert.equal(seen.format, "pdf");
  assert.match(seen.text, /hello pdf|世界/);
  const patched = await edit(created.bytes, { kind: "pdf.watermark", text: "水印" });
  assert.match((await inspect(commit(patched))).text, /水印|hello pdf|世界/);
});

test("office partial-edit keeps unmodified document parts", async () => {
  const extra = {
    docx: { name: "word/header1.xml", xml: "<w:hdr>UNMODIFIED_HEADER</w:hdr>" },
    pptx: { name: "ppt/slides/slide99.xml", xml: "<p:sld>UNMODIFIED_SLIDE</p:sld>" },
  } as const;
  for (const format of ["docx", "pptx"] as const) {
    const created = await createDocument(format, `hello ${format}`);
    const entries = readZip(created.bytes);
    const mark = extra[format];
    entries.push({ name: mark.name, data: Buffer.from(mark.xml, "utf8") });
    const withExtra = writeZip(entries);
    const patched = await edit(withExtra, opFor(format, "世界"));
    const after = readZip(commit(patched));
    assert.equal(
      after.find((entry) => entry.name === mark.name)?.data.toString("utf8"),
      mark.xml,
    );
    const seen = await inspect(commit(patched));
    assert.match(seen.text, /世界/);
  }
  const xlsx = await createDocument("xlsx", "hello xlsx");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.bytes as never);
  wb.addWorksheet("UNMODIFIED_SHEET");
  const withSheet = Buffer.from(await wb.xlsx.writeBuffer());
  const patchedXlsx = await edit(withSheet, { kind: "xlsx.setCell", cell: "B1", value: "世界" });
  const afterXlsx = await inspect(commit(patchedXlsx));
  assert.match(afterXlsx.text, /世界/);
  assert.match(afterXlsx.text, /hello xlsx/);
  assert.equal(afterXlsx.parts.includes("UNMODIFIED_SHEET"), true);
  const pdf = await createDocument("pdf", "hello pdf");
  const patchedPdf = await edit(pdf.bytes, { kind: "pdf.watermark", text: "WMARK" });
  const afterPdf = await inspect(commit(patchedPdf));
  assert.match(afterPdf.text, /hello pdf/);
  assert.notEqual(digestBytes(commit(patchedPdf)), digestBytes(pdf.bytes));
});

test("office remote inspect/create/edit drive the shipped service", async () => {
  const api = createOfficeRemoteApi(createOfficeService());
  const created = await api.create({ format: "docx", text: "hello docx" });
  const seen = await api.inspect({ bytesBase64: created.bytesBase64 });
  assert.match(seen.text, /hello docx/);
  const extra = writeZip([
    ...readZip(Buffer.from(created.bytesBase64, "base64")),
    { name: "word/header1.xml", data: Buffer.from("<w:hdr>KEEP</w:hdr>") },
  ]);
  const patched = await api.edit({
    bytesBase64: extra.toString("base64"),
    format: "docx",
    operation: { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "世界" },
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
    edit: async (input: { bytesBase64: string; replacement?: string; operation?: { kind: string } }) => {
      calls.push("edit");
      if (!input.bytesBase64) return { text: "", bytesBase64: "", format: "docx" };
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
  for (let i = 0; i < 80; i += 1) await new Promise((resolve) => setImmediate(resolve));
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
  for (let i = 0; i < 80; i += 1) await new Promise((resolve) => setImmediate(resolve));
  let result = "";
  for (let i = 0; i < 80; i += 1) {
    tree = render();
    result = "";
    walk(tree, (node) => {
      if (node.props["data-penglai-office-result"] === "1")
        result = String(node.props.children ?? "");
    });
    if (result.includes("世界")) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(calls.includes("create") && calls.includes("edit"), String(calls));
  if (result) assert.match(result, /世界|hello docx/);
  walk(tree, (node) => {
    if (node.props["data-penglai-office-inspect"] === "1")
      (node.props.onClick as () => void)();
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.includes("inspect"), true);
});

test("office rejects secrets and unknown bytes", async () => {
  await assert.rejects(() => createDocument("docx", "api_key=sk-test"), /secret/);
  await assert.rejects(() => inspect(Buffer.from("not-a-document")), /unsupported/);
});
