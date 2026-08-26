import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArtifactService } from "@penglai/artifacts";
import { ObjectStore } from "@penglai/contracts";
import { createDocument, createOfficeService, createStructuredDocument, edit, inspect } from "./service.js";
import { readZip, writeZip } from "./zip.js";

test("0.5.7 structured Office creates real multi-part DOCX/XLSX/PPTX/PDF documents", async () => {
  const docx = await createStructuredDocument({
    format: "docx",
    title: "周报",
    sections: [{ heading: "进展", paragraphs: ["完成结构化创建"], bullets: ["可预览", "可编辑"], table: { headers: ["项", "状态"], rows: [["Office", "完成"]] } }],
  });
  assert.match((await inspect(docx.bytes)).text, /周报.*进展.*完成结构化创建.*Office.*完成/s);

  const xlsx = await createStructuredDocument({
    format: "xlsx",
    sheets: [
      { name: "数据", header: true, rows: [["项目", "金额"], ["研发", 100]], columnWidths: [20, 12] },
      { name: "说明", rows: [["本地生成"]] },
    ],
  });
  const xlsxSeen = await inspect(xlsx.bytes);
  assert.deepEqual(xlsxSeen.parts.slice(0, 2), ["数据", "说明"]);
  assert.match(xlsxSeen.text, /研发.*100.*本地生成/s);

  const pptx = await createStructuredDocument({
    format: "pptx",
    theme: "tech",
    slides: [
      { kind: "cover", heading: "蓬莱发布", subheading: "0.5.7" },
      { kind: "content", heading: "真实能力", bullets: ["多平台 IM", "Office"] },
      { kind: "ending", heading: "谢谢" },
    ],
  });
  const pptxSeen = await inspect(pptx.bytes);
  assert.equal(pptxSeen.parts.filter((part) => /^slide\d+:/.test(part)).length, 3);
  assert.match(pptxSeen.text, /蓬莱发布.*真实能力.*多平台 IM.*Office.*谢谢/s);

  const pdf = await createStructuredDocument({ format: "pdf", title: "发布说明", paragraphs: ["第一段", "第二段"] });
  assert.match((await inspect(pdf.bytes)).text, /发布说明/);
});

test("0.5.7 closed Office edits cover paragraphs, tables, ranges, rows, formulas, and explicit PPTX runs", async () => {
  const docx = await createStructuredDocument({
    format: "docx",
    sections: [{ paragraphs: ["第一段"], table: { rows: [["旧值"]] } }],
  });
  const inserted = await edit(docx.bytes, { kind: "docx.insertParagraph", paragraphIndex: 0, position: "after", text: "插入段" });
  const appended = await edit(inserted.bytes, { kind: "docx.appendParagraph", text: "末段" });
  const table = await edit(appended.bytes, { kind: "docx.replaceTableCell", tableIndex: 0, rowIndex: 0, cellIndex: 0, text: "新值" });
  assert.match((await inspect(table.bytes)).text, /第一段.*插入段.*新值.*末段/s);

  const xlsx = await createStructuredDocument({ format: "xlsx", sheets: [{ name: "表一", rows: [["A", 1]] }] });
  const range = await edit(xlsx.bytes, { kind: "xlsx.setRange", sheet: "表一", startCell: "A2", values: [["B", 2], ["C", 3]] });
  const rows = await edit(range.bytes, { kind: "xlsx.appendRows", sheet: "表一", values: [["D", 4]] });
  const formula = await edit(rows.bytes, { kind: "xlsx.setCell", sheet: "表一", cell: "C1", value: "SUM(B1:B4)", formula: true });
  const sheetText = (await inspect(formula.bytes)).text;
  for (const expected of ["B", "2", "C", "3", "D", "4", "=SUM(B1:B4)"]) assert.match(sheetText, new RegExp(expected.replace(/[()]/g, "\\$&")));

  const pptx = await createStructuredDocument({ format: "pptx", slides: [{ kind: "cover", heading: "原标题", subheading: "原副标题" }] });
  const changed = await edit(pptx.bytes, { kind: "pptx.replaceSlideText", slideIndex: 0, runIndex: 1, text: "新副标题" });
  assert.match((await inspect(changed.bytes)).text, /原标题.*新副标题/s);
});

