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

export async function inspectDocx(bytes: Buffer): Promise<{ text: string; parts: string[] }> {
  assertAuthorizedBytes(bytes);
  const entries = readZip(bytes);
  const xml = entries
    .filter((entry) => entry.name.endsWith(".xml"))
    .map((entry) => xmlText(entry.data.toString("utf8")))
    .filter(Boolean)
    .join(" ");
  let fallback = "";
  try {
    fallback = (await mammoth.extractRawText({ buffer: bytes })).value;
  } catch {
    fallback = "";
  }
  return { text: [xml, fallback].filter(Boolean).join(" "), parts: entries.map((entry) => entry.name) };
}

export function editDocx(bytes: Buffer, replacement: string): Buffer {
  assertAuthorizedBytes(bytes);
  const escaped = replacement.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const entries = readZip(bytes);
  const next = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return { name: entry.name, data: Buffer.from(entry.data) };
    const xml = entry.data.toString("utf8");
    const patched = xml.includes("</w:body>")
      ? xml.replace("</w:body>", `<w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body>`)
      : `${xml}${escaped}`;
    return { name: entry.name, data: Buffer.from(patched, "utf8") };
  });
  if (!next.some((entry) => entry.name === "word/document.xml")) {
    throw new PenglaiError("INVALID_INPUT", "docx document.xml missing");
  }
  return writeZip(next);
}
