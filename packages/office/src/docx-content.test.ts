import assert from "node:assert/strict";
import test from "node:test";
import { createDocx, editDocx, inspectDocx } from "./adapters/docx.js";
import { readZip, writeZip } from "./zip.js";

test("DOCX paragraph indices include empty paragraphs and replacement clears all old text runs", async () => {
  const seed = await createDocx("seed");
  const bytes = writeZip(readZip(seed).map((entry) => ({
    name: entry.name,
    data: entry.name === "word/document.xml" ? Buffer.from(entry.data.toString().replace(
      /<w:body>[\s\S]*?<w:sectPr/,
      '<w:body><w:p/><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>old first</w:t></w:r><w:r><w:t>old tail</w:t><w:br/></w:r></w:p><w:p><w:r><w:t>unrelated</w:t></w:r></w:p><w:sectPr',
    )) : entry.data,
  })));
  assert.deepEqual((await inspectDocx(bytes)).paragraphs, ["", "old first old tail", "unrelated"]);
  const changed = editDocx(bytes, { kind: "docx.replaceParagraph", paragraphIndex: 1, text: "new content" });
  assert.deepEqual((await inspectDocx(changed)).paragraphs, ["", "new content", "unrelated"]);
  const xml = readZip(changed).find((entry) => entry.name === "word/document.xml")!.data.toString();
  assert.match(xml, /<w:keepNext\/>/);
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr>/);
  const filled = editDocx(changed, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "filled" });
  assert.deepEqual((await inspectDocx(filled)).paragraphs, ["filled", "new content", "unrelated"]);
});

test("DOCX table-cell replacement clears every paragraph but preserves neighboring cells", async () => {
  const seed = await createDocx("seed");
  const bytes = writeZip(readZip(seed).map((entry) => ({
    name: entry.name,
    data: entry.name === "word/document.xml" ? Buffer.from(entry.data.toString().replace(
      /<w:body>[\s\S]*?<w:sectPr/,
      '<w:body><w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="FFFF00"/></w:tcPr><w:p><w:r><w:t>old first</w:t></w:r></w:p><w:p><w:r><w:t>old second</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>neighbor</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr',
    )) : entry.data,
  })));
  const changed = editDocx(bytes, { kind: "docx.replaceTableCell", tableIndex: 0, rowIndex: 0, cellIndex: 0, text: "new cell" });
  const seen = await inspectDocx(changed);
  assert.deepEqual(seen.paragraphs, ["new cell", "", "neighbor"]);
  assert.doesNotMatch(seen.text, /old first|old second/);
  assert.match(readZip(changed).find((entry) => entry.name === "word/document.xml")!.data.toString(), /w:fill="FFFF00"/);
});
