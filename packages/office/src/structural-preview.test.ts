import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createDocument, createStructuredDocument, edit } from "./service.js";
import { bindOfficePreviewDigest, externalOpenPlan, previewOfficeStructure } from "./structural-preview.js";

test("structural previews bind digest and expose spreadsheet formula status, not ZIP names alone", async () => {
  const created = await createStructuredDocument({
    format: "xlsx",
    sheets: [{ name: "预算", rows: [["科目", "金额"], ["研发", 100]] }],
  });
  const xlsx = await edit(created.bytes, { kind: "xlsx.setCell", sheet: "预算", cell: "C2", value: "B2*2", formula: true });
  const digest = createHash("sha256").update(xlsx.bytes).digest("hex");
  const preview = await previewOfficeStructure(xlsx.bytes, digest, "预算表.xlsx");
  assert.equal(preview.format, "xlsx");
  assert.match(preview.text, /研发/);
  assert.match(preview.text, /=B2\*2/);
  assert.equal(preview.parts.some((part) => part === "预算"), true);
  assert.equal(preview.parts.every((part) => part.includes("/")), false);
  assert.equal(preview.spreadsheet?.calculationStatus, "stored-formulas");
  assert.equal((preview.spreadsheet?.formulaCount ?? 0) >= 1, true);
  assert.equal(preview.imagePpt.status, "not-supported");
  assert.deepEqual(preview.externalOpen, { allowed: true, filename: "预算表.xlsx" });
  assert.throws(() => bindOfficePreviewDigest(xlsx.bytes, "a".repeat(64)), /digest mismatch/);
  assert.equal(externalOpenPlan({ bytes: xlsx.bytes, digest, filename: "../escape.xlsx" }).allowed, false);
});

test("PPTX structural preview is slide text and does not claim image rasterization", async () => {
  const pptx = await createDocument("pptx", "发布说明");
  const digest = createHash("sha256").update(pptx.bytes).digest("hex");
  const preview = await previewOfficeStructure(pptx.bytes, digest, "deck.pptx");
  assert.equal(preview.format, "pptx");
  assert.match(preview.text, /发布说明/);
  assert.match(preview.parts.join("\n"), /slide0:/);
  assert.equal(preview.imagePpt.status, "not-supported");
  assert.match(preview.imagePpt.reason, /does not rasterize/i);
  assert.equal(preview.externalOpen.allowed, true);
});

test("DOCX structural preview uses paragraph text rather than package metadata", async () => {
  const docx = await createDocument("docx", "正文段落");
  const digest = createHash("sha256").update(docx.bytes).digest("hex");
  const preview = await previewOfficeStructure(docx.bytes, digest, "note.docx");
  assert.match(preview.text, /正文段落/);
  assert.equal(preview.parts.some((part) => part.startsWith("p0:") && part.includes("正文段落")), true);
  assert.equal(preview.parts.includes("word/document.xml"), false);
});
