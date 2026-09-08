import { inflateSync } from "node:zlib";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PenglaiError } from "@penglai/contracts";
import { assertAuthorizedBytes } from "../authorization.js";
import { loadPenglaiCjkFont } from "../cjk-font.js";
import type { PdfCreateSpec } from "../specs.js";

async function embedPenglaiFont(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit as never);
  // Keep the complete upstream font available offline, but embed only glyphs
  // actually used by this PDF so ordinary documents stay within Office limits.
  return pdf.embedFont(loadPenglaiCjkFont(), { subset: true });
}

export async function createPdf(text: string): Promise<Buffer> {
  return createPdfFromSpec({ format: "pdf", paragraphs: text.split(/\r?\n/) });
}

export async function createPdfFromSpec(spec: PdfCreateSpec): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  if (spec.title) pdf.setTitle(spec.title);
  const font = await embedPenglaiFont(pdf);
  let page = pdf.addPage([612, 792]);
  let y = 720;
  for (const paragraph of spec.paragraphs) {
    for (const line of wrapText(paragraph, 68)) {
      if (y < 72) {
        page = pdf.addPage([612, 792]);
        y = 720;
      }
      page.drawText(line, { x: 72, y, size: 11, font, color: rgb(0, 0, 0) });
      y -= 18;
    }
    y -= 8;
  }
  return Buffer.from(await pdf.save());
}

function wrapText(value: string, chars: number): string[] {
  const out: string[] = [];
  for (const source of value.split(/\r?\n/)) {
    if (!source) out.push("");
    for (let i = 0; i < source.length; i += chars) out.push(source.slice(i, i + chars));
  }
  return out;
}

export async function inspectPdf(bytes: Buffer): Promise<{
  text: string;
  parts: string[];
  pages: number;
  pageTexts: string[];
  pageSizes: Array<{ width: number; height: number }>;
  encrypted?: boolean;
  scanned?: boolean;
}> {
  assertAuthorizedBytes(bytes);
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new PenglaiError("INVALID_INPUT", "unsupported office format");
  let encrypted = false;
  try {
    await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    encrypted = true;
  }
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = pdf.getPageCount();
  const pageSizes = pdf.getPages().map((page) => {
    const size = page.getSize();
    return { width: size.width, height: size.height };
  });
  const pageTexts = extractPdfPageTexts(bytes.toString("latin1"), pages);
  const body = pageTexts.join("\n").replace(/\s+/g, " ").trim();
  const scanned = pages > 0 && !body && !encrypted;
  const title = pdf.getTitle()?.trim() ?? "";
  return {
    text: [title, body].filter(Boolean).join(" ").slice(0, 64_000),
    parts: [
      `pages:${pages}`,
      ...(title ? [`title:${title.slice(0, 120)}`] : []),
      ...(encrypted ? ["encrypted:true"] : []),
      ...(scanned ? ["scanned:ocr-required"] : []),
      ...pageTexts.slice(0, 200).map((text, index) => `page${index}:${text.slice(0, 240)}`),
    ],
    pages,
    pageTexts,
    pageSizes,
    ...(encrypted ? { encrypted: true } : {}),
    ...(scanned ? { scanned: true } : {}),
  };
}

function collectBetween(source: string, open: string, close: string, limit = 4_000): string[] {
  const out: string[] = [];
  let from = 0;
  while (out.length < limit) {
    const start = source.indexOf(open, from);
    if (start < 0) break;
    const body = start + open.length;
    const end = source.indexOf(close, body);
    if (end < 0) break;
    out.push(source.slice(body, end));
    from = end + close.length;
  }
  return out;
}

