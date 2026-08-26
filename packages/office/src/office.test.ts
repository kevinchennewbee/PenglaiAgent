import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("office settings client presents ordinary-language capabilities and structured templates", async () => {
  const api = createOfficeRemoteApi(createOfficeService());
  const templates = api.templates();
  assert.equal(templates.length, 10);
  assert.deepEqual(new Set(templates.map((row) => row.format)), new Set(["docx", "xlsx", "pptx"]));
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(source, /data-penglai-office-status/);
  assert.match(source, /data-penglai-office-formats/);
  assert.match(source, /data-penglai-office-templates/);
  assert.match(source, /data-penglai-office-example/);
  assert.match(source, /data-penglai-office-safety/);
  assert.match(source, /先给我预览，不要直接保存/);
  assert.doesNotMatch(source, /data-penglai-office-replacement|cell: "B1"|slideIndex: 0/);
});

test("office rejects secrets and unknown bytes", async () => {
  await assert.rejects(() => createDocument("docx", "api_key=sk-test"), /secret/);
  await assert.rejects(() => inspect(Buffer.from("not-a-document")), /unsupported/);
});
