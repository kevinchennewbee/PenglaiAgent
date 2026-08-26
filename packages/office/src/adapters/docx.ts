import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { PenglaiError } from "@penglai/contracts";
import { readZip, writeZip } from "../zip.js";
import { assertAuthorizedBytes } from "../authorization.js";
import type { DocxCreateSpec } from "../specs.js";

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createDocx(text: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function createDocxFromSpec(spec: DocxCreateSpec): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];
  if (spec.title) children.push(new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE }));
  for (const section of spec.sections) {
    if (section.heading) children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    for (const value of section.paragraphs ?? []) children.push(new Paragraph({ children: [new TextRun(value)] }));
    for (const value of section.bullets ?? []) children.push(new Paragraph({ text: value, bullet: { level: 0 } }));
    if (section.table) {
      const rows = [...(section.table.headers ? [section.table.headers] : []), ...section.table.rows];
      children.push(new Table({
        rows: rows.map((cells) => new TableRow({
          children: cells.map((cell) => new TableCell({ children: [new Paragraph(cell)] })),
        })),
      }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function inspectDocx(bytes: Buffer): Promise<{ text: string; parts: string[]; paragraphs: string[] }> {
  assertAuthorizedBytes(bytes);
  const entries = readZip(bytes);
  const document = entries.find((entry) => entry.name === "word/document.xml")?.data.toString("utf8") ?? "";
  const paragraphs = [...document.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => xmlText(match[0] ?? ""))
    .filter(Boolean);
  const headers = entries.filter((entry) => /^word\/(?:header|footer)\d+\.xml$/.test(entry.name)).map((entry) => xmlText(entry.data.toString("utf8"))).filter(Boolean);
  const tables = [...document.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)].map((match) => xmlText(match[0] ?? "")).filter(Boolean);
  const title = paragraphs[0] ?? "";
  const bounded = [...paragraphs.slice(0, 400), ...tables.slice(0, 50), ...headers.slice(0, 20)];
  return {
    text: bounded.join(" ").slice(0, 64_000),
    parts: [
      `title:${title.slice(0, 120)}`,
      `paragraphs:${paragraphs.length}`,
      `tables:${tables.length}`,
      `headers-footers:${headers.length}`,
      ...paragraphs.slice(0, 400).map((text, index) => `p${index}:${text.slice(0, 120)}`),
      ...tables.slice(0, 50).map((text, index) => `table${index}:${text.slice(0, 160)}`),
    ],
    paragraphs,
  };
}

export function editDocx(bytes: Buffer, op:
  | { kind?: "docx.replaceParagraph"; paragraphIndex: number; text: string }
  | { kind: "docx.insertParagraph"; paragraphIndex: number; position: "before" | "after"; text: string }
  | { kind: "docx.appendParagraph"; text: string }
  | { kind: "docx.replaceTableCell"; tableIndex: number; rowIndex: number; cellIndex: number; text: string }
): Buffer {
  assertAuthorizedBytes(bytes);
  const escaped = op.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const entries = readZip(bytes);
  const next = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return { name: entry.name, data: Buffer.from(entry.data) };
    const xml = entry.data.toString("utf8");
    let patched = xml;
    if (op.kind === "docx.appendParagraph") {
      patched = xml.replace(/<w:sectPr\b/, `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p><w:sectPr`);
      if (patched === xml) patched = xml.replace(/<\/w:body>/, `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:body>`);
    } else if (op.kind === "docx.replaceTableCell") {
      let tableIndex = 0;
      patched = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) => {
        if (tableIndex++ !== op.tableIndex) return table;
        let rowIndex = 0;
        return table.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
          if (rowIndex++ !== op.rowIndex) return row;
          let cellIndex = 0;
          return row.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
            if (cellIndex++ !== op.cellIndex) return cell;
            if (/<w:t[\s>]/.test(cell)) return cell.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${escaped}</w:t>`);
            return cell.replace(/<\/w:tc>/, `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:tc>`);
          });
        });
      });
      if (patched === xml) throw new PenglaiError("INVALID_INPUT", "docx table cell out of range");
    } else {
      const blocks = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
      if (op.paragraphIndex < 0 || op.paragraphIndex >= blocks.length) throw new PenglaiError("INVALID_INPUT", "docx paragraph index out of range");
      let index = 0;
      patched = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (block) => {
        if (index++ !== op.paragraphIndex) return block;
        if (op.kind === "docx.insertParagraph") {
          const added = `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
          return op.position === "before" ? `${added}${block}` : `${block}${added}`;
        }
        if (/<w:t[\s>]/.test(block)) {
          return block.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${escaped}</w:t>`);
        }
        return block.replace(/<\/w:p>/, `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`);
      });
    }
    if (patched === xml) {
      if (op.kind === "docx.appendParagraph") throw new PenglaiError("INVALID_INPUT", "docx body missing");
      if (op.kind === "docx.replaceParagraph" || op.kind === undefined) {
        throw new PenglaiError("INVALID_INPUT", "docx paragraph edit failed");
      }
    }
    return { name: entry.name, data: Buffer.from(patched, "utf8") };
  });
  if (!next.some((entry) => entry.name === "word/document.xml")) {
    throw new PenglaiError("INVALID_INPUT", "docx document.xml missing");
  }
  return writeZip(next);
}
