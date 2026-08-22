import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { PenglaiError } from "@penglai/contracts";
import { assertAuthorizedBytes } from "../authorization.js";

function assertLatinBody(text: string): void {
  if (/[^\u0000-\u00ff]/.test(text)) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "pdf body text cannot embed CJK without an OFL font; 0.5.5 supports latin create/watermark/rotate/merge/inspect only",
    );
  }
}

function decodePdfText(raw: string): string {
  const parts: string[] = [];
  for (const match of raw.matchAll(/\(([^()\\]*)\)/g)) parts.push(match[1] ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function createPdf(text: string): Promise<Buffer> {
  assertLatinBody(text);
  const pdf = await PDFDocument.create();
  pdf.setTitle(text);
  pdf.setSubject(text);
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text.slice(0, 180), { x: 72, y: 720, size: 12, font, color: rgb(0, 0, 0) });
  return Buffer.from(await pdf.save());
}

export async function inspectPdf(bytes: Buffer): Promise<{ text: string; parts: string[]; pages: number }> {
  assertAuthorizedBytes(bytes);
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new PenglaiError("INVALID_INPUT", "unsupported office format");
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = pdf.getPageCount();
  const meta = [pdf.getTitle(), pdf.getSubject()].filter(Boolean).join(" ");
  return {
    text: [meta, decodePdfText(bytes.toString("latin1"))].filter(Boolean).join(" "),
    parts: [`pages:${pages}`],
    pages,
  };
}

export async function editPdf(bytes: Buffer, op: { text: string }): Promise<Buffer> {
  assertAuthorizedBytes(bytes);
  assertLatinBody(op.text);
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPages()[0];
  if (!page) throw new PenglaiError("INVALID_INPUT", "pdf has no pages");
  page.drawText(op.text.slice(0, 120), { x: 72, y: 96, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  return Buffer.from(await pdf.save());
}

export async function rotatePdf(bytes: Buffer, angle: 90 | 180 | 270 = 90): Promise<Buffer> {
  const pdf = await PDFDocument.load(bytes);
  for (const page of pdf.getPages()) page.setRotation(degrees(angle));
  return Buffer.from(await pdf.save());
}

export async function mergePdf(left: Buffer, right: Buffer): Promise<Buffer> {
  const out = await PDFDocument.create();
  const a = await PDFDocument.load(left);
  const b = await PDFDocument.load(right);
  const pages = await out.copyPages(a, a.getPageIndices());
  for (const page of pages) out.addPage(page);
  const more = await out.copyPages(b, b.getPageIndices());
  for (const page of more) out.addPage(page);
  return Buffer.from(await out.save());
}