test("0.5.7 Office security rejects external relationships and embedded payloads, not empty OOXML directories", async () => {
  const docx = await createDocument("docx", "安全文档");
  const entries = readZip(docx.bytes);
  const external = writeZip([...entries.map((entry) => ({ name: entry.name, data: Buffer.from(entry.data) })), {
    name: "word/_rels/evil.rels",
    data: Buffer.from('<Relationships><Relationship TargetMode="External" Target="https://example.invalid/payload"/></Relationships>'),
  }]);
  await assert.rejects(() => inspect(external), /ARTIFACT_EXTERNAL_LINK/);

  const embedded = writeZip([...entries.map((entry) => ({ name: entry.name, data: Buffer.from(entry.data) })), {
    name: "word/embeddings/payload.bin",
    data: Buffer.from("payload"),
  }]);
  await assert.rejects(() => inspect(embedded), /ARTIFACT_EMBEDDED_OBJECT/);

  const emptyDirectory = writeZip([...entries.map((entry) => ({ name: entry.name, data: Buffer.from(entry.data) })), {
    name: "word/embeddings/",
    data: Buffer.alloc(0),
  }]);
  assert.equal((await inspect(emptyDirectory)).format, "docx");
});

test("0.5.7 accepted Office edits become immutable Artifacts with parent and operation lineage", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-office57-artifacts-"));
  const artifacts = new ArtifactService(root);
  const svc = createOfficeService({ artifacts });
  const original = await svc.create("docx", "原始内容");
  const parent = artifacts.ingestBytes(original.bytes, {
    name: "original.docx", source: "office", scope: "workspace", workspaceId: "ws-1", sessionId: "sess-1",
  });
  const edited = await svc.edit(original.bytes, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "修改内容" });
  const record = svc.job(edited.id);
  record.workspaceId = "ws-1";
  record.sessionId = "sess-1";
  record.parentArtifactId = parent.id;
  const accepted = svc.accept(edited.id);
  assert.equal(accepted.parentArtifactId, parent.id);
  assert.match(accepted.operationDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.match(artifacts.readControlled(accepted.id, { workspaceId: "ws-1", sessionId: "sess-1" }).bytes.toString("binary"), /^PK/);
  assert.equal(svc.accept(edited.id).id, accepted.id);
  artifacts.close();
});

test("0.5.7 PDF merge accepts only distinct session-bound handles and produces a previewable job", async () => {
  const objects = new ObjectStore();
  const svc = createOfficeService({ objects });
  const left = await svc.create("pdf", "左侧");
  const right = await svc.create("pdf", "右侧");
  const leftHandle = objects.put(left.bytes, { kind: "office", mime: "application/pdf" }).handle;
  const rightHandle = objects.put(right.bytes, { kind: "office", mime: "application/pdf" }).handle;
  objects.bind(leftHandle, { sessionId: "sess-1", workspaceId: "ws-1" });
  objects.bind(rightHandle, { sessionId: "sess-1", workspaceId: "ws-1" });
  const merged = await svc.mergeAttached(leftHandle, rightHandle, "sess-1", "ws-1");
  assert.equal(merged.format, "pdf");
  assert.deepEqual((await inspect(merged.bytes)).parts, ["pages:2"]);
  assert.equal(svc.job(merged.id).state, "PREVIEW_READY");
  await assert.rejects(() => svc.mergeAttached(leftHandle, leftHandle, "sess-1", "ws-1"), /different handles/);
  await assert.rejects(() => svc.mergeAttached(leftHandle, rightHandle, "sess-other", "ws-1"), /bound|UNAUTHORIZED/i);
});