function extractPdfPageTexts(latin1: string, pageCount: number): string[] {
  const decoded = inflatePdfStreams(latin1);
  const cmap = parseToUnicode(decoded);
  const blocks = collectBetween(decoded, "BT", "ET").map((block) => decodePdfOperators(block, cmap));
  if (blocks.length === 0) {
    const loose = decodePdfOperators(decoded, cmap);
    return Array.from({ length: Math.max(1, pageCount) }, (_, index) => (index === 0 ? loose : ""));
  }
  if (pageCount <= 1) return [blocks.join(" ").replace(/\s+/g, " ").trim()];
  const per = Math.max(1, Math.ceil(blocks.length / pageCount));
  return Array.from({ length: pageCount }, (_, index) => blocks.slice(index * per, (index + 1) * per).join(" ").replace(/\s+/g, " ").trim());
}

function parseToUnicode(decoded: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
    const from = (match[1] ?? "").toLowerCase();
    const to = match[2] ?? "";
    if (!from || to.length % 4 !== 0 || map.has(from)) continue;
    let text = "";
    for (let i = 0; i < to.length; i += 4) {
      text += String.fromCharCode(Number.parseInt(to.slice(i, i + 4), 16));
    }
    map.set(from, text);
  }
  return map;
}

function inflatePdfStreams(latin1: string): string {
  let out = latin1;
  let from = 0;
  while (from < latin1.length) {
    const start = latin1.indexOf("stream", from);
    if (start < 0) break;
    let body = start + 6;
    if (latin1.charCodeAt(body) === 13) body += 1;
    if (latin1.charCodeAt(body) !== 10) {
      from = start + 6;
      continue;
    }
    body += 1;
    const end = latin1.indexOf("endstream", body);
    if (end < 0) break;
    const raw = latin1.slice(body, end);
    try {
      const inflated = inflateSync(Buffer.from(raw, "latin1"));
      out += `\n${inflated.toString("latin1")}`;
    } catch {
      try {
        const trimmed = raw.startsWith("\n") || raw.startsWith("\r")
          ? raw.replace(/^\r?\n/, "").replace(/\r?\n$/, "")
          : raw;
        const inflated = inflateSync(Buffer.from(trimmed, "latin1"));
        out += `\n${inflated.toString("latin1")}`;
      } catch {
        /* keep the original compressed payload */
      }
    }
    from = end + 9;
  }
  return out;
}

function extractPdfLiteralStrings(operators: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < operators.length; i += 1) {
    if (operators.charCodeAt(i) !== 40) continue;
    let text = "";
    let j = i + 1;
    while (j < operators.length) {
      const code = operators.charCodeAt(j);
      if (code === 92 && j + 1 < operators.length) {
        const next = operators[j + 1] ?? "";
        if (next === "n") text += "\n";
        else if (next === "r") text += "\r";
        else if (next === "t") text += "\t";
        else text += next;
        j += 2;
        continue;
      }
      if (code === 41) break;
      text += operators[j] ?? "";
      j += 1;
    }
    parts.push(text);
    i = j;
  }
  return parts;
}

function decodePdfOperators(operators: string, cmap: Map<string, string> = new Map()): string {
  const parts: string[] = extractPdfLiteralStrings(operators);
  for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = (match[1] ?? "").toLowerCase();
    if (!hex) continue;
    if (cmap.size) {
      let text = "";
      const width = [...cmap.keys()][0]?.length ?? 4;
      for (let i = 0; i < hex.length; i += width) {
        text += cmap.get(hex.slice(i, i + width)) ?? "";
      }
      if (text) {
        parts.push(text);
        continue;
      }
    }
    if (hex.length % 2 !== 0) continue;
    const raw = Buffer.from(hex, "hex");
    let utf16 = "";
    for (let i = 0; i + 1 < raw.length; i += 2) utf16 += String.fromCharCode(raw.readUInt16BE(i));
    parts.push(utf16);
  }
  return parts.join(" ");
}

export async function editPdf(bytes: Buffer, op: { text: string }): Promise<Buffer> {
  assertAuthorizedBytes(bytes);
  const pdf = await PDFDocument.load(bytes);
  const font = await embedPenglaiFont(pdf);
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
