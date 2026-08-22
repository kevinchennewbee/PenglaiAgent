import { Document, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";
import { PenglaiError } from "@penglai/contracts";
import { readZip, writeZip } from "../zip.js";
import { assertAuthorizedBytes } from "../authorization.js";

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

export async function inspectDocx(bytes: Buffer): Promise<{ text: string; parts: string[]; paragraphs: string[] }> {
  assertAuthorizedBytes(bytes);
  const entries = readZip(bytes);
  const document = entries.find((entry) => entry.name === "word/document.xml")?.data.toString("utf8") ?? "";
  const paragraphs = [...document.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => xmlText(match[0] ?? ""))
    .filter(Boolean);
  let fallback = "";
  try {
    fallback = (await mammoth.extractRawText({ buffer: bytes })).value;
  } catch {
    fallback = "";
  }
  return {
    text: [paragraphs.join(" "), fallback].filter(Boolean).join(" "),
    parts: [...entries.map((entry) => entry.name), ...paragraphs.map((text, index) => `p${index}:${text.slice(0, 80)}`)],
    paragraphs,
  };
}

export function editDocx(bytes: Buffer, op: { paragraphIndex: number; text: string }): Buffer {
  assertAuthorizedBytes(bytes);
  const escaped = op.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const entries = readZip(bytes);
  const next = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return { name: entry.name, data: Buffer.from(entry.data) };
    const xml = entry.data.toString("utf8");
    const blocks = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
    if (op.paragraphIndex < 0 || op.paragraphIndex >= blocks.length) {
      throw new PenglaiError("INVALID_INPUT", "docx paragraph index out of range");
    }
    let index = 0;
    const patched = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (block) => {
      if (index++ !== op.paragraphIndex) return block;
      if (/<w:t[\s>]/.test(block)) {
        return block.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${escaped}</w:t>`);
      }
      return block.replace(/<\/w:p>/, `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`);
    });
    return { name: entry.name, data: Buffer.from(patched, "utf8") };
  });
  if (!next.some((entry) => entry.name === "word/document.xml")) {
    throw new PenglaiError("INVALID_INPUT", "docx document.xml missing");
  }
  return writeZip(next);
}
